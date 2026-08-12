import { PrismaClient } from '@prisma/client';
import { loadEnv } from '../shared/config/env.js';

/**
 * Sets the passwords for the runtime database roles (KYC-2B-1).
 *
 * The roles themselves are created by the
 * `20260812120000_database_role_separation` migration, which is committed and
 * therefore cannot contain credentials. This script is the other half: it runs
 * as the owner and gives those roles the passwords the application will use.
 *
 * The password is **derived from the connection URL the application will
 * actually use** rather than read from a separate variable. Two sources for one
 * secret is two things to keep in sync, and the failure when they drift is an
 * authentication error at startup with no indication which side is wrong.
 *
 * Idempotent: `ALTER ROLE … PASSWORD` is a set, not a change, so running this
 * twice is running it once. Safe on a fresh database, an existing development
 * database, the test database and CI — all four take exactly this path, which
 * is why there is no `docker-entrypoint-initdb.d` script. An init script runs
 * only when the data directory is first created, so it could never be the
 * mechanism for a database that already exists, and maintaining two divergent
 * provisioning paths is how they come to disagree.
 *
 * Run with: pnpm --filter @leen-mart/api db:provision-roles
 */

/** Fixed, not derived from input — these identifiers are never interpolated from user data. */
const MANAGED_ROLES = {
  APP_DATABASE_URL: 'leenmart_app',
  ADMIN_DATABASE_URL: 'leenmart_admin',
} as const;

interface RoleCredential {
  readonly variable: keyof typeof MANAGED_ROLES;
  readonly role: string;
  readonly password: string;
}

/**
 * Pulls the credential out of a connection URL, and refuses anything that does
 * not match the role the migration created. A URL naming a different user is
 * far more likely to be a copy-paste of the owner connection than a deliberate
 * choice, and setting the owner's password from it would be a bad afternoon.
 */
const credentialFrom = (variable: keyof typeof MANAGED_ROLES, url: string): RoleCredential => {
  const expected = MANAGED_ROLES[variable];
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);

  if (user !== expected) {
    throw new Error(`${variable} must connect as "${expected}", but names "${user}".`);
  }
  if (!password) {
    throw new Error(`${variable} carries no password; the role would be unable to authenticate.`);
  }
  // Not a strength rule — a guard against a value that would break the DDL
  // below or silently truncate. Strength is a deployment concern.
  if (/[\0\n\r]/.test(password)) {
    throw new Error(`${variable} contains a control character in its password.`);
  }

  return { variable, role: expected, password };
};

const run = async (): Promise<void> => {
  const env = loadEnv();
  const configured = (Object.keys(MANAGED_ROLES) as (keyof typeof MANAGED_ROLES)[])
    .map((variable) => ({ variable, url: env[variable] }))
    .filter((entry): entry is { variable: keyof typeof MANAGED_ROLES; url: string } =>
      Boolean(entry.url),
    );

  if (configured.length === 0) {
    process.stdout.write(
      'Neither APP_DATABASE_URL nor ADMIN_DATABASE_URL is set — nothing to provision.\n',
    );
    return;
  }

  const credentials = configured.map((entry) => credentialFrom(entry.variable, entry.url));
  // The owner connection: only `leenmart` may ALTER another role.
  const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

  try {
    for (const credential of credentials) {
      const missing = await prisma.$queryRawUnsafe<{ present: boolean }[]>(
        'SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS present',
        credential.role,
      );
      if (!missing[0]?.present) {
        throw new Error(
          `Role "${credential.role}" does not exist. Run \`pnpm db:migrate:deploy\` first — the role is created by migration, not by this script.`,
        );
      }

      // DDL cannot be parameterised, so the literal is escaped by doubling
      // quotes. The role name is from the fixed map above, never from input.
      const literal = credential.password.replace(/'/g, "''");
      await prisma.$executeRawUnsafe(
        `ALTER ROLE "${credential.role}" WITH LOGIN PASSWORD '${literal}'`,
      );

      // The role name only. The password is never written to stdout, to a log,
      // or into an error message — including the failures above, which name
      // the variable rather than quoting its contents.
      process.stdout.write(`Provisioned ${credential.role}.\n`);
    }
  } finally {
    await prisma.$disconnect();
  }
};

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
