-- Vendor order processing (S3-5): a version column for optimistic
-- concurrency on "sub_orders", plus the first RLS enablement on
-- "orders"/"sub_orders"/"order_items" so the existing tenant-scoped
-- "leenmart_app" credential can read a vendor's own orders and transition
-- one sub-order CONFIRMED -> PROCESSING (SubOrder.startProcessing(), already
-- domain-modelled since S3-3A with no caller until now).
--
-- ---------------------------------------------------------------------------
-- Why "sub_orders" needs a version column now.
-- ---------------------------------------------------------------------------
--
-- Before this milestone, "orders"/"sub_orders" had exactly one writer path —
-- the customer's own checkout/cancel/payment-confirmation flow, entirely on
-- "leenmart_checkout" — so PrismaOrderRepository.updateStatus()'s plain
-- `UPDATE ... WHERE id = :id` could never race with itself (Prisma's
-- transaction serialises the writes within one request). S3-5 adds a second,
-- independent writer: a vendor marking their own sub-order PROCESSING. A
-- customer's cancel and a vendor's "start processing" can now genuinely
-- interleave on the *same* "sub_orders" row, so both write paths condition on
-- `version` (the same optimistic-concurrency shape "inventory.version"
-- already established) rather than blindly overwriting whatever the other
-- wrote in between.
--
-- ---------------------------------------------------------------------------
-- Why RLS, and why "leenmart_app" rather than "leenmart_checkout".
-- ---------------------------------------------------------------------------
--
-- "leenmart_checkout"'s own RLS policies (vendors_checkout_read,
-- inventory_checkout_read/decrement, 20260815120000) are all `USING (true)`
-- by design: a multi-vendor checkout transaction must reach every vendor's
-- rows in one connection, which is the opposite shape a vendor-scoped *read*
-- needs. "leenmart_app" already carries exactly the right mechanism —
-- `tenantContext` resolves the caller's own vendor and sets `app.vendor_id`
-- as a transaction-local session GUC (20260812180000) — and is the credential
-- every other vendor-owned table (`products`, `product_variants`) already
-- uses. Routing vendor order access through it reuses a proven mechanism
-- rather than inventing a third pattern on "leenmart_checkout".
--
-- "orders"/"sub_orders"/"order_items" have never had RLS (see this schema's
-- own comments: "no RLS, ownership enforced in application code by
-- customer_id"). That remains true for the customer-facing surface —
-- "leenmart_checkout" gets `USING (true)` policies below, identical in
-- reach to the plain table grants it already has, so S3-3A/S3-3B/S3-4's own
-- behaviour is completely unchanged. RLS is additive here: it is what makes
-- a *second* credential (leenmart_app) safely vendor-scoped on the same
-- tables, not a new restriction on the first.

-- AlterTable
ALTER TABLE "sub_orders" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- ---------------------------------------------------------------------------
-- Enable RLS. No FORCE, no SECURITY DEFINER, no app.is_admin — the same
-- deliberate omissions 20260812180000_enable_tenant_rls documents for the
-- first tenant-scoped tables: the runtime roles already own nothing, so a
-- plain ENABLE binds them.
-- ---------------------------------------------------------------------------

ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sub_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- "leenmart_checkout" — preserve its existing, unrestricted reach exactly.
-- One policy per grant it already holds (SELECT/INSERT/UPDATE on all three
-- tables, from 20260815120000) — split rather than a single FOR ALL, matching
-- this schema's own established style (vendors_checkout_read,
-- inventory_checkout_read/decrement are likewise one command each).
-- ---------------------------------------------------------------------------

CREATE POLICY "orders_checkout_select" ON "orders" FOR SELECT TO "leenmart_checkout"
    USING (true);
CREATE POLICY "orders_checkout_insert" ON "orders" FOR INSERT TO "leenmart_checkout"
    WITH CHECK (true);
CREATE POLICY "orders_checkout_update" ON "orders" FOR UPDATE TO "leenmart_checkout"
    USING (true)
    WITH CHECK (true);

CREATE POLICY "sub_orders_checkout_select" ON "sub_orders" FOR SELECT TO "leenmart_checkout"
    USING (true);
CREATE POLICY "sub_orders_checkout_insert" ON "sub_orders" FOR INSERT TO "leenmart_checkout"
    WITH CHECK (true);
CREATE POLICY "sub_orders_checkout_update" ON "sub_orders" FOR UPDATE TO "leenmart_checkout"
    USING (true)
    WITH CHECK (true);

CREATE POLICY "order_items_checkout_select" ON "order_items" FOR SELECT TO "leenmart_checkout"
    USING (true);
CREATE POLICY "order_items_checkout_insert" ON "order_items" FOR INSERT TO "leenmart_checkout"
    WITH CHECK (true);
CREATE POLICY "order_items_checkout_update" ON "order_items" FOR UPDATE TO "leenmart_checkout"
    USING (true)
    WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- "leenmart_app" — new, narrowly scoped vendor-order access (S3-5).
-- ---------------------------------------------------------------------------

-- Grant
-- Read-only on "orders" (the delivery-address snapshot a vendor needs to
-- fulfil their own sub-order) and "order_items" (their own line items).
-- Neither grant is column-restricted: every "orders"/"order_items" column a
-- vendor could see is already fulfilment-relevant (address, product/variant
-- snapshots, quantity) — S2-5-style column narrowing is unnecessary where
-- the row-level policy is already the boundary that matters.
GRANT SELECT ON "orders" TO "leenmart_app";
GRANT SELECT ON "order_items" TO "leenmart_app";

-- Grant
-- "sub_orders": full SELECT (a vendor may see every field of their own
-- sub-order), but UPDATE is column-restricted to exactly the three columns
-- the one approved transition touches — status, its version guard, and the
-- timestamp. A vendor credential can never move vendor_id, totalAmount, or
-- any other column on this table, narrower than even a WITH CHECK could
-- express alone.
GRANT SELECT ON "sub_orders" TO "leenmart_app";
GRANT UPDATE ("status", "version", "updated_at") ON "sub_orders" TO "leenmart_app";

-- CreatePolicy
-- Same idiom as "products_select" (20260813180000): `nullif(...)` turns an
-- unset/empty `app.vendor_id` into SQL NULL, so an unconfigured connection
-- matches no row rather than erroring or leaking the previous request's
-- tenant.
CREATE POLICY "orders_vendor_select" ON "orders" FOR SELECT TO "leenmart_app"
    USING (
        EXISTS (
            SELECT 1 FROM "sub_orders" so
            WHERE so."order_id" = "orders"."id"
              AND so."vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid
        )
    );

-- CreatePolicy
CREATE POLICY "sub_orders_vendor_select" ON "sub_orders" FOR SELECT TO "leenmart_app"
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
-- WITH CHECK requires the resulting row to still belong to the caller's own
-- vendor *and* to have landed on PROCESSING — the only transition S3-5
-- approves. A vendor credential attempting any other status value, or a row
-- outside their own tenant, is refused by the database itself, independent
-- of whatever the application layer already checked.
CREATE POLICY "sub_orders_vendor_update" ON "sub_orders" FOR UPDATE TO "leenmart_app"
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid)
    WITH CHECK (
        "vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid
        AND "status" = 'PROCESSING'
    );

-- CreatePolicy
-- "order_items" carries its own denormalised vendor_id (SDD 6.3 snapshot),
-- so this is a direct column comparison, not a subquery — the same shape
-- "product_variants_select" already uses against its own vendor_id.
CREATE POLICY "order_items_vendor_select" ON "order_items" FOR SELECT TO "leenmart_app"
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);
