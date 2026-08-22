-- Phase Next follow-up: `preorder_reservations.fulfilment_mode`.
--
-- `ConvertReservationToOrderUseCase` builds a `SubOrder`, and `SubOrder`'s
-- own `FulfilmentMode` is always exactly `DELIVERY` or `PICKUP` — never
-- `BOTH`. A campaign whose own `fulfilment_mode` is `BOTH` permits either,
-- but nothing before this migration recorded which one a given customer
-- actually chose, leaving conversion with no honest way to decide.
--
-- Added `NOT NULL` with no default, on the assumption (verified) that no
-- `preorder_reservations` row exists yet in any environment this migration
-- has reached — the feature has no customer-facing surface until this same
-- milestone ships. A future deploy against an environment carrying real
-- rows would need a backfill step first; this migration does not attempt to
-- guess one.

ALTER TABLE "preorder_reservations"
    ADD COLUMN "fulfilment_mode" "PreorderFulfilmentMode" NOT NULL;
