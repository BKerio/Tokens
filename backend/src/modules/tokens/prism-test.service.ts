import { AppContext } from '../../context.js';
import { PrismApiError, tokenStrings, type IssuedToken, type MeterConfigIn } from '../../integrations/prism/prism.client.js';
import { VendingService } from './vending.service.js';

/**
 * Prism connectivity / token-generation diagnostic - the engine behind both
 * `npm run prism:test` (scripts/prism-test.ts) and the admin "Prism Test" page.
 *
 * Issues a REAL token on the Prism network using the same meter config a live
 * vend builds (VendingService.meterConfig), but records no transaction and
 * sends no SMS. Never throws: every outcome comes back as a step-by-step result.
 */

/** Laravel's `prism:test-token` dummy meter values. */
export const LEGACY_TEST_METER = { sgc: 600909, krn: 1, ti: 1, ea: 7, ken: 255 };

export type PrismControlType = 'CLEAR_TAMPER' | 'CLEAR_CREDIT' | 'SET_MAX_OVERDRAFT';

export interface PrismTestInput {
  meterNumber: string;
  /** Credit amount (ignored for control tokens). */
  amount?: number;
  /** Issue a control token instead of credit. */
  control?: PrismControlType;
  /** Control value for SET_MAX_OVERDRAFT. */
  value?: number;
  /** Skip the database: legacy test meter values, no vending overrides. */
  raw?: boolean;
}

export type PrismStepKey = 'config' | 'connect' | 'auth' | 'generate';

export interface PrismTestStep {
  key: PrismStepKey;
  label: string;
  status: 'ok' | 'failed' | 'skipped';
  ms: number;
  detail?: string;
}

export interface PrismTestResult {
  ok: boolean;
  meterNumber: string;
  tokenType: 'CREDIT' | PrismControlType;
  amount: number | null;
  controlValue: number | null;
  source: 'database' | 'defaults' | 'raw';
  meter: { type: string; status: string; owner: string | null } | null;
  overrides: Record<string, number>;
  sts: Omit<MeterConfigIn, 'drn' | 'allowKrnUpdate'> | null;
  prism: { host: string; port: number };
  steps: PrismTestStep[];
  tokens: { token: string; description: string | null; quantity: string | null }[];
  messageId: string | null;
  error: { message: string; code?: string; details?: string } | null;
  startedAt: string;
  durationMs: number;
}

const STEP_LABELS: Record<PrismStepKey, string> = {
  config: 'Build meter config',
  connect: 'Connect over TLS',
  auth: 'Authenticate',
  generate: 'Generate token',
};

export class PrismTestService {
  constructor(private app: AppContext) {}

  async run(input: PrismTestInput): Promise<PrismTestResult> {
    const started = Date.now();
    const env = this.app.config;
    const steps: PrismTestStep[] = [];
    const result: PrismTestResult = {
      ok: false,
      meterNumber: input.meterNumber,
      tokenType: input.control ?? 'CREDIT',
      amount: input.control ? null : input.amount ?? 10,
      controlValue: null,
      source: input.raw ? 'raw' : 'defaults',
      meter: null,
      overrides: {},
      sts: null,
      prism: { host: env.PRISM_TOKEN_HOST, port: env.PRISM_TOKEN_PORT },
      steps,
      tokens: [],
      messageId: null,
      error: null,
      startedAt: new Date(started).toISOString(),
      durationMs: 0,
    };

    // Runs one step, timing it; returns false (and fills result.error) on failure.
    const step = async (key: PrismStepKey, fn: () => Promise<string | void>): Promise<boolean> => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        steps.push({ key, label: STEP_LABELS[key], status: 'ok', ms: Date.now() - t0, detail: detail || undefined });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        steps.push({ key, label: STEP_LABELS[key], status: 'failed', ms: Date.now() - t0, detail: message });
        result.error = err instanceof PrismApiError ? { message, code: err.eCode, details: err.eMsgEn } : { message };
        return false;
      }
    };
    const skipRest = (from: PrismStepKey[]) =>
      from.forEach((key) => steps.push({ key, label: STEP_LABELS[key], status: 'skipped', ms: 0 }));

    // ── 1. Meter config: the same path a live vend takes, unless raw ─────────
    let meterConfig: MeterConfigIn | null = null;
    let control: { index: number; value: number; isFlag: boolean } | null = null;
    const configOk = await step('config', async () => {
      if (input.raw) {
        meterConfig = { drn: input.meterNumber, tct: 1, allowKrnUpdate: false, ...LEGACY_TEST_METER };
      } else {
        const dbMeter = await this.app.prisma.meter.findUnique({
          where: { meterNumber: input.meterNumber },
          include: { vendor: { select: { businessName: true } }, landlord: { select: { fullName: true } } },
        });
        result.overrides = await this.app.settings.vendingOverrides();
        meterConfig = await new VendingService(this.app).meterConfig(dbMeter ?? { meterNumber: input.meterNumber, ...LEGACY_TEST_METER });
        if (dbMeter) {
          result.source = 'database';
          result.meter = { type: dbMeter.type, status: dbMeter.status, owner: dbMeter.vendor?.businessName ?? dbMeter.landlord?.fullName ?? null };
        }
      }
      if (input.control) {
        const cfg = env.TOKEN_CONTROLS[input.control];
        if (cfg.index === null) throw new Error(`Control token mapping for ${input.control} is not configured (TOKEN_CONTROL_*_INDEX in the server .env).`);
        const value = input.control === 'SET_MAX_OVERDRAFT' ? (input.value ?? cfg.value) : cfg.value;
        if (value === null || value === undefined || Number.isNaN(value)) throw new Error(`A control value is required for ${input.control}.`);
        control = { index: cfg.index, value, isFlag: cfg.isFlag };
        result.controlValue = value;
      }
      const { drn: _drn, allowKrnUpdate: _k, ...sts } = meterConfig!;
      result.sts = sts;
      return result.source === 'database'
        ? `Meter found (${result.meter?.owner ?? 'unassigned'})`
        : result.source === 'raw' ? 'Raw legacy test values' : 'Meter not in database - legacy test values';
    });

    if (!configOk) {
      skipRest(['connect', 'auth', 'generate']);
      result.durationMs = Date.now() - started;
      return result;
    }

    // ── 2-4. Prism: connect, sign in, issue ─────────────────────────────────
    const client = this.app.createPrismClient();
    try {
      if (!(await step('connect', async () => { await client.connect(); }))) {
        skipRest(['auth', 'generate']);
      } else if (!(await step('auth', async () => { await client.signIn(); }))) {
        skipRest(['generate']);
      } else {
        let issued: IssuedToken[] = [];
        const generated = await step('generate', async () => {
          const c = control as { index: number; value: number; isFlag: boolean } | null;
          issued = c
            ? await client.issueSetControlToken(meterConfig!, c.isFlag, c.index, c.value)
            : await client.issueCreditToken(meterConfig!, result.amount!);
          return `${issued.length} token(s)`;
        });
        result.messageId = client.lastMessageId;
        if (generated) {
          const digits = tokenStrings(issued);
          result.tokens = issued.map((t, i) => ({
            token: digits[i] ?? '',
            description: t.description ?? null,
            quantity: t.scaledAmount ? `${t.scaledAmount} ${t.scaledUnitName ?? ''}`.trim() : null,
          }));
          result.ok = true;
        }
      }
    } finally {
      client.close();
    }

    result.durationMs = Date.now() - started;
    return result;
  }
}
