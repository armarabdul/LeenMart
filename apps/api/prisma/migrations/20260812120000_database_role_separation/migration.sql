-- Platform database role separation (KYC-2B-1).
--
-- Establishes the role model PostgreSQL RLS needs in order to be real. It
-- creates no policies and enables RLS nowhere: policies come in KYC-2B-3, and
-- writing them before a role exists that cannot bypass them would ship a
-- control that provably does nothing (verified during the KYC-2A inspection —
-- ENABLE + FORCE + a restrictive policy still returned every tenant's rows,
-- because the one existing role is SUPERUSER with BYPASSRLS).
--
-- Three roles:
--
--   leenmart        owner. Runs migrations, owns every object. Keeps
--                   SUPERUSER/BYPASSRLS for now — see the note below.
--   leenmart_app    runtime, vendor-facing. DML only, owns nothing, cannot
--                   bypass RLS or touch the schema.
--   leenmart_admin  runtime, admin/reviewer. A *separate credential*, which is
--                   the trust boundary: an application-set flag such as
--                   `app.is_admin` would be set by the same process RLS exists
--                   to constrain, and is worth nothing. Also no BYPASSRLS —
--                   which rows an admin may see is decided by policy in
--                   KYC-2B-3, not by exemption from the mechanism.
--
-- OWNER-ROLE PRIVILEGE REDUCTION IS DEFERRED until runtime role separation is
-- proven. `leenmart` deliberately keeps SUPERUSER and BYPASSRLS in this
-- migration. Removing them is a larger, riskier change that would affect every
-- migration and operational task, and it must not ride along silently with the
-- change that introduces the runtime roles.
--
-- No passwords appear here, and none ever will: this file is committed, and a
-- migration replays identically in every environment while credentials must
-- not. `pnpm db:provision-roles` sets them from APP_DATABASE_URL /
-- ADMIN_DATABASE_URL. A role created here without a password simply cannot log
-- in until that runs, which is the correct failure direction.
--
-- Idempotent and self-healing. Roles are cluster-wide, not database-scoped, so
-- this migration must tolerate a role that already exists — on a shadow
-- database, on a replayed test database, or on a developer's machine. Every
-- statement is written to converge on the intended state rather than to assume
-- an initial one, and the ALTER re-asserts the security attributes so a role
-- that drifted (or was created by hand with the wrong flags) is corrected
-- rather than trusted.

-- CreateRole
DO $$
DECLARE
    target text;
BEGIN
    FOREACH target IN ARRAY ARRAY['leenmart_app', 'leenmart_admin'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = target) THEN
            -- LOGIN but no password: unusable until provisioning runs.
            EXECUTE format('CREATE ROLE %I WITH LOGIN', target);
        END IF;

        -- Re-asserted on every replay, not just at creation. These are the
        -- properties the whole design rests on, and KYC-2B-3's policies are
        -- worthless if any of them is ever quietly true.
        EXECUTE format(
            'ALTER ROLE %I WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION INHERIT',
            target
        );
    END LOOP;
END
$$;

-- Grant
-- USAGE lets the role resolve objects in the schema; CREATE is revoked
-- explicitly so a runtime role cannot add tables of its own. PostgreSQL 15
-- dropped PUBLIC's CREATE on `public`, but being explicit costs nothing and
-- survives a restore onto an older cluster.
GRANT USAGE ON SCHEMA public TO leenmart_app, leenmart_admin;
REVOKE CREATE ON SCHEMA public FROM leenmart_app, leenmart_admin;

-- Grant
-- Table privileges, granted per table rather than with GRANT ALL.
--
--   * ALL would include TRUNCATE, REFERENCES and TRIGGER. TRUNCATE on
--     `audit_logs` would defeat the append-only guarantee SDD 18.4 requires,
--     and none of the three has a caller.
--   * `_prisma_migrations` is excluded entirely: Prisma Client never reads it,
--     only the migration engine does, and that runs as the owner. A runtime
--     role that can rewrite migration history is a runtime role that can lie
--     about the schema.
--   * `spatial_ref_sys` is PostGIS reference data — read-only.
--   * `audit_logs` and its partitions get SELECT and INSERT only. The
--     immutability trigger already refuses UPDATE and DELETE; withholding the
--     privilege as well means the refusal does not depend on the trigger
--     surviving.
--
-- No sequence grants: this schema has zero sequences and zero identity or
-- serial columns (UUID v7 primary keys are generated in the application,
-- ADR-005), so there is nothing for an INSERT to draw from.
DO $$
DECLARE
    target text;
    entry record;
BEGIN
    FOREACH target IN ARRAY ARRAY['leenmart_app', 'leenmart_admin'] LOOP
        FOR entry IN
            SELECT c.relname,
                   c.relname = 'audit_logs' OR c.relname LIKE 'audit\_logs\_%' AS append_only
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind IN ('r', 'p')
              AND c.relname NOT IN ('_prisma_migrations', 'spatial_ref_sys')
        LOOP
            IF entry.append_only THEN
                EXECUTE format('GRANT SELECT, INSERT ON public.%I TO %I', entry.relname, target);
            ELSE
                EXECUTE format(
                    'GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO %I',
                    entry.relname, target
                );
            END IF;
        END LOOP;

        EXECUTE format('GRANT SELECT ON public.spatial_ref_sys TO %I', target);
        EXECUTE format('REVOKE ALL ON public._prisma_migrations FROM %I', target);
    END LOOP;
END
$$;

-- AlterDefaultPrivileges
-- Tables created by the owner *after* this migration. Without this, every
-- future module's first migration would silently produce tables the runtime
-- cannot read, and the failure would surface as a 500 in whichever endpoint
-- happened to touch it first rather than as anything resembling its cause.
--
-- Deliberately not extended to audit-style tables: a future append-only table
-- must narrow its own grants in its own migration, since nothing here can know
-- which ones those are.
ALTER DEFAULT PRIVILEGES FOR ROLE leenmart IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO leenmart_app, leenmart_admin;
