import { AppContext } from '../../context.js';
import { Prisma } from '../../generated/prisma/index.js';
import {
  ADMIN_ROLES, AccountStatus, EnquiryStatus, MeterStatus, Role, TokenType, TransactionStatus,
} from '../../shared/types/index.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';
import { hashPassword } from '../../shared/utils/hash.js';
import { pageMeta, paginate } from '../../shared/utils/validation.js';
import { rawTable } from '../../lib/prisma.js';

const OPERATOR_SELECT = {
  id: true, name: true, username: true, email: true, phone: true, role: true, status: true, createdAt: true,
} as const;

/**
 * Platform operator (SUPER_ADMIN / ADMIN) account management and the admin
 * dashboard's aggregate stats. Vendor and landlord accounts are managed
 * through their own modules since each comes with a business profile.
 */
export class AdminService {
  constructor(private app: AppContext) {}

  /** Only a SUPER_ADMIN may create, edit or remove another SUPER_ADMIN. */
  private assertCanManage(actorRole: Role, targetRole: Role) {
    if (targetRole === Role.SUPER_ADMIN && actorRole !== Role.SUPER_ADMIN) {
      throw new ForbiddenError('Only a super admin can manage super admin accounts.');
    }
  }

  async listOperators(filters: { role?: Role; search?: string; page: number; limit: number }) {
    const where: Prisma.UserWhereInput = { role: filters.role ?? { in: ADMIN_ROLES } };
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { email: { contains: filters.search, mode: 'insensitive' } },
        { username: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      this.app.prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, select: OPERATOR_SELECT, ...paginate(filters.page, filters.limit) }),
      this.app.prisma.user.count({ where }),
    ]);
    return { data, meta: pageMeta(total, filters.page, filters.limit) };
  }

  private async getOperator(id: string) {
    const user = await this.app.prisma.user.findUnique({ where: { id } });
    if (!user || !ADMIN_ROLES.includes(user.role)) throw new NotFoundError('Operator');
    return user;
  }

  private async assertUnique(email?: string, username?: string, exceptId?: string) {
    const not = exceptId ? { id: { not: exceptId } } : {};
    if (email && (await this.app.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, ...not } }))) {
      throw new ConflictError('A user with this email already exists');
    }
    if (username && (await this.app.prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' }, ...not } }))) {
      throw new ConflictError('This username is already taken');
    }
  }

  async createOperator(
    data: { name: string; username: string; email: string; password: string; role: Role; phone?: string },
    actor: { userId: string; role: Role },
  ) {
    this.assertCanManage(actor.role, data.role);
    await this.assertUnique(data.email, data.username);

    const user = await this.app.prisma.user.create({
      data: {
        name: data.name,
        username: data.username,
        email: data.email.toLowerCase(),
        phone: data.phone,
        role: data.role,
        passwordHash: await hashPassword(data.password),
      },
      select: OPERATOR_SELECT,
    });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'CREATE', subjectType: 'USER', subjectId: user.id,
      summary: `Created ${data.role.toLowerCase()} account: ${user.email}`, newValues: user,
    });
    return user;
  }

  async updateOperator(
    id: string,
    data: { name?: string; username?: string; email?: string; password?: string; phone?: string | null; role?: Role; status?: AccountStatus },
    actor: { userId: string; role: Role },
  ) {
    const user = await this.getOperator(id);
    this.assertCanManage(actor.role, user.role);
    if (data.role) this.assertCanManage(actor.role, data.role);
    if (id === actor.userId && (data.role || (data.status && data.status !== AccountStatus.ACTIVE))) {
      throw new BadRequestError('You cannot change your own role or suspend your own account.');
    }
    await this.assertUnique(data.email, data.username, id);

    const { password, ...rest } = data;
    const updated = await this.app.prisma.user.update({
      where: { id },
      data: {
        ...rest,
        ...(rest.email ? { email: rest.email.toLowerCase() } : {}),
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
      },
      select: OPERATOR_SELECT,
    });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'UPDATE', subjectType: 'USER', subjectId: id,
      summary: `Updated operator${password ? ' (password reset)' : ''}: ${updated.email}`,
      oldValues: user, newValues: updated,
    });
    return updated;
  }

  async deleteOperator(id: string, actor: { userId: string; role: Role }) {
    if (id === actor.userId) throw new BadRequestError('You cannot delete your own account');
    const user = await this.getOperator(id);
    this.assertCanManage(actor.role, user.role);

    await this.app.prisma.user.delete({ where: { id } });
    await this.app.auditLog.record({
      actorId: actor.userId, action: 'DELETE', subjectType: 'USER', subjectId: id,
      summary: `Deleted operator: ${user.email}`, oldValues: user,
    });
  }

  /** Platform-wide figures for the admin dashboard (+ 30-day daily sales series). */
  async stats() {
    const prisma = this.app.prisma;
    const since = new Date();
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - 29);
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const sale = { status: TransactionStatus.SUCCESS, tokenType: TokenType.CREDIT } as const;

    const [
      vendorsByStatus, landlords, metersByStatus, customers, pendingEnquiries,
      revenue, todayRevenue, tokensIssued, failedVends, series, topVendors, recent, failedSeries,
    ] = await Promise.all([
      prisma.vendor.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.landlord.count(),
      prisma.meter.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.customer.count(),
      prisma.contactEnquiry.count({ where: { status: EnquiryStatus.PENDING } }),
      prisma.tokenTransaction.aggregate({ where: sale, _sum: { amount: true } }),
      prisma.tokenTransaction.aggregate({ where: { ...sale, createdAt: { gte: startOfToday } }, _sum: { amount: true }, _count: { _all: true } }),
      prisma.tokenTransaction.count({ where: { status: TransactionStatus.SUCCESS } }),
      prisma.tokenTransaction.count({ where: { status: TransactionStatus.FAILED, createdAt: { gte: since } } }),
      prisma.$queryRaw<{ day: Date; amount: Prisma.Decimal | null; count: bigint }[]>`
        SELECT date_trunc('day', created_at) AS day, SUM(amount) AS amount, COUNT(*) AS count
        FROM ${Prisma.raw(rawTable('token_transactions'))}
        WHERE status = 'SUCCESS' AND token_type = 'CREDIT' AND created_at >= ${since}
        GROUP BY 1 ORDER BY 1`,
      prisma.tokenTransaction.groupBy({
        by: ['vendorId'],
        where: { ...sale, vendorId: { not: null }, createdAt: { gte: since } },
        _sum: { amount: true },
        _count: { _all: true },
        orderBy: { _sum: { amount: 'desc' } },
        take: 5,
      }),
      prisma.tokenTransaction.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true, status: true, tokenType: true, amount: true, createdAt: true, meterNumberSnapshot: true,
          vendor: { select: { businessName: true } }, landlord: { select: { fullName: true } },
        },
      }),
      // Failed credit vends per day - the dashboard charts them against successful sales.
      prisma.$queryRaw<{ day: Date; count: bigint }[]>`
        SELECT date_trunc('day', created_at) AS day, COUNT(*) AS count
        FROM ${Prisma.raw(rawTable('token_transactions'))}
        WHERE status = 'FAILED' AND token_type = 'CREDIT' AND created_at >= ${since}
        GROUP BY 1 ORDER BY 1`,
    ]);

    const vendorNames = await prisma.vendor.findMany({
      where: { id: { in: topVendors.map((v) => v.vendorId!) } },
      select: { id: true, businessName: true },
    });
    const nameOf = new Map(vendorNames.map((v) => [v.id, v.businessName]));

    const byDay = new Map(series.map((r) => [r.day.toISOString().slice(0, 10), r]));
    const failedByDay = new Map(failedSeries.map((r) => [r.day.toISOString().slice(0, 10), Number(r.count)]));
    const dailySales = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(since);
      d.setUTCDate(since.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const row = byDay.get(key);
      return { date: key, amount: Number(row?.amount ?? 0), count: Number(row?.count ?? 0), failed: failedByDay.get(key) ?? 0 };
    });

    const vendorCount = (s: AccountStatus) => vendorsByStatus.find((v) => v.status === s)?._count._all ?? 0;
    const meterCount = (s: MeterStatus) => metersByStatus.find((m) => m.status === s)?._count._all ?? 0;

    return {
      vendors: {
        total: vendorsByStatus.reduce((n, v) => n + v._count._all, 0),
        active: vendorCount(AccountStatus.ACTIVE),
        pending: vendorCount(AccountStatus.PENDING),
        suspended: vendorCount(AccountStatus.SUSPENDED),
      },
      landlords,
      meters: {
        total: metersByStatus.reduce((n, m) => n + m._count._all, 0),
        active: meterCount(MeterStatus.ACTIVE),
        inactive: meterCount(MeterStatus.INACTIVE),
        maintenance: meterCount(MeterStatus.MAINTENANCE),
      },
      customers,
      pendingEnquiries,
      vending: {
        revenue: Number(revenue._sum.amount ?? 0),
        todayRevenue: Number(todayRevenue._sum.amount ?? 0),
        todayCount: todayRevenue._count._all,
        tokensIssued,
        failedLast30Days: failedVends,
      },
      dailySales,
      topVendors: topVendors.map((v) => ({
        vendorId: v.vendorId,
        name: nameOf.get(v.vendorId!) ?? 'Unknown vendor',
        amount: Number(v._sum.amount ?? 0),
        count: v._count._all,
      })),
      recentTransactions: recent,
    };
  }
}
