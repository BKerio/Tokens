import type { PrismaClient, Prisma } from '../../generated/prisma/index.js';
import { ADMIN_ROLES, JwtPayload, Role } from '../types/index.js';
import { ForbiddenError, NotFoundError } from '../errors/AppError.js';

/**
 * The signed-in caller plus the vendor/landlord profile behind them - what
 * every ownership check needs. Resolved per request from the JWT.
 */
export interface Actor {
  userId: string;
  role: Role;
  isAdmin: boolean;
  vendorId?: string;
  landlordId?: string;
  /** Set for CUSTOMER tokens (JwtPayload.userId is the customer id). */
  customerId?: string;
}

export async function resolveActor(prisma: PrismaClient, user: JwtPayload): Promise<Actor> {
  const actor: Actor = { userId: user.userId, role: user.role, isAdmin: ADMIN_ROLES.includes(user.role) };

  if (user.role === Role.VENDOR) {
    const vendor = await prisma.vendor.findUnique({ where: { userId: user.userId }, select: { id: true } });
    actor.vendorId = vendor?.id;
  } else if (user.role === Role.LANDLORD) {
    const landlord = await prisma.landlord.findUnique({ where: { userId: user.userId }, select: { id: true } });
    actor.landlordId = landlord?.id;
  } else if (user.role === Role.CUSTOMER) {
    actor.customerId = user.userId;
  }
  return actor;
}

/** Matches nothing - used when a vendor/landlord account has no profile row. */
const NONE = { id: { in: [] as string[] } };

/** Meters the actor may see: admins all, vendors/landlords only their own. */
export function meterScope(actor: Actor): Prisma.MeterWhereInput {
  if (actor.isAdmin) return {};
  if (actor.role === Role.VENDOR) return actor.vendorId ? { vendorId: actor.vendorId } : NONE;
  if (actor.role === Role.LANDLORD) return actor.landlordId ? { landlordId: actor.landlordId } : NONE;
  return NONE;
}

/** Customers the actor may see: admins all, vendors only their own. */
export function customerScope(actor: Actor): Prisma.CustomerWhereInput {
  if (actor.isAdmin) return {};
  if (actor.role === Role.VENDOR) return actor.vendorId ? { vendorId: actor.vendorId } : NONE;
  return NONE;
}

export function canAccessMeter(actor: Actor, meter: { vendorId: string | null; landlordId: string | null }): boolean {
  if (actor.isAdmin) return true;
  if (actor.role === Role.VENDOR) return !!actor.vendorId && meter.vendorId === actor.vendorId;
  if (actor.role === Role.LANDLORD) return !!actor.landlordId && meter.landlordId === actor.landlordId;
  return false;
}

/** The actor's vendor id, or a 403/404 if they aren't a vendor with a profile. */
export function requireVendorId(actor: Actor): string {
  if (actor.role !== Role.VENDOR) throw new ForbiddenError('Vendor access only.');
  if (!actor.vendorId) throw new NotFoundError('Vendor profile');
  return actor.vendorId;
}

/** The actor's landlord id, or a 403/404 if they aren't a landlord with a profile. */
export function requireLandlordId(actor: Actor): string {
  if (actor.role !== Role.LANDLORD) throw new ForbiddenError('Landlord access only.');
  if (!actor.landlordId) throw new NotFoundError('Landlord profile');
  return actor.landlordId;
}
