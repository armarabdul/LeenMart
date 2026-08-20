import type { VendorId } from '../../../identity/index.js';

/**
 * Resolves the distinct vendors with a sub-order on a placed order (S4-SSE).
 *
 * **Deliberately not `NotificationRecipientResolver`.** That port resolves
 * only the vendor *owner's* `userId` (S6-NOTIFY-INAPP's own locked scope);
 * `VIEW_VENDOR_ORDERS` grants `OWN` to `VENDOR_OWNER`/`VENDOR_MANAGER`/
 * `VENDOR_STAFF` alike, and `VendorStreamRegistry` is keyed by `VendorId`,
 * not by any one user — every connected session for the vendor, whoever is
 * signed in, receives the alert. This port stops one query earlier than
 * `NotificationRecipientResolver` does for exactly that reason: it never
 * needs the owner's `userId` at all.
 */
export interface OrderVendorResolver {
  /** Every distinct vendor with a sub-order on `orderId`, in no particular order. Empty if the order has none (should not happen for a placed order, but never assumed). */
  vendorIdsForOrder(orderId: string): Promise<readonly VendorId[]>;
}
