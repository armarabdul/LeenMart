-- Payment attempts (S3-3B).
--
-- ---------------------------------------------------------------------------
-- Why one table, not SDD 10.4's full payments/payment_attempts split.
-- ---------------------------------------------------------------------------
--
-- SDD 10.4 models a real, asynchronous gateway: CREATED -> PENDING ->
-- AUTHORIZED -> CAPTURED -> SETTLED, plus refund states, driven only by
-- verified webhooks, reconciled nightly against the provider. None of that
-- exists in S3-3B (no Razorpay integration, no webhooks, no refunds, no
-- settlement) — every one of those is explicitly out of this milestone's
-- scope. What S3-3B actually needs is: one row per attempt to pay for an
-- order, resolved synchronously to SUCCEEDED or FAILED by a mock gateway.
-- A single "payment_attempts" table with a three-state status is the
-- complete, honest model for that — not a placeholder for the fuller SDD
-- design, which a real gateway integration would need its own migration for
-- regardless of what this table's shape is today.
--
-- ---------------------------------------------------------------------------
-- Why leenmart_checkout, not a new role.
-- ---------------------------------------------------------------------------
--
-- Confirming a payment attempt and confirming the order it belongs to must
-- happen in the same transaction (one payment covers the whole multi-vendor
-- order) — exactly the shape "leenmart_checkout" (20260815120000) already
-- exists to serve. This migration only widens that role's existing grant
-- list by one table; no new credential, no new provisioning path.

-- CreateEnum
-- A deliberately narrow subset of SDD 10.4's own lifecycle — see this
-- file's own header comment for the full reasoning.
CREATE TYPE "PaymentAttemptStatus" AS ENUM ('INITIATED', 'SUCCEEDED', 'FAILED');

-- CreateTable
-- "amount"/"currency" are a snapshot of the order's own persisted total at
-- the moment this attempt was initiated — never a client-supplied figure
-- (SEC-02), and never re-read from the order later, so a completed attempt
-- stays truthful about what it was actually initiated for even if the order
-- total could somehow change afterward (it cannot, in this schema, but the
-- snapshot discipline matches every other financial column in this
-- codebase). "provider" is a plain string, not an enum with one member —
-- this milestone only ever writes the literal 'MOCK', but the column is
-- exactly where a real provider's own attempts would live once a real
-- "PaymentGateway" adapter exists.
CREATE TABLE "payment_attempts" (
    "id"                 UUID NOT NULL,
    "order_id"           UUID NOT NULL,
    "status"             "PaymentAttemptStatus" NOT NULL DEFAULT 'INITIATED',
    "amount"             BIGINT NOT NULL,
    "currency"           VARCHAR(3) NOT NULL DEFAULT 'INR',
    "provider"           VARCHAR(20) NOT NULL,
    "provider_reference" VARCHAR(100) NOT NULL,
    "created_at"         TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_payment_attempts_order_created" ON "payment_attempts"("order_id", "created_at" DESC);

-- CreateIndex
-- The real constraint behind "PaymentAttemptRepository.findInitiatedByOrderId"'s
-- own doc comment: Prisma's schema DSL has no partial-index WHERE clause
-- (the same gap "uq_cart_items_cart_variant" already works around), so this
-- is hand-added here only. At most one attempt per order may be awaiting a
-- decision at a time — a customer retrying after a FAILED attempt gets a
-- fresh row, never a second concurrently-INITIATED one.
CREATE UNIQUE INDEX "uq_payment_attempts_order_initiated" ON "payment_attempts"("order_id") WHERE "status" = 'INITIATED';

-- AddForeignKey
-- Restrict, matching every other foreign key "orders" already carries: a
-- payment attempt is retained financial history, not disposable state.
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Constraint Prisma's schema DSL cannot express (SDD 6.1).
-- ---------------------------------------------------------------------------

ALTER TABLE "payment_attempts"
    ADD CONSTRAINT "chk_payment_attempts_amount_non_negative" CHECK ("amount" >= 0);

-- ---------------------------------------------------------------------------
-- Widen leenmart_checkout's existing grant list by one table.
-- ---------------------------------------------------------------------------
--
-- No RLS on this table — same convention "orders"/"sub_orders"/"order_items"
-- already use: customer-owned, no vendor-tenant concept, ownership enforced
-- in application code by joining through "order_id" to the caller's own
-- "orders" row (the same discipline "PrismaOrderRepository" already applies).
GRANT SELECT, INSERT, UPDATE ON "payment_attempts" TO "leenmart_checkout";
