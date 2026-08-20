-- Manual/scanner-broken pickup fallback (S4-QR-FALLBACK, SDD 13.3's
-- "scanner broken" row: "manual completion by the vendor plus a 4-digit
-- code read from the customer's screen").
--
-- Two nullable/defaulted columns on the existing `pickup_tokens` row —
-- there is exactly one row per sub-order, so the manual code lives beside
-- the QR credential it is a fallback for, sharing its lifecycle rather than
-- a new table:
--
--   manual_code_hash       Argon2id hash of the 4-digit code, generated and
--                          rotated in lockstep with the QR token itself (the
--                          same `issue`/`rotate` call that mints a fresh
--                          nonce mints a fresh code) — never plaintext at
--                          rest, mirroring `otps.code_hash`. Nullable
--                          because a row written before this migration has
--                          no code yet, and none is backfilled: an
--                          unminted code is not data to invent.
--   manual_code_attempts   Mirrors `otps.attempts` — capped in the
--                          application layer (`PickupToken.MAX_MANUAL_CODE_ATTEMPTS`),
--                          reset to 0 on every rotation alongside the code
--                          itself.
--
-- No RLS change: `pickup_tokens` carries no policy of its own today (the
-- vendor-side repository already runs on the tenant-scoped `leenmart_app`
-- client, and the customer-side issue/rotate path runs on
-- `leenmart_checkout`), so two additional columns need no new grant.

ALTER TABLE "pickup_tokens"
    ADD COLUMN "manual_code_hash" TEXT,
    ADD COLUMN "manual_code_attempts" INTEGER NOT NULL DEFAULT 0;
