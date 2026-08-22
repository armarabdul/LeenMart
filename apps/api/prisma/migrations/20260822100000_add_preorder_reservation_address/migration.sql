-- Phase Next follow-up: `preorder_reservations.address_id`.
--
-- `ConvertReservationToOrderUseCase` builds a real `Order`, and `Order`
-- unconditionally requires an address snapshot (`Order.place()`'s own
-- signature) even when every one of its sub-orders is `PICKUP` — the exact
-- same shape `PlaceOrderRequest.addressId` already requires of an ordinary
-- checkout regardless of `pickupVendorIds`. Nothing before this migration
-- captured which address a reservation should convert against.
--
-- No foreign key to `addresses` — `customer` and `preorder` are different
-- modules (SDD 5.1), and `addresses` is not one of the shared identity
-- anchors that rule permits crossing to. Existence and ownership are
-- verified at the application layer, the same `cart_items.variant_id`
-- precedent this table's own `variant_id`/`campaign_id` columns already
-- follow for `catalogue`.
--
-- `NOT NULL` with no default, same reasoning and same verified assumption
-- as the `fulfilment_mode` migration immediately before this one: no
-- `preorder_reservations` row exists yet in any reachable environment.

ALTER TABLE "preorder_reservations"
    ADD COLUMN "address_id" UUID NOT NULL;
