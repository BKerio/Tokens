import path from 'node:path';
import { mkdirSync } from 'node:fs';
import type { Server as HttpServer, IncomingMessage, ServerResponse } from 'node:http';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import formbody from '@fastify/formbody';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { AppContext } from './context.js';
import { env } from './lib/env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { adminRoutes } from './modules/admin/admin.routes.js';
import { vendorAdminRoutes, vendorRegistrationRoutes, vendorSelfRoutes } from './modules/vendors/vendor.routes.js';
import { landlordAdminRoutes, landlordSelfRoutes } from './modules/landlords/landlord.routes.js';
import { meterRoutes } from './modules/meters/meter.routes.js';
import { customerRoutes } from './modules/customers/customer.routes.js';
import { locationRoutes } from './modules/locations/location.routes.js';
import { propertyRoutes } from './modules/properties/property.routes.js';
import { rentalsRoutes } from './modules/rentals/rentals.routes.js';
import { collectionRoutes } from './modules/collections/collection.routes.js';
import { tenantPortalRoutes } from './modules/tenant-portal/tenant-portal.routes.js';
import { publicTokenRoutes, tokenRoutes } from './modules/tokens/token.routes.js';
import { paymentRoutes } from './modules/payments/payment.routes.js';
import { ncbaRoutes } from './modules/ncba/ncba.routes.js';
import { mpesaRoutes } from './modules/mpesa/mpesa.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { enquiryRoutes, publicEnquiryRoutes } from './modules/enquiries/enquiry.routes.js';

/** "*" → allow all; otherwise a comma-separated allow-list. */
export function corsOrigin(value: string): string | string[] | boolean {
  if (value.trim() === '*') return true;
  return value.split(',').map((o) => o.trim()).filter(Boolean);
}

type RoutePlugin = (app: FastifyInstance, ctx: AppContext) => Promise<void>;

/**
 * Builds the configured Fastify instance on top of `httpServer` (shared with
 * Socket.io). Separating app creation from startup allows for clean testing.
 */
export async function buildApp(ctx: AppContext, httpServer: HttpServer): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: ctx.log as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    serverFactory: (handler: (req: IncomingMessage, res: ServerResponse) => void) => {
      httpServer.on('request', handler);
      return httpServer;
    },
  });

  // ── Security ──────────────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(cors, {
    origin: corsOrigin(env.CORS_ORIGIN),
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  });
  // Per-route limits only (OTP, login, public endpoints) - see `config.rateLimit` on routes.
  await app.register(rateLimit, { global: false });

  // ── Body parsing ──────────────────────────────────────────────────────────
  // JSON is built in; payment providers also send form-urlencoded or raw
  // bodies, which the webhook handlers parse themselves.
  await app.register(formbody);
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  // ── Uploaded files (vendor logos) ─────────────────────────────────────────
  const uploadRoot = path.resolve(env.UPLOAD_DIR);
  mkdirSync(uploadRoot, { recursive: true });
  await app.register(fastifyStatic, { root: uploadRoot, prefix: '/uploads/', decorateReply: false });

  app.setErrorHandler(errorHandler);
  app.setNotFoundHandler(notFoundHandler);

  // ── Health check ──────────────────────────────────────────────────────────
  app.get('/', async () => ({ ok: true, service: 'TokenPap API', version: '2.0.0' }));

  // ── Routes ────────────────────────────────────────────────────────────────
  const modules: [string, RoutePlugin][] = [
    ['/auth', authRoutes],
    ['/admin', adminRoutes],
    ['/vendors', vendorAdminRoutes],
    ['/vendor', vendorSelfRoutes],
    ['/landlords', landlordAdminRoutes],
    ['/landlord', landlordSelfRoutes],
    ['/landlord', propertyRoutes],
    // Rent management: locations, leases, ledger, reports, staff (owner + staff)
    ['/landlord', rentalsRoutes],
    ['/collections', collectionRoutes],
    ['/tenant', tenantPortalRoutes],
    ['/meters', meterRoutes],
    ['/customers', customerRoutes],
    ['/locations', locationRoutes],
    ['/tokens', tokenRoutes],
    ['/settings', settingsRoutes],
    ['/enquiries', enquiryRoutes],
    // Unauthenticated
    ['/public/tokens', publicTokenRoutes],
    ['/public/enquiries', publicEnquiryRoutes],
    ['/public/vendor-registrations', vendorRegistrationRoutes],
    // M-Pesa: STK push/status + Safaricom callback and C2B (same URLs as the Laravel API)
    ['/mpesa', mpesaRoutes],
    // NCBA paybill webhook - POST /api/notifications/ncba (same URL as the Laravel API)
    ['/notifications', ncbaRoutes],
    // Admin payment ledger and recovery
    ['/payments', paymentRoutes],
  ];

  await app.register(
    async (api) => {
      for (const [prefix, plugin] of modules) {
        await api.register(async (instance) => plugin(instance, ctx), { prefix });
      }
    },
    { prefix: '/api' },
  );

  return app;
}
