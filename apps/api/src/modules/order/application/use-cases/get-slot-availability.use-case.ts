import type { Clock } from '@leen-mart/domain-kit';
import type { Principal, VendorId } from '../../../identity/index.js';
import type { CartItemRepository, CartRepository } from '../../../cart/index.js';
import type { ProductVariantRepository } from '../../../catalogue/index.js';
import type { VendorRepository } from '../../../vendor/index.js';
import type { SlotAvailabilityRepository } from '../../../vendor/domain/repositories/delivery-slot.repository.js';
import {
  DEFAULT_SLOT_HORIZON_DAYS,
  MAX_SLOT_HORIZON_DAYS,
  horizonEndDate,
  offeredSlots,
  type OfferedSlot,
} from '../../../vendor/domain/services/delivery-slot-policy.js';
import { toIst } from '../../../vendor/domain/value-objects/ist-instant.value-object.js';

export interface VendorSlotAvailability {
  readonly vendorId: string;
  readonly shopName: string | null;
  /** Empty means this vendor takes orders without a slot — never "this vendor is unavailable". */
  readonly slots: readonly OfferedSlot[];
}

export interface GetSlotAvailabilityInput {
  readonly principal: Principal;
  /** Bounded by `MAX_SLOT_HORIZON_DAYS`; the contract rejects anything larger. */
  readonly days?: number;
}

export interface GetSlotAvailabilityDeps {
  readonly cartRepository: CartRepository;
  readonly cartItemRepository: CartItemRepository;
  readonly productVariantRepository: ProductVariantRepository;
  readonly vendorRepository: VendorRepository;
  readonly slotAvailabilityRepository: SlotAvailabilityRepository;
  readonly clock: Clock;
}

/**
 * What slots the caller can actually choose at checkout (S4-SLOTS).
 *
 * **Scoped to the caller's own cart**, and that is a security property rather
 * than a convenience: the request names no vendor, so there is no id to
 * substitute and no way to enumerate another shop's operating pattern. It is
 * why the route is `SELF_SCOPED` in the manifest despite reading vendor-owned
 * rows.
 *
 * Reads on `leenmart_checkout` for the reason every sibling checkout lookup
 * does: a multi-vendor cart must evaluate vendors this session has no tenant
 * context for.
 *
 * Two bounded queries regardless of cart size — templates and bookings — then
 * one pure `offeredSlots` call per vendor. Nothing here decides availability;
 * that lives in the policy, so the availability the customer sees and the
 * selection the server later accepts cannot drift apart.
 *
 * The numbers returned are a **snapshot, not a promise**: a window shown with
 * room may be full by the time the order is placed, which is exactly why
 * placement re-resolves and consumes atomically rather than trusting this.
 */
export class GetSlotAvailabilityUseCase {
  constructor(private readonly deps: GetSlotAvailabilityDeps) {}

  async execute(input: GetSlotAvailabilityInput): Promise<readonly VendorSlotAvailability[]> {
    const horizonDays = Math.min(input.days ?? DEFAULT_SLOT_HORIZON_DAYS, MAX_SLOT_HORIZON_DAYS);
    const vendorIds = await this.cartVendorIds(input.principal);
    if (vendorIds.length === 0) return [];

    const now = this.deps.clock.now();
    const range = { fromDate: toIst(now).date, toDate: horizonEndDate(now, horizonDays) };

    const [templatesByVendor, bookingsByVendor] = await Promise.all([
      this.deps.slotAvailabilityRepository.findTemplatesForVendors(vendorIds),
      this.deps.slotAvailabilityRepository.findBookingsForVendors(vendorIds, range),
    ]);

    const availability: VendorSlotAvailability[] = [];
    for (const vendorId of vendorIds) {
      const vendor = await this.deps.vendorRepository.findById(vendorId);
      availability.push({
        vendorId,
        shopName: vendor?.shopName ?? null,
        slots: offeredSlots(
          templatesByVendor.get(vendorId) ?? [],
          bookingsByVendor.get(vendorId) ?? [],
          now,
          horizonDays,
        ),
      });
    }
    return availability;
  }

  /** The distinct vendors in the caller's own cart, in a stable order. */
  private async cartVendorIds(principal: Principal): Promise<readonly VendorId[]> {
    const cart = await this.deps.cartRepository.findByUserId(principal.userId);
    if (!cart) return [];
    const items = await this.deps.cartItemRepository.listByCartId(cart.id);

    const vendorIds: VendorId[] = [];
    for (const item of items) {
      const variant = await this.deps.productVariantRepository.findById(item.variantId);
      if (variant && !vendorIds.includes(variant.vendorId)) {
        vendorIds.push(variant.vendorId);
      }
    }
    return vendorIds;
  }
}
