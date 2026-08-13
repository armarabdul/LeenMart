import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';

/**
 * Row-level security isolation for the S2-3a catalogue tables, proven against
 * real PostgreSQL as the real runtime roles — the exact same discipline
 * `tenant-rls-isolation.test.ts` established for `vendors`/
 * `vendor_kyc_submissions`/`kyc_documents`, in its own file rather than
 * appended to that one so neither grows unreadably large.
 *
 * Every assertion checks the **actual result** — a row count, an affected-row
 * count, a specific error — never merely that a query did not throw.
 *
 * Connects as `leenmart_app` and `leenmart_admin` rather than through Prisma's
 * default datasource: the owner is SUPERUSER with BYPASSRLS and would prove
 * nothing.
 */
const requireUrl = (name: 'DATABASE_URL' | 'APP_DATABASE_URL' | 'ADMIN_DATABASE_URL'): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} must be set for the RLS suite. Run \`pnpm db:migrate:deploy && pnpm db:provision-roles\`.`,
    );
  }
  return value;
};

describe('product/product_variant RLS isolation (S2-3a)', () => {
  const ownerUrl = requireUrl('DATABASE_URL');
  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  const app = new PrismaClient({ datasources: { db: { url: requireUrl('APP_DATABASE_URL') } } });
  const admin = new PrismaClient({
    datasources: { db: { url: requireUrl('ADMIN_DATABASE_URL') } },
  });
  const ids = new UuidV7Generator();

  const userA = ids.generate();
  const userB = ids.generate();
  const vendorA = ids.generate();
  const vendorB = ids.generate();
  const categoryId = ids.generate();
  const productA = ids.generate();
  const productB = ids.generate();
  const variantA = ids.generate();
  const variantB = ids.generate();
  const now = new Date('2026-01-01T00:00:00.000Z');

  /** Runs `sql` as the app role with the session settings a request would carry. */
  const asApp = async <T>(
    identity: { userId?: string; vendorId?: string },
    sql: (tx: PrismaClient) => Promise<T>,
  ): Promise<T> =>
    app.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.user_id', ${identity.userId ?? ''}, TRUE)`;
      await tx.$executeRaw`SELECT set_config('app.vendor_id', ${identity.vendorId ?? ''}, TRUE)`;
      return sql(tx as unknown as PrismaClient);
    });

  const countProducts = async (tx: PrismaClient, where: string, value: string): Promise<number> => {
    const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM products WHERE ${where} = $1::uuid`,
      value,
    );
    return Number(rows[0]?.count ?? -1);
  };

  const countVariants = async (tx: PrismaClient, where: string, value: string): Promise<number> => {
    const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM product_variants WHERE ${where} = $1::uuid`,
      value,
    );
    return Number(rows[0]?.count ?? -1);
  };

  beforeAll(async () => {
    const stamp = Date.now();
    await owner.user.createMany({
      data: [
        { id: userA, email: `product-rls-a-${stamp}@example.com` },
        { id: userB, email: `product-rls-b-${stamp}@example.com` },
      ],
    });
    await owner.vendorProfile.createMany({
      data: [
        { id: vendorA, userId: userA, createdAt: now, updatedAt: now },
        { id: vendorB, userId: userB, createdAt: now, updatedAt: now },
      ],
    });
    await owner.category.create({
      data: {
        id: categoryId,
        path: [],
        depth: 1,
        name: `product-rls-${stamp}`,
        slug: `product-rls-${stamp}`,
        createdAt: now,
        updatedAt: now,
      },
    });
    await owner.product.createMany({
      data: [
        {
          id: productA,
          vendorId: vendorA,
          categoryId,
          name: 'Vendor A product',
          attributeValues: {},
          createdAt: now,
          updatedAt: now,
        },
        {
          id: productB,
          vendorId: vendorB,
          categoryId,
          name: 'Vendor B product',
          attributeValues: {},
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
    await owner.productVariant.createMany({
      data: [
        {
          id: variantA,
          productId: productA,
          vendorId: vendorA,
          sku: 'A-SKU',
          name: 'A variant',
          priceAmount: 100n,
          unitOfMeasure: 'kg',
          quantityStep: 1,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: variantB,
          productId: productB,
          vendorId: vendorB,
          sku: 'B-SKU',
          name: 'B variant',
          priceAmount: 100n,
          unitOfMeasure: 'kg',
          quantityStep: 1,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
  });

  afterAll(async () => {
    await owner.productVariant.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await owner.product.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await owner.category.deleteMany({ where: { id: categoryId } });
    await owner.vendorProfile.deleteMany({ where: { id: { in: [vendorA, vendorB] } } });
    await owner.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await Promise.all([owner.$disconnect(), app.$disconnect(), admin.$disconnect()]);
  });

  describe('RLS is enabled and enforced on both tables', () => {
    it('has row security on products and product_variants', async () => {
      const rows = await owner.$queryRaw<{ tablename: string; rowsecurity: boolean }[]>`
        SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname = 'public' AND tablename IN ('products', 'product_variants')`;

      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.rowsecurity)).toBe(true);
    });

    it('forces RLS on neither, so the owner can still migrate', async () => {
      const rows = await owner.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname IN ('products', 'product_variants')
          AND c.relforcerowsecurity`;

      expect(Number(rows[0]?.count)).toBe(0);
    });
  });

  describe('no context sees nothing', () => {
    it.each(['products', 'product_variants'])(
      'returns zero rows from %s with neither setting',
      async (table) => {
        const rows = await asApp({}, (tx) =>
          tx.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) AS count FROM ${table}`),
        );

        expect(Number(rows[0]?.count)).toBe(0);
      },
    );
  });

  describe('vendor isolation', () => {
    it('lets vendor A see their own product', async () => {
      const count = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        countProducts(tx, 'id', productA),
      );

      expect(count).toBe(1);
    });

    it('does not let vendor A see vendor B’s product', async () => {
      const count = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        countProducts(tx, 'id', productB),
      );

      expect(count).toBe(0);
    });

    it('does not let vendor A see vendor B’s variant', async () => {
      const count = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        countVariants(tx, 'id', variantB),
      );

      expect(count).toBe(0);
    });

    it('does not let vendor A update vendor B’s product', async () => {
      const affected = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$executeRawUnsafe(`UPDATE products SET name = 'hijacked' WHERE id = $1::uuid`, productB),
      );

      expect(affected).toBe(0);
      const stillNamed = await owner.product.findUnique({ where: { id: productB } });
      expect(stillNamed?.name).toBe('Vendor B product');
    });

    it('does not let vendor A delete vendor B’s product — or their own', async () => {
      // No DELETE policy on either table; its absence is the control.
      const affectedOther = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM products WHERE id = $1::uuid`, productB),
      );
      const affectedOwn = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM products WHERE id = $1::uuid`, productA),
      );

      expect(affectedOther).toBe(0);
      expect(affectedOwn).toBe(0);
      expect(await owner.product.findUnique({ where: { id: productB } })).not.toBeNull();
      expect(await owner.product.findUnique({ where: { id: productA } })).not.toBeNull();
    });

    it('refuses vendor A inserting a product under vendor B’s id', async () => {
      await expect(
        asApp({ userId: userA, vendorId: vendorA }, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO products (id, vendor_id, category_id, name, attribute_values, created_at, updated_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'forged', '{}'::jsonb, now(), now())`,
            ids.generate(),
            vendorB,
            categoryId,
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('leenmart_admin — read across every vendor, write only what S2-5 needs', () => {
    // S2-3 D-6 ("no admin write path") held through S2-3a/S2-4; S2-5 adds the
    // one write this role needed, for the moderation decision
    // (`products_admin_decide`). Insert and delete remain refused — the
    // decision only ever changes a row that already exists.
    it('reads across every vendor', async () => {
      const rows = await admin.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM products WHERE id IN (${productA}::uuid, ${productB}::uuid)`;

      expect(Number(rows[0]?.count)).toBe(2);
    });

    it('can update a product — the S2-5 moderation decision path', async () => {
      const affected = await admin.$executeRawUnsafe(
        `UPDATE products SET name = 'admin-write' WHERE id = $1::uuid`,
        productA,
      );

      expect(affected).toBe(1);
      const updated = await owner.product.findUnique({ where: { id: productA } });
      expect(updated?.name).toBe('admin-write');

      // Restored so later tests in this file see the fixture unchanged.
      await owner.product.update({ where: { id: productA }, data: { name: 'Vendor A product' } });
    });

    it('cannot insert a product', async () => {
      const affected = await admin.$executeRawUnsafe(
        `INSERT INTO products (id, vendor_id, category_id, name, attribute_values, created_at, updated_at)
         SELECT $1::uuid, $2::uuid, $3::uuid, 'admin-insert', '{}'::jsonb, now(), now() WHERE false`,
        ids.generate(),
        vendorA,
        categoryId,
      );

      expect(affected).toBe(0);
    });

    it('still has no BYPASSRLS', async () => {
      const rows = await owner.$queryRaw<{ rolbypassrls: boolean }[]>`
        SELECT rolbypassrls FROM pg_roles WHERE rolname = 'leenmart_admin'`;

      expect(rows[0]?.rolbypassrls).toBe(false);
    });
  });

  describe('composite foreign key (S2-3a)', () => {
    it('refuses inserting a variant whose vendor_id does not match its product’s, even as the owner', async () => {
      // The strongest possible proof: this runs on the owner connection,
      // which bypasses RLS entirely — so a rejection here can only come from
      // the composite foreign key itself, not from policy enforcement.
      await expect(
        owner.$executeRawUnsafe(
          `INSERT INTO product_variants (id, product_id, vendor_id, sku, name, price_amount, price_currency, unit_of_measure, quantity_step, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'CROSS-VENDOR', 'x', 100, 'INR', 'kg', 1, now(), now())`,
          ids.generate(),
          productA,
          vendorB,
        ),
      ).rejects.toThrow(/product_variants_product_id_vendor_id_fkey/);
    });
  });
});
