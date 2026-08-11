-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recipient_name" VARCHAR(100) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "line_1" VARCHAR(200) NOT NULL,
    "line_2" VARCHAR(200),
    "city" VARCHAR(100) NOT NULL,
    "state" VARCHAR(100) NOT NULL,
    "pincode" VARCHAR(6) NOT NULL,
    "landmark" VARCHAR(200),
    "label" VARCHAR(50) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_addresses_user" ON "addresses"("user_id");

-- CreateIndex
-- Partial unique index, hand-added: Prisma's schema DSL has no WHERE clause
-- for indexes, so this can't be expressed in schema.prisma and generated
-- automatically. This is the actual enforcement of "at most one default
-- address per customer" — a database constraint, not just an application
-- check, so two concurrent "set default" requests cannot both succeed no
-- matter how they interleave. Excludes soft-deleted rows so a deleted
-- address that was once the default can never block a new one.
CREATE UNIQUE INDEX "idx_addresses_one_default_per_user" ON "addresses"("user_id") WHERE "is_default" = true AND "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
