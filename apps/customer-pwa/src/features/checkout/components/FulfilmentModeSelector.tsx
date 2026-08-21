import type { CartVendorGroup } from '../lib/group-cart-by-vendor';

interface FulfilmentModeSelectorProps {
  readonly vendors: readonly CartVendorGroup[];
  readonly pickupVendorIds: readonly string[];
  readonly onToggle: (vendorId: string, pickup: boolean) => void;
}

/**
 * Per-vendor DELIVERY/PICKUP choice (S4-QR, locked decision #24).
 *
 * One choice per vendor, never one for the whole order: a multi-vendor cart
 * can legitimately be "pick up from A, deliver from B", and `fulfilmentMode`
 * lives on the `SubOrder` precisely so that is representable.
 *
 * `PICKUP` is offered only where the vendor actually supports it — but that
 * is a *display* rule, not the security boundary: `PlaceOrderUseCase`
 * re-validates every id in `pickupVendorIds` against the cart's real vendors
 * and their `supportsPickup` flag, and refuses rather than downgrading
 * (locked decision #25).
 *
 * Rendered only for a multi-vendor cart or a pickup-capable single vendor —
 * a lone delivery-only vendor gets no control at all, since there is nothing
 * to choose.
 */
export const FulfilmentModeSelector = ({
  vendors,
  pickupVendorIds,
  onToggle,
}: FulfilmentModeSelectorProps): JSX.Element | null => {
  const anyPickupCapable = vendors.some((vendor) => vendor.supportsPickup);
  if (!anyPickupCapable) {
    return null;
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
        Delivery or pickup
      </h2>
      <ul className="flex flex-col gap-2">
        {vendors.map((vendor) => {
          const isPickup = pickupVendorIds.includes(vendor.vendorId);
          return (
            <li
              key={vendor.vendorId}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
            >
              <span className="text-sm font-medium text-text">{vendor.vendorShopName}</span>
              {vendor.supportsPickup ? (
                <div className="flex gap-4">
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text">
                    <input
                      type="radio"
                      name={`fulfilment-${vendor.vendorId}`}
                      checked={!isPickup}
                      onChange={() => onToggle(vendor.vendorId, false)}
                      className="h-4 w-4 rounded-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    />
                    Deliver to me
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-text">
                    <input
                      type="radio"
                      name={`fulfilment-${vendor.vendorId}`}
                      checked={isPickup}
                      onChange={() => onToggle(vendor.vendorId, true)}
                      className="h-4 w-4 rounded-full accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                    />
                    Pick up in store
                  </label>
                </div>
              ) : (
                <p className="text-sm text-text-muted">Delivery only</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
