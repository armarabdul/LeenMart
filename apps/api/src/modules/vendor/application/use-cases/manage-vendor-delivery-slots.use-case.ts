import type { Clock, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import { VendorProfileNotFoundError } from '../../domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';
import type { DeliverySlotRepository } from '../../domain/repositories/delivery-slot.repository.js';
import {
  DEFAULT_SLOT_HORIZON_DAYS,
  horizonEndDate,
  type DeliverySlotTemplate,
  type SlotBooking,
} from '../../domain/services/delivery-slot-policy.js';
import { toIst } from '../../domain/value-objects/ist-instant.value-object.js';

export interface VendorDeliverySlotsResult {
  readonly vendorId: string;
  /**
   * Whether the vendor offers any windows. `false` means customers order from
   * this vendor without choosing a slot — the backward-compatible default that
   * `ServiceablePincode` (D7) and `BusinessHour` (H4-A) each already
   * established — surfaced explicitly so the portal can say so rather than
   * showing an empty list that reads as "never available".
   */
  readonly configured: boolean;
  readonly slots: readonly DeliverySlotTemplate[];
  /** How full the next few days already are, so capacity is not a number the vendor sets blind. */
  readonly bookings: readonly SlotBooking[];
}

export interface GetVendorDeliverySlotsInput {
  readonly principal: Principal;
}

export interface SetVendorDeliverySlotsInput {
  readonly principal: Principal;
  readonly slots: readonly DeliverySlotTemplate[];
}

export interface VendorDeliverySlotsDeps {
  readonly vendorRepository: VendorRepository;
  readonly deliverySlotRepository: DeliverySlotRepository;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Stable ordering, so the stored offer and every response read the same way twice. */
const normalise = (slots: readonly DeliverySlotTemplate[]): readonly DeliverySlotTemplate[] =>
  [...slots].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);

/**
 * A vendor reads back its own slot offer, together with how full the coming
 * days already are (S4-SLOTS).
 *
 * Resolved from `principal.userId`, never from a request-supplied vendor id —
 * the same discipline every other `/me/*` vendor route follows, and what makes
 * "vendor A reads vendor B's slots" unspellable rather than merely refused.
 */
export class GetVendorDeliverySlotsUseCase {
  constructor(private readonly deps: VendorDeliverySlotsDeps) {}

  async execute(input: GetVendorDeliverySlotsInput): Promise<VendorDeliverySlotsResult> {
    const { vendorRepository, deliverySlotRepository, clock } = this.deps;

    const vendor = await vendorRepository.findByUserId(input.principal.userId);
    if (!vendor) {
      throw new VendorProfileNotFoundError();
    }

    const now = clock.now();
    const slots = await deliverySlotRepository.findByVendor(vendor.id);
    const bookings = await deliverySlotRepository.findBookingsByVendor(vendor.id, {
      fromDate: toIst(now).date,
      toDate: horizonEndDate(now, DEFAULT_SLOT_HORIZON_DAYS),
    });

    return { vendorId: vendor.id, configured: slots.length > 0, slots, bookings };
  }
}

/**
 * A vendor replaces its own slot offer (S4-SLOTS, locked decisions S1 and S3).
 *
 * **Bookings already taken survive this.** `slot_capacity` rows carry their own
 * snapshotted capacity and are never rewritten from the templates, so lowering
 * a window's capacity — or withdrawing the window entirely — changes what can
 * be booked from now on and never invalidates an order that already booked it.
 * That is the same immutability rule `sub_orders`' own snapshots follow, and it
 * is why this use case touches one table rather than two.
 *
 * An empty offer is accepted and meaningful: it clears the configuration and
 * returns the vendor to taking orders without a slot.
 *
 * No audit record, following the established shop-profile convention every
 * sibling use case here already uses.
 */
export class SetVendorDeliverySlotsUseCase {
  constructor(private readonly deps: VendorDeliverySlotsDeps) {}

  async execute(input: SetVendorDeliverySlotsInput): Promise<VendorDeliverySlotsResult> {
    const { vendorRepository, deliverySlotRepository, transactionRunner, clock, logger } =
      this.deps;

    const vendor = await vendorRepository.findByUserId(input.principal.userId);
    if (!vendor) {
      throw new VendorProfileNotFoundError();
    }

    const slots = normalise(input.slots);
    await transactionRunner.run(async (scope) => {
      await deliverySlotRepository.withTransaction(scope).replaceForVendor(vendor.id, slots);
    });

    const now = clock.now();
    const bookings = await deliverySlotRepository.findBookingsByVendor(vendor.id, {
      fromDate: toIst(now).date,
      toDate: horizonEndDate(now, DEFAULT_SLOT_HORIZON_DAYS),
    });

    logger.info({ vendorId: vendor.id, slotCount: slots.length }, 'Vendor replaced their slots');
    return { vendorId: vendor.id, configured: slots.length > 0, slots, bookings };
  }
}
