import crypto from 'node:crypto';
import { AppContext } from '../../context.js';
import type { Prisma, User } from '../../generated/prisma/index.js';
import { signToken } from '../../lib/jwt.js';
import { AccountStatus, OtpPurpose, Role, TokenType, TransactionStatus } from '../../shared/types/index.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../shared/errors/AppError.js';
import { comparePassword, hashPassword } from '../../shared/utils/hash.js';
import { sha256 } from '../../shared/utils/crypto.js';
import { normalizeMsisdn, phoneVariants } from '../../shared/utils/phone.js';
import { GatewayCredentialsService } from '../settings/gateway-credentials.service.js';

const OTP_MAX_ATTEMPTS = 5;
const CUSTOMER_OTP_TTL_MS = 5 * 60 * 1000;
const RESET_OTP_TTL_MS = 10 * 60 * 1000;

const USER_SELECT = {
  id: true, name: true, username: true, email: true, phone: true, role: true, status: true,
  bio: true, profileImage: true, createdAt: true, updatedAt: true,
  vendor: { select: { id: true, businessName: true, vendorType: true, accountId: true, status: true, logoPath: true, dashboardSettings: true } },
  landlord: { select: { id: true, fullName: true, phone: true, paymentAccount: true, status: true } },
} satisfies Prisma.UserSelect;

