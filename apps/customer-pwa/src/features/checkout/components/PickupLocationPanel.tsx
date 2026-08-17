import type { PickupLocationSnapshotDto } from '@leen-mart/contracts';

interface PickupLocationPanelProps {
  readonly shopName: string;
  readonly location: PickupLocationSnapshotDto;
}

/**
 * Where to collect a pickup order (S4-ADDR).
 *
 * Rendered from the sub-order's own snapshot, taken when the order was
 * placed — never from the vendor's current profile. A vendor who moves
 * premises afterwards does not change what an already-placed order says, so
 * a customer is never sent to an address that was not the one they agreed to.
 *
 * Shown for the PICKUP sub-order regardless of its status, because a customer
 * needs to know where they are collecting from the moment they order — not
 * only once the vendor marks it ready. The rotating QR remains gated to
 * READY_FOR_PICKUP; this sits alongside it.
 */
export const PickupLocationPanel = ({
  shopName,
  location,
}: PickupLocationPanelProps): JSX.Element => (
  <div className="mt-3 flex flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 p-3">
    <p className="text-sm font-medium text-slate-900">Collect from</p>
    <address className="text-sm not-italic text-slate-700">
      <span className="block font-medium">{shopName}</span>
      <span className="block">
        {location.line1}
        {location.line2 ? `, ${location.line2}` : ''}
      </span>
      <span className="block">
        {location.city}, {location.state} {location.pincode}
      </span>
    </address>
  </div>
);
