import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import { MAX_IMAGES_PER_PRODUCT } from '@leen-mart/contracts';
import {
  createIntegrationHarness,
  disposeIntegrationHarness,
  type IntegrationHarness,
} from '../support/integration-app.js';
import { signUpCustomer, signUpVendorOwner, type VendorActor } from '../support/actors.js';
import { AmbientAuditWriter } from '../../src/modules/audit/index.js';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/persistence/prisma-audit-log.repository.js';
import { PrismaOutboxWriter } from '../../src/shared/infrastructure/persistence/prisma-outbox-writer.js';
import { CATALOGUE_AUDIT_ACTIONS } from '../../src/modules/catalogue/domain/audit-actions.js';
import { DecideProductUseCase } from '../../src/modules/catalogue/application/use-cases/decide-product.use-case.js';
import { PrismaProductRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product.repository.js';
import { PrismaProductMediaRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product-media.repository.js';
import { AdminTransactionRunner } from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import { toProductId } from '../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toSessionId } from '../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { Principal } from '../../src/modules/identity/application/ports/principal.js';

const EMAIL_PREFIX = 'vendor-product-media-';

interface CreateProductBody {
  readonly data: { product: { id: string } };
}
interface IntentBody {
  readonly data: {
    mediaId: string;
    uploadUrl: string;
    expiresAt: string;
    contentType: string;
    sizeBytes: number;
    status: string;
  };
}
interface MediaBody {
  readonly data: { id: string; productId: string; contentType: string; status: string };
}
interface MediaListBody {
  readonly data: { id: string; status: string }[];
}
interface ProductBody {
  readonly data: { id: string; status: string };
}
interface ErrorBody {
  readonly error: { code: string };
}

const ids = new UuidV7Generator();

/**
 * The product media data model and upload/complete flow, end to end (S2-6a).
 *
 * Runs against real MinIO (the same stand-in for R2 `s3-object-store.test.ts`
 * and `vendor-kyc-upload-intent.test.ts` already use) for the same reason
 * those files do: that a presigned URL genuinely enforces its content type
 * and length is a property of the store, not of this API's response.
 */
describe('vendor product media', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let vendor: VendorActor;
  let categoryId: string;

  const s3 = new S3Client({
    region: 'auto',
    endpoint: process.env.PRODUCT_MEDIA_S3_ENDPOINT ?? 'http://localhost:9000',
    forcePathStyle: true,
    credentials: { accessKeyId: 'leenmart', secretAccessKey: 'leenmart-dev-secret' },
  });

  const mediaPath = (productId: string): string => `/api/v1/vendor/products/${productId}/media`;
  const auth = (token = vendor.token): string => `Bearer ${token}`;

  const seedProduct = async (): Promise<string> => {
    const response = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', auth())
      .send({
        categoryId,
        name: `Media Product ${randomUUID()}`,
        variant: {
          sku: `MEDIA-${Date.now()}-${randomUUID()}`,
          name: 'Default',
          price: { amount: '10000', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        },
      })
      .expect(201);
    return (response.body as CreateProductBody).data.product.id;
  };

  const requestIntent = (
    productId: string,
    body: { contentType: string; sizeBytes: number } = {
      contentType: 'image/jpeg',
      sizeBytes: 512,
    },
  ): request.Test =>
    request(app).post(mediaPath(productId)).set('Authorization', auth()).send(body);

  /**
   * Direct DB insert of one live `READY` media row (S2-8's approval gate),
   * separate from whichever media item a given test is actually exercising
   * — never the real upload/complete/worker pipeline, which is not what
   * these ASM-14 tests are about.
   */
  const seedReadyMedia = async (productId: string): Promise<void> => {
    await db.productMedia.create({
      data: {
        id: randomUUID(),
        productId,
        vendorId: vendor.vendorId,
        objectKey: `product-media/${vendor.vendorId}/${productId}/${randomUUID()}.jpg`,
        contentType: 'image/jpeg',
        sizeBytes: 1024,
        status: 'READY',
      },
    });
  };

  /** Mints an intent and PUTs matching bytes to the real store, so the row is genuinely ready to complete. */
  const uploadReadyMedia = async (productId: string): Promise<string> => {
    const intent = (await requestIntent(productId).expect(201)).body as IntentBody;
    const put = await fetch(intent.data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '512' },
      body: Buffer.alloc(512, 7),
    });
    expect(put.status).toBe(200);
    return intent.data.mediaId;
  };

  /**
   * Moves a product straight from DRAFT to APPROVED, bypassing the admin MFA
   * flow — the same direct-use-case shortcut `admin-product-decision.test.ts`
   * itself uses for its audit-rollback proof: submission runs through the
   * real HTTP surface, the decision runs the real `DecideProductUseCase`
   * against `adminPrisma`, so the only thing skipped is minting an admin
   * session, which has nothing to do with what ASM-14 is proving.
   */
  const approveProduct = async (productId: string): Promise<void> => {
    await request(app)
      .post(`/api/v1/vendor/products/${productId}/submit`)
      .set('Authorization', auth())
      .expect(200);
    // S2-8's approval gate: a media item of this ASM-14 suite's own concern
    // (uploaded/completed separately by each test) is never what satisfies
    // it — this is a second, independent one, purely so `approveProduct`
    // itself can succeed.
    await seedReadyMedia(productId);

    const decideProductUseCase = new DecideProductUseCase({
      productRepository: new PrismaProductRepository(harness.container.adminPrisma),
      productMediaRepository: new PrismaProductMediaRepository(harness.container.adminPrisma),
      transactionRunner: new AdminTransactionRunner(harness.container.adminPrisma),
      auditWriter: new AmbientAuditWriter({
        auditLogRepository: new PrismaAuditLogRepository(harness.container.adminPrisma),
        idGenerator: harness.container.idGenerator,
        clock: harness.container.clock,
      }),
      // S6-NOTIFY-LIFECYCLE: the decision now publishes an event in its own
      // transaction, so this harness supplies the real writer.
      outboxWriter: new PrismaOutboxWriter(
        harness.container.adminPrisma,
        harness.container.idGenerator,
        harness.container.clock,
      ),
      clock: harness.container.clock,
      logger: new NullLogger(),
    });
    const principal: Principal = {
      userId: toUserId(ids.generate()),
      sessionId: toSessionId(ids.generate()),
      role: 'CATALOGUE_MODERATOR',
    };
    await decideProductUseCase.execute({
      principal,
      productId: toProductId(productId),
      command: { decision: 'APPROVE' },
    });
  };

  beforeAll(async () => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    vendor = await signUpVendorOwner(app, EMAIL_PREFIX, 'vendor');
    const slug = `vendor-product-media-cat-${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;

    try {
      await s3.send(
        new CreateBucketCommand({ Bucket: harness.container.env.PRODUCT_MEDIA_S3_BUCKET }),
      );
    } catch {
      // Already there from a previous run — the only outcome that matters is
      // that the bucket exists.
    }
  }, 60_000);

  afterAll(async () => {
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe(
      `DELETE FROM categories WHERE slug LIKE $1`,
      'vendor-product-media-cat-%',
    );
    await db.$disconnect();
    s3.destroy();
  });

  describe('authorisation (SDD 7.4)', () => {
    it('refuses an unauthenticated caller', async () => {
      const productId = await seedProduct();
      await request(app)
        .post(mediaPath(productId))
        .send({ contentType: 'image/jpeg', sizeBytes: 512 })
        .expect(401);
    });

    it('refuses a CUSTOMER — no CREATE_OR_EDIT_PRODUCT grant', async () => {
      const productId = await seedProduct();
      const customer = await signUpCustomer(app, EMAIL_PREFIX, 'customer-denied');

      const response = await requestIntent(productId)
        .set('Authorization', auth(customer.token))
        .expect(403);

      expect((response.body as ErrorBody).error.code).toBe('UNAUTHORIZED');
    });

    it('allows a VENDOR_OWNER', async () => {
      const productId = await seedProduct();
      await requestIntent(productId).expect(201);
    });
  });

  describe('upload-intent minting', () => {
    it('returns a server-derived object key never named by the client', async () => {
      const productId = await seedProduct();

      const response = (await requestIntent(productId).expect(201)).body as IntentBody;

      expect(response.data.mediaId).toBeTruthy();
      expect(response.data.uploadUrl).toContain(harness.container.env.PRODUCT_MEDIA_S3_BUCKET);
      expect(response.data.status).toBe('AWAITING_UPLOAD');
      expect(response.data.contentType).toBe('image/jpeg');
      expect(response.data.sizeBytes).toBe(512);
    });

    it('persists a pending row (SDD 12.2: media_asset row at AWAITING_UPLOAD)', async () => {
      const productId = await seedProduct();

      const response = (await requestIntent(productId).expect(201)).body as IntentBody;

      const row = await db.productMedia.findUnique({ where: { id: response.data.mediaId } });
      expect(row?.status).toBe('AWAITING_UPLOAD');
      expect(row?.productId).toBe(productId);
      expect(row?.vendorId).toBe(vendor.vendorId);
    });

    it('rejects a content type outside the allowlist', async () => {
      const productId = await seedProduct();
      await requestIntent(productId, { contentType: 'image/svg+xml', sizeBytes: 512 }).expect(400);
    });

    it('rejects a file above the 10 MB cap', async () => {
      const productId = await seedProduct();
      await requestIntent(productId, {
        contentType: 'image/jpeg',
        sizeBytes: 11 * 1024 * 1024,
      }).expect(400);
    });

    it('404s for another vendor’s product id', async () => {
      const other = await signUpVendorOwner(app, EMAIL_PREFIX, 'other-owner');
      const theirProductId = await (async () => {
        const response = await request(app)
          .post('/api/v1/vendor/products')
          .set('Authorization', `Bearer ${other.token}`)
          .send({
            categoryId,
            name: 'Other vendor product',
            variant: {
              sku: `OTHER-${Date.now()}`,
              name: 'Default',
              price: { amount: '10000', currency: 'INR' },
              unitOfMeasure: 'per piece',
              quantityStep: 1,
            },
          })
          .expect(201);
        return (response.body as CreateProductBody).data.product.id;
      })();

      await requestIntent(theirProductId).expect(404);
    });
  });

  describe('the presigned URL actually enforces its conditions', () => {
    it('accepts a PUT matching the signed content type and length', async () => {
      const productId = await seedProduct();
      const intent = (await requestIntent(productId).expect(201)).body as IntentBody;

      const response = await fetch(intent.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '512' },
        body: Buffer.alloc(512, 7),
      });

      expect(response.status).toBe(200);
    });

    it('rejects a PUT of a different content type', async () => {
      const productId = await seedProduct();
      const intent = (await requestIntent(productId).expect(201)).body as IntentBody;

      const response = await fetch(intent.data.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'image/png', 'Content-Length': '512' },
        body: Buffer.alloc(512, 7),
      });

      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('completing an upload', () => {
    it('refuses to complete before the bytes have landed', async () => {
      const productId = await seedProduct();
      const intent = (await requestIntent(productId).expect(201)).body as IntentBody;

      // IncompleteProductMediaUploadError is a DOMAIN_RULE error (422), not a
      // malformed-request error (400) — the request itself is well-formed.
      await request(app)
        .post(`${mediaPath(productId)}/${intent.data.mediaId}/complete`)
        .set('Authorization', auth())
        .expect(422);
    });

    it('completes a verified upload', async () => {
      const productId = await seedProduct();
      const mediaId = await uploadReadyMedia(productId);

      const response = await request(app)
        .post(`${mediaPath(productId)}/${mediaId}/complete`)
        .set('Authorization', auth())
        .expect(200);

      expect((response.body as MediaBody).data.status).toBe('PROCESSING');
    });

    it('404s completing a media id that does not exist', async () => {
      const productId = await seedProduct();
      await request(app)
        .post(`${mediaPath(productId)}/${randomUUID()}/complete`)
        .set('Authorization', auth())
        .expect(404);
    });
  });

  describe('listing', () => {
    it('lists only live media of the caller’s own product', async () => {
      const productId = await seedProduct();
      const mediaId = await uploadReadyMedia(productId);
      await request(app)
        .post(`${mediaPath(productId)}/${mediaId}/complete`)
        .set('Authorization', auth())
        .expect(200);

      const response = await request(app)
        .get(mediaPath(productId))
        .set('Authorization', auth())
        .expect(200);

      const items = (response.body as MediaListBody).data;
      expect(items).toHaveLength(1);
      expect(items[0]?.id).toBe(mediaId);
    });

    it('404s for another vendor’s product id', async () => {
      const other = await signUpVendorOwner(app, EMAIL_PREFIX, 'list-other');
      await request(app)
        .get(mediaPath(randomUUID()))
        .set('Authorization', `Bearer ${other.token}`)
        .expect(404);
    });
  });

  describe('removing', () => {
    it('soft-deletes and drops it from the list', async () => {
      const productId = await seedProduct();
      const mediaId = await uploadReadyMedia(productId);

      await request(app)
        .delete(`${mediaPath(productId)}/${mediaId}`)
        .set('Authorization', auth())
        .expect(200);

      const listed = await request(app)
        .get(mediaPath(productId))
        .set('Authorization', auth())
        .expect(200);
      expect((listed.body as MediaListBody).data).toHaveLength(0);
      const row = await db.productMedia.findUnique({ where: { id: mediaId } });
      expect(row?.deletedAt).toBeInstanceOf(Date);
    });

    it('404s removing an id that was never there', async () => {
      const productId = await seedProduct();
      await request(app)
        .delete(`${mediaPath(productId)}/${randomUUID()}`)
        .set('Authorization', auth())
        .expect(404);
    });
  });

  describe('MAX_IMAGES_PER_PRODUCT (D-S2-6-I)', () => {
    it(`refuses the (${MAX_IMAGES_PER_PRODUCT + 1})th image`, async () => {
      const productId = await seedProduct();
      for (let i = 0; i < MAX_IMAGES_PER_PRODUCT; i += 1) {
        await requestIntent(productId).expect(201);
      }

      const response = await requestIntent(productId).expect(409);
      expect((response.body as ErrorBody).error.code).toBe('PRODUCT_MEDIA_LIMIT_EXCEEDED');
      expect(await db.productMedia.count({ where: { productId, deletedAt: null } })).toBe(
        MAX_IMAGES_PER_PRODUCT,
      );
    });

    it('a removed image frees a slot', async () => {
      const productId = await seedProduct();
      const intents: string[] = [];
      for (let i = 0; i < MAX_IMAGES_PER_PRODUCT; i += 1) {
        const intent = (await requestIntent(productId).expect(201)).body as IntentBody;
        intents.push(intent.data.mediaId);
      }
      await requestIntent(productId).expect(409);

      await request(app)
        .delete(`${mediaPath(productId)}/${intents[0]}`)
        .set('Authorization', auth())
        .expect(200);

      await requestIntent(productId).expect(201);
    });
  });

  describe('ASM-14 (S2-6a D-S2-6-L): editing images reopens an APPROVED product', () => {
    it('completing an upload on an APPROVED product returns it to PENDING_REVIEW', async () => {
      const productId = await seedProduct();
      await approveProduct(productId);

      const mediaId = await uploadReadyMedia(productId);
      await request(app)
        .post(`${mediaPath(productId)}/${mediaId}/complete`)
        .set('Authorization', auth())
        .expect(200);

      const product = await request(app)
        .get(`/api/v1/vendor/products/${productId}`)
        .set('Authorization', auth())
        .expect(200);
      expect((product.body as ProductBody).data.status).toBe('PENDING_REVIEW');
    });

    it('removing an image from an APPROVED product also reopens it', async () => {
      const productId = await seedProduct();
      const mediaId = await uploadReadyMedia(productId);
      await request(app)
        .post(`${mediaPath(productId)}/${mediaId}/complete`)
        .set('Authorization', auth())
        .expect(200);
      // No worker runs in this suite, so `complete` alone only reaches
      // PROCESSING — forced to READY directly so the S2-8 approval gate
      // below is satisfied; the removal this test actually proves out
      // triggers ASM-14 regardless of the removed item's own status.
      await db.productMedia.update({ where: { id: mediaId }, data: { status: 'READY' } });
      await approveProduct(productId);

      await request(app)
        .delete(`${mediaPath(productId)}/${mediaId}`)
        .set('Authorization', auth())
        .expect(200);

      const product = await request(app)
        .get(`/api/v1/vendor/products/${productId}`)
        .set('Authorization', auth())
        .expect(200);
      expect((product.body as ProductBody).data.status).toBe('PENDING_REVIEW');
    });

    it('records PRODUCT_REVIEW_REOPENED_FOR_MEDIA_CHANGE, never touching title/category/brand', async () => {
      const productId = await seedProduct();
      await approveProduct(productId);
      const before = (
        await request(app)
          .get(`/api/v1/vendor/products/${productId}`)
          .set('Authorization', auth())
          .expect(200)
      ).body as { data: { name: string; categoryId: string; brand: string | null } };

      const mediaId = await uploadReadyMedia(productId);
      await request(app)
        .post(`${mediaPath(productId)}/${mediaId}/complete`)
        .set('Authorization', auth())
        .expect(200);

      const after = (
        await request(app)
          .get(`/api/v1/vendor/products/${productId}`)
          .set('Authorization', auth())
          .expect(200)
      ).body as { data: { name: string; categoryId: string; brand: string | null } };
      expect(after.data.name).toBe(before.data.name);
      expect(after.data.categoryId).toBe(before.data.categoryId);
      expect(after.data.brand).toBe(before.data.brand);

      const rows = await db.$queryRawUnsafe<{ action: string }[]>(
        `SELECT action FROM audit_logs WHERE entity_id = $1::uuid`,
        productId,
      );
      expect(rows.map((row) => row.action)).toContain(
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_REVIEW_REOPENED_FOR_MEDIA_CHANGE,
      );
    });

    it('does not reopen a DRAFT product on a media change', async () => {
      const productId = await seedProduct();

      const mediaId = await uploadReadyMedia(productId);
      await request(app)
        .post(`${mediaPath(productId)}/${mediaId}/complete`)
        .set('Authorization', auth())
        .expect(200);

      const product = await request(app)
        .get(`/api/v1/vendor/products/${productId}`)
        .set('Authorization', auth())
        .expect(200);
      expect((product.body as ProductBody).data.status).toBe('DRAFT');
    });
  });
});
