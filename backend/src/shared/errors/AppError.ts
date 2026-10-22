/**
 * Custom application error class.
 *
 * isOperational: true  → known, expected error (404, 403, 400, etc.)
 * isOperational: false → unexpected programming bug (triggers 500)
 *
 * Usage:
 *   throw new NotFoundError('Meter')          → 404
 *   throw new ForbiddenError()                → 403
 *   throw new BadRequestError('Invalid data') → 400
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  /** Optional extra fields merged into the JSON error body. */
  public readonly details?: Record<string, unknown>;

  constructor(message: string, statusCode: number, isOperational = true, details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.details = details;
    // Maintains correct prototype chain for instanceof checks
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to perform this action') {
    super(message, 403);
  }
}

export class BadRequestError extends AppError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409);
  }
}

/** Request was well-formed but can't be acted on (e.g. meter has no price set). */
export class UnprocessableError extends AppError {
  constructor(message: string) {
    super(message, 422);
  }
}

/** An upstream dependency (Prism, Safaricom, SMS gateway) rejected or failed the call. */
export class UpstreamError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 502, true, details);
  }
}
