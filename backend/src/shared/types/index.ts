/**
 * Shared TypeScript types and interfaces used across the entire backend.
 * Import from here to avoid circular dependencies between modules.
 */

// ── Prisma Enums ──────────────────────────────────────────────────────────────
import {
  Role,
  AccountStatus,
  VendorType,
  MeterStatus,
  RecordStatus,
  PropertyType,
  UnitPaymentMethod,
  UnitOccupancy,
  PaymentChannel,
  PaymentStatus,
  TokenType,
  VendMode,
  TokenOwnerType,
  TransactionStatus,
  EnquiryStatus,
  MpesaEnv,
  MpesaTransactionType,
  ConfigValueType,
  OtpPurpose,
} from '../../generated/prisma/index.js';
export {
  Role,
  AccountStatus,
  VendorType,
  MeterStatus,
  RecordStatus,
  PropertyType,
  UnitPaymentMethod,
  UnitOccupancy,
  PaymentChannel,
  PaymentStatus,
  TokenType,
  VendMode,
  TokenOwnerType,
  TransactionStatus,
  EnquiryStatus,
  MpesaEnv,
  MpesaTransactionType,
  ConfigValueType,
  OtpPurpose,
};

/** Platform administrators - the roles the legacy system called admin/system_admin. */
export const ADMIN_ROLES: Role[] = [Role.SUPER_ADMIN, Role.ADMIN];

// ── JWT ───────────────────────────────────────────────────────────────────────
// Shape of the payload encoded inside every JWT token. For CUSTOMER tokens
// `userId` is a customers.id; for every other role it is a users.id.
export interface JwtPayload {
  userId: string;
  role: Role;
}

// Declaration merging - makes `request.user` typed on every Fastify request,
// set by middleware/auth.ts once the token is verified.
declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload;
  }
}

// ── Pagination ────────────────────────────────────────────────────────────────
export interface PaginationQuery {
  page?: number; // 1-indexed, default: 1
  limit?: number; // default: 20, max: 100
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

// ── Standard API Envelope ─────────────────────────────────────────────────────
// Every API response follows this shape for consistency (external webhook
// endpoints excepted - they answer in the shape the provider expects).
export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  message?: string;
}
