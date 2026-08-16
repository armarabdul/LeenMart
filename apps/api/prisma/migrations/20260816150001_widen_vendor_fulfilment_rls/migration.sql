-- S3-6 (locked decision #9): widen the vendor UPDATE policy on "sub_orders"
-- to permit the two new fulfilment transitions.
--
-- 20260816130000_add_vendor_order_processing deliberately locked this
-- policy's WITH CHECK to "status = 'PROCESSING'" only — that migration's own
-- header explains why: the leenmart_app credential must never be able to
-- write an unrelated status (PENDING_PAYMENT/CONFIRMED/CANCELLED) via this
-- path, even though the column-level GRANT already covers the "status"
-- column broadly. S3-6 widens the same policy the same way, rather than
-- loosening it to "any status" — the vendor credential still can never reach
-- PENDING_PAYMENT, CONFIRMED, or CANCELLED through this path; only the three
-- approved forward fulfilment states are ever a legal WITH CHECK outcome.
--
-- USING is untouched (still vendor_id-scoped, unrelated to which status is
-- being written) — only WITH CHECK changes, so ALTER POLICY specifies it
-- alone.
ALTER POLICY "sub_orders_vendor_update" ON "sub_orders"
    WITH CHECK (
        "vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid
        AND "status" IN ('PROCESSING', 'SHIPPED', 'DELIVERED')
    );
