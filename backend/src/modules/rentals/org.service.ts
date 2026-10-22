import { AppContext } from '../../context.js';
import { Prisma, type LandlordStaffRole } from '../../generated/prisma/index.js';
import { AccountStatus, LeaseStatus, Role } from '../../generated/prisma/index.js';
import { ConflictError, NotFoundError, UnprocessableError } from '../../shared/errors/AppError.js';
import { hashPassword } from '../../shared/utils/hash.js';
import { assertCan, propertyWhere, type LandlordAccess } from './access.js';

function isUnique(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/** Locations (Nairobi, Nakuru...) and the landlord's staff accounts. */
export class OrgService {
  constructor(private app: AppContext) {}

  // ── Locations ──────────────────────────────────────────────────────────────

  async listLocations(access: LandlordAccess) {
    assertCan(access, 'properties.view');
    const [locations, units, leases] = await Promise.all([
      this.app.prisma.propertyLocation.findMany({
        where: { landlordId: access.landlordId },
        orderBy: { name: 'asc' },
        include: { properties: { where: propertyWhere(access), select: { id: true, name: true } } },
      }),
      this.app.prisma.propertyUnit.groupBy({ by: ['propertyId'], where: { landlordId: access.landlordId }, _count: { _all: true } }),
      this.app.prisma.lease.groupBy({ by: ['propertyId'], where: { landlordId: access.landlordId, status: LeaseStatus.ACTIVE }, _count: { _all: true } }),
    ]);
    const unitCount = new Map(units.map((u) => [u.propertyId, u._count._all]));
    const leaseCount = new Map(leases.map((l) => [l.propertyId, l._count._all]));
    return locations.map((loc) => {
      const totalUnits = loc.properties.reduce((n, p) => n + (unitCount.get(p.id) ?? 0), 0);
      const occupied = loc.properties.reduce((n, p) => n + (leaseCount.get(p.id) ?? 0), 0);
      return { ...loc, propertyCount: loc.properties.length, units: totalUnits, occupied };
    });
  }

  async createLocation(access: LandlordAccess, input: { name: string; county?: string; description?: string }) {
    assertCan(access, 'locations.manage');
    try {
      const loc = await this.app.prisma.propertyLocation.create({ data: { ...input, landlordId: access.landlordId } });
      await this.app.auditLog.record({ actorId: access.actorId, action: 'CREATE', subjectType: 'LOCATION', subjectId: loc.id, summary: `Added location ${loc.name}` });
      return loc;
    } catch (err) {
      if (isUnique(err)) throw new ConflictError(`You already have a location called "${input.name}".`);
      throw err;
    }
  }

  async updateLocation(access: LandlordAccess, id: string, input: { name?: string; county?: string | null; description?: string | null }) {
    assertCan(access, 'locations.manage');
    const loc = await this.app.prisma.propertyLocation.findFirst({ where: { id, landlordId: access.landlordId } });
    if (!loc) throw new NotFoundError('Location');
    try {
      const updated = await this.app.prisma.propertyLocation.update({ where: { id }, data: input });
      await this.app.auditLog.record({ actorId: access.actorId, action: 'UPDATE', subjectType: 'LOCATION', subjectId: id, summary: `Updated location ${updated.name}`, oldValues: loc, newValues: updated });
      return updated;
    } catch (err) {
      if (isUnique(err)) throw new ConflictError(`You already have a location called "${input.name}".`);
      throw err;
    }
  }

  async removeLocation(access: LandlordAccess, id: string) {
    assertCan(access, 'locations.manage');
    const loc = await this.app.prisma.propertyLocation.findFirst({ where: { id, landlordId: access.landlordId } });
    if (!loc) throw new NotFoundError('Location');
    await this.app.prisma.propertyLocation.delete({ where: { id } }); // properties keep existing, ungrouped
    await this.app.auditLog.record({ actorId: access.actorId, action: 'DELETE', subjectType: 'LOCATION', subjectId: id, summary: `Removed location ${loc.name}` });
  }

  /** Validates a location id belongs to the landlord (for property create/update). */
  async assertLocation(landlordId: string, locationId: string | null | undefined) {
    if (!locationId) return;
    const loc = await this.app.prisma.propertyLocation.findFirst({ where: { id: locationId, landlordId }, select: { id: true } });
    if (!loc) throw new NotFoundError('Location');
  }

  // ── Staff ──────────────────────────────────────────────────────────────────

  private async assertProperties(landlordId: string, ids: string[]) {
    if (!ids.length) return;
    const found = await this.app.prisma.property.count({ where: { landlordId, id: { in: ids } } });
    if (found !== new Set(ids).size) throw new UnprocessableError('One or more selected properties are not yours.');
  }

  async listStaff(access: LandlordAccess) {
    assertCan(access, 'staff.manage');
    return this.app.prisma.landlordStaff.findMany({
      where: { landlordId: access.landlordId },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true, username: true, phone: true, status: true, createdAt: true } } },
    });
  }

  async createStaff(access: LandlordAccess, input: {
    name: string; email: string; username: string; phone?: string; password: string;
    staffRole: LandlordStaffRole; allProperties: boolean; propertyIds: string[];
  }) {
    assertCan(access, 'staff.manage');
    if (!input.allProperties && !input.propertyIds.length) throw new UnprocessableError('Pick at least one property, or give access to all properties.');
    await this.assertProperties(access.landlordId, input.propertyIds);
    try {
      const staff = await this.app.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: input.name, email: input.email.toLowerCase(), username: input.username.toLowerCase(), phone: input.phone ?? null,
            passwordHash: await hashPassword(input.password), role: Role.LANDLORD_STAFF, status: AccountStatus.ACTIVE,
          },
        });
        return tx.landlordStaff.create({
          data: { landlordId: access.landlordId, userId: user.id, staffRole: input.staffRole, allProperties: input.allProperties, propertyIds: input.allProperties ? [] : input.propertyIds },
          include: { user: { select: { id: true, name: true, email: true, username: true, phone: true, status: true, createdAt: true } } },
        });
      });
      await this.app.auditLog.record({ actorId: access.actorId, action: 'CREATE', subjectType: 'STAFF', subjectId: staff.id, summary: `Added ${input.staffRole.toLowerCase()} ${input.name}` });
      return staff;
    } catch (err) {
      if (isUnique(err)) throw new ConflictError('That email or username is already in use.');
      throw err;
    }
  }

  async updateStaff(access: LandlordAccess, id: string, input: {
    name?: string; phone?: string | null; password?: string; staffRole?: LandlordStaffRole; allProperties?: boolean; propertyIds?: string[]; status?: 'ACTIVE' | 'SUSPENDED';
  }) {
    assertCan(access, 'staff.manage');
    const staff = await this.app.prisma.landlordStaff.findFirst({ where: { id, landlordId: access.landlordId } });
    if (!staff) throw new NotFoundError('Staff member');
    const allProperties = input.allProperties ?? staff.allProperties;
    const propertyIds = allProperties ? [] : (input.propertyIds ?? staff.propertyIds);
    if (!allProperties && !propertyIds.length) throw new UnprocessableError('Pick at least one property, or give access to all properties.');
    await this.assertProperties(access.landlordId, propertyIds);

    const updated = await this.app.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: staff.userId },
        data: {
          ...(input.name ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
        },
      });
      return tx.landlordStaff.update({
        where: { id },
        data: { staffRole: input.staffRole ?? staff.staffRole, allProperties, propertyIds },
        include: { user: { select: { id: true, name: true, email: true, username: true, phone: true, status: true, createdAt: true } } },
      });
    });
    await this.app.auditLog.record({ actorId: access.actorId, action: 'UPDATE', subjectType: 'STAFF', subjectId: id, summary: `Updated staff ${updated.user.name}${input.status ? ` (${input.status.toLowerCase()})` : ''}` });
    return updated;
  }

  /**
   * Revokes a staff member. The user row is kept (suspended) rather than
   * deleted so the audit trail still names who did what.
   */
  async removeStaff(access: LandlordAccess, id: string) {
    assertCan(access, 'staff.manage');
    const staff = await this.app.prisma.landlordStaff.findFirst({ where: { id, landlordId: access.landlordId }, include: { user: { select: { name: true } } } });
    if (!staff) throw new NotFoundError('Staff member');
    await this.app.prisma.$transaction([
      this.app.prisma.user.update({ where: { id: staff.userId }, data: { status: AccountStatus.SUSPENDED } }),
      this.app.prisma.landlordStaff.delete({ where: { id } }),
    ]);
    await this.app.auditLog.record({ actorId: access.actorId, action: 'DELETE', subjectType: 'STAFF', subjectId: id, summary: `Revoked staff access for ${staff.user.name}` });
  }
}
