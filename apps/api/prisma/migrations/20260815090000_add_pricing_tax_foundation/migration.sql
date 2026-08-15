-- Pricing/tax foundation (S3-2, SDD 5 module 7 "pricing-tax"; D-S3-01, D-S3-05).
--
-- Three additions:
--   1. `vendors.plan` — the missing piece ASM-06 / D-S3-01 depend on: which
--      commission rate applies to a given vendor.
--   2. `commission_rules` — effective-dated commission rates, seeded with
--      the two approved V1 figures (D-S3-01: 10% COMMISSION, 0% SUBSCRIPTION).
--   3. `tax_rates` — the structural shape for CA-approved HSN tax rates
--      (D-S3-05). Deliberately left EMPTY: no GST rate is approved yet, and
--      seeding one would be inventing a figure this milestone is explicitly
--      forbidden from inventing.
--
-- Neither new table gets RLS: both are platform-owned configuration, not
-- vendor-tenant data, the same posture `categories` already has (no RLS,
-- no tenant column, readable via the plain runtime client). `ALTER DEFAULT
-- PRIVILEGES FOR ROLE leenmart` (20260812120000_database_role_separation)
-- already grants leenmart_app/leenmart_admin full DML on any table created
-- after it, so no explicit GRANT is needed here either.

-- CreateEnum
CREATE TYPE "VendorPlan" AS ENUM ('COMMISSION', 'SUBSCRIPTION');

-- AlterTable
-- Single-statement backfill via DEFAULT — the same pattern
-- 20260809080549_add_user_status uses for `users.status`. Every existing
-- vendor becomes `COMMISSION`: the baseline plan with no special
-- arrangement, never the free `SUBSCRIPTION` tier nothing has qualified a
-- pre-existing vendor for.
ALTER TABLE "vendors" ADD COLUMN "plan" "VendorPlan" NOT NULL DEFAULT 'COMMISSION';

-- CreateTable
CREATE TABLE "commission_rules" (
    "id"                UUID NOT NULL,
    "plan"              "VendorPlan" NOT NULL,
    "rate_basis_points" INTEGER NOT NULL,
    "effective_from"    TIMESTAMPTZ(6) NOT NULL,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_rules_plan_effective_from" ON "commission_rules"("plan", "effective_from");

-- CreateIndex
CREATE INDEX "idx_commission_rules_plan_effective_from" ON "commission_rules"("plan", "effective_from");

-- CreateTable
CREATE TABLE "tax_rates" (
    "id"                UUID NOT NULL,
    "hsn_code"          VARCHAR(8) NOT NULL,
    "rate_basis_points" INTEGER NOT NULL,
    "effective_from"    TIMESTAMPTZ(6) NOT NULL,
    "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_tax_rates_hsn_code_effective_from" ON "tax_rates"("hsn_code", "effective_from");

-- CreateIndex
CREATE INDEX "idx_tax_rates_hsn_code_effective_from" ON "tax_rates"("hsn_code", "effective_from");

-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express (SDD 6.1), mirroring
-- 20260813220000_add_inventory's own CHECK constraints for a percentage-like
-- integer column: the database itself refuses a rate outside 0–10000 basis
-- points (0%–100%) regardless of application bugs.
-- ---------------------------------------------------------------------------

ALTER TABLE "commission_rules"
    ADD CONSTRAINT "chk_commission_rules_rate_basis_points_range" CHECK ("rate_basis_points" >= 0 AND "rate_basis_points" <= 10000);

ALTER TABLE "tax_rates"
    ADD CONSTRAINT "chk_tax_rates_rate_basis_points_range" CHECK ("rate_basis_points" >= 0 AND "rate_basis_points" <= 10000);

-- ---------------------------------------------------------------------------
-- Seed: the two approved V1 commission rates (D-S3-01), effective from a
-- fixed baseline instant rather than `CURRENT_TIMESTAMP` — this migration
-- must replay identically (same resolvable rate) in every environment and
-- on every replay (shadow database, test database, a fresh dev machine),
-- regardless of when it happens to run. `tax_rates` gets no such seed: no
-- GST rate is CA-approved yet, and an empty table is this milestone's
-- correct, intended state (see the model's own doc comment).
-- ---------------------------------------------------------------------------

INSERT INTO "commission_rules" ("id", "plan", "rate_basis_points", "effective_from") VALUES
    ('018ffb4e-0000-7000-8000-000000000001', 'COMMISSION', 1000, '2020-01-01T00:00:00Z'),
    ('018ffb4e-0000-7000-8000-000000000002', 'SUBSCRIPTION', 0, '2020-01-01T00:00:00Z');
