import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';

/**
 * Row-level security isolation for the `leenmart_public` role (S2-7) — the
 * exact discipline `product-rls-isolation.test.ts`/`product-media-rls-isolation.test.ts`
 * established for `leenmart_app`/`leenmart_admin`, proven here for the third
 * runtime credential.
 *
 * Unlike those two, this role's policies are **static** — `USING (status =
 * ... AND deleted_at IS NULL)`, no session GUC — so there is no `asApp`-style
 * helper here setting `app.vendor_id`; every query below runs on a plain
 * connection and the policy alone decides what comes back.
 *
 * Connects as `leenmart_public` rather than through Prisma's default
 * datasource: the owner is SUPERUSER with BYPASSRLS and would prove nothing.
 */
const requireUrl = (name: 'DATABASE_URL' | 'PUBLIC_DATABASE_URL'): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} must be set for the RLS suite. Run \`pnpm db:migrate:deploy && pnpm db:provision-roles\`.`,
    );
  }
  return value;
};

describe('leenmart_public RLS isolation (S2-7)', () => {
  const ownerUrl = requireUrl('DATABASE_URL');
  const owner = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
  const anon = new PrismaClient({
    datasources: { db: { url: requireUrl('PUBLIC_DATABASE_URL') } },
  });
  const ids = new UuidV7Generator();

  const userId = ids.generate();
  const vendorId = ids.generate();
  const categoryId = ids.generate();
  const draftProductId = ids.generate();
  const pendingProductId = ids.generate();
  const approvedProductId = ids.generate();
  const rejectedProductId = ids.generate();
  const deletedApprovedProductId = ids.generate();
  const readyMediaId = ids.generate();
  const awaitingUploadMediaId = ids.generate();
  const deletedReadyMediaId = ids.generate();
  const now = new Date('2026-01-01T00:00:00.000Z');

  const countProducts = async (where: string, value: string): Promise<number> => {
    const rows = await anon.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) AS count FROM products WHERE ${where} = $1::uuid`,
      value,
    );
    return Number(rows[0]?.count ?? -1);
  };

  beforeAll(async () => {
    const stamp = Date.now();
    await owner.user.create({
      data: { id: userId, email: `product-search-rls-${stamp}@example.com` },
    });
    await owner.vendorProfile.create({
      data: { id: vendorId, userId, createdAt: now, updatedAt: now },
    });
    await owner.category.create({
      data: {
        id: categoryId,
        path: [],
        depth: 1,
        name: `product-search-rls-${stamp}`,
        slug: `product-search-rls-${stamp}`,
        createdAt: now,
        updatedAt: now,
      },
    });
    await owner.product.createMany({
      data: [
        {
          id: draftProductId,
          vendorId,
          categoryId,
          name: 'Draft product',
          attributeValues: {},
          status: 'DRAFT',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: pendingProductId,
          vendorId,
          categoryId,
          name: 'Pending product',
          attributeValues: {},
          status: 'PENDING_REVIEW',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: approvedProductId,
          vendorId,
          categoryId,
          name: 'Approved product',
          attributeValues: {},
          status: 'APPROVED',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: rejectedProductId,
          vendorId,
          categoryId,
          name: 'Rejected product',
          attributeValues: {},
          status: 'REJECTED',
          rejectionReason: 'OTHER',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: deletedApprovedProductId,
          vendorId,
          categoryId,
          name: 'Deleted approved product',
          attributeValues: {},
          status: 'APPROVED',
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        },
      ],
    });
    await owner.productMedia.createMany({
      data: [
        {
          id: readyMediaId,
          productId: approvedProductId,
          vendorId,
          objectKey: `product-media/${vendorId}/${approvedProductId}/ready.jpg`,
          contentType: 'image/jpeg',
          sizeBytes: 1024,
          status: 'READY',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: awaitingUploadMediaId,
          productId: approvedProductId,
          vendorId,
          objectKey: `product-media/${vendorId}/${approvedProductId}/pending.jpg`,
          contentType: 'image/jpeg',
          sizeBytes: 1024,
          status: 'AWAITING_UPLOAD',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: deletedReadyMediaId,
          productId: approvedProductId,
          vendorId,
          objectKey: `product-media/${vendorId}/${approvedProductId}/deleted.jpg`,
          contentType: 'image/jpeg',
          sizeBytes: 1024,
          status: 'READY',
          createdAt: now,
          updatedAt: now,
          deletedAt: now,
        },
      ],
    });
  });

  afterAll(async () => {
    await owner.productMedia.deleteMany({ where: { vendorId } });
    await owner.product.deleteMany({ where: { vendorId } });
    await owner.category.deleteMany({ where: { id: categoryId } });
    await owner.vendorProfile.deleteMany({ where: { id: vendorId } });
    await owner.user.deleteMany({ where: { id: userId } });
    await Promise.all([owner.$disconnect(), anon.$disconnect()]);
  });

  describe('read visibility on products', () => {
    it('sees the APPROVED, non-deleted product', async () => {
      expect(await countProducts('id', approvedProductId)).toBe(1);
    });

    it('does not see a DRAFT product', async () => {
      expect(await countProducts('id', draftProductId)).toBe(0);
    });

    it('does not see a PENDING_REVIEW product', async () => {
      expect(await countProducts('id', pendingProductId)).toBe(0);
    });

    it('does not see a REJECTED product', async () => {
      expect(await countProducts('id', rejectedProductId)).toBe(0);
    });

    it('does not see a soft-deleted APPROVED product', async () => {
      expect(await countProducts('id', deletedApprovedProductId)).toBe(0);
    });

    it('sees exactly one row for this vendor across all five fixture products', async () => {
      expect(await countProducts('vendor_id', vendorId)).toBe(1);
    });
  });

  describe('read visibility on product_media', () => {
    it('sees the READY, non-deleted media row', async () => {
      const rows = await anon.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM product_media WHERE id = $1::uuid`,
        readyMediaId,
      );
      expect(Number(rows[0]?.count)).toBe(1);
    });

    it('does not see an AWAITING_UPLOAD media row', async () => {
      const rows = await anon.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM product_media WHERE id = $1::uuid`,
        awaitingUploadMediaId,
      );
      expect(Number(rows[0]?.count)).toBe(0);
    });

    it('does not see a soft-deleted READY media row', async () => {
      const rows = await anon.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM product_media WHERE id = $1::uuid`,
        deletedReadyMediaId,
      );
      expect(Number(rows[0]?.count)).toBe(0);
    });

    it('counts exactly one visible media row for the approved product', async () => {
      const rows = await anon.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM product_media WHERE product_id = $1::uuid`,
        approvedProductId,
      );
      expect(Number(rows[0]?.count)).toBe(1);
    });
  });

  describe('no write access at all — SELECT-only by grant, not merely by policy', () => {
    it('refuses to insert a product', async () => {
      await expect(
        anon.$executeRawUnsafe(
          `INSERT INTO products (id, vendor_id, category_id, name, attribute_values, status, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'forged', '{}'::jsonb, 'APPROVED', now(), now())`,
          ids.generate(),
          vendorId,
          categoryId,
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('refuses to update the very row it is allowed to read', async () => {
      await expect(
        anon.$executeRawUnsafe(
          `UPDATE products SET name = 'hijacked' WHERE id = $1::uuid`,
          approvedProductId,
        ),
      ).rejects.toThrow(/permission denied/);

      const stillNamed = await owner.product.findUnique({ where: { id: approvedProductId } });
      expect(stillNamed?.name).toBe('Approved product');
    });

    it('refuses to delete the very row it is allowed to read', async () => {
      await expect(
        anon.$executeRawUnsafe(`DELETE FROM products WHERE id = $1::uuid`, approvedProductId),
      ).rejects.toThrow(/permission denied/);

      expect(await owner.product.findUnique({ where: { id: approvedProductId } })).not.toBeNull();
    });

    it('refuses to insert product_media', async () => {
      await expect(
        anon.$executeRawUnsafe(
          `INSERT INTO product_media (id, product_id, vendor_id, object_key, content_type, size_bytes, status, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'forged.jpg', 'image/jpeg', 1, 'READY', now(), now())`,
          ids.generate(),
          approvedProductId,
          vendorId,
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('privilege posture', () => {
    it('has no BYPASSRLS', async () => {
      const rows = await owner.$queryRaw<{ rolbypassrls: boolean }[]>`
        SELECT rolbypassrls FROM pg_roles WHERE rolname = 'leenmart_public'`;

      expect(rows[0]?.rolbypassrls).toBe(false);
    });

    it('is not a superuser', async () => {
      const rows = await owner.$queryRaw<{ rolsuper: boolean }[]>`
        SELECT rolsuper FROM pg_roles WHERE rolname = 'leenmart_public'`;

      expect(rows[0]?.rolsuper).toBe(false);
    });

    it('is excluded from ALTER DEFAULT PRIVILEGES — a table added later grants it nothing automatically', async () => {
      // Least-privilege by construction (S2-7 final approval): unlike
      // leenmart_app/leenmart_admin, this role's grants are enumerated per
      // table in the migration, never inherited from a schema-wide default.
      // Read straight from the catalog (`pg_class.relacl` via `aclexplode`)
      // rather than `information_schema`, which restricts what it shows to
      // "currently enabled roles" and would make this assertion depend on
      // exactly which role is asking.
      const rows = await owner.$queryRaw<{ relname: string }[]>`
        SELECT DISTINCT c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN LATERAL aclexplode(c.relacl) AS acl
        JOIN pg_roles r ON r.oid = acl.grantee
        WHERE n.nspname = 'public' AND r.rolname = 'leenmart_public' AND acl.privilege_type = 'SELECT'`;

      // Exactly the four SELECT grants issued so far: S2-7's `products` and
      // `product_media`, plus S3-1's `product_variants` and `inventory`
      // (cart eligibility/availability checks) — nothing else.
      expect(rows.map((row) => row.relname).sort()).toEqual([
        'inventory',
        'preorder_campaigns',
        'product_media',
        'product_variants',
        'products',
        'reviews',
      ]);
    });
  });
});
