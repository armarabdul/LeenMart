-- QR Pickup foundation (S4-QR, SDD §13). Widens the shared OrderStatus enum
-- with the two pickup-specific terminal states, adds the FulfilmentMode
-- split, and creates the pickup_tokens table with its own RLS.
--
-- Split into two migrations for the same reason 20260816150000/150001 were:
-- Postgres refuses to reference a freshly `ALTER TYPE ... ADD VALUE`d enum
-- value in the same transaction that added it. `sub_orders_vendor_update`'s
-- own WITH CHECK (already referencing PROCESSING/SHIPPED/DELIVERED) must
-- widen to include READY_FOR_PICKUP/COMPLETED, so that widening is deferred
-- to 20260817180001. Everything in *this* migration that references the new
-- OrderStatus values is deliberately avoided.

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'READY_FOR_PICKUP';
ALTER TYPE "OrderStatus" ADD VALUE 'COMPLETED';

-- CreateEnum
CREATE TYPE "FulfilmentMode" AS ENUM ('DELIVERY', 'PICKUP');

-- CreateEnum
CREATE TYPE "PickupTokenStatus" AS ENUM ('ISSUED', 'REDEEMED');

-- AlterTable
-- Every existing row defaults to DELIVERY — zero behavioural change for the
-- entire existing delivery fleet (locked decision).
ALTER TABLE "sub_orders" ADD COLUMN "fulfilment_mode" "FulfilmentMode" NOT NULL DEFAULT 'DELIVERY';

-- AlterTable
-- Opt-in, `false` for every pre-existing vendor.
ALTER TABLE "vendors" ADD COLUMN "supports_pickup" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "pickup_tokens" (
    "id" UUID NOT NULL,
    "sub_order_id" UUID NOT NULL,
    "vendor_id" UUID NOT NULL,
    "status" "PickupTokenStatus" NOT NULL DEFAULT 'ISSUED',
    "token_hash" VARCHAR(64) NOT NULL,
    "nonce" VARCHAR(32) NOT NULL,
    "issued_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "redeemed_at" TIMESTAMPTZ(6),
    "redeemed_by_user_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- One credential per sub-order (rotation overwrites this same row).
CREATE UNIQUE INDEX "pickup_tokens_sub_order_id_key" ON "pickup_tokens"("sub_order_id");

-- CreateIndex
CREATE INDEX "idx_pickup_tokens_vendor_status" ON "pickup_tokens"("vendor_id", "status");

-- AddForeignKey
-- Restrict, matching every other order/vendor foreign key in this schema.
ALTER TABLE "pickup_tokens" ADD CONSTRAINT "pickup_tokens_sub_order_id_fkey" FOREIGN KEY ("sub_order_id") REFERENCES "sub_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Row-level security on pickup_tokens (SDD 6.6 layer 3), the same dual-policy
-- shape orders/sub_orders/order_items already establish (20260816130000):
--
--   leenmart_checkout — the customer's own issue/rotate path
--     (GetOrIssuePickupTokenUseCase). USING(true)/WITH CHECK(true), identical
--     reach to its existing orders_checkout_* policies — ownership is
--     enforced in the use case (join through SubOrder -> Order.customerId),
--     the same application-level pattern GetOrderUseCase already uses.
--
--   leenmart_app — the vendor's own redemption path
--     (RedeemPickupTokenUseCase), scoped by vendor_id = app.vendor_id, the
--     same idiom sub_orders_vendor_select/_update already use. UPDATE is
--     column-restricted to exactly the four columns redemption touches.
-- ---------------------------------------------------------------------------

ALTER TABLE "pickup_tokens" ENABLE ROW LEVEL SECURITY;

-- Grant
GRANT SELECT, INSERT, UPDATE ON "pickup_tokens" TO "leenmart_checkout";
GRANT SELECT ON "pickup_tokens" TO "leenmart_app";
GRANT UPDATE ("status", "redeemed_at", "redeemed_by_user_id", "version") ON "pickup_tokens" TO "leenmart_app";

-- CreatePolicy
CREATE POLICY "pickup_tokens_checkout_select" ON "pickup_tokens" FOR SELECT TO "leenmart_checkout"
    USING (true);
CREATE POLICY "pickup_tokens_checkout_insert" ON "pickup_tokens" FOR INSERT TO "leenmart_checkout"
    WITH CHECK (true);
CREATE POLICY "pickup_tokens_checkout_update" ON "pickup_tokens" FOR UPDATE TO "leenmart_checkout"
    USING (true)
    WITH CHECK (true);

-- CreatePolicy
-- Same nullif(...) idiom as every other vendor policy: an unset/empty
-- app.vendor_id becomes SQL NULL, matching no row rather than leaking the
-- previous request's tenant.
CREATE POLICY "pickup_tokens_vendor_select" ON "pickup_tokens" FOR SELECT TO "leenmart_app"
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
-- WITH CHECK requires the resulting row to still belong to the caller's own
-- vendor *and* to have landed on REDEEMED — the only transition a vendor
-- credential may ever make. Combined with the atomic
-- `WHERE status = 'ISSUED'` compare-and-set in
-- PrismaPickupTokenRepository.redeemIfIssued, this is what makes concurrent/
-- replayed redemption structurally impossible, independent of whatever the
-- application layer already checked.
CREATE POLICY "pickup_tokens_vendor_redeem" ON "pickup_tokens" FOR UPDATE TO "leenmart_app"
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid)
    WITH CHECK (
        "vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid
        AND "status" = 'REDEEMED'
    );
