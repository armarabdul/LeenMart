-- Vendor shop address + immutable pickup-location snapshot (S4-ADDR).
--
-- Two additive, fully nullable column groups. Nothing is backfilled and no
-- default is supplied: an address nobody entered would be invented data, and
-- every pre-existing row is legitimately "no address set" / "not a pickup
-- sub-order". Zero behavioural change for existing DELIVERY orders.
--
-- No RLS work is required here, and that is deliberate rather than an
-- oversight. Row-level security is row-scoped, not column-scoped, so both
-- tables' existing policies already govern these columns:
--
--   vendors     — `vendors_select` / `vendors_update` (leenmart_app, scoped to
--                 `app.vendor_id`) already confine a vendor to its own row, so
--                 the self-service address write inherits exactly the
--                 isolation `shop_name` and `supports_pickup` already have.
--                 `vendors_checkout_read` (leenmart_checkout) already lets
--                 PlaceOrderUseCase read the address it snapshots.
--   sub_orders  — `sub_orders_vendor_*` and `sub_orders_checkout_*`
--                 (20260815120000/20260816130000) already confine sub-order
--                 rows per tenant and per customer.
--
-- A single migration, unlike S4-QR's pair: nothing here adds an enum value, so
-- there is no "cannot reference a freshly added enum value in the same
-- transaction" constraint to work around.

-- AlterTable
-- One shop address per vendor (v1 — no multi-outlet model). No country
-- column: `addresses`, this schema's own address convention, has none either.
-- No lat/lng: geocoding/PostGIS/radius are separate Stage 4 capabilities.
ALTER TABLE "vendors" ADD COLUMN "shop_address_line_1" VARCHAR(200);
ALTER TABLE "vendors" ADD COLUMN "shop_address_line_2" VARCHAR(200);
ALTER TABLE "vendors" ADD COLUMN "shop_address_city" VARCHAR(100);
ALTER TABLE "vendors" ADD COLUMN "shop_address_state" VARCHAR(100);
ALTER TABLE "vendors" ADD COLUMN "shop_address_pincode" VARCHAR(6);

-- AlterTable
-- The collection point as it stood when the order was placed. Never
-- re-resolved from `vendors` afterwards, so a vendor relocating cannot
-- rewrite where an existing order said to collect from.
ALTER TABLE "sub_orders" ADD COLUMN "pickup_location_line_1" VARCHAR(200);
ALTER TABLE "sub_orders" ADD COLUMN "pickup_location_line_2" VARCHAR(200);
ALTER TABLE "sub_orders" ADD COLUMN "pickup_location_city" VARCHAR(100);
ALTER TABLE "sub_orders" ADD COLUMN "pickup_location_state" VARCHAR(100);
ALTER TABLE "sub_orders" ADD COLUMN "pickup_location_pincode" VARCHAR(6);

-- The snapshot is meaningful only for PICKUP. A DELIVERY sub-order carrying a
-- collection address would be a contradiction, so the database refuses it
-- rather than trusting every future write path to remember — the same
-- "database is the final arbiter" discipline the partial unique index on
-- `addresses.is_default` and the append-only triggers already apply.
--
-- Stated as "all five null, or DELIVERY has none": the address parts are
-- always written as a set, so a half-populated snapshot is rejected too.
ALTER TABLE "sub_orders" ADD CONSTRAINT "sub_orders_pickup_location_mode_ck" CHECK (
  (
    "pickup_location_line_1" IS NULL
    AND "pickup_location_line_2" IS NULL
    AND "pickup_location_city" IS NULL
    AND "pickup_location_state" IS NULL
    AND "pickup_location_pincode" IS NULL
  )
  OR (
    "fulfilment_mode" = 'PICKUP'
    AND "pickup_location_line_1" IS NOT NULL
    AND "pickup_location_city" IS NOT NULL
    AND "pickup_location_state" IS NOT NULL
    AND "pickup_location_pincode" IS NOT NULL
  )
);
