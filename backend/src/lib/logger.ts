import pino from 'pino';
import { env } from './env.js';

/**
 * Structured, high-performance logger - also handed to Fastify as its logger
 * instance. Pretty-printed in dev, plain JSON in production. Credentials that
 * may appear in webhook payloads are redacted.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', '*.Password', '*.password', 'payload.Password', 'payload.password'],
    censor: '[redacted]',
  },
  transport:
    env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

export type Logger = typeof logger;
