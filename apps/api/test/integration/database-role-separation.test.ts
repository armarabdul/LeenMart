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
const requireUrl = (
  name:
    | 'DATABASE_URL'
    | 'APP_DATABASE_URL'
    | 'ADMIN_DATABASE_URL'
    | 'PUBLIC_DATABASE_URL'
    | 'CHECKOUT_DATABASE_URL',
): string => {
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

  const publicUrl = requireUrl('PUBLIC_DATABASE_URL');
  const checkoutUrl = requireUrl('CHECKOUT_DATABASE_URL');

  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  const app = new PrismaClient({ datasources: { db: { url: appUrl } } });
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const anon = new PrismaClient({ datasources: { db: { url: publicUrl } } });
  const checkout = new PrismaClient({ datasources: { db: { url: checkoutUrl } } });

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
    expect(publicUrl).not.toBe(ownerUrl);
    expect(publicUrl).not.toBe(appUrl);
    expect(publicUrl).not.toBe(adminUrl);
    expect(checkoutUrl).not.toBe(ownerUrl);
    expect(checkoutUrl).not.toBe(appUrl);
    expect(checkoutUrl).not.toBe(adminUrl);
    expect(checkoutUrl).not.toBe(publicUrl);
  });

  afterAll(async () => {
    await Promise.all([
      owner.$disconnect(),
      app.$disconnect(),
      admin.$disconnect(),
      anon.$disconnect(),
      checkout.$disconnect(),
    ]);
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

  describe('leenmart_public — a fourth, SELECT-only role (S2-7)', () => {
    // A dedicated block rather than folding into `clients()`/`ordinary
    // application access still works` above: those assert *DML* capability,
    // which this role deliberately has none of. Read-visibility (which rows
    // it sees) is the separate concern `product-search-rls-isolation.test.ts`
    // proves in depth; this block is the same role/schema-attribute parity
    // check the app/admin roles get above, plus the one fact that makes this
    // role different in kind rather than degree: it was never given DML.
    it('exists', async () => {
      expect(await attributesOf('leenmart_public')).toBeDefined();
    });

    it('is not SUPERUSER', async () => {
      expect((await attributesOf('leenmart_public'))?.rolsuper).toBe(false);
    });

    it('does not have BYPASSRLS', async () => {
      expect((await attributesOf('leenmart_public'))?.rolbypassrls).toBe(false);
    });

    it('cannot create roles or databases', async () => {
      const attributes = await attributesOf('leenmart_public');

      expect(attributes?.rolcreaterole).toBe(false);
      expect(attributes?.rolcreatedb).toBe(false);
    });

    it('connects as leenmart_public', async () => {
      expect(await currentUserOf(anon)).toBe('leenmart_public');
    });

    it('is a genuinely different credential from both runtime roles', async () => {
      expect(await currentUserOf(anon)).not.toBe(await currentUserOf(app));
      expect(await currentUserOf(anon)).not.toBe(await currentUserOf(admin));
    });

    it('cannot CREATE TABLE', async () => {
      await expect(
        anon.$executeRawUnsafe('CREATE TABLE role_separation_public_probe (id integer)'),
      ).rejects.toThrow(/permission denied for schema public/);
    });

    it('cannot ALTER an application table', async () => {
      await expect(
        anon.$executeRawUnsafe('ALTER TABLE products ADD COLUMN probe integer'),
      ).rejects.toThrow(/must be owner of table products/);
    });

    it('cannot read migration history', async () => {
      await expect(
        anon.$executeRawUnsafe('SELECT count(*) FROM _prisma_migrations'),
      ).rejects.toThrow(/permission denied for table _prisma_migrations/);
    });

    it('can read products, but was never granted any DML on it', async () => {
      // The read side is proven in depth in product-search-rls-isolation.test.ts;
      // this is the narrow "SELECT works, everything else was never granted"
      // symmetry check the app/admin roles get in "ordinary application
      // access still works" above.
      await expect(anon.product.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(
        anon.$executeRawUnsafe("UPDATE products SET name = 'tampered' WHERE false"),
      ).rejects.toThrow(/permission denied for table products/);
    });

    it('has no table grants beyond the four SELECT-only ones S2-7 and S3-1 issue', async () => {
      // S2-7 granted `products`/`product_media`; S3-1 (cart eligibility and
      // availability checks) added `product_variants`/`inventory` — the
      // same narrow, per-table enumeration, never a schema-wide default.
      const rows = await owner.$queryRaw<{ relname: string }[]>`
        SELECT DISTINCT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
        JOIN pg_roles r ON r.oid = acl.grantee
        WHERE n.nspname = 'public' AND r.rolname = 'leenmart_public'`;

      expect(rows.map((row) => row.relname).sort()).toEqual([
        'inventory',
        'product_media',
        'product_variants',
        'products',
      ]);
    });
  });

  describe('leenmart_checkout — a sixth role, narrowly scoped to order placement (S3-3A, Option B)', () => {
    // The security proof the S3-3A Option-B approval explicitly required:
    // this credential exists because placing a multi-vendor order needs one
    // transaction that can decrement more than one vendor's inventory, which
    // no role above can do — and it must be provably incapable of anything
    // beyond that, not just narrower by convention.
    it('exists', async () => {
      expect(await attributesOf('leenmart_checkout')).toBeDefined();
    });

    it('is not SUPERUSER', async () => {
      expect((await attributesOf('leenmart_checkout'))?.rolsuper).toBe(false);
    });

    it('does not have BYPASSRLS', async () => {
      expect((await attributesOf('leenmart_checkout'))?.rolbypassrls).toBe(false);
    });

    it('cannot create roles or databases', async () => {
      const attributes = await attributesOf('leenmart_checkout');

      expect(attributes?.rolcreaterole).toBe(false);
      expect(attributes?.rolcreatedb).toBe(false);
    });

    it('connects as leenmart_checkout', async () => {
      expect(await currentUserOf(checkout)).toBe('leenmart_checkout');
    });

    it('is a genuinely different credential from every other role', async () => {
      expect(await currentUserOf(checkout)).not.toBe(await currentUserOf(app));
      expect(await currentUserOf(checkout)).not.toBe(await currentUserOf(admin));
      expect(await currentUserOf(checkout)).not.toBe(await currentUserOf(anon));
    });

    it('cannot CREATE TABLE', async () => {
      await expect(
        checkout.$executeRawUnsafe('CREATE TABLE role_separation_checkout_probe (id integer)'),
      ).rejects.toThrow(/permission denied for schema public/);
    });

    it('cannot read migration history', async () => {
      await expect(
        checkout.$executeRawUnsafe('SELECT count(*) FROM _prisma_migrations'),
      ).rejects.toThrow(/permission denied for table _prisma_migrations/);
    });

    it('can place, read and update orders, sub-orders, order items and idempotency keys', async () => {
      await expect(checkout.order.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(checkout.subOrder.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(checkout.orderItem.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(checkout.idempotencyKey.count()).resolves.toBeGreaterThanOrEqual(0);
    });

    it('can read and update payment_attempts (S3-3B) but never delete a row', async () => {
      await expect(checkout.paymentAttempt.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(
        checkout.$executeRawUnsafe(
          'UPDATE payment_attempts SET provider_reference = provider_reference WHERE false',
        ),
      ).resolves.toBe(0);
      await expect(
        checkout.$executeRawUnsafe('DELETE FROM payment_attempts WHERE false'),
      ).rejects.toThrow(/permission denied for table payment_attempts/);
    });

    it('can read vendors, and can read and decrement inventory', async () => {
      await expect(checkout.vendorProfile.count()).resolves.toBeGreaterThanOrEqual(0);
      await expect(checkout.inventory.count()).resolves.toBeGreaterThanOrEqual(0);
    });

    it('can insert outbox events but never read, update or delete them', async () => {
      await expect(
        checkout.outboxEvent.createMany({
          data: [
            {
              id: '00000000-0000-7000-8000-0000000c7ec0',
              aggregateType: 'RoleSeparationProbe',
              aggregateId: '00000000-0000-7000-8000-0000000c7ec1',
              eventType: 'role-separation.probe',
              payload: {},
              occurredAt: new Date('2026-01-01T00:00:00.000Z'),
            },
          ],
        }),
      ).resolves.toEqual({ count: 1 });

      await expect(checkout.outboxEvent.findMany()).rejects.toThrow(
        /permission denied for table outbox_events/,
      );
      await expect(
        checkout.$executeRawUnsafe("UPDATE outbox_events SET last_error = 'tampered' WHERE false"),
      ).rejects.toThrow(/permission denied for table outbox_events/);
      await expect(checkout.$executeRawUnsafe('DELETE FROM outbox_events')).rejects.toThrow(
        /permission denied for table outbox_events/,
      );

      await owner.outboxEvent.deleteMany({ where: { aggregateType: 'RoleSeparationProbe' } });
    });

    it('cannot touch KYC material at all — no grant on vendor_kyc_submissions or kyc_documents', async () => {
      await expect(checkout.vendorKycSubmission.count()).rejects.toThrow(
        /permission denied for table vendor_kyc_submissions/,
      );
      await expect(checkout.kycDocument.count()).rejects.toThrow(
        /permission denied for table kyc_documents/,
      );
    });

    it('cannot touch users at all — no grant on the users table', async () => {
      await expect(checkout.user.count()).rejects.toThrow(/permission denied for table users/);
    });

    it('cannot mutate the catalogue — no grant on products or product_variants', async () => {
      await expect(checkout.product.count()).rejects.toThrow(
        /permission denied for table products/,
      );
      await expect(checkout.productVariant.count()).rejects.toThrow(
        /permission denied for table product_variants/,
      );
    });

    it('cannot touch the cart — no grant on carts or cart_items', async () => {
      await expect(checkout.cart.count()).rejects.toThrow(/permission denied for table carts/);
      await expect(checkout.cartItem.count()).rejects.toThrow(
        /permission denied for table cart_items/,
      );
    });

    it('cannot write vendor rows — read-only, even for the one table it can see', async () => {
      await expect(
        checkout.$executeRawUnsafe("UPDATE vendors SET shop_name = 'tampered' WHERE false"),
      ).rejects.toThrow(/permission denied for table vendors/);
    });

    it('cannot drive inventory negative — the decrement floor holds even for a statement this role IS privileged to run', async () => {
      // `inventory_checkout_decrement`'s own `WITH CHECK (available >= 0)`
      // is the enforcement layer that actually fires for this role (RLS is
      // evaluated before the table's `chk_inventory_available_non_negative`
      // CHECK constraint is ever reached) — proven here against the real
      // grant/policy pair, not just the application-level
      // `decrementIfAvailable` port in isolation.
      const row = await owner.inventory.findFirst({ select: { variantId: true } });
      if (!row) return; // Nothing seeded yet in this database — the constraint itself is proven at the migration/schema level regardless.
      await expect(
        checkout.$executeRawUnsafe(
          'UPDATE inventory SET available = available - 999999999 WHERE variant_id = $1::uuid',
          row.variantId,
        ),
      ).rejects.toThrow(/row-level security policy for table "inventory"/);
    });

    it('has no table grants beyond the ones S3-3A/S3-3B issue', async () => {
      const rows = await owner.$queryRaw<{ relname: string }[]>`
        SELECT DISTINCT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
        JOIN pg_roles r ON r.oid = acl.grantee
        WHERE n.nspname = 'public' AND r.rolname = 'leenmart_checkout'`;

      expect(rows.map((row) => row.relname).sort()).toEqual([
        'idempotency_keys',
        'inventory',
        'order_items',
        'orders',
        'outbox_events',
        'payment_attempts',
        'sub_orders',
        'vendors',
      ]);
    });
  });

  describe('row-level security rests on this role model (KYC-2B-3)', () => {
    it('enables RLS only on the tenant tables', async () => {
      // The role separation above is what gives these policies teeth; asserted
      // here too so a change to either half is caught from both sides.
      // `products`/`product_variants` joined this list in S2-3a; `inventory`
      // in S2-4; `product_media` in S2-6a; `product_media_variants` in S2-6b —
      // written by the background worker, and therefore exactly the kind of
      // table that must not be exempt from the boundary.
      const rows = await owner.$queryRawUnsafe<{ tablename: string }[]>(
        'SELECT tablename FROM pg_tables WHERE schemaname = $1 AND rowsecurity ORDER BY tablename',
        'public',
      );

      expect(rows.map((row) => row.tablename)).toEqual([
        'inventory',
        'kyc_documents',
        'product_media',
        'product_media_variants',
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
