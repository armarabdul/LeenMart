-- S4-QR-FALLBACK (D1): make the database enforce what 20260820160000's own
-- comment already claims, on both counts it turned out not to.
--
-- 20260820160000 added `pickup_tokens_vendor_manual_code_attempt`, a second
-- permissive UPDATE policy for `leenmart_app` (ISSUED -> ISSUED, so a wrong
-- manual-code guess can persist its attempt counter). Its comment argued —
-- correctly — that *loosening* `pickup_tokens_vendor_redeem`'s `WITH CHECK`
-- would let a vendor session roll a REDEEMED token back to ISSUED. Adding a
-- disjoint policy avoided loosening that CHECK, but produced the same two
-- outcomes anyway, because of how PostgreSQL combines policies and how this
-- table's grants were actually set. Both were demonstrated against a live
-- database and then rolled back.
--
-- FAULT 1 — the vendor credential could rewrite the QR credentials.
--
--   20260817180000 granted `leenmart_app` a deliberately column-scoped
--   UPDATE ("status","redeemed_at","redeemed_by_user_id","version"). But
--   20260812120000_database_role_separation had already set
--
--     ALTER DEFAULT PRIVILEGES FOR ROLE leenmart IN SCHEMA public
--         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO leenmart_app, leenmart_admin;
--
--   so the table arrived with **table-wide** UPDATE regardless; the column
--   list was additive, never a ceiling. Until 20260820160000 that was inert,
--   because the only UPDATE policy `leenmart_app` had demanded the resulting
--   row be REDEEMED — however wide the grant, the only permitted update was
--   one that redeemed the token. Once an ISSUED -> ISSUED update became
--   permitted, the wide grant meant it could carry any column, including
--   `token_hash`, `nonce` and `manual_code_hash`.
--
--   Exactly the situation 20260817090001_narrow_ledger_grants was written
--   for, and its reasoning applies verbatim: a table created after the
--   default-privileges rule must narrow its own grants in its own migration.
--
-- FAULT 2 — the single-use guarantee could be undone.
--
--   Permissive policies are OR-ed, and that applies to `WITH CHECK` as well
--   as `USING`. For `UPDATE status = 'ISSUED'` on a REDEEMED row:
--   `pickup_tokens_vendor_redeem`'s USING has no status predicate, so it
--   makes the REDEEMED row visible; its own CHECK rejects the ISSUED result,
--   but `pickup_tokens_vendor_manual_code_attempt`'s CHECK *accepts* it, and
--   one passing CHECK is enough. A vendor session could therefore un-redeem
--   a token — precisely the outcome 20260820160000 set out to prevent.
--
-- THE FIX, in two parts, neither of which touches the existing policies.
--
-- Part 1 — the grant. The five columns below are the exact union of what the
-- two legitimate `leenmart_app` writes need:
--
--   redeemIfIssued()            status, redeemed_at, redeemed_by_user_id, version
--   recordManualCodeAttempt()   manual_code_attempts
--
-- `token_hash`, `nonce`, `manual_code_hash`, `issued_at` and `expires_at` are
-- written only by issuance/rotation, which runs on `leenmart_checkout` (the
-- customer's own path — see `PickupTokenRepository`'s doc comment), so
-- `leenmart_app` never needed them. A table-level REVOKE also drops the
-- column-level privileges of the same type, so the GRANT that follows is what
-- re-establishes the whole permitted set — deterministic on a fresh database
-- as well as an existing one.
--
-- Part 2 — a RESTRICTIVE policy, which is AND-ed with the OR of the
-- permissive ones and so cannot be satisfied by some other policy the way a
-- permissive CHECK can. Its `USING` constrains the **pre-image**: a row that
-- is not currently ISSUED is not updatable by `leenmart_app` at all. That is
-- the invariant the redeem CAS has always relied on, now stated once,
-- declaratively, instead of being an emergent property of which policies
-- happen to exist.
--
--   `WITH CHECK (true)` is explicit and load-bearing: omitting it makes
--   PostgreSQL reuse `USING` as the check, which would reject the legitimate
--   ISSUED -> REDEEMED transition itself. The post-image stays governed by
--   the permissive policies, exactly as before.
--
-- RLS remains fail-closed throughout, and nothing here alters:
--   * the atomic ISSUED -> REDEEMED compare-and-set,
--   * token ownership semantics (`vendor_id = app.vendor_id`),
--   * `leenmart_checkout`'s issue/rotate grants,
--   * `leenmart_admin`, which holds no policy on this table and is not
--     BYPASSRLS, so RLS already denies it every row.

REVOKE UPDATE ON "pickup_tokens" FROM "leenmart_app";

GRANT UPDATE (
    "status",
    "redeemed_at",
    "redeemed_by_user_id",
    "version",
    "manual_code_attempts"
) ON "pickup_tokens" TO "leenmart_app";

CREATE POLICY "pickup_tokens_vendor_update_issued_only" ON "pickup_tokens"
    AS RESTRICTIVE FOR UPDATE TO "leenmart_app"
    USING ("status" = 'ISSUED')
    WITH CHECK (true);
