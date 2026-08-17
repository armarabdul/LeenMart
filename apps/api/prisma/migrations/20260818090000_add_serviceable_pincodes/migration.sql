-- Vendor-declared delivery serviceability (S4-SERV, SDD 5 module 10
-- `serviceable_pincodes`; ASM-17 / IMP-11 / SDD 6.4 — the pincode fast path).
--
-- Locked decisions this transcribes:
--   D1  vendor-declared set only; no platform launch allowlist
--   D2  the vendor's own shop pincode is NOT implicitly serviceable
--   D7  zero rows for a vendor means "serves everywhere" (backward
--       compatibility — every existing vendor predates this table). That rule
--       lives in the application layer, so this table needs no marker column
--       and a future explicit `configured` flag can be added without
--       reshaping it.
--
-- No geospatial columns of any kind: PostGIS is the *precise* check (SDD 6.4)
-- and remains blocked on AMB-16. This is the fast path only.

-- CreateTable
CREATE TABLE "serviceable_pincodes" (
    "vendor_id" UUID NOT NULL,
    "pincode" VARCHAR(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- The pair is the identity: a vendor either serves a pincode or does not.
    -- No surrogate id, and duplicate declarations are impossible rather than
    -- merely discouraged.
    CONSTRAINT "serviceable_pincodes_pkey" PRIMARY KEY ("vendor_id", "pincode")
);

-- CreateIndex
-- Leading with `pincode` because the hot path is checkout's
-- "for this delivery pincode, which of these vendors serve it?" — the pincode
-- is the constant and the vendor set is the filter. The primary key already
-- covers the vendor-leading direction the vendor portal reads by.
CREATE INDEX "idx_serviceable_pincodes_pincode_vendor"
    ON "serviceable_pincodes"("pincode", "vendor_id");

-- AddForeignKey
-- Cascade, unlike the RESTRICT this schema uses for orders/products: a
-- serviceability declaration is disposable configuration, not retained
-- financial or audit history, so it has no reason to outlive its vendor.
ALTER TABLE "serviceable_pincodes"
    ADD CONSTRAINT "serviceable_pincodes_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Six digits, no leading zero — the same shape `pincodeSchema` enforces at the
-- HTTP boundary and the same rule every other pincode column in this schema
-- follows. Enforced here too, because the database is the final arbiter.
ALTER TABLE "serviceable_pincodes"
    ADD CONSTRAINT "serviceable_pincodes_pincode_format_ck"
    CHECK ("pincode" ~ '^[1-9][0-9]{5}$');

-- ---------------------------------------------------------------------------
-- Row-level security (SDD 6.6 layer 3), the same dual-policy shape
-- pickup_tokens/sub_orders already establish:
--
--   leenmart_app      — the vendor's own management path, scoped by
--                       vendor_id = app.vendor_id. This is what makes
--                       "vendor A edits vendor B's set" impossible at the
--                       database, underneath the application-level guarantee
--                       that no route accepts a vendor id.
--
--   leenmart_checkout — the read PlaceOrderUseCase performs. USING(true),
--                       identical reach and identical reasoning to
--                       `vendors_checkout_read`: this role must evaluate
--                       every vendor in a multi-vendor cart, so cross-vendor
--                       reach is the point rather than a gap. SELECT only —
--                       checkout reads serviceability and never writes it.
--
-- leenmart_public gets nothing: the public catalogue role has no business
-- reading any vendor's delivery configuration, and the customer-facing hint
-- is served through the checkout credential the cart already uses.
-- ---------------------------------------------------------------------------
-- ENABLE only, never FORCE — the same deliberate omission 20260812180000
-- documents: FORCE subjects the table's *owner* to its own policies, which
-- would break migrations and the owner-connection maintenance paths. The
-- `database-role-separation` suite asserts `relforcerowsecurity` is zero
-- across the whole database, so this is enforced rather than merely intended.
ALTER TABLE "serviceable_pincodes" ENABLE ROW LEVEL SECURITY;

-- `ALTER DEFAULT PRIVILEGES` (20260812120000) grants new tables to
-- leenmart_app and leenmart_admin only, so the checkout role's grant must be
-- explicit — exactly as it was for orders/sub_orders/inventory.
GRANT SELECT ON "serviceable_pincodes" TO "leenmart_checkout";

-- CreatePolicy
CREATE POLICY "serviceable_pincodes_vendor_select" ON "serviceable_pincodes"
    FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
-- The vendor may only ever insert rows for itself: WITH CHECK is what stops a
-- write from naming another tenant even if the application layer were bypassed.
CREATE POLICY "serviceable_pincodes_vendor_insert" ON "serviceable_pincodes"
    FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
-- DELETE, because replacing a set is delete-then-insert inside one
-- transaction. There is deliberately no UPDATE policy: the pair is the
-- primary key, so "changing" a row is adding one and removing another.
CREATE POLICY "serviceable_pincodes_vendor_delete" ON "serviceable_pincodes"
    FOR DELETE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
CREATE POLICY "serviceable_pincodes_checkout_select" ON "serviceable_pincodes"
    FOR SELECT TO "leenmart_checkout"
    USING (true);

-- CreatePolicy
-- Admin read, matching `vendors_admin_read` — support needs to be able to see
-- why a delivery was refused.
CREATE POLICY "serviceable_pincodes_admin_read" ON "serviceable_pincodes"
    FOR SELECT TO leenmart_admin
    USING (true);
