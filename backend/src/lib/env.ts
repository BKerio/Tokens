/**
 * Environment variable loading & validation.
 *
 * Runs once at import time (before anything else touches process.env),
 * applies defaults, and throws with a clear message if a required variable
 * is missing - so the app refuses to start rather than fail confusingly later.
 */
import 'dotenv/config';

export interface EnvConfig {
  PORT: string;
  HOST: string;
  NODE_ENV: 'development' | 'production' | 'test';
  LOG_LEVEL: string;
  CORS_ORIGIN: string;
  DATABASE_URL: string;
  JWT_SECRET: string;
  JWT_EXPIRES_IN: string;
  /** Key material for encrypting stored credentials. Falls back to JWT_SECRET. */
  ENCRYPTION_KEY: string;

  /** Public base URL of this API (no trailing slash), e.g. https://api.tokenpap.com */
  APP_URL: string;
  /** Public base URL of the web frontend - used for OAuth redirects. */
  FRONTEND_URL: string;
  /** Where uploaded files (vendor logos) are written; served at /uploads. */
  UPLOAD_DIR: string;

  PRISM_TOKEN_HOST: string;
  PRISM_TOKEN_PORT: number;
  PRISM_TOKEN_USERNAME: string;
  PRISM_TOKEN_PASSWORD: string;
  PRISM_TOKEN_REALM: string;
  /** Verify Prism's TLS certificate. Off by default - the legacy client accepted self-signed certs. */
  PRISM_TLS_VERIFY: boolean;

  /** STS control-token index/value mappings (blank index = action disabled). */
  TOKEN_CONTROLS: Record<'CLEAR_TAMPER' | 'CLEAR_CREDIT' | 'SET_MAX_OVERDRAFT', TokenControlConfig>;

  NCBA_PAYBILL_USERNAME: string;
  NCBA_PAYBILL_PASSWORD: string;
  NCBA_PAYBILL_SHORTCODE: string;

  /** Env-level SMS fallbacks, used when neither vendor nor SystemConfig has a value. */
  SMS_API_KEY?: string;
  SMS_PARTNER_ID?: string;
  SMS_SHORTCODE?: string;
  SMS_API_URL?: string;

  SMTP_HOST?: string;
  SMTP_PORT: number;
  SMTP_USER?: string;
  SMTP_PASSWORD?: string;
  SMTP_SECURE: boolean;
  MAIL_FROM: string;

  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
}

export interface TokenControlConfig {
  index: number | null;
  value: number | null;
  isFlag: boolean;
}

const REQUIRED = ['DATABASE_URL', 'JWT_SECRET'] as const;

function optional(key: string): string | undefined {
  const value = process.env[key];
  return value === undefined || value === '' ? undefined : value;
}

function intOrNull(key: string, fallback: number | null = null): number | null {
  const raw = optional(key);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = optional(key);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function loadEnv(): EnvConfig {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const jwtSecret = process.env.JWT_SECRET!;
  if (jwtSecret.length < 16) {
    throw new Error('JWT_SECRET must be at least 16 characters long');
  }

  const nodeEnv = process.env.NODE_ENV ?? 'development';
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new Error(`NODE_ENV must be one of development|production|test, got "${nodeEnv}"`);
  }

  const port = process.env.PORT ?? '3000';

  return {
    PORT: port,
    HOST: process.env.HOST ?? '0.0.0.0',
    NODE_ENV: nodeEnv as EnvConfig['NODE_ENV'],
    LOG_LEVEL: process.env.LOG_LEVEL ?? 'info',
    CORS_ORIGIN: process.env.CORS_ORIGIN ?? '*',
    DATABASE_URL: process.env.DATABASE_URL!,
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? '7d',
    ENCRYPTION_KEY: optional('ENCRYPTION_KEY') ?? jwtSecret,

    APP_URL: (optional('APP_URL') ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    FRONTEND_URL: (optional('FRONTEND_URL') ?? 'http://localhost:5173').replace(/\/+$/, ''),
    UPLOAD_DIR: optional('UPLOAD_DIR') ?? 'uploads',

    PRISM_TOKEN_HOST: optional('PRISM_TOKEN_HOST') ?? 'pt-vend.prismcrypto.co.za',
    PRISM_TOKEN_PORT: intOrNull('PRISM_TOKEN_PORT', 9443) ?? 9443,
    PRISM_TOKEN_USERNAME: optional('PRISM_TOKEN_USERNAME') ?? '',
    PRISM_TOKEN_PASSWORD: optional('PRISM_TOKEN_PASSWORD') ?? '',
    PRISM_TOKEN_REALM: optional('PRISM_TOKEN_REALM') ?? 'local',
    PRISM_TLS_VERIFY: bool('PRISM_TLS_VERIFY', false),

    TOKEN_CONTROLS: {
      CLEAR_TAMPER: {
        index: intOrNull('TOKEN_CONTROL_CLEAR_TAMPER_INDEX'),
        value: intOrNull('TOKEN_CONTROL_CLEAR_TAMPER_VALUE', 1),
        isFlag: bool('TOKEN_CONTROL_CLEAR_TAMPER_IS_FLAG', true),
      },
      CLEAR_CREDIT: {
        index: intOrNull('TOKEN_CONTROL_CLEAR_CREDIT_INDEX'),
        value: intOrNull('TOKEN_CONTROL_CLEAR_CREDIT_VALUE', 0),
        isFlag: bool('TOKEN_CONTROL_CLEAR_CREDIT_IS_FLAG', false),
      },
      SET_MAX_OVERDRAFT: {
        index: intOrNull('TOKEN_CONTROL_MAX_OVERDRAFT_INDEX'),
        value: intOrNull('TOKEN_CONTROL_MAX_OVERDRAFT_VALUE'),
        isFlag: bool('TOKEN_CONTROL_MAX_OVERDRAFT_IS_FLAG', false),
      },
    },

    NCBA_PAYBILL_USERNAME: optional('NCBA_PAYBILL_USERNAME') ?? '',
    NCBA_PAYBILL_PASSWORD: optional('NCBA_PAYBILL_PASSWORD') ?? '',
    NCBA_PAYBILL_SHORTCODE: optional('NCBA_PAYBILL_SHORTCODE') ?? '880100',

    SMS_API_KEY: optional('SMS_API_KEY'),
    SMS_PARTNER_ID: optional('SMS_PARTNER_ID'),
    SMS_SHORTCODE: optional('SMS_SHORTCODE'),
    SMS_API_URL: optional('SMS_API_URL'),

    SMTP_HOST: optional('SMTP_HOST'),
    SMTP_PORT: intOrNull('SMTP_PORT', 587) ?? 587,
    SMTP_USER: optional('SMTP_USER'),
    SMTP_PASSWORD: optional('SMTP_PASSWORD'),
    SMTP_SECURE: bool('SMTP_SECURE', false),
    MAIL_FROM: optional('MAIL_FROM') ?? 'TokenPap <no-reply@tokenpap.com>',

    GOOGLE_CLIENT_ID: optional('GOOGLE_CLIENT_ID'),
    GOOGLE_CLIENT_SECRET: optional('GOOGLE_CLIENT_SECRET'),
    GOOGLE_REDIRECT_URI: optional('GOOGLE_REDIRECT_URI'),
  };
}

export const env: EnvConfig = loadEnv();
