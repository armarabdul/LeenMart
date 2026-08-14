import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { runWithTenant } from '../../src/shared/infrastructure/persistence/tenant-context.js';
import { withTenantBoundary } from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import { PrismaProductMediaVariantRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-media-variant.repository.js';
import {
  ProductMediaVariant,
  type ProductMediaVariantFormat,
  type ProductMediaVariantWidth,
} from '../../src/modules/catalogue/domain/entities/product-media-variant.entity.js';
import { toProductMediaId } from '../../src/modules/catalogue/domain/value-objects/product-media-id.value-object.js';
import { toProductMediaVariantId } from '../../src/modules/catalogue/domain/value-objects/product-media-variant-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const requireUrl = (name: 'DATABASE_URL' | 'APP_DATABASE_URL' | 'ADMIN_DATABASE_URL'): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} must be set for this suite. Run \`pnpm db:migrate:deploy && pnpm db:provision-roles\`.`,
    );
  }
  return value;
};

/**
 * `product_media_variants` against real PostgreSQL (S2-6b).
 *
 * The half of the design that only exists in the database: the three `CHECK`
 * constraints the migration adds, the composite foreign key pinning
 * `vendor_id` to the parent media row's, the unique index the worker's
 * idempotency rests on — including the concurrent case, which is the one that
 * decides whether "the database is the arbiter" is true — and the RLS
 * policies, exercised on `leenmart_app` and `leenmart_admin` rather than the
 * owner, which is SUPERUSER and would prove nothing.
 */
