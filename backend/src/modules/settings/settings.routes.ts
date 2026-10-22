import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { ADMIN_ROLES, ConfigValueType, MpesaEnv, MpesaTransactionType, Role } from '../../shared/types/index.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { resolveActor } from '../../shared/utils/actor.js';
import { normalizeMsisdn } from '../../shared/utils/phone.js';
import { optionalString, parse } from '../../shared/utils/validation.js';
import { DarajaClient, firstMissingDarajaField, type DarajaCredentials } from '../mpesa/daraja.client.js';
import { presentConfig } from './system-config.service.js';
import { GatewayCredentialsService, presentMpesaConfig } from './gateway-credentials.service.js';

/** Keys the SMS gateway can't run without - never deletable. */
const CRITICAL_KEYS = ['sms_api_url', 'sms_api_key', 'sms_provider'];

/** A value the client echoed back from a masked secret ("********…") - means "unchanged". */
const isMaskEcho = (v: unknown) => typeof v === 'string' && /^\*+…?$/.test(v);

const valueSchema = z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v));

const createSchema = z.object({
  key: z.string().trim().regex(/^[a-z0-9_]+$/, 'Key may only contain lowercase letters, digits and underscores'),
  value: valueSchema,
  type: z.enum(ConfigValueType),
  category: z.string().trim().min(1),
  description: optionalString,
  isEncrypted: z.boolean().optional(),
});

const updateSchema = z.object({ value: valueSchema, description: optionalString });

const bulkSchema = z.object({
  configs: z.array(z.object({ key: z.string(), value: valueSchema, description: optionalString })).min(1),
});

const vendingSchema = z.object({
  settings: z
    .array(z.object({ key: z.string(), value: z.union([z.string(), z.number(), z.null()]).transform((v) => (v === null ? null : String(v))), isActive: z.boolean().optional() }))
    .min(1),
});

const mpesaConfigSchema = z.object({
  consumerKey: optionalString,
  consumerSecret: optionalString,
  passkey: optionalString,
  shortcode: optionalString,
  tillNo: optionalString,
  env: z.enum(MpesaEnv).optional(),
  transactionType: z.enum(MpesaTransactionType).optional(),
  callbackUrl: z.string().trim().url().optional().or(z.literal('').transform(() => undefined)),
});

const testSmsSchema = z.object({
  phone: z.string().trim().refine((v) => !!normalizeMsisdn(v), 'Enter a valid phone number'),
  message: z.string().trim().min(1).max(480),
  vendorId: optionalString,
});

const testMpesaSchema = z.object({
  phone: z.string().trim().refine((v) => !!normalizeMsisdn(v), 'Enter a valid Safaricom phone number'),
  amount: z.coerce.number().min(1),
  vendorId: optionalString,
  landlordId: optionalString,
});

type KeyParams = { Params: { key: string } };
type IdParams = { Params: { id: string } };

