import 'dotenv/config';
import type { Server } from 'socket.io';
import { env } from '../src/lib/env.js';
import { logger } from '../src/lib/logger.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import type { AppContext } from '../src/context.js';
import { AuditLogService } from '../src/modules/audit/audit-log.service.js';
import { SystemConfigService } from '../src/modules/settings/system-config.service.js';
import { GatewayCredentialsService } from '../src/modules/settings/gateway-credentials.service.js';
import { NcbaPaymentService } from '../src/modules/ncba/ncba-payment.service.js';
import { SmsService } from '../src/integrations/sms.service.js';
import { MailService } from '../src/integrations/mail.service.js';
import { DarajaClient } from '../src/modules/mpesa/daraja.client.js';
import { PrismClient } from '../src/integrations/prism/prism.client.js';
import { formatToken } from '../src/modules/tokens/vending.service.js';

/**
 * Paybill operations (ports of the legacy artisan commands):
 *
 *   Manually process a paybill payment whose webhook never arrived (token + SMS):
 *     npx tsx scripts/paybill.ts process <transId> <amount> <phone> <till> <meter> [name]
 *
 *   Register Safaricom C2B validation/confirmation URLs for a paybill shortcode:
 *     npx tsx scripts/paybill.ts register-c2b [shortcode] [vendorBusinessName]
 *     (uses that vendor's Daraja credentials, else the global M-Pesa config)
 */
const prisma = createPrismaClient();
const settings = new SystemConfigService(prisma, env.ENCRYPTION_KEY, logger);
const ctx: AppContext = {
  prisma,
  // No live clients in a CLI run - broadcasts become no-ops.
  io: { to: () => ({ emit: () => true }) } as unknown as Server,
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
      password: env.PRISM_TOKEN_PASSWORD, realm: env.PRISM_TOKEN_REALM, rejectUnauthorized: env.PRISM_TLS_VERIFY, log: logger,
    }),
};

async function processPayment(args: string[]) {
  const [transId, amount, phone, till, meter, name = 'Customer'] = args;
  if (!transId || !amount || !phone || !till || !meter) {
    console.error('Usage: npx tsx scripts/paybill.ts process <transId> <amount> <phone> <till> <meter> [name]');
    process.exit(1);
  }
  const ncba = new NcbaPaymentService(ctx);
  if (await ncba.isDuplicate(transId)) {
    console.error(`Transaction ${transId} already exists.`);
    process.exit(1);
  }

  console.log(`Processing paybill payment ${transId}: KES ${amount} from ${phone} for ${till}#${meter}`);
  const result = await ncba.processPayment(
    { TransID: transId, TransAmount: amount, BillRefNumber: till, Narrative: meter, Mobile: phone, name },
    'NCBA',
  );

  if (result.duplicate) {
    console.error(`Transaction ${transId} already exists.`);
    process.exitCode = 1;
    return;
  }
  if (!result.meterFound) {
    console.error('Meter not found. Check till/meter values. (Payment recorded; confirmation SMS attempted.)');
    process.exitCode = 1;
    return;
  }
  if (result.tokenGenerated) {
    console.log('Token generated successfully.');
    ('tokens' in result ? result.tokens : []).forEach((t, i) => console.log(`Token ${i + 1}: ${formatToken(t)}`));
  } else {
    console.error(`Token generation failed: ${'error' in result ? result.error : 'unknown error'}`);
  }
  console.log(result.smsSent ? 'SMS sent to purchaser.' : 'SMS failed to send - check SMS logs.');
  if (!result.tokenGenerated || !result.smsSent) process.exitCode = 1;
}

async function registerC2b(args: string[]) {
  const [shortcodeArg, vendorName] = args;
  const shortCode = shortcodeArg || env.NCBA_PAYBILL_SHORTCODE;
  const confirmationUrl = `${env.APP_URL}/api/mpesa/c2b/confirmation`;
  const validationUrl = `${env.APP_URL}/api/mpesa/c2b/validation`;
  const credentials = new GatewayCredentialsService(ctx);

  let creds: { env: 'SANDBOX' | 'LIVE'; consumerKey: string; consumerSecret: string } | null = null;
  if (vendorName) {
    const vendor = await prisma.vendor.findFirst({
      where: { businessName: { contains: vendorName, mode: 'insensitive' } },
      include: { mpesaConfig: true },
    });
    if (vendor?.mpesaConfig) {
      const c = await credentials.fromStoredConfig(vendor.mpesaConfig);
      if (c.consumerKey && c.consumerSecret) creds = { env: c.env!, consumerKey: c.consumerKey, consumerSecret: c.consumerSecret };
      console.log(`Using Daraja credentials from vendor: ${vendor.businessName}`);
    }
  }
  creds ??= await credentials.globalCredentials();
  if (!creds) {
    console.error('No Daraja credentials available (vendor or global).');
    process.exit(1);
  }

  console.log(`Registering C2B URLs for paybill ${shortCode}`);
  console.log(`Validation:   ${validationUrl}`);
  console.log(`Confirmation: ${confirmationUrl}`);
  const response = await ctx.mpesa.registerC2bUrls(creds, shortCode, confirmationUrl, validationUrl);
  console.log(JSON.stringify(response, null, 2));

  if (String(response.ResponseDescription ?? '').toLowerCase().includes('success')) {
    console.log('C2B URLs registered successfully.');
  } else {
    console.error(`C2B registration failed. If you don't own the Daraja app, Millicom/NCBA must register these URLs on paybill ${shortCode}.`);
    process.exitCode = 1;
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'process') return processPayment(args);
  if (command === 'register-c2b') return registerC2b(args);
  console.error('Usage:\n  npx tsx scripts/paybill.ts process <transId> <amount> <phone> <till> <meter> [name]\n  npx tsx scripts/paybill.ts register-c2b [shortcode] [vendorBusinessName]');
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
