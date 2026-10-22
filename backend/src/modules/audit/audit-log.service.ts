import type { PrismaClient } from '../../generated/prisma/index.js';
import { Prisma } from '../../generated/prisma/index.js';
import type { Logger } from '../../lib/logger.js';

export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'LOGIN_FAILED'
  | 'APPROVE' | 'REJECT' | 'VEND' | 'PASSWORD_RESET';

export type AuditSubjectType =
  | 'USER' | 'VENDOR' | 'LANDLORD' | 'METER' | 'CUSTOMER' | 'PROPERTY' | 'HIERARCHY'
  | 'TENANT' | 'TOKEN' | 'PAYMENT' | 'SYSTEM_CONFIG' | 'VENDING_SETTING' | 'MPESA_CONFIG'
  | 'SMS_CONFIG' | 'ENQUIRY' | 'LOCATION' | 'LEASE' | 'LEDGER' | 'STAFF';

export interface RecordAuditInput {
  /** users.id of whoever acted; null for system events (webhooks, customers). */
  actorId: string | null;
  action: AuditAction;
  subjectType: AuditSubjectType;
  subjectId: string;
  /** Short human-readable line, e.g. "Updated task: Break fixes for the Proxmox server". */
  summary?: string;
  oldValues?: unknown;
  newValues?: unknown;
}

/**
 * JSON-round-trips a value so it satisfies Prisma's `Json` input typing
 * (Dates -> ISO strings, `undefined` keys dropped, etc.), and strips
 * `passwordHash` - the audit trail must never persist a credential, even
 * hashed.
 */
function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  const plain = JSON.parse(JSON.stringify(value));
  if (plain && typeof plain === 'object' && !Array.isArray(plain)) {
    for (const key of Object.keys(plain)) {
      if (key === 'passwordHash' || key.endsWith('Enc')) delete (plain as Record<string, unknown>)[key];
    }
  }
  return plain as Prisma.InputJsonValue;
}

/**
 * Central write/read point for the system-wide activity trail (`AuditLog`).
 * Every mutating service method across the app calls `record()` right after
 * its mutation - see the individual services (vendors, meters, tokens,
 * admin, auth, ...) for call sites.
 */
export class AuditLogService {
  // Takes the prisma client + logger directly (not the full AppContext) so it
  // can be constructed once in server.ts and handed into `ctx` itself,
  // without a circular "ctx needs auditLog, auditLog needs ctx" dependency.
  constructor(private prisma: PrismaClient, private log: Logger) {}

  /**
   * Writes one audit entry. Never throws - a logging failure must never
   * break the real request it's describing.
   */
  async record(input: RecordAuditInput): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: input.actorId,
          action: input.action,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          summary: input.summary,
          oldValues: sanitize(input.oldValues),
          newValues: sanitize(input.newValues),
        },
      });
    } catch (err) {
      this.log.error({ err, input }, 'Failed to write audit log entry');
    }
  }

  async list(filters: {
    userId?: string;
    action?: string;
    subjectType?: string;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }) {
    const { page, limit } = filters;
    const skip = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {};
    if (filters.userId) where.userId = filters.userId;
    if (filters.action) where.action = filters.action;
    if (filters.subjectType) where.subjectType = filters.subjectType;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: new Date(filters.from) } : {}),
        ...(filters.to ? { lte: new Date(filters.to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, name: true, email: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }
}
