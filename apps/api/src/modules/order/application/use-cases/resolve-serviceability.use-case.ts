import type { VendorId } from '../../../identity/index.js';
import type { ServiceabilityRepository } from '../../domain/repositories/serviceability.repository.js';

export interface ResolveServiceabilityInput {
  /**
   * The delivery pincode, read from the customer's own stored `Address` after
   * an ownership check — **never** from the request body. `PlaceOrderUseCase`
   * is the only caller and passes `address.pincode`.
   */
  readonly pincode: string;
  /** Only the vendors whose sub-order is `DELIVERY`; pickup vendors are never passed here (D6). */
  readonly deliveryVendorIds: readonly VendorId[];
}

export interface ResolveServiceabilityDeps {
  readonly serviceabilityRepository: ServiceabilityRepository;
}

/**
 * Decides which delivery vendors can serve a given pincode (S4-SERV,
 * SDD 4.2 step 4b, ASM-17).
 *
 * A use case rather than SQL inlined into `PlaceOrderUseCase`, so the two
 * rules that make up the decision live in exactly one readable place:
 *
 *  1. **An unconfigured vendor serves everywhere** (locked decision D7).
 *     Every vendor predates `serviceable_pincodes`; reading "no rows" as
 *     "serves nowhere" would take the entire existing delivery fleet offline
 *     the moment this shipped. The rule is deliberately expressed against
 *     `VendorServiceability.configured` rather than against a row count, so
 *     introducing an explicit "I have finished configuring" flag later
 *     changes only where that boolean comes from.
 *
 *  2. **A configured vendor serves only what it declared.** No fallback to
 *     the shop's own pincode (D2), no radius, no distance — those are other
 *     capabilities entirely.
 *
 * Returns the unserviceable vendors rather than throwing: the caller owns the
 * all-or-nothing policy (D4) and the error type, and a use case that returned
 * "who failed" is also what a future display-only checkout hint would call.
 */
export class ResolveServiceabilityUseCase {
  constructor(private readonly deps: ResolveServiceabilityDeps) {}

  async execute(input: ResolveServiceabilityInput): Promise<readonly VendorId[]> {
    const { pincode, deliveryVendorIds } = input;
    if (deliveryVendorIds.length === 0) {
      // A pickup-only order asks the database nothing at all.
      return [];
    }

    const resolved = await this.deps.serviceabilityRepository.resolveForPincode(
      pincode,
      deliveryVendorIds,
    );

    return deliveryVendorIds.filter((vendorId) => {
      const serviceability = resolved.get(vendorId);
      // Absent from the map is treated exactly as unconfigured: the repository
      // contract already promises every requested vendor is present, and this
      // keeps the legacy rule the single answer for "we know nothing".
      if (!serviceability?.configured) return false;
      return !serviceability.servesPincode;
    });
  }
}
