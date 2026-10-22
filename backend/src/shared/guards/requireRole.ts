import type { FastifyRequest } from 'fastify';
import { Role } from '../types/index.js';
import { ForbiddenError } from '../errors/AppError.js';

/**
 * preHandler factory enforcing Role-Based Access Control (RBAC).
 * Must run after `authenticate` so `request.user` is populated.
 *
 * Usage:
 *   app.get('/vendors', { preHandler: [authenticate, requireRole(ADMIN_ROLES)] }, handler)
 *
 * @param allowedRoles Roles that are allowed to access the route
 */
export function requireRole(allowedRoles: Role[]) {
  return async (request: FastifyRequest): Promise<void> => {
    const user = request.user;

    if (!user) {
      throw new ForbiddenError('Access denied: User context missing');
    }

    if (!allowedRoles.includes(user.role)) {
      throw new ForbiddenError(`Access denied: Requires one of [${allowedRoles.join(', ')}]`);
    }
  };
}
