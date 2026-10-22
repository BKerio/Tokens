import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { ADMIN_ROLES, AccountStatus, Role, VendorType } from '../../shared/types/index.js';
import { requireVendorId, resolveActor } from '../../shared/utils/actor.js';
import { nullableString, optionalString, paginationSchema, parse } from '../../shared/utils/validation.js';
import { VendorService } from './vendor.service.js';

const accountFields = {
  name: z.string().trim().min(2, 'Name is required'),
  username: z.string().trim().min(3, 'Username must be at least 3 characters'),
  email: z.string().trim().email('Invalid email address'),
  phone: optionalString,
  password: z.string().min(8, 'Password must be at least 8 characters'),
  businessName: z.string().trim().min(2, 'Business name is required'),
  address: optionalString,
  accountId: z.string().trim().min(1, 'Account ID is required'),
  paybill: optionalString,
  vendorType: z.enum(VendorType),
  bankName: optionalString,
};

const createSchema = z.object(accountFields);

const updateSchema = createSchema.partial().extend({
  status: z.enum([AccountStatus.ACTIVE, AccountStatus.SUSPENDED]).optional(),
});

// Public registration: Individual vendors don't supply a business name (their own name is used).
const registerSchema = z
  .object({ ...accountFields, businessName: optionalString, phone: z.string().trim().min(9, 'Phone is required') })
  .refine((d) => d.vendorType !== VendorType.COMPANY || !!d.businessName, {
    message: 'Business name is required for companies',
    path: ['businessName'],
  });

const listSchema = paginationSchema.extend({ search: optionalString, status: z.enum(AccountStatus).optional() });

const profileSchema = z.object({
  businessName: z.string().trim().min(2).optional(),
  address: nullableString,
  vendorType: z.enum(VendorType).optional(),
  bankName: nullableString,
  dashboardSettings: z
    .object({
      primaryColor: z.string().max(50).nullable().optional(),
      tagline: z.string().max(255).nullable().optional(),
      showLogoInSidebar: z.boolean().nullable().optional(),
    })
    .optional(),
});

const smsSchema = z.object({
  provider: optionalString,
  apiUrl: z.string().trim().url('API URL must be a valid URL').optional().or(z.literal('').transform(() => undefined)),
  apiKey: optionalString,
  partnerId: optionalString,
  shortcode: optionalString,
  enabled: z.boolean().optional(),
});

/** /vendors - admin vendor management. */
export async function vendorAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new VendorService(ctx);
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole(ADMIN_ROLES));

  app.get('/', async (req) => ({ ok: true, ...(await service.list(parse(listSchema, req.query))) }));

  app.get('/pending', async () => {
    const result = await service.list({ status: AccountStatus.PENDING, page: 1, limit: 200 });
    return { ok: true, data: result.data };
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => ({ ok: true, data: await service.get(req.params.id) }));

  app.get<{ Params: { id: string } }>('/:id/oversight', async (req) => ({ ok: true, data: await service.oversight(req.params.id) }));

  app.post('/', async (req, reply) => {
    const vendor = await service.create(parse(createSchema, req.body), req.user.userId);
    return reply.status(201).send({ ok: true, message: 'Vendor created successfully', data: vendor });
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const vendor = await service.update(req.params.id, parse(updateSchema, req.body), req.user.userId);
    return { ok: true, message: 'Vendor updated successfully', data: vendor };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    await service.remove(req.params.id, req.user.userId);
    return { ok: true, message: 'Vendor deleted successfully' };
  });

  app.post<{ Params: { id: string } }>('/:id/approve', async (req) => {
    await service.setApproval(req.params.id, true, req.user.userId);
    return { ok: true, message: 'Vendor approved successfully.' };
  });

  app.post<{ Params: { id: string } }>('/:id/reject', async (req) => {
    await service.setApproval(req.params.id, false, req.user.userId);
    return { ok: true, message: 'Vendor registration rejected.' };
  });
}

/** /vendor - the signed-in vendor's own profile, branding and gateway settings. */
export async function vendorSelfRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new VendorService(ctx);
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole([Role.VENDOR]));

  const vendorId = async (req: Parameters<typeof authenticate>[0]) => requireVendorId(await resolveActor(ctx.prisma, req.user));

  app.get('/profile', async (req) => ({ ok: true, data: await service.profile(await vendorId(req)) }));

  app.patch('/profile', async (req) => {
    const data = parse(profileSchema, req.body);
    return { ok: true, message: 'Profile updated successfully.', data: await service.updateProfile(await vendorId(req), data, req.user.userId) };
  });

  app.post('/logo', { bodyLimit: 4 * 1024 * 1024 }, async (req) => {
    const { logo } = parse(z.object({ logo: z.string().min(1, 'Logo is required') }), req.body);
    return { ok: true, message: 'Logo updated successfully.', data: await service.uploadLogo(await vendorId(req), logo, req.user.userId) };
  });

  app.get('/sms-config', async (req) => ({ ok: true, data: await service.smsConfig(await vendorId(req)) }));

  app.put('/sms-config', async (req) => {
    const data = parse(smsSchema, req.body);
    return { ok: true, message: 'SMS configuration updated successfully', data: await service.updateSmsConfig(await vendorId(req), data, req.user.userId) };
  });

  // Read-only: M-Pesa credentials are managed by TokenPap administrators.
  app.get('/mpesa-config', async (req) => ({ ok: true, data: await service.mpesaConfig(await vendorId(req)) }));
}

/** /public/vendor-registrations - self sign-up, pending admin approval. */
export async function vendorRegistrationRoutes(app: FastifyInstance, ctx: AppContext) {
  const service = new VendorService(ctx);

  app.post('/', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req) => {
    const data = parse(registerSchema, req.body);
    await service.register({ ...data, businessName: data.vendorType === VendorType.COMPANY ? data.businessName! : data.name });
    return { ok: true, message: 'Registration successful. Your account is pending admin approval.' };
  });
}
