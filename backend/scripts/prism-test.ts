import 'dotenv/config';
import { env } from '../src/lib/env.js';
import { PrismApiError, PrismClient, tokenStrings } from '../src/integrations/prism/prism.client.js';
import { formatToken } from '../src/modules/tokens/vending.service.js';

/**
 * Issues a real credit token through Prism to verify connectivity and
 * credentials (port of `php artisan prism:test-token`).
 *
 * Usage:
 *   npm run prism:test -- [meterNumber] [amount]
 *   npm run prism:test -- 47500162848 10
 *
 * Uses the legacy test meter's STS values (SGC 600909, KRN 1, TI 1, EA 7, KEN 255).
 */
async function main() {
  const meter = process.argv[2] ?? '47500162848';
  const amount = Number(process.argv[3] ?? 10);

  console.log('Starting Prism API integration test...');
  console.log(`Meter:  ${meter}`);
  console.log(`Amount: ${amount}`);

  const client = new PrismClient({
    host: env.PRISM_TOKEN_HOST,
    port: env.PRISM_TOKEN_PORT,
    username: env.PRISM_TOKEN_USERNAME,
    password: env.PRISM_TOKEN_PASSWORD,
    realm: env.PRISM_TOKEN_REALM,
    rejectUnauthorized: env.PRISM_TLS_VERIFY,
  });

  try {
    console.log(`\n1. Connecting to ${env.PRISM_TOKEN_HOST}:${env.PRISM_TOKEN_PORT} over TLS...`);
    await client.connect();
    console.log('   -> Connected.');

    console.log('\n2. Authenticating...');
    await client.signIn();
    console.log('   -> Authenticated.');

    console.log('\n3. Generating credit token...');
    const tokens = await client.issueCreditToken({ drn: meter, sgc: 600909, krn: 1, ti: 1, ea: 7, tct: 1, ken: 255 }, amount);
    console.log('\nSUCCESS: tokens generated');
    console.log('-------------------------------------------------');
    tokenStrings(tokens).forEach((t, i) => console.log(`STS Token ${i + 1}: ${formatToken(t)}`));
    console.log('-------------------------------------------------');
  } catch (err) {
    console.error(`\nFAILED: ${err instanceof Error ? err.message : err}`);
    if (err instanceof PrismApiError) {
      console.error(`   Code:    ${err.eCode}`);
      console.error(`   Message: ${err.eMsgEn}`);
    }
    process.exitCode = 1;
  } finally {
    client.close();
    console.log('\nDisconnected from Prism.');
  }
}

void main();
