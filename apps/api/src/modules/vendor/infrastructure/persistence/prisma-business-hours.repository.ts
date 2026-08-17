import { randomUUID } from 'node:crypto';
import type { TransactionScope } from '@leen-mart/domain-kit';
import type { PrismaClient } from '@prisma/client';
import { toVendorId, type VendorId } from '../../../identity/index.js';
import type {
  BusinessHoursLookupRepository,
  BusinessHoursRepository,
} from '../../domain/repositories/business-hours.repository.js';
import type { VendorBusinessHours } from '../../domain/services/business-hours-policy.js';
import { toIsoDate } from '../../domain/value-objects/ist-instant.value-object.js';

/**
 * The vendor's own management path (S4-HOURS).
 *
 * Bound to the tenant-scoped `leenmart_app` client, so `business_hours_vendor_*`
 * and `business_hour_closures_vendor_*` confine every statement to the
 * caller's own `app.vendor_id` — the `vendorId` passed here is belt-and-braces
 * on top of that, not the enforcement.
 */
export class PrismaBusinessHoursRepository implements BusinessHoursRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): BusinessHoursRepository {
    return new PrismaBusinessHoursRepository(scope as unknown as PrismaClient);
  }

  async findByVendor(vendorId: VendorId): Promise<VendorBusinessHours> {
    const [intervals, closures] = await Promise.all([
      this.prisma.businessHour.findMany({
        where: { vendorId },
        select: { weekday: true, openMinute: true, closeMinute: true },
        orderBy: [{ weekday: 'asc' }, { openMinute: 'asc' }],
      }),
      this.prisma.businessHourClosure.findMany({
        where: { vendorId },
        select: { weekday: true, closedOn: true },
        orderBy: [{ weekday: 'asc' }, { closedOn: 'asc' }],
      }),
    ]);

    return {
      intervals,
      closures: closures.map((closure) => ({
        weekday: closure.weekday,
        closedOn: closure.closedOn === null ? null : toIsoDate(closure.closedOn),
      })),
    };
  }

  async replaceForVendor(vendorId: VendorId, hours: VendorBusinessHours): Promise<void> {
    await this.prisma.businessHour.deleteMany({ where: { vendorId } });
    await this.prisma.businessHourClosure.deleteMany({ where: { vendorId } });

    if (hours.intervals.length > 0) {
      await this.prisma.businessHour.createMany({
        data: hours.intervals.map((interval) => ({ vendorId, ...interval })),
      });
    }
    if (hours.closures.length > 0) {
      await this.prisma.businessHourClosure.createMany({
        data: hours.closures.map((closure) => ({
          // A surrogate id, unlike `business_hours`' natural key: the two
          // closure kinds populate different columns, so no single column set
          // identifies a row.
          id: randomUUID(),
          vendorId,
          weekday: closure.weekday,
          // `@db.Date` wants a Date; the string is already an IST calendar day,
          // and appending Z keeps it at that day rather than shifting it.
          closedOn: closure.closedOn === null ? null : new Date(`${closure.closedOn}T00:00:00Z`),
        })),
      });
    }
  }
}

/**
 * The checkout-side read (S4-HOURS).
 *
 * Bound to `leenmart_checkout`, the only credential besides the owning
 * vendor's own policy granted SELECT on these tables — a multi-vendor cart
 * must evaluate vendors this session has no tenant context for, exactly as
 * `PrismaServiceabilityRepository` already does.
 *
 * **Two queries, both bounded by the vendor list, never one per vendor.** The
 * closure query is narrowed to the two closures that could bite today; the
 * interval query is not, because H4-A asks whether the vendor has *any* hours
 * at all and a today-only filter cannot answer that.
 */
export class PrismaBusinessHoursLookupRepository implements BusinessHoursLookupRepository {
  constructor(private readonly checkoutPrisma: PrismaClient) {}

  async findForVendors(
    vendorIds: readonly VendorId[],
    today: { readonly weekday: number; readonly isoDate: string },
  ): Promise<ReadonlyMap<VendorId, VendorBusinessHours>> {
    const resolved = new Map<VendorId, VendorBusinessHours>();
    if (vendorIds.length === 0) {
      return resolved;
    }

    const ids = [...vendorIds];
    const [intervalRows, closureRows] = await Promise.all([
      this.checkoutPrisma.businessHour.findMany({
        // Every weekday, not just today's. H4-A keys on the vendor having no
        // `business_hours` rows *at all*; narrowing this to today would make a
        // vendor who trades only on Mondays look unconfigured — and therefore
        // open — every other day of the week.
        where: { vendorId: { in: ids } },
        select: { vendorId: true, weekday: true, openMinute: true, closeMinute: true },
      }),
      this.checkoutPrisma.businessHourClosure.findMany({
        where: {
          vendorId: { in: ids },
          OR: [{ weekday: today.weekday }, { closedOn: new Date(`${today.isoDate}T00:00:00Z`) }],
        },
        select: { vendorId: true, weekday: true, closedOn: true },
      }),
    ]);

    for (const vendorId of vendorIds) {
      resolved.set(vendorId, { intervals: [], closures: [] });
    }
    for (const row of intervalRows) {
      const vendorId = toVendorId(row.vendorId);
      const existing = resolved.get(vendorId);
      if (!existing) continue;
      resolved.set(vendorId, {
        intervals: [
          ...existing.intervals,
          { weekday: row.weekday, openMinute: row.openMinute, closeMinute: row.closeMinute },
        ],
        closures: existing.closures,
      });
    }
    for (const row of closureRows) {
      const vendorId = toVendorId(row.vendorId);
      const existing = resolved.get(vendorId);
      if (!existing) continue;
      resolved.set(vendorId, {
        intervals: existing.intervals,
        closures: [
          ...existing.closures,
          {
            weekday: row.weekday,
            closedOn: row.closedOn === null ? null : toIsoDate(row.closedOn),
          },
        ],
      });
    }
    return resolved;
  }
}
