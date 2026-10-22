import { createServer } from 'node:http';
import type { Server } from 'socket.io';
import { env } from './lib/env.js';
import { logger } from './lib/logger.js';
import { createPrismaClient } from './lib/prisma.js';
import { createSocketServer } from './lib/socket.js';
import { buildApp } from './app.js';
import { AppContext } from './context.js';
import { AuditLogService } from './modules/audit/audit-log.service.js';
import { SystemConfigService } from './modules/settings/system-config.service.js';
import { SmsService } from './integrations/sms.service.js';
import { MailService } from './integrations/mail.service.js';
import { DarajaClient } from './modules/mpesa/daraja.client.js';
import { PrismClient } from './integrations/prism/prism.client.js';
import { BillingService } from './modules/rentals/billing.service.js';

async function start(): Promise<void> {
  // ── Database ───────────────────────────────────────────────────────────────
  const prisma = createPrismaClient();
  await prisma.$connect();
  logger.info('✅ Prisma connected to the database');

  const settings = new SystemConfigService(prisma, env.ENCRYPTION_KEY, logger);
  const ctx: AppContext = {
    prisma,
    io: null as unknown as Server, // attached below, once Fastify owns the HTTP server
    log: logger,
    config: env,
    auditLog: new AuditLogService(prisma, logger),
    settings,
    sms: new SmsService(settings, env, logger),
    mail: new MailService(env, logger),
    mpesa: new DarajaClient(logger),
    createPrismClient: () =>
      new PrismClient({
        host: env.PRISM_TOKEN_HOST,
        port: env.PRISM_TOKEN_PORT,
        username: env.PRISM_TOKEN_USERNAME,
        password: env.PRISM_TOKEN_PASSWORD,
        realm: env.PRISM_TOKEN_REALM,
        rejectUnauthorized: env.PRISM_TLS_VERIFY,
        log: logger,
      }),
  };

  // ── HTTP: Fastify + Socket.io on one server ────────────────────────────────
  // Fastify's request handler is attached first so Socket.io can wrap it and
  // only intercept its own /socket.io/ traffic.
  const httpServer = createServer();
  const app = await buildApp(ctx, httpServer);
  ctx.io = createSocketServer(httpServer);

  await app.listen({ port: Number.parseInt(env.PORT, 10), host: env.HOST });
  logger.info(`🚀 TokenPap API listening on http://${env.HOST}:${env.PORT}/api`);

  // ── Rent billing: posts due rent charges shortly after boot, then hourly ──
  const stopBilling = new BillingService(ctx).startScheduler();

  // ── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`${signal} received - shutting down`);
    stopBilling();
    ctx.io.close();
    await app.close();
    await prisma.$disconnect();
    logger.info('Shutdown complete');
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

start().catch((err) => {
  logger.error(err);
  process.exit(1);
});
