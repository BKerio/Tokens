import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
// Fixed, app-specific salt for key derivation - not a secret itself, just
// domain-separates this key from any other use of the same key material.
const KDF_SALT = 'tokenpap-credentials-v1';

const keyCache = new Map<string, Buffer>();

function deriveKey(secret: string): Buffer {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.scryptSync(secret, KDF_SALT, 32);
    keyCache.set(secret, key);
  }
  return key;
}

/**
 * Encrypts an arbitrary JSON-serializable value with AES-256-GCM, keyed off
 * `secret` (in practice env.ENCRYPTION_KEY). Used to store M-Pesa / SMS
 * gateway credentials at rest.
 *
 * Output is `<iv>.<authTag>.<ciphertext>`, each base64.
 */
export function encryptJson(secret: string, data: unknown): string {
  const key = deriveKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((b) => b.toString('base64')).join('.');
}

/** Reverses {@link encryptJson}. Throws if `secret` is wrong or the payload was tampered with. */
export function decryptJson<T = unknown>(secret: string, payload: string): T {
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted payload');

  const key = deriveKey(secret);
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

/** Convenience wrapper for a single secret string. */
export function encryptString(secret: string, value: string): string {
  return encryptJson(secret, value);
}

/** Reverses {@link encryptString}; returns null for an empty input. */
export function decryptString(secret: string, payload: string | null | undefined): string | null {
  if (!payload) return null;
  return decryptJson<string>(secret, payload);
}

/** SHA-256 hex digest - used for one-time codes, where only a hash is stored. */
export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

/** Constant-time string comparison (safe for credentials of differing length). */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
