import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppContext } from '../../context.js';
import { authenticate } from '../../middleware/auth.js';
import { parse } from '../../shared/utils/validation.js';

/** /locations - Kenyan counties → constituencies → wards, for address pickers. */
export async function locationRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', authenticate);
  const select = { id: true, name: true } as const;

  app.get('/counties', async () => ({
    ok: true,
    data: await ctx.prisma.county.findMany({ where: { isActive: true }, select, orderBy: { id: 'asc' } }),
  }));

  app.get('/constituencies', async (req) => {
    const { countyId } = parse(z.object({ countyId: z.coerce.number().int() }), req.query);
    return {
      ok: true,
      data: await ctx.prisma.constituency.findMany({ where: { countyId, isActive: true }, select, orderBy: { name: 'asc' } }),
    };
  });

  app.get('/wards', async (req) => {
    const { constituencyId } = parse(z.object({ constituencyId: z.coerce.number().int() }), req.query);
    return {
      ok: true,
      data: await ctx.prisma.ward.findMany({ where: { constituencyId, isActive: true }, select, orderBy: { name: 'asc' } }),
    };
  });
}
