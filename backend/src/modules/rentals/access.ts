import type { FastifyRequest } from 'fastify';
import type { Prisma } from '../../generated/prisma/index.js';
import { AppContext } from '../../context.js';
import { AccountStatus, Role } from '../../shared/types/index.js';
import { ForbiddenError, NotFoundError } from '../../shared/errors/AppError.js';

/**
 * Who may do what inside a landlord's organization. The landlord's own login
 * is the OWNER; staff get a LandlordStaffRole and, optionally, a subset of
 * properties. Permission sets are defined here (not in the database) so they
 * change with the code that enforces them.
 */

export const PERMISSIONS = [
  'properties.view', 'properties.manage', 'locations.manage',
  'tenants.view', 'tenants.manage',
  'leases.view', 'leases.manage',
  'ledger.view', 'payments.record', 'charges.manage', 'deposits.manage', 'expenses.manage', 'entries.reverse',
  'reports.view', 'staff.manage', 'meters.view',
] as const;
export type LandlordPermission = (typeof PERMISSIONS)[number];

export type OrgRole = 'OWNER' | 'MANAGER' | 'CARETAKER' | 'ACCOUNTANT' | 'VIEWER';

const VIEW: LandlordPermission[] = ['properties.view', 'tenants.view', 'leases.view', 'ledger.view', 'meters.view'];

export const ROLE_PERMISSIONS: Record<OrgRole, LandlordPermission[]> = {
  OWNER: [...PERMISSIONS],
  MANAGER: PERMISSIONS.filter((p) => p !== 'staff.manage' && p !== 'locations.manage'),
  CARETAKER: [...VIEW, 'tenants.manage', 'payments.record'],
  ACCOUNTANT: [...VIEW, 'payments.record', 'charges.manage', 'deposits.manage', 'expenses.manage', 'entries.reverse', 'reports.view'],
  VIEWER: [...VIEW, 'reports.view'],
};

export interface LandlordAccess {
  landlordId: string;
  landlordName: string;
  actorId: string;
  role: OrgRole;
  permissions: Set<LandlordPermission>;
  /** false → only `propertyIds` are visible. */
  allProperties: boolean;
  propertyIds: string[];
}

export const LANDLORD_ORG_ROLES: Role[] = [Role.LANDLORD, Role.LANDLORD_STAFF];

/** Resolves (and caches per request) the caller's landlord organization access. */
const cache = new WeakMap<FastifyRequest, Promise<LandlordAccess>>();

export function landlordAccess(ctx: AppContext, req: FastifyRequest): Promise<LandlordAccess> {
  let pending = cache.get(req);
  if (!pending) {
    pending = resolve(ctx, req);
    cache.set(req, pending);
  }
  return pending;
}

async function resolve(ctx: AppContext, req: FastifyRequest): Promise<LandlordAccess> {
  const { userId, role } = req.user;

  if (role === Role.LANDLORD) {
    const landlord = await ctx.prisma.landlord.findUnique({ where: { userId }, select: { id: true, fullName: true } });
    if (!landlord) throw new NotFoundError('Landlord profile');
    return { landlordId: landlord.id, landlordName: landlord.fullName, actorId: userId, role: 'OWNER', permissions: new Set(ROLE_PERMISSIONS.OWNER), allProperties: true, propertyIds: [] };
  }

  if (role === Role.LANDLORD_STAFF) {
    // Checked on every request so suspending a staff member takes effect immediately, not at token expiry.
    const staff = await ctx.prisma.landlordStaff.findUnique({
      where: { userId },
      include: { user: { select: { status: true } }, landlord: { select: { id: true, fullName: true, status: true } } },
    });
    if (!staff || staff.user.status !== AccountStatus.ACTIVE) throw new ForbiddenError('Your staff access has been suspended.');
    if (staff.landlord.status !== AccountStatus.ACTIVE) throw new ForbiddenError("This landlord's account is not active.");
    return {
      landlordId: staff.landlord.id,
      landlordName: staff.landlord.fullName,
      actorId: userId,
      role: staff.staffRole,
      permissions: new Set(ROLE_PERMISSIONS[staff.staffRole]),
      allProperties: staff.allProperties,
      propertyIds: staff.propertyIds,
    };
  }

  throw new ForbiddenError('Landlord access only.');
}

export function can(access: LandlordAccess, permission: LandlordPermission): boolean {
  return access.permissions.has(permission);
}

export function assertCan(access: LandlordAccess, permission: LandlordPermission): void {
  if (!can(access, permission)) throw new ForbiddenError(`Your role (${access.role.toLowerCase()}) can't do this.`);
}

export function canSeeProperty(access: LandlordAccess, propertyId: string): boolean {
  return access.allProperties || access.propertyIds.includes(propertyId);
}

export function assertProperty(access: LandlordAccess, propertyId: string): void {
  if (!canSeeProperty(access, propertyId)) throw new ForbiddenError("You don't have access to this property.");
}

/** `where` fragment limiting a query to the caller's landlord and visible properties. */
export function scopeWhere(access: LandlordAccess): { landlordId: string; propertyId?: { in: string[] } } {
  return access.allProperties ? { landlordId: access.landlordId } : { landlordId: access.landlordId, propertyId: { in: access.propertyIds } };
}

/** Same, for the Property model itself (its key is `id`). */
export function propertyWhere(access: LandlordAccess): Prisma.PropertyWhereInput {
  return access.allProperties ? { landlordId: access.landlordId } : { landlordId: access.landlordId, id: { in: access.propertyIds } };
}

/** preHandler factory: 403 unless the caller holds `permission`. */
export function requirePermission(ctx: AppContext, permission: LandlordPermission) {
  return async (req: FastifyRequest) => {
    assertCan(await landlordAccess(ctx, req), permission);
  };
}

/** Public shape returned by GET /landlord/access. */
export function describeAccess(access: LandlordAccess) {
  return {
    landlordId: access.landlordId,
    landlordName: access.landlordName,
    role: access.role,
    permissions: [...access.permissions],
    allProperties: access.allProperties,
    propertyIds: access.propertyIds,
  };
}
