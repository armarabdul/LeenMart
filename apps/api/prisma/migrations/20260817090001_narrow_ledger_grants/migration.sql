-- S3-7: narrow the ledger tables' grants to SELECT for the two runtime roles
-- that only ever read them.
--
-- 20260812120000_database_role_separation set:
--
--   ALTER DEFAULT PRIVILEGES FOR ROLE leenmart IN SCHEMA public
--       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO leenmart_app, leenmart_admin;
--
-- so *every* table the owner creates afterwards arrives with all four
-- privileges for both roles, regardless of what its own migration granted.
-- That migration's own comment anticipates this precisely:
--
--   "Deliberately not extended to audit-style tables: a future append-only
--    table must narrow its own grants in its own migration, since nothing
--    here can know which ones those are."
--
-- `audit_logs` never needed this because it was created in the very first
-- migration, before the default-privileges rule existed. `ledger_journals`
-- and `ledger_entries` are the first append-only tables created *after* it,
-- so they are the first to need the narrowing it describes.
--
-- Split into its own migration rather than folded into
-- 20260817090000_add_double_entry_ledger because that one is already applied;
-- editing an applied migration changes its checksum and would make Prisma
-- report drift for anyone who had run it. The end state is identical either
-- way.
--
-- Without this, the append-only guarantee would rest only on the triggers and
-- on the absence of UPDATE/DELETE *policies* — both real, but the grant
-- itself would still read as though a vendor credential could rewrite posted
-- accounting history, which is exactly the claim the ledger must not leave
-- ambiguous.

REVOKE INSERT, UPDATE, DELETE ON "ledger_journals" FROM "leenmart_app", "leenmart_admin";
REVOKE INSERT, UPDATE, DELETE ON "ledger_entries" FROM "leenmart_app", "leenmart_admin";

-- `leenmart_checkout` is the ledger's only writer and was granted exactly
-- SELECT + INSERT explicitly (it is not covered by the ALTER DEFAULT
-- PRIVILEGES above, which names only leenmart_app and leenmart_admin), so it
-- needs no narrowing. Asserted rather than assumed: if a future migration
-- widens it, this REVOKE keeps the invariant true.
REVOKE UPDATE, DELETE ON "ledger_journals" FROM "leenmart_checkout";
REVOKE UPDATE, DELETE ON "ledger_entries" FROM "leenmart_checkout";
