import jwt from 'jsonwebtoken';
import { env } from './env.js';
import { JwtPayload } from '../shared/types/index.js';

/** Thin wrapper around `jsonwebtoken` - no state to hold, so plain functions. */
export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET) as Partial<JwtPayload> & { purpose?: string };
  // Reject single-purpose tokens (e.g. OAuth state) being replayed as sessions.
  if (decoded.purpose || !decoded.userId || !decoded.role) throw new Error('Not a session token');
  return { userId: decoded.userId, role: decoded.role };
}

/** Short-lived signed OAuth `state` value (CSRF protection for the Google redirect). */
export function signOAuthState(): string {
  return jwt.sign({ purpose: 'oauth-state' }, env.JWT_SECRET, { expiresIn: '10m' });
}

export function verifyOAuthState(state: string): boolean {
  try {
    return (jwt.verify(state, env.JWT_SECRET) as { purpose?: string }).purpose === 'oauth-state';
  } catch {
    return false;
  }
}
