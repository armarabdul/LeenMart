-- Grants the vendor-tenant credential (`leenmart_app`) the narrow, additional
-- write this milestone actually needs (S4-QR-FALLBACK): recording a wrong
-- manual-code guess by incrementing `manual_code_attempts` while a token is
-- still `ISSUED` — discovered missing by the integration suite, not assumed.
--
-- `pickup_tokens_vendor_redeem` (20260817180000) already grants `leenmart_app`
-- UPDATE on `status`/`redeemed_at`/`redeemed_by_user_id`/`version`, gated by a
-- `WITH CHECK` that requires the *resulting* row to be `REDEEMED` — deliberately
-- the only transition that policy allows. Reusing it (or loosening its CHECK
-- to also accept `status = 'ISSUED'`) would be a real regression: `USING` has
-- no status predicate, so it already sees an already-REDEEMED row, and a
-- loosened CHECK would let a malicious/buggy `leenmart_app` session roll a
-- REDEEMED token back to ISSUED — un-redeeming it and defeating the single-use
-- guarantee this table exists to enforce.
--
-- Instead, a second, disjoint policy for a disjoint column:
--
--   Grant   UPDATE ("manual_code_attempts") only — never `status` or any of
--           the QR-credential columns, so this policy can never be used to
--           touch redemption state even if its own CHECK were wrong.
--   USING   requires the row to *already* be ISSUED — a REDEEMED row is
--           invisible to this policy, full stop, regardless of what the
--           UPDATE's SET clause contains.
--   CHECK   requires the row to *still* be ISSUED afterward.
--
-- Together: only an ISSUED -> stays-ISSUED update is ever permitted here,
-- and PostgreSQL's OR-of-permissive-policies semantics mean this policy can
-- only ever be *more* permissive than a blanket denial, never bypass the
-- existing redeem policy's own guarantee — an update touching `status` still
-- has to satisfy `pickup_tokens_vendor_redeem`'s own CHECK, which this
-- migration does not alter.

GRANT UPDATE ("manual_code_attempts") ON "pickup_tokens" TO "leenmart_app";

CREATE POLICY "pickup_tokens_vendor_manual_code_attempt" ON "pickup_tokens" FOR UPDATE TO "leenmart_app"
    USING (
        "vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid
        AND "status" = 'ISSUED'
    )
    WITH CHECK (
        "vendor_id" = nullif(current_setting('app.vendor_id', true), '')::uuid
        AND "status" = 'ISSUED'
    );