/** /settings - global configuration, STS vending parameters and payment gateways. */
export async function settingsRoutes(app: FastifyInstance, ctx: AppContext) {
  const credentials = new GatewayCredentialsService(ctx);
  const adminOnly = { preHandler: requireRole(ADMIN_ROLES) };
  app.addHook('preHandler', authenticate);

  // ── System config (key/value) ──────────────────────────────────────────────
  app.get('/system-config', adminOnly, async (req) => {
    const { category, search } = parse(z.object({ category: optionalString, search: optionalString }), req.query);
    const rows = await ctx.prisma.systemConfig.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(search ? { OR: [{ key: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}),
      },
      orderBy: [{ category: 'asc' }, { key: 'asc' }],
    });
    return { ok: true, data: rows.map((r) => presentConfig(r, ctx.settings.plaintext(r))) };
  });

  app.get<KeyParams>('/system-config/:key', adminOnly, async (req) => {
    const row = await ctx.prisma.systemConfig.findUnique({ where: { key: req.params.key } });
    if (!row) throw new NotFoundError('Configuration');
    return { ok: true, data: presentConfig(row, ctx.settings.plaintext(row)) };
  });

  app.post('/system-config', adminOnly, async (req, reply) => {
    const input = parse(createSchema, req.body);
    if (await ctx.prisma.systemConfig.findUnique({ where: { key: input.key } })) throw new ConflictError('A configuration with this key already exists');
    const isEncrypted = input.isEncrypted ?? false;
    const row = await ctx.prisma.systemConfig.create({
      data: { ...input, isEncrypted, value: ctx.settings.storable({ isEncrypted, type: input.type }, input.value) },
    });
    await ctx.auditLog.record({ actorId: req.user.userId, action: 'CREATE', subjectType: 'SYSTEM_CONFIG', subjectId: row.key, summary: `Created config ${row.key}` });
    return reply.status(201).send({ ok: true, message: 'Configuration created successfully', data: presentConfig(row, ctx.settings.plaintext(row)) });
  });

  app.put<KeyParams>('/system-config/:key', adminOnly, async (req) => {
    const input = parse(updateSchema, req.body);
    const row = await ctx.prisma.systemConfig.findUnique({ where: { key: req.params.key } });
    if (!row) throw new NotFoundError('Configuration');
    const updated = await ctx.prisma.systemConfig.update({
      where: { key: row.key },
      data: {
        ...(isMaskEcho(input.value) ? {} : { value: ctx.settings.storable(row, input.value) }),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });
    await ctx.auditLog.record({ actorId: req.user.userId, action: 'UPDATE', subjectType: 'SYSTEM_CONFIG', subjectId: row.key, summary: `Updated config ${row.key}` });
    return { ok: true, message: 'Configuration updated successfully', data: presentConfig(updated, ctx.settings.plaintext(updated)) };
  });

  app.post('/system-config/bulk-update', adminOnly, async (req) => {
    const { configs } = parse(bulkSchema, req.body);
    const rows = await ctx.prisma.systemConfig.findMany({ where: { key: { in: configs.map((c) => c.key) } } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const updated: string[] = [];

    await ctx.prisma.$transaction(
      configs.flatMap((c) => {
        const row = byKey.get(c.key);
        if (!row || isMaskEcho(c.value)) return [];
        updated.push(c.key);
        return [
          ctx.prisma.systemConfig.update({
            where: { key: c.key },
            data: { value: ctx.settings.storable(row, c.value), ...(c.description !== undefined ? { description: c.description } : {}) },
          }),
        ];
      }),
    );
    if (updated.length) {
      await ctx.auditLog.record({
        actorId: req.user.userId, action: 'UPDATE', subjectType: 'SYSTEM_CONFIG', subjectId: updated.join(','),
        summary: `Updated ${updated.length} config value(s): ${updated.join(', ')}`,
      });
    }
    return { ok: true, message: 'Configurations updated successfully', data: { updated } };
  });

  app.delete<KeyParams>('/system-config/:key', adminOnly, async (req) => {
    if (CRITICAL_KEYS.includes(req.params.key)) throw new ForbiddenError('Cannot delete critical configuration');
    const row = await ctx.prisma.systemConfig.findUnique({ where: { key: req.params.key } });
    if (!row) throw new NotFoundError('Configuration');
    await ctx.prisma.systemConfig.delete({ where: { key: row.key } });
    await ctx.auditLog.record({ actorId: req.user.userId, action: 'DELETE', subjectType: 'SYSTEM_CONFIG', subjectId: row.key, summary: `Deleted config ${row.key}` });
    return { ok: true, message: 'Configuration deleted successfully' };
  });

  // ── STS vending parameters ─────────────────────────────────────────────────
  app.get('/vending', adminOnly, async () => ({
    ok: true,
    data: await ctx.prisma.vendingSetting.findMany({ orderBy: { key: 'asc' } }),
  }));

  app.put('/vending', adminOnly, async (req) => {
    const { settings } = parse(vendingSchema, req.body);
    const existing = await ctx.prisma.vendingSetting.findMany({ where: { key: { in: settings.map((s) => s.key) } }, select: { key: true } });
    const known = new Set(existing.map((e) => e.key));
    const unknown = settings.find((s) => !known.has(s.key));
    if (unknown) throw new BadRequestError(`Unknown vending setting: ${unknown.key}`);

    await ctx.prisma.$transaction(
      settings.map((s) =>
        ctx.prisma.vendingSetting.update({
          where: { key: s.key },
          data: { value: s.value, ...(s.isActive !== undefined ? { isActive: s.isActive } : {}) },
        }),
      ),
    );
    await ctx.auditLog.record({
      actorId: req.user.userId, action: 'UPDATE', subjectType: 'VENDING_SETTING', subjectId: settings.map((s) => s.key).join(','),
      summary: `Updated vending settings: ${settings.map((s) => `${s.key}=${s.value}`).join(', ')}`,
    });
    return { ok: true, message: 'Vending settings updated successfully', data: await ctx.prisma.vendingSetting.findMany({ orderBy: { key: 'asc' } }) };
  });

  // ── Per-vendor / per-landlord M-Pesa (Daraja) credentials ──────────────────
  app.get('/payment-config/entities', adminOnly, async () => {
    const [vendors, landlords] = await Promise.all([
      ctx.prisma.vendor.findMany({ orderBy: { businessName: 'asc' }, include: { user: { select: { email: true } }, mpesaConfig: true } }),
      ctx.prisma.landlord.findMany({ orderBy: { fullName: 'asc' }, include: { user: { select: { email: true } }, mpesaConfig: true } }),
    ]);
    return {
      ok: true,
      data: {
        vendors: vendors.map((v) => ({
          id: v.id, type: 'vendor' as const, name: v.businessName, subtitle: v.user.email, vendorType: v.vendorType, status: v.status,
          hasMpesaConfig: !!v.mpesaConfig, mpesaEnv: v.mpesaConfig?.env ?? null, mpesaShortcode: v.mpesaConfig?.shortcode ?? null,
        })),
        landlords: landlords.map((l) => ({
          id: l.id, type: 'landlord' as const, name: l.fullName, subtitle: l.user.email, status: l.status, phone: l.phone, paymentAccount: l.paymentAccount,
          hasMpesaConfig: !!l.mpesaConfig, mpesaEnv: l.mpesaConfig?.env ?? null, mpesaShortcode: l.mpesaConfig?.shortcode ?? null,
        })),
      },
    };
  });

  app.get<IdParams>('/payment-config/vendors/:id', adminOnly, async (req) => {
    const vendor = await ctx.prisma.vendor.findUnique({ where: { id: req.params.id }, include: { user: { select: { email: true } }, mpesaConfig: true } });
    if (!vendor) throw new NotFoundError('Vendor');
    return {
      ok: true,
      data: {
        owner: { id: vendor.id, name: vendor.businessName, email: vendor.user.email, vendorType: vendor.vendorType, status: vendor.status },
        mpesaConfig: presentMpesaConfig(vendor.mpesaConfig),
      },
    };
  });

  app.put<IdParams>('/payment-config/vendors/:id', adminOnly, async (req) => {
    const input = parse(mpesaConfigSchema, req.body);
    if (!(await ctx.prisma.vendor.count({ where: { id: req.params.id } }))) throw new NotFoundError('Vendor');
    const saved = await credentials.upsertMpesaConfig({ vendorId: req.params.id }, input);
    await ctx.auditLog.record({ actorId: req.user.userId, action: 'UPDATE', subjectType: 'MPESA_CONFIG', subjectId: saved.id, summary: 'Updated vendor M-Pesa configuration' });
    return { ok: true, message: 'Vendor M-Pesa configuration updated successfully', data: presentMpesaConfig(saved) };
  });

  app.get<IdParams>('/payment-config/landlords/:id', adminOnly, async (req) => {
    const landlord = await ctx.prisma.landlord.findUnique({ where: { id: req.params.id }, include: { user: { select: { email: true } }, mpesaConfig: true } });
    if (!landlord) throw new NotFoundError('Landlord');
    return {
      ok: true,
      data: {
        owner: { id: landlord.id, name: landlord.fullName, email: landlord.user.email, phone: landlord.phone, paymentAccount: landlord.paymentAccount, status: landlord.status },
        mpesaConfig: presentMpesaConfig(landlord.mpesaConfig),
      },
    };
  });

  app.put<IdParams>('/payment-config/landlords/:id', adminOnly, async (req) => {
    const input = parse(mpesaConfigSchema, req.body);
    if (!(await ctx.prisma.landlord.count({ where: { id: req.params.id } }))) throw new NotFoundError('Landlord');
    const saved = await credentials.upsertMpesaConfig({ landlordId: req.params.id }, input);
    await ctx.auditLog.record({ actorId: req.user.userId, action: 'UPDATE', subjectType: 'MPESA_CONFIG', subjectId: saved.id, summary: 'Updated landlord M-Pesa configuration' });
    return { ok: true, message: 'Landlord M-Pesa configuration updated successfully', data: presentMpesaConfig(saved) };
  });

  // ── Connectivity tests ─────────────────────────────────────────────────────
  // Vendors may test their own SMS gateway; admins may test any vendor's or the global one.
  app.post('/test-sms', { preHandler: requireRole([...ADMIN_ROLES, Role.VENDOR]) }, async (req) => {
    const input = parse(testSmsSchema, req.body);
    const actor = await resolveActor(ctx.prisma, req.user);
    const vendorId = actor.role === Role.VENDOR ? actor.vendorId : input.vendorId;
    // No fallback here: the test must show whether these exact settings work.
    const ok = await ctx.sms.send(input.phone, input.message, await credentials.vendorSmsConfig(vendorId), { fallbackToGlobal: false });
    if (!ok) throw new BadRequestError('Failed to send test SMS. Check the gateway settings and server logs.');
    return { ok: true, message: 'Test SMS sent successfully' };
  });

  app.post('/test-mpesa', adminOnly, async (req) => {
    const input = parse(testMpesaSchema, req.body);
    const stored = input.vendorId
      ? await ctx.prisma.mpesaConfig.findUnique({ where: { vendorId: input.vendorId } })
      : input.landlordId
        ? await ctx.prisma.mpesaConfig.findUnique({ where: { landlordId: input.landlordId } })
        : null;
    if ((input.vendorId || input.landlordId) && !stored) throw new BadRequestError('This account has no M-Pesa configuration yet.');

    let creds: DarajaCredentials | null;
    if (stored) {
      const partial = await credentials.fromStoredConfig(stored);
      const missing = firstMissingDarajaField(partial);
      if (missing) throw new BadRequestError(`M-Pesa configuration is incomplete. Missing: ${missing}`);
      creds = partial as DarajaCredentials;
    } else {
      creds = await credentials.globalCredentials();
      if (!creds) throw new BadRequestError('Global M-Pesa credentials are not configured.');
    }

    const response = await ctx.mpesa.stkPush(creds, input.phone, input.amount, 'TestPayment');
    if (DarajaClient.isError(response)) throw new BadRequestError(DarajaClient.errorMessage(response));
    return { ok: true, message: 'Test STK push request sent', data: response };
  });
}
