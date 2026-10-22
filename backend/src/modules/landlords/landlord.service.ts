import { AppContext } from '../../context.js';
import type { Prisma } from '../../generated/prisma/index.js';
import { AccountStatus, Role, TokenType, TransactionStatus } from '../../shared/types/index.js';
import { ConflictError, NotFoundError } from '../../shared/errors/AppError.js';
import { hashPassword } from '../../shared/utils/hash.js';
import { pageMeta, paginate } from '../../shared/utils/validation.js';

const USER_SUMMARY = { select: { id: true, name: true, username: true, email: true, status: true } } as const;

export interface LandlordInput {
  name: string;
  email: string;
  username: string;
  password: string;
  phone: string;
  paymentAccount: string;
}

export class LandlordService {
  constructor(private app: AppContext) {}

  private async assertAvailable(email?: string, username?: string, exceptUserId?: string) {
    const not = exceptUserId ? { id: { not: exceptUserId } } : {};
    if (email && (await this.app.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, ...not } }))) {
      throw new ConflictError('This email is already registered.');
    }
    if (username && (await this.app.prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' }, ...not } }))) {
      throw new ConflictError('This username is already taken.');
    }
  }

  async list(filters: { search?: string; page: number; limit: number }) {
    const where: Prisma.LandlordWhereInput = {};
    if (filters.search) {
      const s = filters.search;
      where.OR = [
        { fullName: { contains: s, mode: 'insensitive' } },
        { phone: { contains: s } },
        { paymentAccount: { contains: s, mode: 'insensitive' } },
        { user: { email: { contains: s, mode: 'insensitive' } } },
      ];
    }
    const [data, total] = await Promise.all([
      this.app.prisma.landlord.findMany({
        where,
        include: { user: USER_SUMMARY, _count: { select: { meters: true, properties: true } } },
        orderBy: { createdAt: 'desc' },
        ...paginate(filters.page, filters.limit),
      }),
      this.app.prisma.landlord.count({ where }),
    ]);
    return { data, meta: pageMeta(total, filters.page, filters.limit) };
  }

  async get(id: string) {
    const landlord = await this.app.prisma.landlord.findUnique({
      where: { id },
      include: { user: USER_SUMMARY, _count: { select: { meters: true, properties: true } } },
    });
    if (!landlord) throw new NotFoundError('Landlord');
    return landlord;
  }

  async create(input: LandlordInput, actorId: string) {
    await this.assertAvailable(input.email, input.username);
    const user = await this.app.prisma.user.create({
      data: {
        name: input.name,
        email: input.email.toLowerCase(),
        username: input.username,
        phone: input.phone,
        passwordHash: await hashPassword(input.password),
        role: Role.LANDLORD,
        landlord: { create: { fullName: input.name, phone: input.phone, paymentAccount: input.paymentAccount } },
      },
      include: { landlord: true },
    });
    await this.app.auditLog.record({
      actorId, action: 'CREATE', subjectType: 'LANDLORD', subjectId: user.landlord!.id, summary: `Registered landlord: ${input.name}`,
    });
    return this.get(user.landlord!.id);
  }

  async update(id: string, input: Partial<LandlordInput> & { status?: AccountStatus }, actorId: string) {
    const landlord = await this.app.prisma.landlord.findUnique({ where: { id } });
    if (!landlord) throw new NotFoundError('Landlord');
    await this.assertAvailable(input.email, input.username, landlord.userId);

    await this.app.prisma.$transaction([
      this.app.prisma.user.update({
        where: { id: landlord.userId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.email ? { email: input.email.toLowerCase() } : {}),
          ...(input.username ? { username: input.username } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
      }),
      this.app.prisma.landlord.update({
        where: { id },
        data: {
          ...(input.name ? { fullName: input.name } : {}),
          ...(input.phone ? { phone: input.phone } : {}),
          ...(input.paymentAccount ? { paymentAccount: input.paymentAccount } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
      }),
    ]);
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'LANDLORD', subjectId: id,
      summary: `Updated landlord${input.password ? ' (password reset)' : ''}: ${input.name ?? landlord.fullName}`, oldValues: landlord,
    });
    return this.get(id);
  }

  /** Removes the landlord and their user account (properties cascade; meters are kept, unassigned). */
  async remove(id: string, actorId: string) {
    const landlord = await this.app.prisma.landlord.findUnique({ where: { id } });
    if (!landlord) throw new NotFoundError('Landlord');
    await this.app.prisma.user.delete({ where: { id: landlord.userId } });
    await this.app.auditLog.record({
      actorId, action: 'DELETE', subjectType: 'LANDLORD', subjectId: id, summary: `Removed landlord: ${landlord.fullName}`, oldValues: landlord,
    });
  }

  async meters(landlordId: string) {
    return this.app.prisma.meter.findMany({ where: { landlordId }, orderBy: { meterNumber: 'asc' } });
  }

  /** Makes `meterIds` exactly the set of meters assigned to the landlord. */
  async syncMeters(landlordId: string, meterIds: string[], actorId: string) {
    const landlord = await this.app.prisma.landlord.findUnique({ where: { id: landlordId } });
    if (!landlord) throw new NotFoundError('Landlord');
    const ids = Array.from(new Set(meterIds));

    await this.app.prisma.$transaction([
      this.app.prisma.meter.updateMany({ where: { landlordId, id: { notIn: ids } }, data: { landlordId: null } }),
      this.app.prisma.meter.updateMany({ where: { id: { in: ids } }, data: { landlordId } }),
    ]);
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'LANDLORD', subjectId: landlordId,
      summary: `Set ${ids.length} meter(s) for landlord: ${landlord.fullName}`,
    });
    return this.meters(landlordId);
  }

  /** The signed-in landlord's dashboard: profile, portfolio counts and sales. */
  async dashboard(landlordId: string) {
    const prisma = this.app.prisma;
    const where = { landlordId };
    const [landlord, properties, units, occupied, tenants, meters, sales] = await Promise.all([
      this.get(landlordId),
      prisma.property.count({ where }),
      prisma.propertyUnit.count({ where }),
      prisma.lease.count({ where: { landlordId, status: 'ACTIVE' } }),
      prisma.landlordTenant.count({ where }),
      prisma.meter.count({ where }),
      prisma.tokenTransaction.aggregate({
        where: { landlordId, status: TransactionStatus.SUCCESS, tokenType: TokenType.CREDIT },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    return {
      landlord,
      summary: { properties, units, occupied, vacant: Math.max(units - occupied, 0), tenants, meters },
      sales: { total: sales._sum.amount ?? 0, count: sales._count._all },
    };
  }
}
