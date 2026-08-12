-- Admin KYC decision policies (KYC-5).
--
-- The UPDATE half of the reviewer path that KYC-2B-3 deliberately withheld.
-- Its own comment recorded why and what would finish it: "deciding is an
-- UPDATE of the review columns, which arrives with the admin review use case
-- in KYC-5 and gets its own policy then. Granting FOR ALL USING (true) now --
-- merely because the role exists -- would hand every future admin code path
-- unrestricted write access to every vendor's data before anything has been
-- written that needs it." This is that policy, and nothing more.
--
-- Why a policy is the whole change: `leenmart_admin` already *holds* the
-- UPDATE privilege on both tables -- `20260812120000_database_role_separation`
-- grants SELECT, INSERT, UPDATE, DELETE on every table except the append-only
-- audit ones. RLS is what has been refusing the write, silently, as zero
-- affected rows. So no GRANT changes here, and none are needed.
--
-- SDD 15.1 is the authority for the shape: an administrator reads a
-- submission and decides it, and "a human makes the decision and their
-- identity is recorded". Deciding writes the six review columns on
-- `vendor_kyc_submissions` and moves `vendors.status` from KYC_UNDER_REVIEW to
-- KYC_APPROVED or KYC_REJECTED. Those two writes are the entire elevated
-- surface, and they must be in one transaction, so both tables need the
-- policy or neither is useful.
--
-- Deliberately NOT here, each for a reason rather than for caution:
--
--   * **FOR ALL.** It would silently include INSERT and DELETE. An admin
--     credential that can delete a vendor's KYC history can erase the evidence
--     of its own decisions, which is the opposite of SDD 18.4's intent.
--   * **INSERT policies.** Nothing an administrator does creates a vendor or a
--     submission; both are the vendor's own act (KYC-4). The privilege exists
--     but no policy admits it, so RLS keeps refusing -- which is the design.
--   * **DELETE policies.** Same reasoning, and retention is BR-16's erasure
--     job, not a reviewer's.
--   * **`kyc_documents`.** A submission's documents are immutable once
--     written (KYC-1), and the repository has no method that updates one.
--     Review changes the decision, never the evidence.
--   * **FORCE ROW LEVEL SECURITY, SECURITY DEFINER, BYPASSRLS, privilege
--     changes.** None is required to record a decision, and each would widen
--     the boundary well past it.
--
-- USING (true) is correct rather than lax: cross-tenant reach *is* the
-- reviewer's job (SDD 15.1), and it is the interface layer that decides who
-- may reach -- `requirePermission('APPROVE_OR_REJECT_VENDOR_KYC')`, which
-- SDD 8.2 grants only to RISK_ANALYST and SUPER_ADMIN (SDD 7.4 step 2). A
-- predicate here could only re-express that decision in a place with less
-- information about it.
--
-- WITH CHECK (true) is stated explicitly. PostgreSQL would default it to the
-- USING expression, so this changes nothing at runtime; written out, the row
-- an UPDATE produces is visibly unconstrained on purpose rather than by a
-- default a reader has to know.

-- CreatePolicy
CREATE POLICY "vendor_kyc_admin_decide" ON "vendor_kyc_submissions" FOR UPDATE TO leenmart_admin
    USING (true)
    WITH CHECK (true);

-- CreatePolicy
-- The lifecycle half. Without it the decision would commit against the
-- submission while the vendor stayed KYC_UNDER_REVIEW -- or, inside the one
-- transaction KYC-5 requires, the whole decision would roll back with nothing
-- to explain why, because a policy refusal reports zero affected rows rather
-- than an error.
CREATE POLICY "vendors_admin_decide" ON "vendors" FOR UPDATE TO leenmart_admin
    USING (true)
    WITH CHECK (true);
