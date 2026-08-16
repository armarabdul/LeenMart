-- S3-7: the append-only double-entry ledger (SDD 10.3, ADR-008).
--
-- Hand-written rather than taken verbatim from `prisma migrate diff`: the
-- generated script also wanted to drop `products.search_vector` and its two
-- indexes, and to rename `uq_carts_user`. Those objects are hand-written
-- (20260814150000_add_public_product_search) and deliberately absent from
-- schema.prisma, so the generator reads them as drift. Only the ledger DDL
-- below is this migration's business; the search column is left untouched.

-- CreateEnum
CREATE TYPE "LedgerAccountCode" AS ENUM ('GATEWAY_CLEARING', 'VENDOR_PAYABLE', 'PLATFORM_COMMISSION_INCOME', 'GST_OUTPUT', 'TCS_PAYABLE', 'TDS_PAYABLE', 'REFUND_CLEARING', 'HOLD_SUSPENSE', 'VENDOR_RECEIVABLE_COD');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerJournalKind" AS ENUM ('PAYMENT_CAPTURED', 'COMMISSION_ACCRUED');

-- CreateTable
CREATE TABLE "ledger_journals" (
    "id" UUID NOT NULL,
    "kind" "LedgerJournalKind" NOT NULL,
    "order_id" UUID NOT NULL,
    "sub_order_id" UUID NOT NULL,
    "payment_attempt_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "journal_id" UUID NOT NULL,
    "account_code" "LedgerAccountCode" NOT NULL,
    "vendor_id" UUID,
    "direction" "LedgerDirection" NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "order_item_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_ledger_journals_vendor_created" ON "ledger_journals"("vendor_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_ledger_journals_order" ON "ledger_journals"("order_id");

-- CreateIndex
-- The ledger's own idempotency guard (S3-7): one journal of each kind per
-- sub-order. A replayed payment confirmation cannot post a second set, even
-- if the route's `Idempotency-Key` middleware and `Order.confirm()`'s status
-- guard were both somehow bypassed.
CREATE UNIQUE INDEX "uq_ledger_journals_sub_order_kind" ON "ledger_journals"("sub_order_id", "kind");

-- CreateIndex
CREATE INDEX "idx_ledger_entries_journal" ON "ledger_entries"("journal_id");

-- CreateIndex
CREATE INDEX "idx_ledger_entries_account_vendor" ON "ledger_entries"("account_code", "vendor_id");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_id_fkey" FOREIGN KEY ("journal_id") REFERENCES "ledger_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express, the same discipline every
-- prior migration in this repository applies.
-- ---------------------------------------------------------------------------

ALTER TABLE "ledger_entries"
    -- A zero or negative line is never a legitimate double entry: direction
    -- carries the sign, so the amount is always a positive magnitude. This is
    -- what stops a "negative debit" being used to fake a balanced journal.
    ADD CONSTRAINT "chk_ledger_entries_amount_positive" CHECK ("amount_minor" > 0),
    ADD CONSTRAINT "chk_ledger_entries_currency_len" CHECK (char_length("currency") = 3);

ALTER TABLE "ledger_journals"
    ADD CONSTRAINT "chk_ledger_journals_currency_len" CHECK (char_length("currency") = 3);


-- ---------------------------------------------------------------------------
-- Append-only (SDD 10.3: "Ledger rows are append-only"), enforced exactly the
-- way `audit_logs` already is (20260811120000_audit_log_immutability):
-- a BEFORE trigger, so the write is refused rather than rolled back after the
-- fact, plus a statement-level TRUNCATE guard because TRUNCATE bypasses
-- row-level triggers entirely.
--
-- This is defence in depth *behind* the policy set below: no role is granted
-- UPDATE or DELETE on either table at all. The triggers mean that even the
-- owner/superuser connection used by migrations cannot silently rewrite
-- posted accounting history.
-- ---------------------------------------------------------------------------

-- CreateFunction
CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ledger is append-only (SDD 10.3): % is not permitted on %. Corrections are new compensating journals.', TG_OP, TG_TABLE_NAME
        USING ERRCODE = '0A000';
END;
$$ LANGUAGE plpgsql;

-- CreateTrigger
CREATE TRIGGER trg_ledger_journals_immutable
    BEFORE UPDATE OR DELETE ON "ledger_journals"
    FOR EACH ROW
    EXECUTE FUNCTION reject_ledger_mutation();

-- CreateTrigger
CREATE TRIGGER trg_ledger_journals_no_truncate
    BEFORE TRUNCATE ON "ledger_journals"
    FOR EACH STATEMENT
    EXECUTE FUNCTION reject_ledger_mutation();

-- CreateTrigger
CREATE TRIGGER trg_ledger_entries_immutable
    BEFORE UPDATE OR DELETE ON "ledger_entries"
    FOR EACH ROW
    EXECUTE FUNCTION reject_ledger_mutation();

-- CreateTrigger
CREATE TRIGGER trg_ledger_entries_no_truncate
    BEFORE TRUNCATE ON "ledger_entries"
    FOR EACH STATEMENT
    EXECUTE FUNCTION reject_ledger_mutation();


-- ---------------------------------------------------------------------------
-- Row-level security (SDD 6.6 layer 3).
--
-- Three roles, three different reaches, and *no role holds UPDATE or DELETE*:
--
--   leenmart_checkout — SELECT + INSERT. This is the credential payment
--     confirmation runs on (`CheckoutTransactionRunner`), so it is the only
--     writer. Its policies are `USING (true)`, matching the existing
--     orders/sub_orders/order_items checkout policies: a checkout transaction
--     legitimately spans every vendor in a multi-vendor order, so there is no
--     tenant GUC to compare against.
--
--   leenmart_app — SELECT only, confined to the caller's own vendor via
--     `app.vendor_id`. A vendor can never write a ledger row, and never read
--     another vendor's. No INSERT/UPDATE/DELETE grant exists for this role.
--
--   leenmart_admin — SELECT across every vendor, writes nothing. S3-7 adds no
--     admin surface; this is the read reach a finance/settlement milestone
--     will need, granted now so that milestone need not weaken vendor RLS
--     later.
-- ---------------------------------------------------------------------------

ALTER TABLE "ledger_journals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;

-- Grant
GRANT SELECT, INSERT ON "ledger_journals" TO "leenmart_checkout";
GRANT SELECT, INSERT ON "ledger_entries" TO "leenmart_checkout";
GRANT SELECT ON "ledger_journals" TO "leenmart_app";
GRANT SELECT ON "ledger_entries" TO "leenmart_app";
GRANT SELECT ON "ledger_journals" TO "leenmart_admin";
GRANT SELECT ON "ledger_entries" TO "leenmart_admin";

-- CreatePolicy
CREATE POLICY "ledger_journals_checkout_select" ON "ledger_journals" FOR SELECT TO "leenmart_checkout"
    USING (true);
CREATE POLICY "ledger_journals_checkout_insert" ON "ledger_journals" FOR INSERT TO "leenmart_checkout"
    WITH CHECK (true);
CREATE POLICY "ledger_entries_checkout_select" ON "ledger_entries" FOR SELECT TO "leenmart_checkout"
    USING (true);
CREATE POLICY "ledger_entries_checkout_insert" ON "ledger_entries" FOR INSERT TO "leenmart_checkout"
    WITH CHECK (true);

-- CreatePolicy
-- Same `nullif(...)` idiom as every other vendor policy: an unset or empty
-- `app.vendor_id` becomes SQL NULL and matches no row, so an unconfigured
-- connection fails closed rather than leaking the previous request's tenant.
CREATE POLICY "ledger_journals_vendor_select" ON "ledger_journals" FOR SELECT TO "leenmart_app"
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
-- Entries are reached through their journal: a platform-owned line
-- (commission income, gateway clearing) carries a NULL vendor_id, so a
-- column comparison alone would hide the vendor's own journal's other half.
-- The journal is the ownership boundary, and it is already vendor-scoped.
CREATE POLICY "ledger_entries_vendor_select" ON "ledger_entries" FOR SELECT TO "leenmart_app"
    USING (
        EXISTS (
            SELECT 1 FROM "ledger_journals" j
            WHERE j."id" = "ledger_entries"."journal_id"
              AND j."vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid
        )
    );

-- CreatePolicy
CREATE POLICY "ledger_journals_admin_read" ON "ledger_journals" FOR SELECT TO "leenmart_admin"
    USING (true);
CREATE POLICY "ledger_entries_admin_read" ON "ledger_entries" FOR SELECT TO "leenmart_admin"
    USING (true);
