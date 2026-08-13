-- CreateEnum
CREATE TYPE "CategoryRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'RESTRICTED');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "path" UUID[],
    "depth" SMALLINT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(140) NOT NULL,
    "risk_level" "CategoryRiskLevel" NOT NULL DEFAULT 'LOW',
    "requires_hsn" BOOLEAN NOT NULL DEFAULT false,
    "requires_country_of_origin" BOOLEAN NOT NULL DEFAULT false,
    "requires_net_quantity" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_categories_parent" ON "categories"("parent_id");

-- CreateIndex
CREATE INDEX "idx_categories_path" ON "categories" USING GIN ("path");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express (SDD 6.1: "Constraints in the
-- database. Not only in the application... The database is the last line of
-- correctness"). Every rule below is also enforced by the `Category`
-- aggregate; this is the copy that survives an application bug.
--
-- No GRANT block is needed. `20260812120000_database_role_separation` ends with
-- ALTER DEFAULT PRIVILEGES FOR ROLE leenmart, so tables the owner creates after
-- that migration already carry SELECT/INSERT/UPDATE/DELETE for both
-- `leenmart_app` and `leenmart_admin`.
--
-- No RLS either. Categories are platform-owned and have no tenant column to
-- scope by; the public catalogue must read them with no tenant context at all.
-- ---------------------------------------------------------------------------

-- The stable public URL key. Globally unique among live rows; a soft-deleted
-- category releases its slug rather than reserving it forever.
CREATE UNIQUE INDEX "idx_categories_slug_unique"
    ON "categories" ("slug")
    WHERE "deleted_at" IS NULL;

-- Siblings may not share a name. Two indexes rather than one, because in
-- PostgreSQL NULL <> NULL: a single (parent_id, name) index would place every
-- root in its own group and let all of them share a name.
CREATE UNIQUE INDEX "idx_categories_child_name_unique"
    ON "categories" ("parent_id", lower("name"))
    WHERE "deleted_at" IS NULL AND "parent_id" IS NOT NULL;

CREATE UNIQUE INDEX "idx_categories_root_name_unique"
    ON "categories" (lower("name"))
    WHERE "deleted_at" IS NULL AND "parent_id" IS NULL;

ALTER TABLE "categories"
    -- Five levels (S2-2 D-C2).
    ADD CONSTRAINT "chk_categories_depth"
        CHECK ("depth" BETWEEN 1 AND 5),
    -- The materialised path and the depth are two views of one fact.
    ADD CONSTRAINT "chk_categories_path_depth"
        CHECK (cardinality("path") = "depth" - 1),
    -- A root has no parent and no ancestors; a non-root has both.
    ADD CONSTRAINT "chk_categories_root_path"
        CHECK (("parent_id" IS NULL) = (cardinality("path") = 0)),
    -- The two halves of "a category is never its own ancestor". The FK cannot
    -- express either: it only says the parent exists.
    ADD CONSTRAINT "chk_categories_not_self_parent"
        CHECK ("parent_id" IS NULL OR "parent_id" <> "id"),
    ADD CONSTRAINT "chk_categories_not_own_ancestor"
        CHECK (NOT ("id" = ANY("path"))),
    -- Lowercase, hyphen-separated, no leading/trailing/doubled hyphen.
    ADD CONSTRAINT "chk_categories_slug_format"
        CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
