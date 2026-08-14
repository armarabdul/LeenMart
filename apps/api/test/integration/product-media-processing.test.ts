import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { NullLogger, SystemClock, UuidV7Generator, type Clock } from '@leen-mart/domain-kit';
import type {
  ObjectStore,
  PresignedDownload,
  PresignedUpload,
  StoredObject,
  TemporaryObject,
} from '../../src/modules/media/index.js';
import { runWithTenant } from '../../src/shared/infrastructure/persistence/tenant-context.js';
import { withTenantBoundary } from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import { ProcessProductMediaUseCase } from '../../src/modules/catalogue/application/use-cases/process-product-media.use-case.js';
import { SharpImageProcessor } from '../../src/modules/catalogue/infrastructure/media-processing/sharp-image-processor.js';
import { PrismaProductMediaRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-media.repository.js';
import { PrismaProductMediaVariantRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-media-variant.repository.js';
import { toProductMediaId } from '../../src/modules/catalogue/domain/value-objects/product-media-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const requireUrl = (name: 'DATABASE_URL' | 'APP_DATABASE_URL'): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} must be set for this suite. Run \`pnpm db:migrate:deploy && pnpm db:provision-roles\`.`,
    );
  }
  return value;
};

/**
 * An `ObjectStore` that keeps bytes in a `Map` (S2-6b).
 *
 * The one faked collaborator in this suite, and deliberately the only one:
 * PostgreSQL is real (that is what the concurrency assertions are about) and
 * Sharp is real (that is what the variant assertions are about). Standing up
 * MinIO as well would test the AWS SDK, which `s3-object-store.test.ts`
 * already does — here it would only slow the arbitration proofs down.
 *
 * `putObject` is a plain `Map.set`, so a repeated write to the same key
 * overwrites rather than accumulating — exactly what a content-addressed
 * permanent key does in S3, and what makes "retries do not produce
 * uncontrolled duplicate objects" observable as `store.keys.size`.
 */
class MapObjectStore implements ObjectStore {
  readonly objects = new Map<string, { bytes: Buffer; contentType: string }>();
  putCalls = 0;

  presignPut(): Promise<PresignedUpload> {
    throw new Error('not used by the worker');
  }

  presignGet(): Promise<PresignedDownload> {
    throw new Error('not used by the worker');
  }

  head(key: string): Promise<StoredObject | null> {
    const found = this.objects.get(key);
    return Promise.resolve(
      found ? { sizeBytes: found.bytes.length, contentType: found.contentType } : null,
    );
  }

  getObject(key: string): Promise<Buffer | null> {
    return Promise.resolve(this.objects.get(key)?.bytes ?? null);
  }

  writeTemporaryObject(): Promise<TemporaryObject> {
    throw new Error('not used by the worker');
  }

