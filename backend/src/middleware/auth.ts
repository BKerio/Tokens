import type { FastifyRequest } from 'fastify';
import { verifyToken } from '../lib/jwt.js';
import { UnauthorizedError } from '../shared/errors/AppError.js';

/**
 * preHandler hook: reads the Bearer token, verifies it, and attaches the
 * decoded payload to `request.user` for downstream handlers/guards.
 *
 * Usage:
 *   app.addHook('preHandler', authenticate)            // whole plugin
 *   app.get('/x', { preHandler: authenticate }, h)     // single route
 */
export async function authenticate(request: FastifyRequest): Promise<void> {
  const header = request.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    throw new UnauthorizedError('Invalid or missing token');
  }

  try {
    request.user = verifyToken(token);
  } catch {
    throw new UnauthorizedError('Invalid or missing token');
  }
}
