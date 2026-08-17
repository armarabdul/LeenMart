import type { ProductVariantRepository } from '../../../catalogue/index.js';
import type { VendorRepository } from '../../../vendor/domain/repositories/vendor.repository.js';
import type { CartItem } from '../../domain/entities/cart-item.entity.js';

/** The minimum a cart line needs to offer a per-vendor fulfilment choice (S4-QR). */
export interface CartLineVendor {
  readonly vendorId: string;
  readonly vendorShopName: string;
  readonly supportsPickup: boolean;
}

export interface CartLineVendorResolverDeps {
  readonly productVariantRepository: ProductVariantRepository;
  /**
   * Bound to the **checkout** credential (`leenmart_checkout`). Neither of
   * the cart module's other clients can serve this read: `leenmart_public`
   * holds no grant on `vendors` at all, and `leenmart_app`'s `vendors_select`
   * policy is scoped to `app.vendor_id`, which a customer session never has —
   * it would return zero rows rather than fail, which is worse. The checkout
   * role's own `vendors_checkout_read` policy exists for exactly this
   * cross-vendor read, and `PlaceOrderUseCase` already resolves shop name and
   * pickup capability the same way.
   */
  readonly vendorRepository: VendorRepository;
}

/**
 * Resolves each cart line's owning vendor (S4-QR).
 *
 * Server-derived end to end: the variant's own denormalised `vendorId` names
 * the vendor, and the vendor's profile supplies the shop name and pickup
 * capability. Nothing here is ever taken from the request.
 *
 * **A cart line is never dropped for want of vendor data.** `vendorId` comes
 * from the variant's own denormalised column, so it is always available; only
 * the shop name and pickup capability need the vendor row. A vendor with no
 * `shopName` yet — which `cart.test.ts`'s own fixtures are, and which is a
 * legitimate mid-onboarding state — therefore still shows its line, just with
 * no name and no pickup offer. Hiding the customer's own cart line because a
 * vendor profile is incomplete would be a far worse failure than an empty
 * label, and `PlaceOrderUseCase` already refuses to place an order for a
 * vendor without a `shopName`, so an unnamed vendor can never reach a real
 * order anyway.
 *
 * Only a variant that no longer resolves at all is omitted — that line is
 * genuinely unbuyable, and the add/checkout eligibility checks already treat
 * it that way.
 */
export class CartLineVendorResolver {
  constructor(private readonly deps: CartLineVendorResolverDeps) {}

  async resolve(items: readonly CartItem[]): Promise<ReadonlyMap<string, CartLineVendor>> {
    const byVariantId = new Map<string, CartLineVendor>();
    if (items.length === 0) {
      return byVariantId;
    }

    const { productVariantRepository, vendorRepository } = this.deps;
    const vendorCache = new Map<string, CartLineVendor>();

    for (const item of items) {
      // A cart is capped at a handful of lines, and each lookup feeds the
      // shared vendor cache below.
      const variant = await productVariantRepository.findById(item.variantId);
      if (!variant) continue;

      const vendorId = variant.vendorId;
      if (!vendorCache.has(vendorId)) {
        // Cached per vendor, so a multi-line single-vendor cart costs one read.
        const vendor = await vendorRepository.findById(vendorId);
        vendorCache.set(vendorId, {
          vendorId,
          vendorShopName: vendor?.shopName ?? '',
          // An unreadable or unnamed vendor is never offered as a pickup
          // option — the flag defaults closed, and the backend re-validates
          // it at checkout regardless.
          supportsPickup: vendor?.supportsPickup ?? false,
        });
      }

      const resolved = vendorCache.get(vendorId);
      if (resolved) {
        byVariantId.set(item.variantId, resolved);
      }
    }

    return byVariantId;
  }
}