  putObject(key: string, bytes: Buffer, contentType: string): Promise<void> {
    this.putCalls += 1;
    this.objects.set(key, { bytes, contentType });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}

/**
 * The processing pipeline against **real PostgreSQL** and **real Sharp**
 * (S2-6b).
 *
 * The repositories run on the `leenmart_app` credential wrapped in
 * `withTenantBoundary` — the same client the HTTP tier uses, not the owner
 * connection and not `adminPrisma`. Every assertion below therefore passes
 * only if the worker's `runWithTenant` scope really does reach RLS, which is
 * the tenancy claim this milestone has to make good on.
 */
describe('product media processing pipeline (S2-6b)', () => {
  const owner = new PrismaClient({ datasources: { db: { url: requireUrl('DATABASE_URL') } } });
  const app = new PrismaClient({ datasources: { db: { url: requireUrl('APP_DATABASE_URL') } } });
  const tenant = withTenantBoundary(app);
  const ids = new UuidV7Generator();
  // A real clock: `updatedAt` comparisons below need time to actually move.
  const clock: Clock = new SystemClock();

  const userA = toUserId(ids.generate());
  const userB = toUserId(ids.generate());
  const vendorA = toVendorId(ids.generate());
  const vendorB = toVendorId(ids.generate());
  const categoryId = ids.generate();
  const productA = ids.generate();
  const productB = ids.generate();
  const now = new Date('2026-01-01T00:00:00.000Z');

  /**
   * Only just wider than the 1600 px variant, on purpose. Every assertion here
   * is about the database — statuses, row counts, arbitration — and each test
   * still runs the full eight-output AVIF/WebP encode, so the source is kept
   * as small as "no variant is ever upscaled" allows. The pixel-level
   * behaviour is asserted on a genuinely large source in
   * `sharp-image-processor.test.ts`.
   */
  const SOURCE_WIDTH = 1700;
  let jpeg: Buffer;
  let png: Buffer;
  let svg: Buffer;

  let store: MapObjectStore;
  const createdMedia: string[] = [];

  const useCase = (): ProcessProductMediaUseCase =>
    new ProcessProductMediaUseCase({
      productMediaRepository: new PrismaProductMediaRepository(tenant),
      productMediaVariantRepository: new PrismaProductMediaVariantRepository(tenant),
      objectStore: store,
      imageProcessor: new SharpImageProcessor(),
      idGenerator: ids,
      clock,
      logger: new NullLogger(),
    });

  /** Runs the pipeline as the worker does: inside a tenant scope, from a job payload. */
  const process = (
    mediaId: string,
    identity: { userId: typeof userA; vendorId: typeof vendorA } = {
      userId: userA,
      vendorId: vendorA,
    },
    attemptNumber = 1,
    maxAttempts = 3,
  ): Promise<void> =>
    runWithTenant(identity, () =>
      useCase().execute({ mediaId: toProductMediaId(mediaId), attemptNumber, maxAttempts }),
    );

  interface SeedOptions {
    readonly status?: 'AWAITING_UPLOAD' | 'PROCESSING' | 'READY' | 'FAILED';
    readonly contentType?: string;
    readonly bytes?: Buffer;
    /** Omit the stored object entirely, to exercise OBJECT_NOT_FOUND. */
    readonly upload?: boolean;
    readonly vendorId?: typeof vendorA;
    readonly productId?: string;
  }

  const seedMedia = async (options: SeedOptions = {}): Promise<string> => {
    const id = ids.generate();
    const vendorId = options.vendorId ?? vendorA;
    const productId = options.productId ?? (vendorId === vendorA ? productA : productB);
    const contentType = options.contentType ?? 'image/jpeg';
    const bytes = options.bytes ?? jpeg;
    const objectKey = `product-media/${vendorId}/${productId}/${id}/original`;

    await owner.productMedia.create({
      data: {
        id,
        productId,
        vendorId,
        objectKey,
        contentType,
        sizeBytes: bytes.length,
        status: options.status ?? 'PROCESSING',
        createdAt: now,
        updatedAt: now,
      },
    });
    if (options.upload !== false) {
      store.objects.set(objectKey, { bytes, contentType });
    }
    createdMedia.push(id);
    return id;
  };

  const readMedia = (
    id: string,
  ): Promise<{ status: string; failureReason: string | null } | null> =>
    owner.productMedia.findUnique({
      where: { id },
      select: { status: true, failureReason: true },
    });

  const variantsOf = (
    mediaId: string,
  ): Promise<
    { width: number; format: string; objectKey: string; sizeBytes: number; vendorId: string }[]
  > =>
    owner.productMediaVariant.findMany({
      where: { mediaId },
      orderBy: [{ width: 'asc' }, { format: 'asc' }],
      select: { width: true, format: true, objectKey: true, sizeBytes: true, vendorId: true },
    });

  beforeAll(async () => {
    jpeg = await sharp({
      create: {
        width: SOURCE_WIDTH,
        height: 850,
        channels: 3,
        background: { r: 9, g: 99, b: 199 },
      },
    })
      .jpeg()
      .toBuffer();
    png = await sharp({
      create: { width: 400, height: 300, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png()
      .toBuffer();
    svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"></svg>');

    const stamp = Date.now();
    await owner.user.createMany({
      data: [
        { id: userA, email: `media-processing-a-${stamp}@example.com` },
        { id: userB, email: `media-processing-b-${stamp}@example.com` },
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
        name: `media-processing-${stamp}`,
        slug: `media-processing-${stamp}`,
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
  });

  afterEach(() => {
    store = new MapObjectStore();
  });

  beforeAll(() => {
    store = new MapObjectStore();
  });

  afterAll(async () => {
    await owner.productMediaVariant.deleteMany({ where: { mediaId: { in: createdMedia } } });
    await owner.productMedia.deleteMany({ where: { id: { in: createdMedia } } });
    await owner.product.deleteMany({ where: { id: { in: [productA, productB] } } });
    await owner.category.deleteMany({ where: { id: categoryId } });
    await owner.vendorProfile.deleteMany({ where: { id: { in: [vendorA, vendorB] } } });
    await owner.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await Promise.all([owner.$disconnect(), app.$disconnect()]);
  });

  describe('the happy path, end to end', () => {
    it('reaches READY with all eight variant rows', async () => {
      const mediaId = await seedMedia();

      await process(mediaId);

      expect((await readMedia(mediaId))?.status).toBe('READY');
      expect(await variantsOf(mediaId)).toHaveLength(8);
    });

    it('writes exactly the SDD matrix, each pair once', async () => {
      const mediaId = await seedMedia();

      await process(mediaId);

      const pairs = (await variantsOf(mediaId)).map((v) => `${v.width}:${v.format}`);
      expect(pairs.sort()).toEqual(
        [
          '200:WEBP',
          '200:AVIF',
          '400:WEBP',
          '400:AVIF',
          '800:WEBP',
          '800:AVIF',
          '1600:WEBP',
          '1600:AVIF',
        ].sort(),
      );
    });

    it('keeps every row internally consistent with the object it names', async () => {
      const mediaId = await seedMedia();

      await process(mediaId);

      for (const variant of await variantsOf(mediaId)) {
        const stored = store.objects.get(variant.objectKey);
        expect(stored).toBeDefined();
        expect(variant.sizeBytes).toBe(stored?.bytes.length);
        expect(variant.vendorId).toBe(vendorA);
        // eight sequential decodes of real output.
        const decoded = await sharp(stored?.bytes ?? Buffer.alloc(0)).metadata();
        expect(decoded.width).toBe(variant.width);
      }
    });

    it('clears no failure reason it never set', async () => {
      const mediaId = await seedMedia();

      await process(mediaId);

      expect((await readMedia(mediaId))?.failureReason).toBeNull();
    });

    it('leaves the original object untouched and unpublished', async () => {
      const mediaId = await seedMedia();
      const original = await owner.productMedia.findUnique({ where: { id: mediaId } });

      await process(mediaId);

      expect(store.objects.get(original?.objectKey ?? '')?.bytes.equals(jpeg)).toBe(true);
      const keys = (await variantsOf(mediaId)).map((v) => v.objectKey);
      expect(keys).not.toContain(original?.objectKey);
    });

    it('processes a PNG the same way', async () => {
      const mediaId = await seedMedia({ contentType: 'image/png', bytes: png });

      await process(mediaId);

      expect((await readMedia(mediaId))?.status).toBe('READY');
      expect(await variantsOf(mediaId)).toHaveLength(8);
    });
  });

  describe('duplicate delivery is safe', () => {
    it('leaves exactly eight rows after the same job runs twice', async () => {
      const mediaId = await seedMedia();

      await process(mediaId);
      await process(mediaId);

      expect(await variantsOf(mediaId)).toHaveLength(8);
      expect((await readMedia(mediaId))?.status).toBe('READY');
    });

    it('does no object-store work at all on the second delivery', async () => {
      const mediaId = await seedMedia();

      await process(mediaId);
      const after = store.putCalls;
      await process(mediaId);

      expect(after).toBe(8);
      expect(store.putCalls).toBe(8);
    });

    it('never overwrites READY with a late duplicate', async () => {
      const mediaId = await seedMedia();
      await process(mediaId);
      const first = await owner.productMedia.findUnique({ where: { id: mediaId } });

      await process(mediaId);

      const second = await owner.productMedia.findUnique({ where: { id: mediaId } });
      expect(second?.status).toBe('READY');
      expect(second?.updatedAt).toEqual(first?.updatedAt);
    });

    it('does not corrupt the object references a duplicate re-derives', async () => {
      const mediaId = await seedMedia();
      await process(mediaId);
      const before = (await variantsOf(mediaId)).map((v) => v.objectKey);

      await process(mediaId);

      expect((await variantsOf(mediaId)).map((v) => v.objectKey)).toEqual(before);
    });
  });

  describe('concurrent workers', () => {
    it('leaves exactly eight rows when two workers race the same item', async () => {
      const mediaId = await seedMedia();

      await Promise.all([process(mediaId), process(mediaId)]);

      expect(await variantsOf(mediaId)).toHaveLength(8);
    });

    it('lets exactly one of them win the READY transition', async () => {
      const mediaId = await seedMedia();
      const repository = new PrismaProductMediaRepository(tenant);
      const wins: boolean[] = [];

      // Both workers reach the same conditional UPDATE; the database, not the
      // application, decides which one it applies to.
      const finish = async (): Promise<void> => {
        await runWithTenant({ userId: userA, vendorId: vendorA }, async () => {
          const media = await repository.findById(toProductMediaId(mediaId));
          if (!media) throw new Error('seeded media vanished');
          wins.push(await repository.markReadyIfProcessing(media.markReady(clock.now())));
        });
      };

      await Promise.all([finish(), finish()]);

      expect(wins.filter(Boolean)).toHaveLength(1);
      expect((await readMedia(mediaId))?.status).toBe('READY');
    });

    it('survives three workers racing the same item', async () => {
      const mediaId = await seedMedia();

      await Promise.all([process(mediaId), process(mediaId), process(mediaId)]);

      expect(await variantsOf(mediaId)).toHaveLength(8);
      expect((await readMedia(mediaId))?.status).toBe('READY');
    });

    it('keeps two different items independent', async () => {
      const first = await seedMedia();
      const second = await seedMedia();

      await Promise.all([process(first), process(second)]);

      expect(await variantsOf(first)).toHaveLength(8);
      expect(await variantsOf(second)).toHaveLength(8);
    });
  });

  describe('resuming a half-finished item', () => {
    it('fills in only the pairs a crashed attempt left missing', async () => {
      const mediaId = await seedMedia();
      await process(mediaId);
      // Simulate a crash after four variants: remove half the rows, leaving
      // the item PROCESSING again as a resumed attempt would find it.
      const survivors = (await variantsOf(mediaId)).slice(0, 4);
      await owner.productMediaVariant.deleteMany({
        where: { mediaId, NOT: { objectKey: { in: survivors.map((v) => v.objectKey) } } },
      });
      await owner.productMedia.update({
        where: { id: mediaId },
        data: { status: 'PROCESSING' },
      });
      store.putCalls = 0;

      await process(mediaId);

      expect(await variantsOf(mediaId)).toHaveLength(8);
      expect(store.putCalls).toBe(4);
    });
  });

  describe('retry from FAILED (D-S2-6-K)', () => {
    it('goes FAILED → PROCESSING → READY and clears the reason', async () => {
      const mediaId = await seedMedia({ status: 'FAILED' });
      await owner.productMedia.update({
        where: { id: mediaId },
        data: { failureReason: 'PROCESSING_ERROR' },
      });

      await process(mediaId);

      const after = await readMedia(mediaId);
      expect(after?.status).toBe('READY');
      expect(after?.failureReason).toBeNull();
    });

    it('produces all eight variants on the retry', async () => {
      const mediaId = await seedMedia({ status: 'FAILED' });

      await process(mediaId);

      expect(await variantsOf(mediaId)).toHaveLength(8);
    });

    it('lets only one of two concurrent retries claim the item', async () => {
      const mediaId = await seedMedia({ status: 'FAILED' });

      await Promise.all([process(mediaId), process(mediaId)]);

      expect((await readMedia(mediaId))?.status).toBe('READY');
      expect(await variantsOf(mediaId)).toHaveLength(8);
    });

    it('refuses to let a stale retry demote an item that is already READY', async () => {
      const mediaId = await seedMedia();
      await process(mediaId);

      // A job redelivered long after the item finished: it finds READY and
      // stops, rather than re-entering PROCESSING.
      await process(mediaId);

      expect((await readMedia(mediaId))?.status).toBe('READY');
    });
  });

  describe('permanent failures', () => {
    it('marks SVG_REJECTED and writes no variants', async () => {
      const mediaId = await seedMedia({ contentType: 'image/png', bytes: svg });

      await process(mediaId);

      expect(await readMedia(mediaId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'SVG_REJECTED',
      });
      expect(await variantsOf(mediaId)).toHaveLength(0);
    });

    it('marks CONTENT_TYPE_MISMATCH for PNG bytes declared as JPEG', async () => {
      const mediaId = await seedMedia({ contentType: 'image/jpeg', bytes: png });

      await process(mediaId);

      expect(await readMedia(mediaId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'CONTENT_TYPE_MISMATCH',
      });
      expect(await variantsOf(mediaId)).toHaveLength(0);
    });

    it('marks DECODE_FAILED for bytes that are not an image', async () => {
      const mediaId = await seedMedia({ bytes: Buffer.from('definitely not a jpeg') });

      await process(mediaId);

      expect((await readMedia(mediaId))?.failureReason).toBe('DECODE_FAILED');
    });

    it('marks OBJECT_NOT_FOUND when the upload never landed', async () => {
      const mediaId = await seedMedia({ upload: false });

      await process(mediaId);

      expect(await readMedia(mediaId)).toMatchObject({
        status: 'FAILED',
        failureReason: 'OBJECT_NOT_FOUND',
      });
    });

    it('records a short code, never an exception message', async () => {
      const mediaId = await seedMedia({ bytes: Buffer.from('definitely not a jpeg') });

      await process(mediaId);

      const reason = (await readMedia(mediaId))?.failureReason ?? '';
      expect(reason.length).toBeLessThanOrEqual(64);
      expect(reason).not.toMatch(/Error|at .*\.ts:/);
    });

    it('can be retried after the underlying problem is fixed', async () => {
      const mediaId = await seedMedia({ upload: false });
      await process(mediaId);
      expect((await readMedia(mediaId))?.status).toBe('FAILED');

      const row = await owner.productMedia.findUnique({ where: { id: mediaId } });
      store.objects.set(row?.objectKey ?? '', { bytes: jpeg, contentType: 'image/jpeg' });
      await process(mediaId);

      expect((await readMedia(mediaId))?.status).toBe('READY');
      expect(await variantsOf(mediaId)).toHaveLength(8);
    });
  });

  describe('tenancy — the job payload is a claim, not an authorisation', () => {
    it('does nothing at all when the job names the wrong vendor', async () => {
      const mediaId = await seedMedia();

      // The payload asserts vendor B; the row belongs to vendor A. RLS makes
      // it invisible, so the pipeline finds no such row and stops.
      await process(mediaId, { userId: userB, vendorId: vendorB });

      expect((await readMedia(mediaId))?.status).toBe('PROCESSING');
      expect(await variantsOf(mediaId)).toHaveLength(0);
      expect(store.putCalls).toBe(0);
    });

    it('writes variant rows the other vendor cannot see', async () => {
      const mediaId = await seedMedia();
      await process(mediaId);

      const seenByB = await runWithTenant({ userId: userB, vendorId: vendorB }, () =>
        new PrismaProductMediaVariantRepository(tenant).listByMediaId(toProductMediaId(mediaId)),
      );

      expect(seenByB).toHaveLength(0);
      expect(await variantsOf(mediaId)).toHaveLength(8);
    });

    it('refuses a query issued with no tenant context at all', async () => {
      const mediaId = await seedMedia();

      await expect(
        new PrismaProductMediaVariantRepository(tenant).listByMediaId(toProductMediaId(mediaId)),
      ).rejects.toThrow(/tenant context/i);
    });

    it('stamps every variant with the media row’s own vendor, not the payload’s', async () => {
      const mediaId = await seedMedia();

      await process(mediaId);

      for (const variant of await variantsOf(mediaId)) {
        expect(variant.vendorId).toBe(vendorA);
      }
    });
  });
});
