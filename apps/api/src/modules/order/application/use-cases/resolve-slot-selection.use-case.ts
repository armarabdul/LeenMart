import type { Clock } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';
import type { SlotAvailabilityRepository } from '../../../vendor/domain/repositories/delivery-slot.repository.js';
import {
  DEFAULT_SLOT_HORIZON_DAYS,
  offersSlots,
  resolveSelection,
  type SlotSelection,
} from '../../../vendor/domain/services/delivery-slot-policy.js';
import {
  OrderSlotNotOfferedError,
  OrderSlotRequiredError,
} from '../../domain/errors/order-errors.js';

/** A slot the server itself resolved — never the client's own numbers beyond the two it named. */
export interface ResolvedSlot {
  readonly date: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly capacity: number;
}

export interface ResolveSlotSelectionInput {
  /** Every vendor in the cart, `DELIVERY` and `PICKUP` alike — slots apply to both (locked decision S4). */
  readonly vendorIds: readonly VendorId[];
  /** What the customer chose, keyed by vendor. A vendor may legitimately be absent. */
  readonly selections: ReadonlyMap<VendorId, SlotSelection>;
}

export interface ResolveSlotSelectionDeps {
  readonly slotAvailabilityRepository: SlotAvailabilityRepository;
  readonly clock: Clock;
}

/**
 * Decides which slot each vendor's sub-order is booked into (S4-SLOTS, SDD 4.2
 * step 4c, FR-27).
 *
 * A use case rather than logic inlined into `PlaceOrderUseCase`, for the same
 * reason `ResolveServiceabilityUseCase` and `ResolveBusinessHoursUseCase` are
 * ones: the decision has rules of its own and they belong somewhere a test can
 * reach without a cart.
 *
 * **The customer's numbers are never trusted.** The request names only a date
 * and a start minute; the window's end and its capacity are read from the
 * vendor's own template here, so a client cannot widen a window or inflate a
 * capacity by sending different values.
 *
 * **The current instant comes from the injected `Clock`**, converted to IST
 * once, so a window that has already ended cannot be booked and a test can sit
 * on either side of that boundary deterministically.
 *
 * Two things this deliberately does **not** do:
 *
 *  - It does not check whether the window has room. Availability at validation
 *    time proves nothing about availability a millisecond later; the only
 *    honest capacity check is the atomic conditional UPDATE at consumption
 *    time, inside the placement transaction.
 *  - It does not substitute anything. A vendor whose selection is missing or
 *    unrecognised raises — never a nearby window, never a different day.
 */
export class ResolveSlotSelectionUseCase {
  constructor(private readonly deps: ResolveSlotSelectionDeps) {}

  async execute(input: ResolveSlotSelectionInput): Promise<ReadonlyMap<VendorId, ResolvedSlot>> {
    const { vendorIds, selections } = input;
    const resolved = new Map<VendorId, ResolvedSlot>();
    if (vendorIds.length === 0) return resolved;

    const now = this.deps.clock.now();
    const templatesByVendor =
      await this.deps.slotAvailabilityRepository.findTemplatesForVendors(vendorIds);

    for (const vendorId of vendorIds) {
      const templates = templatesByVendor.get(vendorId) ?? [];
      const selection = selections.get(vendorId);

      // A vendor who offers no windows takes orders without one — the
      // backward-compatible default D7 and H4-A each established. A selection
      // naming such a vendor is still refused rather than ignored: silently
      // dropping it would tell the customer their choice was honoured.
      if (!offersSlots(templates)) {
        if (selection) throw new OrderSlotNotOfferedError();
        continue;
      }

      if (!selection) throw new OrderSlotRequiredError();

      const template = resolveSelection(templates, selection, now, DEFAULT_SLOT_HORIZON_DAYS);
      if (!template) throw new OrderSlotNotOfferedError();

      resolved.set(vendorId, {
        date: selection.date,
        startMinute: template.startMinute,
        endMinute: template.endMinute,
        capacity: template.capacity,
      });
    }

    return resolved;
  }
}
