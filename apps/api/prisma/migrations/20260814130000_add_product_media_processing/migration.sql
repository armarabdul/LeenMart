-- AlterEnum
-- S2-6b: the async processing pipeline's two remaining states (SDD 12.2).
-- Split into its own leading block, separate from anything that could
-- reference these values, for the same reason 20260813230000 split
-- ProductStatus's widening from its own constraint migration: PostgreSQL
-- refuses to use a freshly-added enum value inside the transaction that
-- added it. Nothing below this block names 'READY' or 'FAILED' literally, so
-- one migration file is safe here — there is no CHECK constraint or DEFAULT
-- to defer to a follow-up migration this time.
ALTER TYPE "ProductMediaStatus" ADD VALUE 'READY';
ALTER TYPE "ProductMediaStatus" ADD VALUE 'FAILED';

-- CreateEnum
-- The two output encodings SDD 12.2's variant matrix requires (D-S2-6-F) — a
-- closed, fixed set, so a native enum rather than free text.
CREATE TYPE "ProductMediaVariantFormat" AS ENUM ('WEBP', 'AVIF');

-- AlterTable
-- `failure_reason`: a closed, internal vocabulary of short codes this module
-- defines (never a raw exception message or stack trace) — NULL unless
-- status = FAILED.
ALTER TABLE "product_media" ADD COLUMN "failure_reason" VARCHAR(64);

-- `uq_product_media_id_vendor`: the composite-foreign-key target
-- `product_media_variants` pins its own denormalised vendor_id against,
-- mirroring `uq_products_id_vendor`/`uq_product_variants_id_vendor` one level
-- up. Additive: `id` is already unique, so this constrains nothing S2-6a
-- previously allowed.
ALTER TABLE "product_media" ADD CONSTRAINT "uq_product_media_id_vendor" UNIQUE ("id", "vendor_id");

-- CreateTable
-- One row per generated variant (S2-6b, SDD 12.2 step 5f) — a structured
-- child table, not a JSON blob, the same "one row per thing" convention
-- product_variants/kyc_documents/category_attributes already establish.
CREATE TABLE "product_media_variants" (
    "id" UUID NOT NULL,
    "media_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "width" INTEGER NOT NULL,
    "format" "ProductMediaVariantFormat" NOT NULL,
    "object_key" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_media_variants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_product_media_variants_media" ON "product_media_variants"("media_id");

-- CreateIndex
-- The worker's idempotency key: a redelivered or retried job that already
-- wrote this (media, width, format) triple does nothing the second time —
-- this index is the arbiter, never a read-then-write existence check.
CREATE UNIQUE INDEX "uq_product_media_variants_media_width_format" ON "product_media_variants"("media_id", "width", "format");

-- AddForeignKey
-- Composite: both media_id and vendor_id must match one product_media row,
-- the same technique product_media_product_id_vendor_id_fkey already uses one
-- level up.
ALTER TABLE "product_media_variants" ADD CONSTRAINT "product_media_variants_media_id_vendor_id_fkey" FOREIGN KEY ("media_id", "vendor_id") REFERENCES "product_media"("id", "vendor_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express (SDD 6.1), the same
-- discipline every prior catalogue migration applies.
-- ---------------------------------------------------------------------------

ALTER TABLE "product_media_variants"
    ADD CONSTRAINT "chk_product_media_variants_object_key_not_blank"
        CHECK (char_length(btrim("object_key")) > 0),
    -- Mirrors S3ObjectStore/Sharp's own positive-byte-count invariant — the
    -- copy that survives an application bug writing directly to the row.
    ADD CONSTRAINT "chk_product_media_variants_size_positive"
        CHECK ("size_bytes" > 0),
    -- SDD 12.2's variant matrix is fixed (D-S2-6-F): 200/400/800/1600 px, no
    -- other width is ever legitimately generated.
    ADD CONSTRAINT "chk_product_media_variants_width_in_matrix"
        CHECK ("width" IN (200, 400, 800, 1600));


-- ---------------------------------------------------------------------------
-- Row-level security (SDD 6.6 layer 3), mirroring "product_media" exactly —
-- a column comparison against the denormalised vendor_id the composite
-- foreign key above pins, never a subquery to the parent media row.
-- ---------------------------------------------------------------------------

ALTER TABLE "product_media_variants" ENABLE ROW LEVEL SECURITY;

-- CreatePolicy
CREATE POLICY "product_media_variants_select" ON "product_media_variants" FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
-- The worker writes each variant under the tenant context it derives from
-- the media row's own vendor_id (S2-6b) — see `runWithTenant` in
-- `product-media-worker.ts` — so this is the same policy shape as
-- `product_media_insert`, never an admin-credential write.
CREATE POLICY "product_media_variants_insert" ON "product_media_variants" FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- No UPDATE policy: a variant row is written once and never edited — a
-- retried or redelivered job either finds it already there (unique index,
-- idempotent no-op) or writes a fresh row for a pair that is still missing.
-- No DELETE policy, deliberately — the same absence "product_media" already
-- establishes; there is no vendor-facing action that removes a single
-- variant on its own.

-- CreatePolicy
-- The admin credential reads across every vendor and writes nothing here —
-- mirrors `product_media_admin_read` exactly; S2-6b adds no admin surface for
-- media processing.
CREATE POLICY "product_media_variants_admin_read" ON "product_media_variants" FOR SELECT TO leenmart_admin
    USING (true);
