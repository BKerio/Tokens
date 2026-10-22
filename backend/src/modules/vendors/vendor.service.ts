import { mkdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { AppContext } from '../../context.js';
import type { Prisma, Vendor } from '../../generated/prisma/index.js';
import { AccountStatus, MeterStatus, Role, TokenType, TransactionStatus, VendorType } from '../../shared/types/index.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../shared/errors/AppError.js';
import { hashPassword } from '../../shared/utils/hash.js';
import { pageMeta, paginate } from '../../shared/utils/validation.js';
import { GatewayCredentialsService, SmsConfigInput, presentMpesaConfig, presentSmsConfig } from '../settings/gateway-credentials.service.js';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_TYPES: Record<string, string> = { png: 'png', jpeg: 'jpg', jpg: 'jpg', webp: 'webp', gif: 'gif' };

const USER_SUMMARY = { select: { id: true, name: true, username: true, email: true, phone: true, status: true } } as const;

export interface DashboardSettings {
  primaryColor?: string | null;
  tagline?: string | null;
  showLogoInSidebar?: boolean | null;
}

export interface VendorAccountInput {
  name: string;
  username: string;
  email: string;
  phone?: string;
  password: string;
  businessName: string;
  address?: string;
  accountId: string;
  paybill?: string;
  vendorType: VendorType;
  bankName?: string;
}

export class VendorService {
  private credentials: GatewayCredentialsService;

  constructor(private app: AppContext) {
    this.credentials = new GatewayCredentialsService(app);
  }

  logoUrl(logoPath: string | null): string | null {
    if (!logoPath) return null;
    if (/^https?:\/\//.test(logoPath)) return logoPath;
    return `${this.app.config.APP_URL}/uploads/${logoPath.replace(/^\/+/, '')}`;
  }

  private present<T extends Vendor>(vendor: T) {
    return { ...vendor, logoUrl: this.logoUrl(vendor.logoPath) };
  }

  private async assertAvailable(input: { email?: string; username?: string; accountId?: string }, except?: { userId?: string; vendorId?: string }) {
    const notUser = except?.userId ? { id: { not: except.userId } } : {};
    if (input.email && (await this.app.prisma.user.findFirst({ where: { email: { equals: input.email, mode: 'insensitive' }, ...notUser } }))) {
      throw new ConflictError('This email is already registered.');
    }
    if (input.username && (await this.app.prisma.user.findFirst({ where: { username: { equals: input.username, mode: 'insensitive' }, ...notUser } }))) {
      throw new ConflictError('This username is already taken.');
    }
    if (input.accountId) {
      const notVendor = except?.vendorId ? { id: { not: except.vendorId } } : {};
      if (await this.app.prisma.vendor.findFirst({ where: { accountId: input.accountId, ...notVendor } })) {
        throw new ConflictError('This account ID is already in use by another vendor.');
      }
    }
  }

  async list(filters: { search?: string; status?: AccountStatus; page: number; limit: number }) {
    const where: Prisma.VendorWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.search) {
      const s = filters.search;
      where.OR = [
        { businessName: { contains: s, mode: 'insensitive' } },
        { accountId: { contains: s, mode: 'insensitive' } },
        { user: { name: { contains: s, mode: 'insensitive' } } },
        { user: { email: { contains: s, mode: 'insensitive' } } },
      ];
    }
    const [rows, total] = await Promise.all([
      this.app.prisma.vendor.findMany({
        where,
        include: { user: USER_SUMMARY, _count: { select: { meters: true, customers: true } } },
        orderBy: { createdAt: 'desc' },
        ...paginate(filters.page, filters.limit),
      }),
      this.app.prisma.vendor.count({ where }),
    ]);
    return { data: rows.map((v) => this.present(v)), meta: pageMeta(total, filters.page, filters.limit) };
  }

  async get(id: string) {
    const vendor = await this.app.prisma.vendor.findUnique({
      where: { id },
      include: { user: USER_SUMMARY, _count: { select: { meters: true, customers: true } } },
    });
    if (!vendor) throw new NotFoundError('Vendor');
    return this.present(vendor);
  }

  /** Creates the user account + vendor profile together. */
  private async createAccount(input: VendorAccountInput, status: AccountStatus) {
    await this.assertAvailable(input);
    const passwordHash = await hashPassword(input.password);
    const user = await this.app.prisma.user.create({
      data: {
        name: input.name,
        username: input.username,
        email: input.email.toLowerCase(),
        phone: input.phone,
        passwordHash,
        role: Role.VENDOR,
        status,
        vendor: {
          create: {
            businessName: input.businessName,
            address: input.address,
            accountId: input.accountId,
            paybill: input.paybill,
            vendorType: input.vendorType,
            bankName: input.bankName,
            status,
          },
        },
      },
      include: { vendor: true },
    });
    return user.vendor!;
  }

  async create(input: VendorAccountInput, actorId: string) {
    const vendor = await this.createAccount(input, AccountStatus.ACTIVE);
    await this.app.auditLog.record({
      actorId, action: 'CREATE', subjectType: 'VENDOR', subjectId: vendor.id, summary: `Created vendor: ${vendor.businessName}`,
    });
    return this.get(vendor.id);
  }

  /** Public self-registration - lands in the approval queue as PENDING. */
  async register(input: VendorAccountInput) {
    const vendor = await this.createAccount(input, AccountStatus.PENDING);
    await this.app.auditLog.record({
      actorId: null, action: 'CREATE', subjectType: 'VENDOR', subjectId: vendor.id,
      summary: `Vendor self-registered (pending approval): ${vendor.businessName}`,
    });
  }

  async update(
    id: string,
    input: Partial<Omit<VendorAccountInput, 'password'>> & { password?: string; status?: AccountStatus },
    actorId: string,
  ) {
    const vendor = await this.app.prisma.vendor.findUnique({ where: { id }, include: { user: true } });
    if (!vendor) throw new NotFoundError('Vendor');
    await this.assertAvailable(input, { userId: vendor.userId, vendorId: id });

    await this.app.prisma.$transaction([
      this.app.prisma.user.update({
        where: { id: vendor.userId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.username ? { username: input.username } : {}),
          ...(input.email ? { email: input.email.toLowerCase() } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
      }),
      this.app.prisma.vendor.update({
        where: { id },
        data: {
          ...(input.businessName ? { businessName: input.businessName } : {}),
          ...(input.address !== undefined ? { address: input.address } : {}),
          ...(input.accountId ? { accountId: input.accountId } : {}),
          ...(input.paybill !== undefined ? { paybill: input.paybill } : {}),
          ...(input.vendorType ? { vendorType: input.vendorType } : {}),
          ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
          ...(input.status ? { status: input.status } : {}),
        },
      }),
    ]);

    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'VENDOR', subjectId: id,
      summary: `Updated vendor${input.password ? ' (password reset)' : ''}: ${input.businessName ?? vendor.businessName}`,
      oldValues: vendor,
    });
    return this.get(id);
  }

  /** Deletes the vendor's user account (cascades to the profile; meters/customers are kept, unassigned). */
  async remove(id: string, actorId: string) {
    const vendor = await this.app.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundError('Vendor');
    await this.app.prisma.user.delete({ where: { id: vendor.userId } });
    if (vendor.logoPath) await this.deleteLogoFile(vendor.logoPath);
    await this.app.auditLog.record({
      actorId, action: 'DELETE', subjectType: 'VENDOR', subjectId: id, summary: `Deleted vendor: ${vendor.businessName}`, oldValues: vendor,
    });
  }

  async setApproval(id: string, approve: boolean, actorId: string) {
    const vendor = await this.app.prisma.vendor.findUnique({ where: { id } });
    if (!vendor) throw new NotFoundError('Vendor');
    await this.app.prisma.$transaction([
      this.app.prisma.vendor.update({ where: { id }, data: { status: approve ? AccountStatus.ACTIVE : AccountStatus.REJECTED } }),
      this.app.prisma.user.update({ where: { id: vendor.userId }, data: { status: approve ? AccountStatus.ACTIVE : AccountStatus.SUSPENDED } }),
    ]);
    await this.app.auditLog.record({
      actorId, action: approve ? 'APPROVE' : 'REJECT', subjectType: 'VENDOR', subjectId: id,
      summary: `${approve ? 'Approved' : 'Rejected'} vendor registration: ${vendor.businessName}`,
    });
  }

  /** Admin drill-down: a vendor with its meters, customers and sales. */
  async oversight(id: string) {
    const vendor = await this.get(id);
    const [meters, customers, sales] = await Promise.all([
      this.app.prisma.meter.findMany({ where: { vendorId: id }, orderBy: { meterNumber: 'asc' } }),
      this.app.prisma.customer.findMany({
        where: { vendorId: id },
        orderBy: { createdAt: 'desc' },
        include: { meter: { select: { meterNumber: true } } },
      }),
      this.app.prisma.tokenTransaction.aggregate({
        where: { vendorId: id, status: TransactionStatus.SUCCESS, tokenType: TokenType.CREDIT },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    return {
      vendor,
      metersCount: meters.length,
      customersCount: customers.length,
      totalSales: sales._sum.amount ?? 0,
      salesCount: sales._count._all,
      meters,
      customers,
    };
  }

  // ── Vendor self-service ────────────────────────────────────────────────────

  async profile(vendorId: string) {
    const vendor = await this.get(vendorId);
    const [activeMeters, sales] = await Promise.all([
      this.app.prisma.meter.count({ where: { vendorId, status: MeterStatus.ACTIVE } }),
      this.app.prisma.tokenTransaction.aggregate({
        where: { vendorId, status: TransactionStatus.SUCCESS, tokenType: TokenType.CREDIT },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);
    return {
      vendor,
      stats: {
        totalMeters: vendor._count.meters,
        activeMeters,
        totalCustomers: vendor._count.customers,
        totalSales: sales._sum.amount ?? 0,
        salesCount: sales._count._all,
      },
    };
  }

  async updateProfile(
    vendorId: string,
    input: { businessName?: string; address?: string | null; vendorType?: VendorType; bankName?: string | null; dashboardSettings?: DashboardSettings },
    actorId: string,
  ) {
    const vendor = await this.app.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundError('Vendor');
    const settings = input.dashboardSettings
      ? { ...((vendor.dashboardSettings as DashboardSettings | null) ?? {}), ...input.dashboardSettings }
      : undefined;

    await this.app.prisma.vendor.update({
      where: { id: vendorId },
      data: {
        ...(input.businessName ? { businessName: input.businessName } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
        ...(input.vendorType ? { vendorType: input.vendorType } : {}),
        ...(input.bankName !== undefined ? { bankName: input.bankName } : {}),
        ...(settings ? { dashboardSettings: settings as Prisma.InputJsonValue } : {}),
      },
    });
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'VENDOR', subjectId: vendorId, summary: `Updated own vendor profile: ${vendor.businessName}`,
    });
    return this.get(vendorId);
  }

  private async deleteLogoFile(logoPath: string) {
    if (/^https?:\/\//.test(logoPath)) return;
    const root = path.resolve(this.app.config.UPLOAD_DIR);
    const file = path.resolve(root, logoPath);
    if (!file.startsWith(root + path.sep)) return;
    await unlink(file).catch(() => undefined);
  }

  /** Saves a base64 data-URL image as the vendor's logo, replacing any previous one. */
  async uploadLogo(vendorId: string, dataUrl: string, actorId: string) {
    const match = dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/);
    const ext = match ? LOGO_TYPES[match[1]!.toLowerCase()] : undefined;
    if (!match || !ext) throw new BadRequestError('Invalid logo. Provide a PNG, JPEG, WEBP or GIF image.');

    const content = Buffer.from(match[2]!, 'base64');
    if (content.length === 0) throw new BadRequestError('Invalid logo image data.');
    if (content.length > MAX_LOGO_BYTES) throw new BadRequestError('Logo must be 2MB or smaller.');

    const vendor = await this.app.prisma.vendor.findUnique({ where: { id: vendorId } });
    if (!vendor) throw new NotFoundError('Vendor');

    const relative = `vendor-logos/${vendorId}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
    const target = path.resolve(this.app.config.UPLOAD_DIR, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);

    await this.app.prisma.vendor.update({ where: { id: vendorId }, data: { logoPath: relative } });
    if (vendor.logoPath) await this.deleteLogoFile(vendor.logoPath);
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'VENDOR', subjectId: vendorId, summary: `Uploaded new logo: ${vendor.businessName}`,
    });
    return { logoUrl: this.logoUrl(relative) };
  }

  async smsConfig(vendorId: string) {
    return presentSmsConfig(await this.app.prisma.smsConfig.findUnique({ where: { vendorId } }));
  }

  async updateSmsConfig(vendorId: string, input: SmsConfigInput, actorId: string) {
    const saved = await this.credentials.upsertSmsConfig(vendorId, input);
    await this.app.auditLog.record({
      actorId, action: 'UPDATE', subjectType: 'SMS_CONFIG', subjectId: saved.id, summary: 'Updated vendor SMS gateway settings',
    });
    return presentSmsConfig(saved);
  }

  async mpesaConfig(vendorId: string) {
    return presentMpesaConfig(await this.app.prisma.mpesaConfig.findUnique({ where: { vendorId } }));
  }
}
