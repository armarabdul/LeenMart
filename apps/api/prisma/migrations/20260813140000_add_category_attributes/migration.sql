-- CreateEnum
CREATE TYPE "CategoryAttributeType" AS ENUM ('STRING', 'NUMBER', 'BOOLEAN', 'ENUM');

-- CreateTable
CREATE TABLE "category_attributes" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "key" VARCHAR(60) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "data_type" "CategoryAttributeType" NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "unit" VARCHAR(20),
    "options" VARCHAR(80)[],
    "position" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_category_attributes_category" ON "category_attributes"("category_id");

-- AddForeignKey
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express (SDD 6.1: "Constraints in the
-- database. Not only in the application... The database is the last line of
-- correctness"). Every rule below is also enforced by the `CategoryAttribute`
-- aggregate and by the request contract; this is the copy that survives an
-- application bug.
--
-- No GRANT block: `20260812120000_database_role_separation` ends with
-- ALTER DEFAULT PRIVILEGES FOR ROLE leenmart, so a table the owner creates
-- after it already carries SELECT/INSERT/UPDATE/DELETE for `leenmart_app` and
-- `leenmart_admin`. No RLS either — attribute definitions belong to a
-- platform-owned category and carry no tenant column.
-- ---------------------------------------------------------------------------

-- One live definition per key per category. Partial on `deleted_at IS NULL`,
-- so a deleted attribute releases its key for reuse rather than reserving it
-- forever — the same behaviour `categories` gives slugs and sibling names.
CREATE UNIQUE INDEX "idx_category_attributes_key_unique"
    ON "category_attributes" ("category_id", "key")
    WHERE "deleted_at" IS NULL;

ALTER TABLE "category_attributes"
    -- A stable machine identifier, not a display string: lowercase, starting
    -- with a letter, underscores permitted.
    ADD CONSTRAINT "chk_category_attributes_key_format"
        CHECK ("key" ~ '^[a-z][a-z0-9_]*$'),
    -- An equivalence rather than two implications, so it enforces both halves
    -- at once: ENUM must carry options, and no other type may carry any.
    ADD CONSTRAINT "chk_category_attributes_options"
        CHECK (("data_type" = 'ENUM') = (cardinality("options") > 0)),
    -- A unit is meaningful only on a number. "kg" on a BOOLEAN is not a
    -- value anyone can interpret.
    ADD CONSTRAINT "chk_category_attributes_unit"
        CHECK ("unit" IS NULL OR "data_type" = 'NUMBER'),
    ADD CONSTRAINT "chk_category_attributes_position"
        CHECK ("position" >= 0);