function generateOtp(): string {
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** The session user object returned by login/me - same shape for every role. */
export interface SessionUser {
  id: string;
  name: string;
  email: string | null;
  username: string | null;
  phone: string | null;
  role: Role;
  vendorType: string | null;
}

export class AuthService {
  private credentials: GatewayCredentialsService;

  constructor(private app: AppContext) {
    this.credentials = new GatewayCredentialsService(app);
  }

  private session(user: Pick<User, 'id' | 'name' | 'email' | 'username' | 'phone' | 'role'>, vendorType: string | null = null): SessionUser {
    return { id: user.id, name: user.name, email: user.email, username: user.username, phone: user.phone, role: user.role, vendorType };
  }

  /**
   * Password login for admins, vendors and landlords. `identifier` may be an
   * email, a username, or a vendor's account id (till number).
   */
  async login(identifier: string, password: string) {
    const id = identifier.trim();
    const user =
      (await this.app.prisma.user.findFirst({
        where: { OR: [{ email: { equals: id, mode: 'insensitive' } }, { username: { equals: id, mode: 'insensitive' } }] },
        include: { vendor: { select: { vendorType: true } } },
      })) ??
      (await this.app.prisma.vendor.findUnique({ where: { accountId: id }, include: { user: { include: { vendor: { select: { vendorType: true } } } } } }))?.user ??
      null;

    if (!user || !(await comparePassword(password, user.passwordHash))) {
      if (user) {
        await this.app.auditLog.record({
          actorId: user.id, action: 'LOGIN_FAILED', subjectType: 'USER', subjectId: user.id,
          summary: `Failed login attempt (wrong password): ${user.email}`,
        });
      }
      throw new UnauthorizedError('The provided credentials are incorrect.');
    }

    if (user.status === AccountStatus.PENDING) {
      throw new ForbiddenError('Your account is pending admin approval. Please wait for an email/SMS confirmation.');
    }
    if (user.status !== AccountStatus.ACTIVE) {
      throw new ForbiddenError('Your account has been suspended. Please contact support.');
    }

    const token = signToken({ userId: user.id, role: user.role });
    await this.app.auditLog.record({
      actorId: user.id, action: 'LOGIN', subjectType: 'USER', subjectId: user.id, summary: `Signed in: ${user.email}`,
    });
    return { token, user: this.session(user, user.vendor?.vendorType ?? null) };
  }

  /** The signed-in account's profile. Customers additionally get their meter, vendor and recent tokens. */
  async me(userId: string, role: Role) {
    if (role === Role.CUSTOMER) return this.customerProfile(userId);
    if (role === Role.TENANT) return this.tenantProfile(userId);

    const user = await this.app.prisma.user.findUnique({ where: { id: userId }, select: USER_SELECT });
    if (!user) throw new NotFoundError('User');
    return { ...user, vendorType: user.vendor?.vendorType ?? null };
  }

  private async tenantProfile(tenantId: string) {
    const tenant = await this.app.prisma.landlordTenant.findUnique({
      where: { id: tenantId },
      include: { landlord: { select: { fullName: true, phone: true } }, unit: { select: { name: true } }, property: { select: { name: true } } },
    });
    if (!tenant || !tenant.portalAccess) throw new NotFoundError('Tenant');
    return {
      id: tenant.id, name: tenant.name, email: tenant.email, phone: tenant.phone, role: Role.TENANT, username: null, vendorType: null,
      landlord: tenant.landlord, unit: tenant.unit?.name ?? null, property: tenant.property.name,
    };
  }

  private async customerProfile(customerId: string) {
    const customer = await this.app.prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        meter: { select: { id: true, meterNumber: true, type: true, pricePerUnit: true, status: true } },
        vendor: { select: { id: true, businessName: true, logoPath: true } },
        county: { select: { name: true } },
      },
    });
    if (!customer) throw new NotFoundError('Customer');

    const meterWhere = { meterId: customer.meterId ?? '__none__' };
    const [spent, recentTransactions] = await Promise.all([
      this.app.prisma.tokenTransaction.aggregate({
        where: { ...meterWhere, status: TransactionStatus.SUCCESS, tokenType: TokenType.CREDIT },
        _sum: { amount: true },
      }),
      this.app.prisma.tokenTransaction.findMany({
        where: meterWhere,
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, status: true, tokenType: true, amount: true, units: true, tokens: true, description: true, createdAt: true },
      }),
    ]);

    return {
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      role: Role.CUSTOMER,
      username: null,
      vendorType: null,
      meter: customer.meter,
      vendor: customer.vendor,
      county: customer.county?.name ?? null,
      totalSpent: spent._sum.amount ?? 0,
      recentTransactions,
    };
  }

  async updateMe(
    userId: string,
    role: Role,
    data: {
      name?: string; username?: string; email?: string; phone?: string | null; bio?: string | null;
      profileImage?: string | null; currentPassword?: string; newPassword?: string;
    },
  ) {
    if (role === Role.TENANT) {
      const updated = await this.app.prisma.landlordTenant.update({
        where: { id: userId },
        data: { ...(data.name ? { name: data.name } : {}), ...(data.email !== undefined ? { email: data.email } : {}) },
      });
      return { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, role };
    }
    if (role === Role.CUSTOMER) {
      const updated = await this.app.prisma.customer.update({
        where: { id: userId },
        data: { ...(data.name ? { name: data.name } : {}), ...(data.email !== undefined ? { email: data.email } : {}) },
      });
      return { id: updated.id, name: updated.name, email: updated.email, phone: updated.phone, role };
    }

    const user = await this.app.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User');

    if (data.email && data.email.toLowerCase() !== user.email.toLowerCase()) {
      const taken = await this.app.prisma.user.findFirst({ where: { email: { equals: data.email, mode: 'insensitive' }, id: { not: userId } } });
      if (taken) throw new ConflictError('This email is already in use.');
    }
    if (data.username && data.username.toLowerCase() !== user.username.toLowerCase()) {
      const taken = await this.app.prisma.user.findFirst({ where: { username: { equals: data.username, mode: 'insensitive' }, id: { not: userId } } });
      if (taken) throw new ConflictError('This username is already taken.');
    }

    let passwordHash: string | undefined;
    if (data.newPassword) {
      if (!(await comparePassword(data.currentPassword ?? '', user.passwordHash))) {
        throw new BadRequestError('The current password is incorrect.');
      }
      passwordHash = await hashPassword(data.newPassword);
    }

    const updated = await this.app.prisma.user.update({
      where: { id: userId },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.username !== undefined ? { username: data.username } : {}),
        ...(data.email !== undefined ? { email: data.email.toLowerCase() } : {}),
        ...(data.phone !== undefined ? { phone: data.phone } : {}),
        ...(data.bio !== undefined ? { bio: data.bio } : {}),
        ...(data.profileImage !== undefined ? { profileImage: data.profileImage } : {}),
        ...(passwordHash ? { passwordHash } : {}),
      },
      select: USER_SELECT,
    });

    await this.app.auditLog.record({
      actorId: userId, action: 'UPDATE', subjectType: 'USER', subjectId: userId,
      summary: `Updated own profile${passwordHash ? ' (password changed)' : ''}: ${updated.email}`,
      oldValues: user, newValues: updated,
    });
    return { ...updated, vendorType: updated.vendor?.vendorType ?? null };
  }

  // ── One-time codes ─────────────────────────────────────────────────────────

  private async issueOtp(purpose: OtpPurpose, identifier: string, ttlMs: number): Promise<string> {
    const code = generateOtp();
    await this.app.prisma.otp.upsert({
      where: { purpose_identifier: { purpose, identifier } },
      update: { codeHash: sha256(code), attempts: 0, expiresAt: new Date(Date.now() + ttlMs) },
      create: { purpose, identifier, codeHash: sha256(code), expiresAt: new Date(Date.now() + ttlMs) },
    });
    return code;
  }

  /** Checks a code; wrong guesses count against the attempt limit. Does not consume it. */
  private async checkOtp(purpose: OtpPurpose, identifier: string, code: string): Promise<boolean> {
    const otp = await this.app.prisma.otp.findUnique({ where: { purpose_identifier: { purpose, identifier } } });
    if (!otp || otp.expiresAt < new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) return false;
    if (otp.codeHash !== sha256(code)) {
      await this.app.prisma.otp.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      return false;
    }
    return true;
  }

  private async consumeOtp(purpose: OtpPurpose, identifier: string) {
    await this.app.prisma.otp.deleteMany({ where: { purpose, identifier } });
  }

  /** Only customers with portal access may sign in. */
  private findCustomerByPhone(phone: string) {
    return this.app.prisma.customer.findFirst({ where: { phone: { in: phoneVariants(phone) }, portalAccess: true }, orderBy: { createdAt: 'asc' } });
  }

  /** Tenants sign in only once their landlord has given them portal access. */
  private findTenantByPhone(phone: string) {
    return this.app.prisma.landlordTenant.findFirst({
      where: { phone: { in: phoneVariants(phone) }, portalAccess: true, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  }

  async sendTenantOtp(phone: string) {
    const tenant = await this.findTenantByPhone(phone);
    if (!tenant) throw new NotFoundError('Tenant account with this phone number');
    const identifier = normalizeMsisdn(phone) ?? phone.trim();
    const code = await this.issueOtp(OtpPurpose.TENANT_LOGIN, identifier, CUSTOMER_OTP_TTL_MS);
    const sent = await this.app.sms.send(normalizeMsisdn(tenant.phone) ?? tenant.phone, `Your TokenPap tenant sign-in code is: ${code}. Valid for 5 minutes.`);
    if (!sent) throw new BadRequestError('Failed to send the code. Please try again later.');
  }

  async verifyTenantOtp(phone: string, code: string) {
    const identifier = normalizeMsisdn(phone) ?? phone.trim();
    if (!(await this.checkOtp(OtpPurpose.TENANT_LOGIN, identifier, code))) throw new UnauthorizedError('Invalid or expired code.');
    const tenant = await this.findTenantByPhone(phone);
    if (!tenant) throw new NotFoundError('Tenant');
    await this.consumeOtp(OtpPurpose.TENANT_LOGIN, identifier);
    return {
      token: signToken({ userId: tenant.id, role: Role.TENANT }),
      user: { id: tenant.id, name: tenant.name, email: tenant.email, username: null, phone: tenant.phone, role: Role.TENANT, vendorType: null } satisfies SessionUser,
    };
  }

  async sendCustomerOtp(phone: string) {
    const customer = await this.findCustomerByPhone(phone);
    if (!customer) throw new NotFoundError('Customer with this phone number');

    const identifier = normalizeMsisdn(phone) ?? phone.trim();
    const code = await this.issueOtp(OtpPurpose.CUSTOMER_LOGIN, identifier, CUSTOMER_OTP_TTL_MS);
    const sent = await this.app.sms.send(
      customer.phone,
      `Your Token Utility System verification code is: ${code}. Valid for 5 minutes.`,
      await this.credentials.vendorSmsConfig(customer.vendorId),
    );
    if (!sent) throw new BadRequestError('Failed to send OTP. Please try again later.');
  }

  async verifyCustomerOtp(phone: string, code: string) {
    const identifier = normalizeMsisdn(phone) ?? phone.trim();
    if (!(await this.checkOtp(OtpPurpose.CUSTOMER_LOGIN, identifier, code))) {
      throw new UnauthorizedError('Invalid or expired OTP.');
    }
    const customer = await this.findCustomerByPhone(phone);
    if (!customer) throw new NotFoundError('Customer');
    await this.consumeOtp(OtpPurpose.CUSTOMER_LOGIN, identifier);
    return this.customerSession(customer);
  }

  private customerSession(customer: { id: string; name: string; email: string | null; phone: string }) {
    return {
      token: signToken({ userId: customer.id, role: Role.CUSTOMER }),
      user: { id: customer.id, name: customer.name, email: customer.email, username: null, phone: customer.phone, role: Role.CUSTOMER, vendorType: null } satisfies SessionUser,
    };
  }

  /** Normalized OTP identifier + the user it belongs to (by email, or by user/landlord phone). */
  private async findUserForReset(identifier: string): Promise<{ key: string; user: User | null; email: boolean }> {
    const id = identifier.trim();
    if (isEmail(id)) {
      const user = await this.app.prisma.user.findFirst({ where: { email: { equals: id, mode: 'insensitive' } } });
      return { key: id.toLowerCase(), user, email: true };
    }
    const variants = phoneVariants(id);
    const user =
      (await this.app.prisma.user.findFirst({ where: { phone: { in: variants } } })) ??
      (await this.app.prisma.landlord.findFirst({ where: { phone: { in: variants } }, include: { user: true } }))?.user ??
      null;
    return { key: normalizeMsisdn(id) ?? id, user, email: false };
  }

  /**
   * Sends a password-reset code by email or SMS. Responds the same way whether
   * or not an account matched, so it can't be used to discover accounts.
   */
  async sendResetCode(identifier: string) {
    const { key, user, email } = await this.findUserForReset(identifier);
    if (!user) return;

    const code = await this.issueOtp(OtpPurpose.PASSWORD_RESET, key, RESET_OTP_TTL_MS);
    if (email) {
      await this.app.mail.sendPasswordResetCode(user.email, code);
    } else {
      await this.app.sms.send(key, `Your Token Utility System password reset code is: ${code}. Valid for 10 minutes.`);
    }
  }

  async verifyResetCode(identifier: string, code: string) {
    const { key } = await this.findUserForReset(identifier);
    if (!(await this.checkOtp(OtpPurpose.PASSWORD_RESET, key, code))) {
      throw new UnauthorizedError('Invalid or expired verification code.');
    }
  }

  async resetPassword(identifier: string, code: string, password: string) {
    const { key, user } = await this.findUserForReset(identifier);
    if (!user || !(await this.checkOtp(OtpPurpose.PASSWORD_RESET, key, code))) {
      throw new UnauthorizedError('Invalid or expired verification session.');
    }
    await this.app.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
    await this.consumeOtp(OtpPurpose.PASSWORD_RESET, key);
    await this.app.auditLog.record({
      actorId: user.id, action: 'PASSWORD_RESET', subjectType: 'USER', subjectId: user.id, summary: `Password reset via one-time code: ${user.email}`,
    });
  }

  // ── Google sign-in (customers) ─────────────────────────────────────────────

  googleConfigured(): boolean {
    const c = this.app.config;
    return !!(c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET && c.GOOGLE_REDIRECT_URI);
  }

  googleAuthUrl(state: string): string {
    const c = this.app.config;
    const params = new URLSearchParams({
      client_id: c.GOOGLE_CLIENT_ID!,
      redirect_uri: c.GOOGLE_REDIRECT_URI!,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      prompt: 'select_account',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  /** Exchanges an OAuth code for the Google account's email and signs in the matching customer. */
  async googleCallback(code: string) {
    const c = this.app.config;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: c.GOOGLE_CLIENT_ID!,
        client_secret: c.GOOGLE_CLIENT_SECRET!,
        redirect_uri: c.GOOGLE_REDIRECT_URI!,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
    if (!tokenRes.ok || !tokens?.access_token) throw new UnauthorizedError('Google sign-in failed.');

    const infoRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const info = (await infoRes.json().catch(() => null)) as { email?: string; email_verified?: boolean } | null;
    if (!info?.email || info.email_verified === false) throw new UnauthorizedError('Google account email is not verified.');

    const customer = await this.app.prisma.customer.findFirst({ where: { email: { equals: info.email, mode: 'insensitive' } } });
    if (!customer) throw new NotFoundError('Customer profile for this Google account');
    return this.customerSession(customer);
  }
}
