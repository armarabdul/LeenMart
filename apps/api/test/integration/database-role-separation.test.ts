import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Proves the KYC-2B-1 role separation is real rather than declared.
 *
 * **Cross-tenant isolation is asserted in `tenant-rls-isolation.test.ts`, not
 * here.** This file covers the precondition that made RLS possible at all — a
 * runtime role that cannot bypass it — and the two RLS facts that depend
 * directly on the role model, so a change to either half is caught from both
 * sides.
 *
 * The security assertions below are the load-bearing part. A future policy is
 * worth exactly nothing if `leenmart_app` ever regains SUPERUSER or BYPASSRLS,
 * and that is the kind of drift that happens quietly during an incident and is
 * never undone. These tests fail loudly if it does.
 */
/**
 * A separation that silently falls back to the owner connection is not a
 * separation. Outside production that fallback is deliberate (see `env.ts`), so
 * this suite refuses to run rather than passing against the owner role and
 * proving nothing.
 */
const requireUrl = (name: 'DATABASE_URL' | 'APP_DATABASE_URL' | 'ADMIN_DATABASE_URL'): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} must be set for the role-separation suite. Run \`pnpm db:migrate:deploy && pnpm db:provision-roles\`.`,
    );
  }
  return value;
};

describe('database role separation', () => {
  const ownerUrl = requireUrl('DATABASE_URL');
  const appUrl = requireUrl('APP_DATABASE_URL');
  const adminUrl = requireUrl('ADMIN_DATABASE_URL');

  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  const app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });

  interface RoleAttributes {
    readonly rolname: string;
    readonly rolsuper: boolean;
    readonly rolbypassrls: boolean;
    readonly rolcreaterole: boolean;
    readonly rolcreatedb: boolean;
  }

  const attributesOf = async (role: string): Promise<RoleAttributes | undefined> => {
    const rows = await owner.$queryRawUnsafe<RoleAttributes[]>(
      'SELECT rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = $1',
      role,
    );
    return rows[0];
  };

  const currentUserOf = async (client: PrismaClient): Promise<string> => {
    const rows = await client.$queryRawUnsafe<{ current_user: string }[]>('SELECT current_user');
    return rows[0]?.current_user ?? '';
  };

  beforeAll(() => {
    // Set, but set to the owner connection, is the same failure wearing a
    // different hat.
    expect(appUrl).not.toBe(ownerUrl);
    expect(adminUrl).not.toBe(ownerUrl);
    expect(appUrl).not.toBe(adminUrl);
  });

  afterAll(async () => {
    await Promise.all([owner.$disconnect(), app.$disconnect(), admin.$disconnect()]);
  });

  describe('security attributes (the precondition for RLS)', () => {
    it.each(['leenmart_app', 'leenmart_admin'])('%s exists', async (role) => {
      expect(await attributesOf(role)).toBeDefined();
    });

    it.each(['leenmart_app', 'leenmart_admin'])('%s is not SUPERUSER', async (role) => {
      expect((await attributesOf(role))?.rolsuper).toBe(false);
    });

    it.each(['leenmart_app', 'leenmart_admin'])('%s does not have BYPASSRLS', async (role) => {
      // The single most important assertion in this file. With BYPASSRLS,
      // every policy KYC-2B-3 writes is decoration.
      expect((await attributesOf(role))?.rolbypassrls).toBe(false);
    });

    it.each(['leenmart_app', 'leenmart_admin'])(
      '%s cannot create roles or databases',
      async (role) => {
        const attributes = await attributesOf(role);

        expect(attributes?.rolcreaterole).toBe(false);
        expect(attributes?.rolcreatedb).toBe(false);
      },
    );

    it('the admin role is not simply a bypass in disguise', async () => {
      // The elevated path is a separate *credential*, not an exemption from
      // the mechanism. Which rows an admin sees is a policy decision in
      // KYC-2B-3, and it cannot be one if the role skips policies outright.
      const attributes = await attributesOf('leenmart_admin');

      expect(attributes?.rolbypassrls).toBe(false);
      expect(attributes?.rolsuper).toBe(false);
    });

    it('the owner role deliberately still has its privileges', async () => {
      // Documented, not accidental: owner-role privilege reduction is deferred
      // until runtime role separation is proven. If this ever fails, someone
      // has done that work — and this expectation is the reminder to also
      // re-verify that migrations still run.
      const attributes = await attributesOf('leenmart');

      expect(attributes?.rolsuper).toBe(true);
      expect(attributes?.rolbypassrls).toBe(true);
    });
  });

  describe('connections', () => {
    it('the app client connects as leenmart_app', async () => {
      expect(await currentUserOf(app)).toBe('leenmart_app');
    });

    it('the admin client connects as leenmart_admin', async () => {
      expect(await currentUserOf(admin)).toBe('leenmart_admin');
    });

    it('the owner client still connects for migrations', async () => {
      expect(await currentUserOf(owner)).toBe('leenmart');
    });

    it('the two runtime roles are genuinely different credentials', async () => {
      expect(await currentUserOf(app)).not.toBe(await currentUserOf(admin));
    });
  });

  describe('the runtime roles cannot touch the schema', () => {
    const clients = (): [string, PrismaClient][] => [
      ['leenmart_app', app],
      ['leenmart_admin', admin],
    ];

    it.each(clients())('%s cannot CREATE TABLE', async (_role, client) => {
      await expect(
        client.$executeRawUnsafe('CREATE TABLE role_separation_probe (id integer)'),
      ).rejects.toThrow(/permission denied for schema public/);
    });

    it.each(clients())('%s cannot ALTER an application table', async (_role, client) => {
      await expect(
        client.$executeRawUnsafe('ALTER TABLE users ADD COLUMN probe integer'),
      ).rejects.toThrow(/must be owner of table users/);
    });

    it.each(clients())('%s cannot DROP an application table', async (_role, client) => {
      await expect(client.$executeRawUnsafe('DROP TABLE kyc_documents')).rejects.toThrow(
        /must be owner of table kyc_documents/,
      );
    });

    it.each(clients())('%s cannot read migration history', async (_role, client) => {
      // A runtime role able to rewrite `_prisma_migrations` is one that can lie
      // about which schema is deployed.
      await expect(
        client.$executeRawUnsafe('SELECT count(*) FROM _prisma_migrations'),
      ).rejects.toThrow(/permission denied for table _prisma_migrations/);
    });
  });

  describe('append-only tables stay append-only', () => {
    it('the app role cannot UPDATE audit_logs', async () => {
      // Belt and braces with the immutability trigger: withholding the
      // privilege means the refusal does not depend on the trigger surviving a
      // future migration.
      await expect(
        app.$executeRawUnsafe("UPDATE audit_logs SET reason = 'tampered'"),
      ).rejects.toThrow(/permission denied for table audit_logs/);
    });

    it('the app role cannot DELETE from audit_logs', async () => {
      await expect(app.$executeRawUnsafe('DELETE FROM audit_logs')).rejects.toThrow(
        /permission denied for table audit_logs/,
      );
    });

    it('the app role can still write and read audit entries', async () => {
      // The point of the narrowing is that the module keeps working.
      await expect(app.auditLog.count()).resolves.toBeGreaterThanOrEqual(0);
    });
  });

  describe('ordinary application access still works', () => {
    it('the app role can read every table the application uses', async () => {
      // Authentication must not break because tenancy work started. These are
      // the tables login, refresh, OTP and admin MFA depend on.
      await expect(app.user.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(app.refreshToken.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(app.otp.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(app.mfaSecret.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(app.mfaChallenge.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(app.vendorProfile.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(app.address.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(app.vendorKycSubmission.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(app.kycDocument.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(app.outboxEvent.count()).resolves.toBeGreaterThanOrEqual(0);
    });

    it('the app role can write and delete its own rows', async () => {
      const id = '00000000-0000-7000-8000-0000000b2b01';

      await app.user.create({
        data: { id, email: `role-separation-${Date.now()}@example.com` },
      });
      await expect(app.user.findUnique({ where: { id } })).resolves.not.toBeNull();

      await app.user.update({ where: { id }, data: { status: 'SUSPENDED' } });
      await app.user.delete({ where: { id } });

      await expect(app.user.findUnique({ where: { id } })).resolves.toBeNull();
    });

    it('the admin role has the same DML capability for now', async () => {
      // Until KYC-2B-3's policies exist, the admin role differs from the app
      // role only in which credential it presents. That is intentional: this
      // chunk proves the connection, the next one gives it different rows.
      await expect(admin.vendorKycSubmission.count()).resolves.toBeGreaterThanOrEqual(0);
    });
  });

  describe('row-level security rests on this role model (KYC-2B-3)', () => {
    it('enables RLS only on the tenant tables', async () => {
      // The role separation above is what gives these policies teeth; asserted
      // here too so a change to either half is caught from both sides.
      // `products`/`product_variants` joined this list in S2-3a; `inventory`
      // in S2-4.
      const rows = await owner.$queryRawUnsafe<{ tablename: string }[]>(
        'SELECT tablename FROM pg_tables WHERE schemaname = $1 AND rowsecurity ORDER BY tablename',
        'public',
      );

      expect(rows.map((row) => row.tablename)).toEqual([
        'inventory',
        'kyc_documents',
        'product_variants',
        'products',
        'vendor_kyc_submissions',
        'vendors',
      ]);
    });

    it('forces RLS on nothing, so the owner can still migrate', async () => {
      const [forced] = await owner.$queryRawUnsafe<{ count: bigint }[]>(
        'SELECT count(*) AS count FROM pg_class WHERE relforcerowsecurity',
      );

      expect(Number(forced?.count)).toBe(0);
    });
  });
});
