-- CreateEnum
-- S2-6a: only the two states this milestone's own code can produce
-- (AWAITING_UPLOAD, PROCESSING) — READY/FAILED are S2-6b's (the async
-- worker), added in their own migration when the code that produces them
-- exists, the same discipline ProductStatus already follows.
CREATE TYPE "ProductMediaStatus" AS ENUM ('AWAITING_UPLOAD', 'PROCESSING');

-- CreateTable
CREATE TABLE "product_media" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "object_key" TEXT NOT NULL,
    "content_type" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "status" "ProductMediaStatus" NOT NULL DEFAULT 'AWAITING_UPLOAD',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_product_media_product" ON "product_media"("product_id");

-- AddForeignKey
-- Composite: both product_id and vendor_id must match one products row, the
-- exact technique product_variants_product_id_vendor_id_fkey already uses —
-- so the database itself refuses a media row whose vendor does not match its
-- product's.
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_product_id_vendor_id_fkey" FOREIGN KEY ("product_id", "vendor_id") REFERENCES "products"("id", "vendor_id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express (SDD 6.1), the same
-- discipline every prior catalogue migration applies.
-- ---------------------------------------------------------------------------

ALTER TABLE "product_media"
    ADD CONSTRAINT "chk_product_media_object_key_not_blank"
        CHECK (char_length(btrim("object_key")) > 0),
    ADD CONSTRAINT "chk_product_media_content_type_not_blank"
        CHECK (char_length(btrim("content_type")) > 0),
    -- Mirrors S3ObjectStore.presignPut's own "must be a positive whole
    -- number of bytes" check — the copy that survives an application bug
    -- writing directly to the row.
    ADD CONSTRAINT "chk_product_media_size_positive"
        CHECK ("size_bytes" > 0);


-- ---------------------------------------------------------------------------
-- Row-level security (SDD 6.6 layer 3), mirroring "products"/"product_variants"
-- exactly — a column comparison against the denormalised vendor_id the
-- composite foreign key above pins, never a subquery to the parent product.
-- ---------------------------------------------------------------------------

ALTER TABLE "product_media" ENABLE ROW LEVEL SECURITY;

-- CreatePolicy
CREATE POLICY "product_media_select" ON "product_media" FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
CREATE POLICY "product_media_insert" ON "product_media" FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
CREATE POLICY "product_media_update" ON "product_media" FOR UPDATE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid)
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- No DELETE policy, deliberately — soft-delete only, the same absence
-- "products"/"product_variants" already establish.

-- CreatePolicy
-- The admin credential reads across every vendor and writes nothing here —
-- S2-6a adds no admin surface for media, unlike products_admin_decide (S2-5),
-- so there is no admin write policy to add alongside this one.
CREATE POLICY "product_media_admin_read" ON "product_media" FOR SELECT TO leenmart_admin
    USING (true);
