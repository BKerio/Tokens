import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../shared/errors/AppError.js';
import { Prisma } from '../generated/prisma/index.js';

/**
 * Global error handler (registered with app.setErrorHandler). Maps known
 * error types onto the standard `{ ok: false, message }` envelope.
 */
export function errorHandler(err: FastifyError | Error, request: FastifyRequest, reply: FastifyReply): void {
  if (err instanceof AppError) {
    if (!err.isOperational) {
      request.log.error({ err }, 'Unexpected (non-operational) error');
    }
    void reply.status(err.statusCode).send({ ok: false, message: err.message, ...(err.details ?? {}) });
    return;
  }

  if (err instanceof ZodError) {
    void reply.status(400).send({ ok: false, message: err.issues[0]?.message ?? 'Invalid request' });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2025') {
      void reply.status(404).send({ ok: false, message: 'Record not found' });
      return;
    }
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | string | undefined) ?? 'field';
      void reply.status(409).send({ ok: false, message: `A record with this ${String(target)} already exists` });
      return;
    }
  }

  // Fastify's own errors (body too large, bad JSON, rate limit, ...) carry a statusCode.
  const statusCode = (err as FastifyError).statusCode;
  if (statusCode && statusCode >= 400 && statusCode < 500) {
    void reply.status(statusCode).send({ ok: false, message: err.message });
    return;
  }

  request.log.error({ err, url: request.url, method: request.method }, 'Unhandled error');
  void reply.status(500).send({ ok: false, message: 'Internal server error' });
}

/** 404 handler for routes that don't match anything. */
export function notFoundHandler(request: FastifyRequest, reply: FastifyReply): void {
  void reply.status(404).send({ ok: false, message: `Route ${request.method} ${request.url} not found` });
}
