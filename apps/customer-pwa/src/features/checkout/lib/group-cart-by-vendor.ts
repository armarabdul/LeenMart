import type { CartItemResponse } from '@leen-mart/contracts';

export interface CartVendorGroup {
  readonly vendorId: string;
  readonly vendorShopName: string;
  readonly supportsPickup: boolean;
}

/**
 * Collapses the cart's lines into the distinct vendors it spans (S4-QR).
 *
 * Every field here is server-derived — the cart response carries `vendorId`,
 * `vendorShopName` and `supportsPickup` per line, resolved from the variant's
 * own vendor. Nothing about the vendor is ever inferred client-side, and
 * `supportsPickup` is a display hint only: `PlaceOrderUseCase` re-validates it.
 *
 * Kept in its own module rather than beside `FulfilmentModeSelector` so that
 * file exports only its component (react-refresh/only-export-components).
 */
export const groupCartByVendor = (
  items: readonly CartItemResponse[],
): readonly CartVendorGroup[] => {
  const byVendorId = new Map<string, CartVendorGroup>();
  for (const item of items) {
    if (!byVendorId.has(item.vendorId)) {
      byVendorId.set(item.vendorId, {
        vendorId: item.vendorId,
        vendorShopName: item.vendorShopName,
        supportsPickup: item.supportsPickup,
      });
    }
  }
  return [...byVendorId.values()];
};
