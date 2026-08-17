-- S4-QR: widen "sub_orders_vendor_update"'s WITH CHECK to permit the two
-- new pickup states — split into its own migration because it references
-- OrderStatus values ("READY_FOR_PICKUP", "COMPLETED") added by
-- 20260817180000, and Postgres refuses to use a freshly `ADD VALUE`d enum
-- value in the same transaction that added it (the exact precedent
-- 20260816150000/150001 already established for SHIPPED/DELIVERED).
--
-- "COMPLETED" is included deliberately: RedeemPickupTokenUseCase runs as the
-- vendor (the caller performing the scan), and transitions the sub-order
-- READY_FOR_PICKUP -> COMPLETED in the same transaction as the pickup_tokens
-- compare-and-set. No other credential ever writes COMPLETED.

ALTER POLICY "sub_orders_vendor_update" ON "sub_orders"
    WITH CHECK (
        "vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid
        AND "status" IN ('PROCESSING', 'SHIPPED', 'DELIVERED', 'READY_FOR_PICKUP', 'COMPLETED')
    );
