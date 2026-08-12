-- Tenant row-level security (KYC-2B-3).
--
-- The point at which SDD 6.6's third layer becomes real. Layers one and two --
-- repository scoping and cross-tenant tests -- are application controls; this
-- is the one that holds when both of them are wrong.
--
-- It only works because KYC-2B-1 separated the roles: leenmart_app and
-- leenmart_admin are NOSUPERUSER/NOBYPASSRLS and own nothing, so ordinary
-- ENABLE binds them. The reverse was verified during the KYC-2A inspection:
-- with the old single SUPERUSER/BYPASSRLS role, ENABLE + FORCE + a restrictive
-- policy still returned every tenant's rows.
--
-- Deliberately NOT here:
--
--   * FORCE ROW LEVEL SECURITY. FORCE subjects a table's *owner* to its
--     policies. The runtime roles own nothing, so plain ENABLE already binds
--     them; FORCE would additionally bind leenmart, breaking migrations and
--     backfills for no security gain.
--   * SECURITY DEFINER. Every such function is a hand-written privilege
--     boundary running as the owner, and one mistake in it is a total bypass.
--   * Any app.is_admin setting. A flag set by the same process these policies
--     constrain is worth nothing; elevated access is the separate
--     leenmart_admin credential.
--   * Owner privilege reduction, which stays deferred.
--
-- Every policy reads a setting as nullif(current_setting(..., true), '')
-- before casting. Verified behaviour, not caution: after a transaction-local
-- set_config commits, the setting persists on the session as an *empty
-- string*, and casting that to uuid raises "invalid input syntax for type
-- uuid". Without the nullif, the second request on a reused pooled connection
-- would fail hard. With it, an unset or emptied setting is SQL NULL, every
-- comparison is NULL, and the row is invisible -- fail-closed by construction.

-- Enable
ALTER TABLE "vendors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vendor_kyc_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kyc_documents" ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- vendors -- the tenant root, and the only table with a pre-tenant operation.
-- ---------------------------------------------------------------------------

-- CreatePolicy
-- Registration. A caller may create a vendor for themselves and nobody else:
-- app.user_id comes from the verified access token, so forging a row for
-- another user is refused by the database rather than only by the
-- application's CUSTOMER-role check. With no user setting at all the
-- comparison is NULL and the insert is refused, so an unconfigured connection
-- cannot create tenants.
CREATE POLICY "vendors_insert" ON "vendors" FOR INSERT TO leenmart_app
    WITH CHECK ("user_id" = nullif(current_setting('app.user_id', true), '')::uuid);

-- CreatePolicy
-- Two ways to see a vendor row, and both are needed.
--
--   * id = app.vendor_id is the ordinary tenant read.
--   * user_id = app.user_id is what makes the system bootstrappable: the
--     tenant middleware resolves a caller's vendor by user_id, and if that
--     lookup required a vendor context there would be no way to ever obtain
--     one. It is also what keeps VendorAlreadyRegisteredError working --
--     registration's duplicate pre-check reads the caller's own row, so a
--     second attempt still gets the existing 409 rather than a raw unique
--     violation.
CREATE POLICY "vendors_select" ON "vendors" FOR SELECT TO leenmart_app
    USING (
        "id" = nullif(current_setting('app.vendor_id', true), '')::uuid
        OR "user_id" = nullif(current_setting('app.user_id', true), '')::uuid
    );

-- CreatePolicy
-- Lifecycle transitions, restricted to the caller's own vendor. WITH CHECK as
-- well as USING: without it a vendor could update their own row into another
-- tenant's identity.
CREATE POLICY "vendors_update" ON "vendors" FOR UPDATE TO leenmart_app
    USING ("id" = nullif(current_setting('app.vendor_id', true), '')::uuid)
    WITH CHECK ("id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- No DELETE policy, deliberately. Nothing deletes a vendor -- SDD 15.1 winds
-- one down through TERMINATED -- and the absence of a policy is itself the
-- control: with RLS enabled, a command with no policy matches no rows.

-- ---------------------------------------------------------------------------
-- vendor_kyc_submissions / kyc_documents -- leaves, no pre-tenant case.
-- ---------------------------------------------------------------------------

-- CreatePolicy
CREATE POLICY "vendor_kyc_select" ON "vendor_kyc_submissions" FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
CREATE POLICY "vendor_kyc_insert" ON "vendor_kyc_submissions" FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
CREATE POLICY "vendor_kyc_update" ON "vendor_kyc_submissions" FOR UPDATE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid)
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
-- kyc_documents carries its own vendor_id, pinned to the parent submission by
-- the composite foreign key added in KYC-2A. That is what lets this policy be
-- a column comparison rather than a subquery against the parent -- the
-- denormalisation earns its place twice.
CREATE POLICY "kyc_documents_select" ON "kyc_documents" FOR SELECT TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
CREATE POLICY "kyc_documents_insert" ON "kyc_documents" FOR INSERT TO leenmart_app
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- CreatePolicy
CREATE POLICY "kyc_documents_update" ON "kyc_documents" FOR UPDATE TO leenmart_app
    USING ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid)
    WITH CHECK ("vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid);

-- No DELETE policy on either: a submission is history (SDD 18.4) and a
-- document is the evidence behind it.

-- ---------------------------------------------------------------------------
-- leenmart_admin -- the reviewer path.
-- ---------------------------------------------------------------------------

-- CreatePolicy
-- Read-only, and only what a reviewer's job requires today. SDD 15.1 has an
-- administrator read a submission and decide it; deciding is an UPDATE of the
-- review columns, which arrives with the admin review use case in KYC-5 and
-- gets its own policy then. Granting FOR ALL USING (true) now -- merely
-- because the role exists -- would hand every future admin code path
-- unrestricted write access to every vendor's data before anything has been
-- written that needs it.
--
-- This is also the SEC-17 duplicate-detection path:
-- findByIdentifierFingerprints deliberately searches other vendors, which
-- vendor RLS correctly refuses. It has no production caller yet; when
-- KYC-4/KYC-5 wires one it runs here, behind an authorisation decision made in
-- the interface layer (SDD 7.4).
CREATE POLICY "vendors_admin_read" ON "vendors" FOR SELECT TO leenmart_admin USING (true);

-- CreatePolicy
CREATE POLICY "vendor_kyc_admin_read" ON "vendor_kyc_submissions" FOR SELECT TO leenmart_admin
    USING (true);

-- CreatePolicy
CREATE POLICY "kyc_documents_admin_read" ON "kyc_documents" FOR SELECT TO leenmart_admin
    USING (true);
