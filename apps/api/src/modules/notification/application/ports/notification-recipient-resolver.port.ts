/**
 * Resolves the users an order's notifications belong to (S6-NOTIFY-INAPP).
 *
 * **This port exists because no event payload carries both identities.** Order
 * events (`order.placed`, `order.confirmed`, …) carry `customerId` but say
 * nothing about which vendors are involved; the `sub_order.*` events carry
 * `vendorId` but not the customer. Rather than widen those payloads — which
 * would change five use cases on the checkout hot path for a consumer's
 * convenience — the orchestrator looks the missing side up here.
 *
 * The implementation must read **across vendors**: one order can hold several
 * vendors' sub-orders, and `leenmart_app`'s policies are scoped to a single
 * `app.vendor_id`, so a vendor-scoped credential would silently return a subset.
 * `leenmart_checkout` is the existing credential with that reach and is what
 * the adapter uses; nothing here widens vendor RLS.
 */
export interface NotificationRecipientResolver {
  /**
   * Every vendor-owner user for the vendors with a sub-order on this order.
   *
   * Deliberately plural: a multi-vendor cart produces one sub-order per vendor
   * (ASM-03), and each of those vendors is a separate recipient of
   * "New order (vendor)".
   *
   * Returns user ids, not vendor ids — a notification is delivered to a person,
   * and `recipient_user_id` is the anchor. A vendor whose owner cannot be
   * resolved is omitted rather than guessed at.
   */
  vendorUserIdsForOrder(orderId: string): Promise<readonly string[]>;
}
