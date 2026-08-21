import type { CartItemResponse } from '@leen-mart/contracts';

export interface CartVendorSection {
  readonly vendorId: string;
  readonly vendorShopName: string;
  readonly items: readonly CartItemResponse[];
}

/**
 * Groups the cart's lines under the shop that will fulfil them (Phase E).
 *
 * Leen Mart carts are genuinely multi-vendor — an order fans out into one
 * sub-order per vendor — so a flat list misrepresents what the customer is
 * about to buy. `vendorId`/`vendorShopName` are resolved server-side on every
 * cart line (see `cartItemResponseSchema`), so the grouping is read from the
 * API rather than inferred here.
 *
 * Insertion order is preserved for both vendors and their items so the cart
 * does not reshuffle itself when a quantity changes.
 *
 * Distinct from checkout's own `groupCartByVendor`, which collapses the cart
 * to the vendors alone in order to offer a per-vendor DELIVERY/PICKUP choice.
 * This one keeps the items, and lives in `cart/` because a feature may never
 * import from another feature.
 */
export const groupCartItemsByVendor = (
  items: readonly CartItemResponse[],
): readonly CartVendorSection[] => {
  const byVendorId = new Map<string, { vendorShopName: string; items: CartItemResponse[] }>();
  for (const item of items) {
    const existing = byVendorId.get(item.vendorId);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    byVendorId.set(item.vendorId, { vendorShopName: item.vendorShopName, items: [item] });
  }
  return [...byVendorId.entries()].map(([vendorId, group]) => ({
    vendorId,
    vendorShopName: group.vendorShopName,
    items: group.items,
  }));
};
