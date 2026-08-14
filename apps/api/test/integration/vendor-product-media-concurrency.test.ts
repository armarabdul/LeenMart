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
import { signUpVendorOwner, type VendorActor } from '../support/actors.js';
import { AmbientAuditWriter } from '../../src/modules/audit/index.js';
import { PrismaAuditLogRepository } from '../../src/modules/audit/infrastructure/persistence/prisma-audit-log.repository.js';
import { CATALOGUE_AUDIT_ACTIONS } from '../../src/modules/catalogue/domain/audit-actions.js';
import { DecideProductUseCase } from '../../src/modules/catalogue/application/use-cases/decide-product.use-case.js';
import { PrismaProductRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product.repository.js';
import { AdminTransactionRunner } from '../../src/shared/infrastructure/persistence/tenant-prisma.js';
import { toProductId } from '../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toSessionId } from '../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { Principal } from '../../src/modules/identity/application/ports/principal.js';

const EMAIL_PREFIX = 'vendor-product-media-conc-';
const ids = new UuidV7Generator();

interface CreateProductBody {
  readonly data: { product: { id: string } };
}
interface IntentBody {
  readonly data: { mediaId: string; uploadUrl: string };
}
interface ProductBody {
  readonly data: { id: string; status: string };
}

/** The status of every settled request, so a race can be asserted on exactly. */
const statusesOf = (results: PromiseSettledResult<request.Response>[]): number[] =>
  results
    .map((result) => (result.status === 'fulfilled' ? result.value.status : 0))
    .sort((a, b) => a - b);

/**
 * The three races S2-6a has to survive, against real PostgreSQL and real
 * MinIO — mirrors `vendor-product-concurrency.test.ts`'s own reasoning: none
 * of these can be demonstrated against a mocked database, because each one
 * depends on two transactions genuinely interleaving on the same rows.
 */
describe('vendor product media concurrency', () => {
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
  const auth = (): string => `Bearer ${vendor.token}`;

  const seedProduct = async (): Promise<string> => {
    const response = await request(app)
      .post('/api/v1/vendor/products')
      .set('Authorization', auth())
      .send({
        categoryId,
        name: `Media Conc Product ${randomUUID()}`,
        variant: {
          sku: `MEDIA-CONC-${Date.now()}-${randomUUID()}`,
          name: 'Default',
          price: { amount: '10000', currency: 'INR' },
          unitOfMeasure: 'per piece',
          quantityStep: 1,
        },
      })
      .expect(201);
    return (response.body as CreateProductBody).data.product.id;
  };

  const requestIntent = (productId: string): request.Test =>
    request(app)
      .post(mediaPath(productId))
      .set('Authorization', auth())
      .send({ contentType: 'image/jpeg', sizeBytes: 512 });

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

  /** Same direct-use-case shortcut `admin-product-decision.test.ts`/`vendor-product-media.test.ts` use to reach APPROVED without the admin MFA flow. */
  const approveProduct = async (productId: string): Promise<void> => {
    await request(app)
      .post(`/api/v1/vendor/products/${productId}/submit`)
      .set('Authorization', auth())
      .expect(200);

    const decideProductUseCase = new DecideProductUseCase({
      productRepository: new PrismaProductRepository(harness.container.adminPrisma),
      transactionRunner: new AdminTransactionRunner(harness.container.adminPrisma),
      auditWriter: new AmbientAuditWriter({
        auditLogRepository: new PrismaAuditLogRepository(harness.container.adminPrisma),
        idGenerator: harness.container.idGenerator,
        clock: harness.container.clock,
      }),
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
    const slug = `vendor-product-media-conc-cat-${Date.now()}`;
    const row = await db.category.create({
      data: { id: randomUUID(), path: [], depth: 1, name: slug, slug },
    });
    categoryId = row.id;

    try {
      await s3.send(
        new CreateBucketCommand({ Bucket: harness.container.env.PRODUCT_MEDIA_S3_BUCKET }),
      );
    } catch {
      // Already there from a previous run.
    }
  }, 60_000);

  afterAll(async () => {
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$executeRawUnsafe(
      `DELETE FROM categories WHERE slug LIKE $1`,
      'vendor-product-media-conc-cat-%',
    );
    await db.$disconnect();
    s3.destroy();
  });

  describe('MAX_IMAGES_PER_PRODUCT', () => {
    it('lets exactly one of two simultaneous uploads win at the cap', async () => {
      const productId = await seedProduct();
      // Fill to one below the cap serially, so both racing requests land on
      // the exact same "one slot left" boundary.
      for (let i = 0; i < MAX_IMAGES_PER_PRODUCT - 1; i += 1) {
        await requestIntent(productId).expect(201);
      }

      // `lockForMediaChange`'s exclusive row lock is the arbiter: both
      // transactions would otherwise count the same seven live items and both
      // proceed, leaving nine where the cap says eight.
      const results = await Promise.allSettled([
        requestIntent(productId),
        requestIntent(productId),
      ]);

      expect(statusesOf(results)).toEqual([201, 409]);
      expect(await db.productMedia.count({ where: { productId, deletedAt: null } })).toBe(
        MAX_IMAGES_PER_PRODUCT,
      );
    });
  });

  describe('completing an upload', () => {
    it('lets exactly one of two simultaneous completions win', async () => {
      const productId = await seedProduct();
      const mediaId = await uploadReadyMedia(productId);
      const complete = (): request.Test =>
        request(app)
          .post(`${mediaPath(productId)}/${mediaId}/complete`)
          .set('Authorization', auth());

      // Both requests may load the same AWAITING_UPLOAD row before either
      // writes; `completeIfAwaitingUpload`'s conditional `WHERE` is what
      // decides which one actually flips the status.
      const results = await Promise.allSettled([complete(), complete()]);

      expect(statusesOf(results)).toEqual([200, 409]);
      const row = await db.productMedia.findUnique({ where: { id: mediaId } });
      expect(row?.status).toBe('PROCESSING');
    });
  });

  describe('ASM-14 concurrent reopening', () => {
    it('two simultaneous media changes on an APPROVED product both succeed and reopen it exactly once', async () => {
      const productId = await seedProduct();
      // Two separate media items so both completions are legitimately
      // independent operations, not a race over the same row.
      const mediaA = await uploadReadyMedia(productId);
      const mediaB = await uploadReadyMedia(productId);
      await approveProduct(productId);

      const complete = (mediaId: string): request.Test =>
        request(app)
          .post(`${mediaPath(productId)}/${mediaId}/complete`)
          .set('Authorization', auth());

      // Both `reenterReviewIfApproved` calls may read the product as
      // APPROVED before either writes; the conditional `WHERE status =
      // 'APPROVED'` is what lets only the first actually flip it, and the
      // second's lost race is not an error — its own media completion still
      // succeeds regardless (see `CompleteProductMediaUploadUseCase`).
      const results = await Promise.allSettled([complete(mediaA), complete(mediaB)]);

      expect(statusesOf(results)).toEqual([200, 200]);

      const product = await request(app)
        .get(`/api/v1/vendor/products/${productId}`)
        .set('Authorization', auth())
        .expect(200);
      expect((product.body as ProductBody).data.status).toBe('PENDING_REVIEW');

      // Exactly one reopening — the loser of the race changed nothing.
      const reopenedRows = await db.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) AS count FROM audit_logs WHERE entity_id = $1::uuid AND action = $2`,
        productId,
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_REVIEW_REOPENED_FOR_MEDIA_CHANGE,
      );
      expect(Number(reopenedRows[0]?.count)).toBe(1);
    });
  });
});
