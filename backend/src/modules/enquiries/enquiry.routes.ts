import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { requireRole } from '../../shared/guards/requireRole.js';
import { ADMIN_ROLES, EnquiryStatus } from '../../shared/types/index.js';
import { NotFoundError } from '../../shared/errors/AppError.js';
import { optionalString, pageMeta, paginate, paginationSchema, parse } from '../../shared/utils/validation.js';

const enquirySchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(255),
  lastName: z.string().trim().min(1, 'Last name is required').max(255),
  email: z.string().trim().email('Invalid email address').max(255),
  phone: z.string().trim().min(9, 'Phone is required').max(20),
  city: z.string().trim().min(1, 'City is required').max(255),
  premisesType: z.string().trim().min(1, 'Premises type is required'),
  residenceType: z.string().trim().min(1, 'Residence type is required'),
  meterTypes: z.array(z.string().trim().min(1)).min(1, 'Select at least one meter type'),
  mainMeterType: z.string().trim().min(1, 'Main meter type is required'),
  message: z.string().trim().min(1, 'Message is required').max(5000),
});

const listSchema = paginationSchema.extend({ status: z.enum(EnquiryStatus).optional(), search: optionalString });

/** /public/enquiries - landing page contact form. */
export async function publicEnquiryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/', { config: { rateLimit: { max: 5, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const input = parse(enquirySchema, req.body);
    const enquiry = await ctx.prisma.contactEnquiry.create({ data: input });
    return reply.status(201).send({ ok: true, message: 'Enquiry submitted successfully', data: { id: enquiry.id } });
  });
}

/** /enquiries - admin inbox for public enquiries. */
export async function enquiryRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', authenticate);
  app.addHook('preHandler', requireRole(ADMIN_ROLES));

  app.get('/', async (req) => {
    const { page, limit, status, search } = parse(listSchema, req.query);
    const where = {
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' as const } },
              { lastName: { contains: search, mode: 'insensitive' as const } },
              { email: { contains: search, mode: 'insensitive' as const } },
              { phone: { contains: search } },
              { city: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      ctx.prisma.contactEnquiry.findMany({ where, orderBy: { createdAt: 'desc' }, ...paginate(page, limit) }),
      ctx.prisma.contactEnquiry.count({ where }),
    ]);
    return { ok: true, data, meta: pageMeta(total, page, limit) };
  });

  app.get<{ Params: { id: string } }>('/:id', async (req) => {
    const enquiry = await ctx.prisma.contactEnquiry.findUnique({ where: { id: req.params.id } });
    if (!enquiry) throw new NotFoundError('Enquiry');
    return { ok: true, data: enquiry };
  });

  app.patch<{ Params: { id: string } }>('/:id', async (req) => {
    const { status } = parse(z.object({ status: z.enum(EnquiryStatus) }), req.body);
    const enquiry = await ctx.prisma.contactEnquiry.update({ where: { id: req.params.id }, data: { status } });
    await ctx.auditLog.record({
      actorId: req.user.userId, action: 'UPDATE', subjectType: 'ENQUIRY', subjectId: enquiry.id,
      summary: `Marked enquiry from ${enquiry.firstName} ${enquiry.lastName} as ${status.toLowerCase()}`,
    });
    return { ok: true, message: 'Enquiry status updated', data: enquiry };
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req) => {
    const enquiry = await ctx.prisma.contactEnquiry.delete({ where: { id: req.params.id } });
    await ctx.auditLog.record({
      actorId: req.user.userId, action: 'DELETE', subjectType: 'ENQUIRY', subjectId: enquiry.id,
      summary: `Deleted enquiry from ${enquiry.firstName} ${enquiry.lastName}`,
    });
    return { ok: true, message: 'Enquiry deleted' };
  });
}
