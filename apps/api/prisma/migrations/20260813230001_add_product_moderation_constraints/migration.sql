-- ---------------------------------------------------------------------------
-- Constraints Prisma's schema DSL cannot express (SDD 6.1), the same
-- discipline 20260813180000_add_products applied to this table already.
--
-- Kept in its own migration, applied after 20260813230000_add_product_moderation
-- has committed: the CHECK below names 'REJECTED', a value that migration
-- adds to "ProductStatus", and PostgreSQL refuses to reference a new enum
-- value inside the same transaction that added it.
-- ---------------------------------------------------------------------------

ALTER TABLE "products"
    -- Mirrors the domain's own rule (S2-5 D: every rejection carries a reason
    -- *and* a non-blank note, stricter than KYC's "only OTHER needs one") and
    -- the inverse: a product that is not REJECTED carries neither. This is
    -- the copy that survives an application bug writing directly to the row.
    ADD CONSTRAINT "chk_products_rejection_requires_reason_and_note"
        CHECK (
            ("status" = 'REJECTED' AND "rejection_reason" IS NOT NULL AND "rejection_note" IS NOT NULL AND char_length(btrim("rejection_note")) > 0)
            OR
            ("status" <> 'REJECTED' AND "rejection_reason" IS NULL AND "rejection_note" IS NULL)
        );


-- ---------------------------------------------------------------------------
-- leenmart_admin gains its first WRITE policy on this table (S2-5). S2-3a's
-- 20260813180000_add_products deliberately withheld one — "granting a write
-- policy now, before any admin code path needs one, would hand every future
-- admin route unrestricted write access to every vendor's catalogue before
-- anything written requires it." The admin approve/reject decision (SDD
-- 15.2) is that code path. Exact template: 20260812210000_admin_kyc_decision_policies's
-- vendor_kyc_admin_decide/vendors_admin_decide — USING(true)/WITH CHECK(true),
-- because leenmart_admin's authority is the credential itself, not a
-- row-level comparison, and the actual authorisation decision (does this
-- caller hold APPROVE_OR_REJECT_PRODUCT?) is made in the interface layer
-- (SDD 7.4), not by RLS.
--
-- Still only one policy, not two: DecideProductUseCase's conditional
-- `WHERE status = 'PENDING_REVIEW'` is what arbitrates concurrent decisions,
-- exactly as vendor_kyc_admin_decide leaves the "only if undecided" rule to
-- the application's conditional write rather than to RLS.
-- ---------------------------------------------------------------------------

-- CreatePolicy
CREATE POLICY "products_admin_decide" ON "products" FOR UPDATE TO leenmart_admin
    USING (true)
    WITH CHECK (true);
