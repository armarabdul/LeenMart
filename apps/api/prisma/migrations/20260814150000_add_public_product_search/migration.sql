-- Public product search (S2-7, SDD 6.4 / 9.4 / 26).
--
-- Adds one new, minimally-privileged database role for the unauthenticated
-- public search surface, and the SDD 6.4-specified search machinery on
-- `products`. Mirrors 20260812120000_database_role_separation's own
-- reasoning throughout: a separate *credential* is the trust boundary, not
-- an application-set flag, and the same idempotent, self-healing DO-block
-- pattern is used so this migration tolerates a role that already exists
-- (shadow database, replayed test database, a developer's machine).
--
-- Visibility for this milestone (S2-7 D-S2-7-A): `APPROVED` stands in for
-- the SDD's `PUBLISHED` state, which does not exist yet — see
-- `products_public_read`'s own comment below. Not a schema change; a policy
-- decision, changeable in a later migration once `PUBLISHED` itself lands.

-- CreateRole
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'leenmart_public') THEN
        -- LOGIN but no password: unusable until `pnpm db:provision-roles` runs,
        -- the same convergence-not-assumption discipline the app/admin roles use.
        CREATE ROLE "leenmart_public" WITH LOGIN;
    END IF;

    -- Re-asserted on every replay, not just at creation.
    ALTER ROLE "leenmart_public" WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT;
END
$$;

-- Grant
GRANT USAGE ON SCHEMA public TO "leenmart_public";

-- Grant
-- Least privilege, deliberately narrower than `leenmart_app`/`leenmart_admin`
-- (S2-7 D-S2-7-B/decision 4): SELECT only, on exactly the two tables this
-- surface actually queries — never `ALTER DEFAULT PRIVILEGES`, so a future
-- table is invisible to this role until someone deliberately grants it,
-- rather than automatically public the moment it is created.
GRANT SELECT ON "products" TO "leenmart_public";
GRANT SELECT ON "product_media" TO "leenmart_public";

-- CreatePolicy
-- S2-7 D-S2-7-A: `APPROVED` is this milestone's stand-in for the SDD's
-- `PUBLISHED` state (SDD 15.2's diagram: APPROVED -> PUBLISHED -> ...),
-- which this codebase does not implement yet. Revisited when `PUBLISHED`
-- itself is built — this policy's `USING` clause is the one line that
-- changes, not the role, the grant, or anything above it.
CREATE POLICY "products_public_read" ON "products" FOR SELECT TO "leenmart_public"
    USING ("status" = 'APPROVED' AND "deleted_at" IS NULL);

-- CreatePolicy
-- The one child table `hasMedia`/`mediaCount` (S2-7 decision I) actually
-- queries — mirrors `product_media_admin_read`'s own shape, scoped to the
-- media item's own readiness rather than re-checking its parent product's
-- status (already guaranteed by `products_public_read` gating which
-- products this role's queries ever join against in the first place).
CREATE POLICY "product_media_public_read" ON "product_media" FOR SELECT TO "leenmart_public"
    USING ("status" = 'READY' AND "deleted_at" IS NULL);

-- No INSERT/UPDATE/DELETE policy anywhere for this role — it never writes,
-- and the GRANTs above never gave it the privilege to.


-- ---------------------------------------------------------------------------
-- SDD 6.4's search machinery. `(vendor_id, status)` and `(category_id,
-- status)` already exist (idx_products_vendor_status / idx_products_category_status,
-- 20260813180000_add_products) — verified before writing this migration, not
-- recreated here. Only the two genuinely missing indexes are added.
--
-- Note, not acted on: SDD 6.4's own table reads "(vendor_id, status),
-- (category_id, status) partial WHERE deleted_at IS NULL" — grammatically,
-- the partial clause modifies only the second pair. The existing
-- idx_products_category_status was built in S2-3a without it, which is a
-- pre-existing gap against the literal spec, not something this migration
-- introduced or was asked to fix; flagged in the S2-7 report rather than
-- corrected here.
-- ---------------------------------------------------------------------------

-- AlterTable
-- `simple` configuration (S2-7 D-S2-7-E): no stemming, no stopword removal —
-- deliberately, since the SDD names no language and this is a pan-India
-- catalogue where assuming English would be wrong more often than right.
-- `name` only (S2-7 decision D) — no other column is named by SDD 6.4.
ALTER TABLE "products" ADD COLUMN "search_vector" tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', coalesce("name", ''))) STORED;

-- CreateIndex
CREATE INDEX "idx_products_search_vector" ON "products" USING GIN ("search_vector");

-- CreateIndex
-- `pg_trgm` is already enabled (20260807065349_leen_mart's baseline
-- migration) — no CREATE EXTENSION needed. Used to accelerate ILIKE/
-- substring matching only (S2-7 D-S2-7-F): no similarity threshold and no
-- ranking role, neither of which the SDD specifies.
CREATE INDEX "idx_products_name_trgm" ON "products" USING GIN ("name" gin_trgm_ops);