describe('PrismaProductMediaVariantRepository', () => {
  const owner = new PrismaClient({ datasources: { db: { url: requireUrl('DATABASE_URL') } } });
  const app = new PrismaClient({ datasources: { db: { url: requireUrl('APP_DATABASE_URL') } } });
  const admin = new PrismaClient({
    datasources: { db: { url: requireUrl('ADMIN_DATABASE_URL') } },
  });
  const tenant = withTenantBoundary(app);
  const repository = new PrismaProductMediaVariantRepository(tenant);
  const ids = new UuidV7Generator();

  const userA = toUserId(ids.generate());
  const userB = toUserId(ids.generate());
  const vendorA = toVendorId(ids.generate());
  const vendorB = toVendorId(ids.generate());
  const categoryId = ids.generate();
  const productA = ids.generate();
  const productB = ids.generate();
  const mediaA = ids.generate();
  const mediaB = ids.generate();
  const now = new Date('2026-01-01T00:00:00.000Z');

  const asA = <T>(work: () => Promise<T>): Promise<T> =>
    runWithTenant({ userId: userA, vendorId: vendorA }, work);

  const variant = (options: {
    mediaId?: string;
    vendorId?: typeof vendorA;
    width?: ProductMediaVariantWidth;
    format?: ProductMediaVariantFormat;
    objectKey?: string;
    sizeBytes?: number;
  }): ProductMediaVariant =>
    ProductMediaVariant.create({
      id: toProductMediaVariantId(ids.generate()),
      mediaId: toProductMediaId(options.mediaId ?? mediaA),
      vendorId: options.vendorId ?? vendorA,
      width: options.width ?? 800,
      format: options.format ?? 'WEBP',
      objectKey: options.objectKey ?? `derived/${ids.generate()}.webp`,
      sizeBytes: options.sizeBytes ?? 1234,
      now,
    });

  /** A fresh media row, so each test's uniqueness assertions stand alone. */
  const seedMedia = async (vendorId = vendorA): Promise<string> => {
    const id = ids.generate();
    await owner.productMedia.create({
      data: {
        id,
        productId: vendorId === vendorA ? productA : productB,
        vendorId,
        objectKey: `product-media/${vendorId}/${id}/original`,
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        status: 'PROCESSING',
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  };

  const rawInsert = (columns: {
    mediaId: string;
    vendorId: string;
    width: number;
    objectKey: string;
    sizeBytes: number;
  }): Promise<number> =>
    owner.$executeRawUnsafe(
      `INSERT INTO product_media_variants (id, media_id, vendor_id, width, format, object_key, size_bytes)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'WEBP', $5, $6)`,
      ids.generate(),
      columns.mediaId,
      columns.vendorId,
      columns.width,
      columns.objectKey,
      columns.sizeBytes,
    );

  beforeAll(async () => {
    const stamp = Date.now();
    await owner.user.createMany({
      data: [
        { id: userA, email: `pmv-repo-a-${stamp}@example.com` },
        { id: userB, email: `pmv-repo-b-${stamp}@example.com` },
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
        name: `pmv-repo-${stamp}`,
        slug: `pmv-repo-${stamp}`,
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
          name: 'A',
          attributeValues: {},
          createdAt: now,
          updatedAt: now,
        },
        {
          id: productB,
          vendorId: vendorB,
          categoryId,
          name: 'B',
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
          objectKey: `product-media/${vendorA}/${productA}/${mediaA}/original`,
          contentType: 'image/jpeg',
          sizeBytes: 1024,
          status: 'PROCESSING',
          createdAt: now,
          updatedAt: now,
        },
        {
          id: mediaB,
          productId: productB,
          vendorId: vendorB,
          objectKey: `product-media/${vendorB}/${productB}/${mediaB}/original`,
          contentType: 'image/jpeg',
          sizeBytes: 1024,
          status: 'PROCESSING',
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
  });

  afterAll(async () => {
    await owner.productMediaVariant.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await owner.productMedia.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await owner.product.deleteMany({ where: { vendorId: { in: [vendorA, vendorB] } } });
    await owner.category.deleteMany({ where: { id: categoryId } });
    await owner.vendorProfile.deleteMany({ where: { id: { in: [vendorA, vendorB] } } });
    await owner.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await Promise.all([owner.$disconnect(), app.$disconnect(), admin.$disconnect()]);
  });

  describe('round trip', () => {
    it('stores and reads back a variant', async () => {
      const mediaId = await seedMedia();

      await asA(() => repository.createIfAbsent(variant({ mediaId, width: 400, format: 'AVIF' })));
      const found = await asA(() => repository.listByMediaId(toProductMediaId(mediaId)));

      expect(found).toHaveLength(1);
      expect(found[0]?.width).toBe(400);
      expect(found[0]?.format).toBe('AVIF');
      expect(found[0]?.vendorId).toBe(vendorA);
    });

    it('orders by width then format, deterministically — format by its enum declaration order', async () => {
      const mediaId = await seedMedia();
      const pairs: [ProductMediaVariantWidth, ProductMediaVariantFormat][] = [
        [1600, 'WEBP'],
        [200, 'WEBP'],
        [800, 'AVIF'],
        [200, 'AVIF'],
      ];
      await asA(async () => {
        for (const [width, format] of pairs) {
          // ordering assertion; insert order is the point.
          await repository.createIfAbsent(variant({ mediaId, width, format }));
        }
      });

      const found = await asA(() => repository.listByMediaId(toProductMediaId(mediaId)));

      // PostgreSQL sorts a native enum by the order its values were declared,
      // not alphabetically — `ProductMediaVariantFormat` is `('WEBP',
      // 'AVIF')`, so WEBP sorts first. Still fully deterministic, which is
      // the property this asserts; the specific order is the database's.
      expect(found.map((v) => `${v.width}:${v.format}`)).toEqual([
        '200:WEBP',
        '200:AVIF',
        '800:AVIF',
        '1600:WEBP',
      ]);
    });

    it('counts without reading every column', async () => {
      const mediaId = await seedMedia();
      await asA(() => repository.createIfAbsent(variant({ mediaId })));
      await asA(() => repository.createIfAbsent(variant({ mediaId, format: 'AVIF' })));

      expect(await asA(() => repository.countByMediaId(toProductMediaId(mediaId)))).toBe(2);
    });

    it('returns nothing for a media item with no variants yet', async () => {
      const mediaId = await seedMedia();

      expect(await asA(() => repository.listByMediaId(toProductMediaId(mediaId)))).toEqual([]);
    });
  });

  describe('createIfAbsent — the worker’s idempotency guard', () => {
    it('reports true the first time and false the second', async () => {
      const mediaId = await seedMedia();

      const first = await asA(() => repository.createIfAbsent(variant({ mediaId })));
      const second = await asA(() => repository.createIfAbsent(variant({ mediaId })));

      expect(first).toBe(true);
      expect(second).toBe(false);
    });

    it('leaves exactly one row for a repeated pair, even with a fresh id each time', async () => {
      const mediaId = await seedMedia();

      await asA(() => repository.createIfAbsent(variant({ mediaId })));
      await asA(() => repository.createIfAbsent(variant({ mediaId })));
      await asA(() => repository.createIfAbsent(variant({ mediaId })));

      expect(await owner.productMediaVariant.count({ where: { mediaId } })).toBe(1);
    });

    it('never throws on a duplicate — a redelivered job is not an error', async () => {
      const mediaId = await seedMedia();
      await asA(() => repository.createIfAbsent(variant({ mediaId })));

      await expect(asA(() => repository.createIfAbsent(variant({ mediaId })))).resolves.toBe(false);
    });

    it('leaves exactly one row when two writers race the same pair', async () => {
      const mediaId = await seedMedia();

      const outcomes = await Promise.all([
        asA(() => repository.createIfAbsent(variant({ mediaId }))),
        asA(() => repository.createIfAbsent(variant({ mediaId }))),
        asA(() => repository.createIfAbsent(variant({ mediaId }))),
      ]);

      expect(await owner.productMediaVariant.count({ where: { mediaId } })).toBe(1);
      expect(outcomes.filter(Boolean)).toHaveLength(1);
    });

    it('treats different formats at the same width as different pairs', async () => {
      const mediaId = await seedMedia();

      expect(await asA(() => repository.createIfAbsent(variant({ mediaId, format: 'WEBP' })))).toBe(
        true,
      );
      expect(await asA(() => repository.createIfAbsent(variant({ mediaId, format: 'AVIF' })))).toBe(
        true,
      );
    });

    it('scopes uniqueness per media item, not globally', async () => {
      const first = await seedMedia();
      const second = await seedMedia();

      expect(await asA(() => repository.createIfAbsent(variant({ mediaId: first })))).toBe(true);
      expect(await asA(() => repository.createIfAbsent(variant({ mediaId: second })))).toBe(true);
    });
  });

  describe('database constraints', () => {
    it('refuses a blank object_key', async () => {
      const mediaId = await seedMedia();

      await expect(
        rawInsert({ mediaId, vendorId: vendorA, width: 200, objectKey: '   ', sizeBytes: 1 }),
      ).rejects.toThrow(/chk_product_media_variants_object_key_not_blank/);
    });

    it('refuses a non-positive size', async () => {
      const mediaId = await seedMedia();

      await expect(
        rawInsert({ mediaId, vendorId: vendorA, width: 200, objectKey: 'k', sizeBytes: 0 }),
      ).rejects.toThrow(/chk_product_media_variants_size_positive/);
    });

    it('refuses a width outside the SDD matrix', async () => {
      const mediaId = await seedMedia();

      await expect(
        rawInsert({ mediaId, vendorId: vendorA, width: 999, objectKey: 'k', sizeBytes: 1 }),
      ).rejects.toThrow(/chk_product_media_variants_width_in_matrix/);
    });

    it('accepts every width the matrix does name', async () => {
      const mediaId = await seedMedia();

      for (const width of [200, 400, 800, 1600]) {
        // four sequential inserts against the same table.
        await expect(
          rawInsert({ mediaId, vendorId: vendorA, width, objectKey: `k-${width}`, sizeBytes: 1 }),
        ).resolves.toBe(1);
      }
    });

    it('refuses a duplicate (media, width, format) at the database level', async () => {
      const mediaId = await seedMedia();
      await rawInsert({ mediaId, vendorId: vendorA, width: 200, objectKey: 'a', sizeBytes: 1 });

      // PostgreSQL names the columns rather than the index in a 23505 message,
      // the same way `prisma-inventory.repository.test.ts` already records.
      await expect(
        rawInsert({ mediaId, vendorId: vendorA, width: 200, objectKey: 'b', sizeBytes: 1 }),
      ).rejects.toThrow(/\(media_id, width, format\).*already exists/i);
    });

    it('refuses a vendor_id that does not match the parent media row — even as the owner', async () => {
      // On the owner connection, which bypasses RLS entirely, so a rejection
      // here can only be the composite foreign key.
      await expect(
        rawInsert({ mediaId: mediaA, vendorId: vendorB, width: 200, objectKey: 'x', sizeBytes: 1 }),
      ).rejects.toThrow(/product_media_variants_media_id_vendor_id_fkey/);
    });

    it('refuses removing a media row while a variant still points at it (RESTRICT)', async () => {
      const mediaId = await seedMedia();
      await rawInsert({ mediaId, vendorId: vendorA, width: 200, objectKey: 'r', sizeBytes: 1 });

      await expect(owner.productMedia.delete({ where: { id: mediaId } })).rejects.toThrow();
    });
  });

  describe('row-level security', () => {
    it('has row security enabled on the table', async () => {
      const rows = await owner.$queryRaw<{ rowsecurity: boolean }[]>`
        SELECT rowsecurity FROM pg_tables
        WHERE schemaname = 'public' AND tablename = 'product_media_variants'`;

      expect(rows[0]?.rowsecurity).toBe(true);
    });

    it('returns zero rows to the app role with no tenant settings', async () => {
      const mediaId = await seedMedia();
      await rawInsert({ mediaId, vendorId: vendorA, width: 200, objectKey: 'n', sizeBytes: 1 });

      const rows = await app.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM product_media_variants WHERE media_id = $1::uuid`,
        mediaId,
      );

      expect(Number(rows[0]?.count)).toBe(0);
    });

    it('hides vendor A’s variants from vendor B', async () => {
      const mediaId = await seedMedia();
      await asA(() => repository.createIfAbsent(variant({ mediaId })));

      const seen = await runWithTenant({ userId: userB, vendorId: vendorB }, () =>
        repository.listByMediaId(toProductMediaId(mediaId)),
      );

      expect(seen).toEqual([]);
    });

    it('refuses an insert claiming another vendor’s id', async () => {
      const rows = app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${userA}, TRUE)`;
        await tx.$executeRaw`SELECT set_config('app.vendor_id', ${vendorA}, TRUE)`;
        return tx.$executeRawUnsafe(
          `INSERT INTO product_media_variants (id, media_id, vendor_id, width, format, object_key, size_bytes)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 200, 'WEBP', 'forged', 1)`,
          ids.generate(),
          mediaB,
          vendorB,
        );
      });

      await expect(rows).rejects.toThrow(/row-level security/);
    });

    it('has no UPDATE policy — a variant row is written once', async () => {
      const mediaId = await seedMedia();
      await asA(() => repository.createIfAbsent(variant({ mediaId, objectKey: 'immutable' })));

      const affected = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${userA}, TRUE)`;
        await tx.$executeRaw`SELECT set_config('app.vendor_id', ${vendorA}, TRUE)`;
        return tx.$executeRawUnsafe(
          `UPDATE product_media_variants SET object_key = 'tampered' WHERE media_id = $1::uuid`,
          mediaId,
        );
      });

      expect(affected).toBe(0);
      const unchanged = await owner.productMediaVariant.findFirst({ where: { mediaId } });
      expect(unchanged?.objectKey).toBe('immutable');
    });

    it('has no DELETE policy — the same absence product_media already establishes', async () => {
      const mediaId = await seedMedia();
      await asA(() => repository.createIfAbsent(variant({ mediaId })));

      const affected = await app.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${userA}, TRUE)`;
        await tx.$executeRaw`SELECT set_config('app.vendor_id', ${vendorA}, TRUE)`;
        return tx.$executeRawUnsafe(
          `DELETE FROM product_media_variants WHERE media_id = $1::uuid`,
          mediaId,
        );
      });

      expect(affected).toBe(0);
      expect(await owner.productMediaVariant.count({ where: { mediaId } })).toBe(1);
    });

    it('lets leenmart_admin read across vendors', async () => {
      const mediaId = await seedMedia();
      await asA(() => repository.createIfAbsent(variant({ mediaId })));

      const rows = await admin.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM product_media_variants WHERE media_id = $1::uuid`,
        mediaId,
      );

      expect(Number(rows[0]?.count)).toBe(1);
    });

    it('gives leenmart_admin no write policy', async () => {
      const mediaId = await seedMedia();
      await asA(() =>
        repository.createIfAbsent(variant({ mediaId, objectKey: 'admin-untouched' })),
      );

      const affected = await admin.$executeRawUnsafe(
        `UPDATE product_media_variants SET object_key = 'admin-wrote' WHERE media_id = $1::uuid`,
        mediaId,
      );

      expect(affected).toBe(0);
    });
  });
});
