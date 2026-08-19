import type { TransactionScope } from '@leen-mart/domain-kit';
import type { PrismaClient } from '@prisma/client';
import { toVendorId, type VendorId } from '../../../identity/index.js';
import type {
  DeliverySlotRepository,
  SlotAvailabilityRepository,
} from '../../domain/repositories/delivery-slot.repository.js';
import type {
  DeliverySlotTemplate,
  SlotBooking,
  SlotSelection,
} from '../../domain/services/delivery-slot-policy.js';
import { toIsoDate } from '../../domain/value-objects/ist-instant.value-object.js';

/** `2026-08-18` → the `@db.Date` value PostgreSQL stores for that IST calendar day. */
const toDateValue = (isoDate: string): Date => new Date(`${isoDate}T00:00:00Z`);

/**
 * The vendor's own management path (S4-SLOTS).
 *
 * Bound to the tenant-scoped `leenmart_app` client, so `delivery_slots_vendor_*`
 * confines every statement to the caller's own `app.vendor_id` — the `vendorId`
 * passed here is belt-and-braces on top of that, not the enforcement.
 *
 * Reads `slot_capacity` but never writes it: the counter is derived from orders
 * rather than declared, and the vendor role holds no write policy on it.
 */
export class PrismaDeliverySlotRepository implements DeliverySlotRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): DeliverySlotRepository {
    return new PrismaDeliverySlotRepository(scope as unknown as PrismaClient);
  }

  async findByVendor(vendorId: VendorId): Promise<readonly DeliverySlotTemplate[]> {
    return this.prisma.deliverySlot.findMany({
      where: { vendorId },
      select: { weekday: true, startMinute: true, endMinute: true, capacity: true },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });
  }

  async replaceForVendor(
    vendorId: VendorId,
    slots: readonly DeliverySlotTemplate[],
  ): Promise<void> {
    await this.prisma.deliverySlot.deleteMany({ where: { vendorId } });
    if (slots.length > 0) {
      await this.prisma.deliverySlot.createMany({
        data: slots.map((slot) => ({ vendorId, ...slot })),
      });
    }
  }

  async findBookingsByVendor(
    vendorId: VendorId,
    range: { readonly fromDate: string; readonly toDate: string },
  ): Promise<readonly SlotBooking[]> {
    const rows = await this.prisma.slotCapacity.findMany({
      where: {
        vendorId,
        slotDate: { gte: toDateValue(range.fromDate), lte: toDateValue(range.toDate) },
      },
      select: { slotDate: true, startMinute: true, booked: true },
      orderBy: [{ slotDate: 'asc' }, { startMinute: 'asc' }],
    });
    return rows.map((row) => ({
      date: toIsoDate(row.slotDate),
      startMinute: row.startMinute,
      booked: row.booked,
    }));
  }
}

/**
 * The checkout-side read and write (S4-SLOTS).
 *
 * Bound to `leenmart_checkout` — the only credential besides the owning vendor
 * with reach into these tables, and the only one that may move `booked`. The
 * precedent is `PrismaInventoryRepository`, which holds exactly this shape of
 * privilege over `inventory` for exactly this reason: a multi-vendor cart must
 * write rows belonging to vendors this session has no tenant context for.
 */
export class PrismaSlotAvailabilityRepository implements SlotAvailabilityRepository {
  constructor(private readonly checkoutPrisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): SlotAvailabilityRepository {
    return new PrismaSlotAvailabilityRepository(scope as unknown as PrismaClient);
  }

  async findTemplatesForVendors(
    vendorIds: readonly VendorId[],
  ): Promise<ReadonlyMap<VendorId, readonly DeliverySlotTemplate[]>> {
    const resolved = new Map<VendorId, DeliverySlotTemplate[]>();
    for (const vendorId of vendorIds) resolved.set(vendorId, []);
    if (vendorIds.length === 0) return resolved;

    const rows = await this.checkoutPrisma.deliverySlot.findMany({
      where: { vendorId: { in: [...vendorIds] } },
      select: {
        vendorId: true,
        weekday: true,
        startMinute: true,
        endMinute: true,
        capacity: true,
      },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
    });

    for (const row of rows) {
      resolved.get(toVendorId(row.vendorId))?.push({
        weekday: row.weekday,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
        capacity: row.capacity,
      });
    }
    return resolved;
  }

  async findBookingsForVendors(
    vendorIds: readonly VendorId[],
    range: { readonly fromDate: string; readonly toDate: string },
  ): Promise<ReadonlyMap<VendorId, readonly SlotBooking[]>> {
    const resolved = new Map<VendorId, SlotBooking[]>();
    for (const vendorId of vendorIds) resolved.set(vendorId, []);
    if (vendorIds.length === 0) return resolved;

    const rows = await this.checkoutPrisma.slotCapacity.findMany({
      where: {
        vendorId: { in: [...vendorIds] },
        slotDate: { gte: toDateValue(range.fromDate), lte: toDateValue(range.toDate) },
      },
      select: { vendorId: true, slotDate: true, startMinute: true, booked: true },
    });

    for (const row of rows) {
      resolved.get(toVendorId(row.vendorId))?.push({
        date: toIsoDate(row.slotDate),
        startMinute: row.startMinute,
        booked: row.booked,
      });
    }
    return resolved;
  }

  async consume(
    vendorId: VendorId,
    slot: SlotSelection & { readonly endMinute: number; readonly capacity: number },
  ): Promise<boolean> {
    const slotDate = toDateValue(slot.date);

    // Step 1 — materialise (S3). `skipDuplicates` compiles to
    // `ON CONFLICT DO NOTHING`, so two concurrent first-bookings of the same
    // window both proceed and exactly one row exists afterwards. This never
    // overwrites an existing row, which is what keeps a booked window's
    // snapshotted capacity stable after the vendor edits the template.
    await this.checkoutPrisma.slotCapacity.createMany({
      data: [
        {
          vendorId,
          slotDate,
          startMinute: slot.startMinute,
          endMinute: slot.endMinute,
          capacity: slot.capacity,
          booked: 0,
        },
      ],
      skipDuplicates: true,
    });

    // Step 2 — take one unit, conditionally, in a single statement. The
    // `booked < capacity` guard is a Prisma field reference, so it compiles
    // into the same `UPDATE … WHERE` PostgreSQL evaluates atomically; there is
    // no prior read whose answer could be stale by the time the write lands.
    // `count === 0` means the window filled between the availability view and
    // now — the caller aborts the placement rather than choosing another slot.
    const result = await this.checkoutPrisma.slotCapacity.updateMany({
      where: {
        vendorId,
        slotDate,
        startMinute: slot.startMinute,
        booked: { lt: this.checkoutPrisma.slotCapacity.fields.capacity },
      },
      data: { booked: { increment: 1 } },
    });
    return result.count === 1;
  }

  async release(vendorId: VendorId, slot: SlotSelection): Promise<void> {
    // Conditional for the same reason `consume` is: a replayed release must
    // not drive the counter below zero, and the CHECK constraint would abort
    // the whole cancellation if it tried. A row that is already at zero — or
    // has somehow gone — simply matches nothing, which is the correct no-op.
    await this.checkoutPrisma.slotCapacity.updateMany({
      where: {
        vendorId,
        slotDate: toDateValue(slot.date),
        startMinute: slot.startMinute,
        booked: { gt: 0 },
      },
      data: { booked: { decrement: 1 } },
    });
  }
}
