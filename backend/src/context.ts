import type { Server } from 'socket.io';
import type { PrismaClient } from './generated/prisma/index.js';
import type { EnvConfig } from './lib/env.js';
import type { Logger } from './lib/logger.js';
import type { AuditLogService } from './modules/audit/audit-log.service.js';
import type { SystemConfigService } from './modules/settings/system-config.service.js';
import type { SmsService } from './integrations/sms.service.js';
import type { MailService } from './integrations/mail.service.js';
import type { DarajaClient } from './modules/mpesa/daraja.client.js';
import type { PrismClient } from './integrations/prism/prism.client.js';

/**
 * Shared application context - passed into every route module / service
 * constructor instead of reaching for globals.
 */
export interface AppContext {
  prisma: PrismaClient;
  io: Server;
  log: Logger;
  config: EnvConfig;
  auditLog: AuditLogService;
  settings: SystemConfigService;
  sms: SmsService;
  mail: MailService;
  mpesa: DarajaClient;
  /** A fresh, unconnected Prism client - one per vend, closed afterwards. */
  createPrismClient: () => PrismClient;
}
