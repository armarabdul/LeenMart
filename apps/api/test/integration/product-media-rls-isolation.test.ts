import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';

/**
 * Row-level security isolation for `product_media` (S2-6a), the same
 * discipline `product-rls-isolation.test.ts` established for
 * `products`/`product_variants` — in its own file for the same reason: one
 * new tenant-scoped table, one focused suite.
 *
 * Connects as `leenmart_app` and `leenmart_admin` rather than through
 * Prisma's default datasource: the owner is SUPERUSER with BYPASSRLS and
 * would prove nothing.
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

describe('product_media RLS isolation (S2-6a)', () => {
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
  const mediaA = ids.generate();
  const mediaB = ids.generate();
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

  const countMedia = async (tx: PrismaClient, where: string, value: string): Promise<number> => {
    const rows = await tx.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM product_media WHERE ${where} = $1::uuid`,
      value,
    );
    return Number(rows[0]?.count ?? -1);
  };

  beforeAll(async () => {
    const stamp = Date.now();
    await owner.user.createMany({
      data: [
        { id: userA, email: `product-media-rls-a-${stamp}@example.com` },
        { id: userB, email: `product-media-rls-b-${stamp}@example.com` },
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
        name: `product-media-rls-${stamp}`,
        slug: `product-media-rls-${stamp}`,
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
    await owner.productMedia.createMany({
      data: [
        {
          id: mediaA,
          productId: productA,
          vendorId: vendorA,
          objectKey: `product-media/${vendorA}/${productA}/a.jpg`,
          contentType: 'image/jpeg',
          sizeBytes: 1024,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: mediaB,
          productId: productB,
          vendorId: vendorB,
          objectKey: `product-media/${vendorB}/${productB}/b.jpg`,
          contentType: 'image/jpeg',
          sizeBytes: 1024,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
  });

  afterAll(async () => {
    await owner.productMedia.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await owner.product.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await owner.category.deleteMany({ where: { id: categoryId } });
    await owner.vendorProfile.deleteMany({ where: { id: { in: [vendorA, vendorB] } } });
    await owner.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await Promise.all([owner.$disconnect(), app.$disconnect(), admin.$disconnect()]);
  });

  describe('RLS is enabled and enforced', () => {
    it('has row security on product_media', async () => {
      const rows = await owner.$queryRaw<{ tablename: string; rowsecurity: boolean }[]>`
        SELECT tablename, rowsecurity FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'product_media'`;

      expect(rows).toHaveLength(1);
      expect(rows[0]?.rowsecurity).toBe(true);
    });

    it('forces RLS on no one, so the owner can still migrate', async () => {
      const rows = await owner.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = 'product_media'
          AND c.relforcerowsecurity`;

      expect(Number(rows[0]?.count)).toBe(0);
    });
  });

  describe('no context sees nothing', () => {
    it('returns zero rows with neither setting', async () => {
      const rows = await asApp({}, (tx) =>
        tx.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) AS count FROM product_media`),
      );

      expect(Number(rows[0]?.count)).toBe(0);
    });
  });

  describe('vendor isolation', () => {
    it('lets vendor A see their own media', async () => {
      const count = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        countMedia(tx, 'id', mediaA),
      );

      expect(count).toBe(1);
    });

    it('does not let vendor A see vendor B’s media', async () => {
      const count = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        countMedia(tx, 'id', mediaB),
      );

      expect(count).toBe(0);
    });

    it('does not let vendor A update vendor B’s media', async () => {
      const affected = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$executeRawUnsafe(
          `UPDATE product_media SET content_type = 'image/png' WHERE id = $1::uuid`,
          mediaB,
        ),
      );

      expect(affected).toBe(0);
      const stillJpeg = await owner.productMedia.findUnique({ where: { id: mediaB } });
      expect(stillJpeg?.contentType).toBe('image/jpeg');
    });

    it('does not let vendor A delete vendor B’s media — or their own', async () => {
      // No DELETE policy at all; its absence is the control.
      const affectedOther = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM product_media WHERE id = $1::uuid`, mediaB),
      );
      const affectedOwn = await asApp({ userId: userA, vendorId: vendorA }, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM product_media WHERE id = $1::uuid`, mediaA),
      );

      expect(affectedOther).toBe(0);
      expect(affectedOwn).toBe(0);
      expect(await owner.productMedia.findUnique({ where: { id: mediaB } })).not.toBeNull();
      expect(await owner.productMedia.findUnique({ where: { id: mediaA } })).not.toBeNull();
    });

    it('refuses vendor A inserting media under vendor B’s id', async () => {
      await expect(
        asApp({ userId: userA, vendorId: vendorA }, (tx) =>
          tx.$executeRawUnsafe(
            `INSERT INTO product_media (id, product_id, vendor_id, object_key, content_type, size_bytes, updated_at)
             VALUES ($1::uuid, $2::uuid, $3::uuid, 'forged/key.jpg', 'image/jpeg', 1024, now())`,
            ids.generate(),
            productB,
            vendorB,
          ),
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  describe('leenmart_admin — read across every vendor, write nothing (no admin media surface in S2-6a)', () => {
    it('reads across every vendor', async () => {
      const rows = await admin.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM product_media WHERE id IN (${mediaA}::uuid, ${mediaB}::uuid)`;

      expect(Number(rows[0]?.count)).toBe(2);
    });

    it('cannot update a media row — no admin write policy exists', async () => {
      const affected = await admin.$executeRawUnsafe(
        `UPDATE product_media SET content_type = 'image/png' WHERE id = $1::uuid`,
        mediaA,
      );

      expect(affected).toBe(0);
      const unchanged = await owner.productMedia.findUnique({ where: { id: mediaA } });
      expect(unchanged?.contentType).toBe('image/jpeg');
    });

    it('cannot insert a media row', async () => {
      const affected = await admin.$executeRawUnsafe(
        `INSERT INTO product_media (id, product_id, vendor_id, object_key, content_type, size_bytes, updated_at)
         SELECT $1::uuid, $2::uuid, $3::uuid, 'admin-insert.jpg', 'image/jpeg', 1024, now() WHERE false`,
        ids.generate(),
        productA,
        vendorA,
      );

      expect(affected).toBe(0);
    });

    it('still has no BYPASSRLS', async () => {
      const rows = await owner.$queryRaw<{ rolbypassrls: boolean }[]>`
        SELECT rolbypassrls FROM pg_roles WHERE rolname = 'leenmart_admin'`;

      expect(rows[0]?.rolbypassrls).toBe(false);
    });
  });

  describe('composite foreign key (S2-6a)', () => {
    it('refuses inserting media whose vendor_id does not match its product’s, even as the owner', async () => {
      // The strongest possible proof: this runs on the owner connection,
      // which bypasses RLS entirely — so a rejection here can only come from
      // the composite foreign key itself, not from policy enforcement.
      await expect(
        owner.$executeRawUnsafe(
          `INSERT INTO product_media (id, product_id, vendor_id, object_key, content_type, size_bytes, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'cross-vendor.jpg', 'image/jpeg', 1024, now())`,
          ids.generate(),
          productA,
          vendorB,
        ),
      ).rejects.toThrow(/product_media_product_id_vendor_id_fkey/);
    });
  });
});
