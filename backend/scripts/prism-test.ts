import 'dotenv/config';
import type { Server } from 'socket.io';
import { env } from '../src/lib/env.js';
import { logger } from '../src/lib/logger.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import type { AppContext } from '../src/context.js';
import { AuditLogService } from '../src/modules/audit/audit-log.service.js';
import { SystemConfigService } from '../src/modules/settings/system-config.service.js';
import { SmsService } from '../src/integrations/sms.service.js';
import { MailService } from '../src/integrations/mail.service.js';
import { DarajaClient } from '../src/modules/mpesa/daraja.client.js';
import { PrismClient } from '../src/integrations/prism/prism.client.js';
import { PrismTestService, type PrismControlType } from '../src/modules/tokens/prism-test.service.js';

/**
 * Test token generation through Prism using the app's own vending pipeline -
 * the port of `php artisan prism:test-token`. Same engine as the admin
 * "Prism Test" page (PrismTestService).
 *
 *   npm run prism:test -- [meter] [amount] [options]
 *   npm run prism:test -- 47500162848 10
 *   npm run prism:test -- 47500162848 --control=clear_tamper
 *   npm run prism:test -- 47500162848 --control=set_max_overdraft --value=500
 *
 * Options:
 *   --control=<type>   issue a control token instead of credit:
 *                      clear_tamper | clear_credit | set_max_overdraft
 *                      (uses the TOKEN_CONTROL_* mappings from .env)
 *   --value=<n>        control value for set_max_overdraft
 *   --raw              skip the database: use the legacy test meter's STS values
 *                      (SGC 600909, KRN 1, TI 1, EA 7, KEN 255) with no vending overrides
 *
 * Without --raw the meter config is built exactly as a live vend builds it:
 * active Settings → STS vending overrides first, then the meter's own STS
 * values if it exists in the database, then defaults.
 *
 * Issues a REAL token on the Prism network, but writes nothing to the
 * database and sends no SMS.
 */

function parseArgs(argv: string[]) {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const flag = (name: string) => argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  const flagValue = (name: string) => flag(name)?.split('=')[1];

  const control = flagValue('control')?.toUpperCase() as PrismControlType | undefined;
  if (control && !['CLEAR_TAMPER', 'CLEAR_CREDIT', 'SET_MAX_OVERDRAFT'].includes(control)) {
    throw new Error(`Unknown --control "${flagValue('control')}". Use clear_tamper, clear_credit or set_max_overdraft.`);
  }
  const amount = Number(positional[1] ?? 10);
  if (!control && !(amount > 0)) throw new Error(`Amount must be a positive number, got "${positional[1]}".`);

  return {
    meterNumber: positional[0] ?? '47500162848',
    amount,
    control,
    value: flagValue('value') !== undefined ? Number(flagValue('value')) : undefined,
    raw: !!flag('raw'),
  };
}

const group = (token: string) => token.match(/.{1,4}/g)?.join(' ') ?? token;

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const prisma = createPrismaClient();
  const settings = new SystemConfigService(prisma, env.ENCRYPTION_KEY, logger);
  const ctx: AppContext = {
    prisma,
    io: { to: () => ({ emit: () => true }) } as unknown as Server, // no live clients in a CLI run
    log: logger,
    config: env,
    auditLog: new AuditLogService(prisma, logger),
    settings,
    sms: new SmsService(settings, env, logger),
    mail: new MailService(env, logger),
    mpesa: new DarajaClient(logger),
    createPrismClient: () =>
      new PrismClient({
        host: env.PRISM_TOKEN_HOST, port: env.PRISM_TOKEN_PORT, username: env.PRISM_TOKEN_USERNAME,
        password: env.PRISM_TOKEN_PASSWORD, realm: env.PRISM_TOKEN_REALM, rejectUnauthorized: env.PRISM_TLS_VERIFY,
      }),
  };

  console.log('Starting Prism API integration test...');
  console.log(`Meter:   ${input.meterNumber}`);
  console.log(input.control ? `Token:   ${input.control}${input.value !== undefined ? ` (value ${input.value})` : ''}` : `Amount:  ${input.amount}`);

  try {
    const r = await new PrismTestService(ctx).run(input);

    if (r.sts) {
      if (r.source !== 'raw') {
        const o = Object.entries(r.overrides);
        console.log(`Overrides: ${o.length ? o.map(([k, v]) => `${k.replace('vending_', '')}=${v}`).join(', ') : 'none active'}`);
      }
      console.log(`STS:     SGC ${r.sts.sgc} · KRN ${r.sts.krn} · TI ${r.sts.ti} · EA ${r.sts.ea} · TCT ${r.sts.tct} · KEN ${r.sts.ken}`);
    }
    console.log(`Prism:   ${r.prism.host}:${r.prism.port}\n`);

    r.steps.forEach((s, i) => {
      const mark = s.status === 'ok' ? '✔' : s.status === 'failed' ? '✖' : '–';
      console.log(`${i + 1}. ${mark} ${s.label}${s.status === 'skipped' ? ' (skipped)' : ` - ${s.ms} ms`}${s.detail ? `\n     ${s.detail}` : ''}`);
    });

    if (r.ok) {
      console.log('\nSUCCESS: Tokens Generated');
      console.log('-------------------------------------------------');
      r.tokens.forEach((t, i) => {
        console.log(`STS Token ${i + 1}: ${group(t.token)}`);
        const detail = [t.description, t.quantity].filter(Boolean).join(' · ');
        if (detail) console.log(`   ${detail}`);
      });
      console.log('-------------------------------------------------');
    } else {
      console.error(`\nFAILED: ${r.error?.message ?? 'unknown error'}`);
      if (r.error?.code) {
        console.error('API Error Details:');
        console.error(`   Code: ${r.error.code}`);
        console.error(`   Message: ${r.error.details}`);
      }
      process.exitCode = 1;
    }
    if (r.messageId) console.log(`Prism message id: ${r.messageId}`);
    console.log(`\nDone in ${r.durationMs} ms. Disconnected from Prism.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(`FAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
