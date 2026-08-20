import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { AuditWriter, AuditWriterInput } from '../../../../../src/modules/audit/index.js';
import { CATALOGUE_AUDIT_ACTIONS } from '../../../../../src/modules/catalogue/domain/audit-actions.js';
import { SubmitProductForReviewUseCase } from '../../../../../src/modules/catalogue/application/use-cases/submit-product-for-review.use-case.js';
import { DecideProductUseCase } from '../../../../../src/modules/catalogue/application/use-cases/decide-product.use-case.js';
import { ListProductReviewQueueUseCase } from '../../../../../src/modules/catalogue/application/use-cases/list-product-review-queue.use-case.js';
import { GetProductReviewUseCase } from '../../../../../src/modules/catalogue/application/use-cases/get-product-review.use-case.js';
import {
  IncompleteProductSubmissionError,
  ProductAlreadyDecidedError,
  ProductMediaNotReadyError,
  ProductNotFoundError,
  ProductSubmissionConflictError,
} from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { Category } from '../../../../../src/modules/catalogue/domain/entities/category.entity.js';
import { Product } from '../../../../../src/modules/catalogue/domain/entities/product.entity.js';
import { ProductMedia } from '../../../../../src/modules/catalogue/domain/entities/product-media.entity.js';
import { ProductRejectionReason } from '../../../../../src/modules/catalogue/domain/value-objects/product-rejection-reason.value-object.js';
import type { CategoryRepository } from '../../../../../src/modules/catalogue/domain/repositories/category.repository.js';
import type { ProductRepository } from '../../../../../src/modules/catalogue/domain/repositories/product.repository.js';
import type { ProductMediaRepository } from '../../../../../src/modules/catalogue/domain/repositories/product-media.repository.js';
import type { ProductReviewQueryPort } from '../../../../../src/modules/catalogue/application/ports/product-review-query.port.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../../../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategorySlug } from '../../../../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductMediaId } from '../../../../../src/modules/catalogue/domain/value-objects/product-media-id.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import {
  FailingAuditWriter,
  RecordingAuditWriter,
  RecordingOutboxWriter,
} from '../../identity/application/fakes.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);

const vendorId = toVendorId(ids.generate());
const categoryId = toCategoryId(ids.generate());
const admin = toUserId(ids.generate());

const vendorPrincipal: Principal = {
  userId: toUserId(ids.generate()),
  sessionId: toSessionId(ids.generate()),
  role: 'VENDOR_OWNER',
};

const adminPrincipal = (userId = admin): Principal => ({
  userId,
  sessionId: toSessionId(ids.generate()),
  role: 'CATALOGUE_MODERATOR',
});

let seq = 0;

const category = (
  requirements = { requiresHsn: false, requiresCountryOfOrigin: false, requiresNetQuantity: false },
): Category =>
  Category.create({
    id: categoryId,
    parent: null,
    name: `Category ${(seq += 1)}`,
    slug: toCategorySlug(`category-${seq}`),
    riskLevel: CategoryRiskLevel.LOW,
    requirements,
    now: NOW,
  });

const draftProduct = (overrides: Partial<{ hsnCode: string | null }> = {}): Product =>
  Product.create({
    id: toProductId(ids.generate()),
    vendorId,
    categoryId,
    name: 'Fresh Rohu Fish',
    brand: null,
    description: null,
    hsnCode: overrides.hsnCode ?? null,
    countryOfOrigin: null,
    netQuantity: null,
    attributeValues: {},
    now: NOW,
  });

const pendingProduct = (): Product => draftProduct().submitForReview(NOW);

const mediaOf = (
  productId: ReturnType<typeof toProductId> = toProductId(ids.generate()),
): ProductMedia =>
  ProductMedia.create({
    id: toProductMediaId(ids.generate()),
    productId,
    vendorId,
    objectKey: `product-media/${vendorId}/${productId}/x.jpg`,
    contentType: 'image/jpeg',
    sizeBytes: 2048,
    now: NOW,
  });

/** The one shape `DecideProductUseCase`'s S2-8 media-readiness gate accepts. */
const readyMedia = (productId?: ReturnType<typeof toProductId>): ProductMedia =>
  mediaOf(productId).completeUpload(NOW).markReady(NOW);
const processingMedia = (productId?: ReturnType<typeof toProductId>): ProductMedia =>
  mediaOf(productId).completeUpload(NOW);
const failedMedia = (productId?: ReturnType<typeof toProductId>): ProductMedia =>
  mediaOf(productId).completeUpload(NOW).markFailed('PROCESSING_ERROR', NOW);
const awaitingUploadMedia = (productId?: ReturnType<typeof toProductId>): ProductMedia =>
  mediaOf(productId);

/**
 * `listByProductId` already excludes soft-deleted rows (S2-8 relies on this
 * exactly the way the use case itself does) — defaults to one `READY` item so
 * every pre-existing `DecideProductUseCase` test in this file, which predates
 * the S2-8 gate and does not care about media, keeps passing unchanged.
 */
const mediaRepo = (overrides: Partial<ProductMediaRepository> = {}): ProductMediaRepository => {
  const repository: ProductMediaRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    findByProductAndId: vi.fn().mockResolvedValue(null),
    listByProductId: vi.fn().mockResolvedValue([readyMedia()]),
    countLiveForProduct: vi.fn().mockResolvedValue(1),
    completeIfAwaitingUpload: vi.fn().mockResolvedValue(true),
    markReadyIfProcessing: vi.fn().mockResolvedValue(true),
    markFailedIfProcessing: vi.fn().mockResolvedValue(true),
    markProcessingIfFailed: vi.fn().mockResolvedValue(true),
    softDelete: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return repository;
};

const runner = (onRollback?: () => void): TransactionRunner => ({
  run: async (work) => {
    try {
      return await work({} as TransactionScope);
    } catch (error) {
      onRollback?.();
      throw error;
    }
  },
});

const productRepo = (overrides: Partial<ProductRepository> = {}): ProductRepository => {
  const repository: ProductRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    update: vi.fn().mockResolvedValue(true),
    listPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    softDelete: vi.fn().mockResolvedValue(true),
    lockForVariantChange: vi.fn().mockResolvedValue(true),
    submitForReviewIfEligible: vi.fn().mockResolvedValue(true),
    decideIfPendingReview: vi.fn().mockResolvedValue(true),
    lockForMediaChange: vi.fn().mockResolvedValue(true),
    reenterReviewIfApproved: vi.fn().mockResolvedValue(true),
    updateAndReenterReviewIfApproved: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  return repository;
};

const categoryRepo = (found: Category | null): CategoryRepository => {
  const repository: CategoryRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
    updateMany: vi.fn(),
    findById: vi.fn().mockResolvedValue(found),
    findBySlug: vi.fn().mockResolvedValue(null),
    findDescendants: vi.fn().mockResolvedValue([]),
    listPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    softDeleteIfEmpty: vi.fn().mockResolvedValue(true),
    findAllActive: vi.fn().mockResolvedValue([]),
    findChildren: vi.fn().mockResolvedValue([]),
  };
  return repository;
};

const issueOf = async (act: () => Promise<unknown>): Promise<string> => {
  try {
    await act();
    return 'did not throw';
  } catch (error) {
    const failure = error as { details?: { field: string; issue: string }[] };
    return failure.details?.[0]?.issue ?? 'no detail';
  }
};

describe('SubmitProductForReviewUseCase', () => {
  const build = (
    products: ProductRepository,
    categories: CategoryRepository = categoryRepo(category()),
    auditWriter: AuditWriter = new RecordingAuditWriter(),
    onRollback?: () => void,
  ): SubmitProductForReviewUseCase =>
    new SubmitProductForReviewUseCase({
      productRepository: products,
      categoryRepository: categories,
      transactionRunner: runner(onRollback),
      auditWriter,
      clock,
      logger: new NullLogger(),
    });

  it('moves a DRAFT product to PENDING_REVIEW', async () => {
    const existing = draftProduct();
    const { product } = await build(
      productRepo({ findById: vi.fn().mockResolvedValue(existing) }),
    ).execute({ principal: vendorPrincipal, productId: existing.id });

    expect(product.status).toBe('PENDING_REVIEW');
  });

  it('is not found for an unknown product', async () => {
    await expect(
      build(productRepo()).execute({
        principal: vendorPrincipal,
        productId: toProductId(ids.generate()),
      }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });

  it('persists through the conditional write, never a plain update', async () => {
    const existing = draftProduct();
    const products = productRepo({ findById: vi.fn().mockResolvedValue(existing) });

    await build(products).execute({ principal: vendorPrincipal, productId: existing.id });

    expect(products.submitForReviewIfEligible).toHaveBeenCalledTimes(1);
    expect(products.update).not.toHaveBeenCalled();
  });

  describe('mandatory-field pre-screen (BR-15/BR-21)', () => {
    it('refuses submission when a required HSN code is missing', async () => {
      const existing = draftProduct();
      const products = productRepo({ findById: vi.fn().mockResolvedValue(existing) });
      const categories = categoryRepo(
        category({ requiresHsn: true, requiresCountryOfOrigin: false, requiresNetQuantity: false }),
      );

      await expect(
        build(products, categories).execute({ principal: vendorPrincipal, productId: existing.id }),
      ).rejects.toBeInstanceOf(IncompleteProductSubmissionError);
      expect(products.submitForReviewIfEligible).not.toHaveBeenCalled();
    });

    it('names every missing field', async () => {
      const existing = draftProduct();
      const products = productRepo({ findById: vi.fn().mockResolvedValue(existing) });
      const categories = categoryRepo(
        category({ requiresHsn: true, requiresCountryOfOrigin: true, requiresNetQuantity: true }),
      );

      expect(
        await issueOf(() =>
          build(products, categories).execute({
            principal: vendorPrincipal,
            productId: existing.id,
          }),
        ),
      ).toMatch(/hsnCode.*countryOfOrigin.*netQuantity/);
    });

    it('allows submission once the required field is present', async () => {
      const existing = draftProduct({ hsnCode: '0302' });
      const products = productRepo({ findById: vi.fn().mockResolvedValue(existing) });
      const categories = categoryRepo(
        category({ requiresHsn: true, requiresCountryOfOrigin: false, requiresNetQuantity: false }),
      );

      const { product } = await build(products, categories).execute({
        principal: vendorPrincipal,
        productId: existing.id,
      });
      expect(product.status).toBe('PENDING_REVIEW');
    });

    it('never checks fields not required by the category', async () => {
      // No requirements at all — a completely bare product must still submit.
      const existing = draftProduct();
      const products = productRepo({ findById: vi.fn().mockResolvedValue(existing) });

      await expect(
        build(products, categoryRepo(category())).execute({
          principal: vendorPrincipal,
          productId: existing.id,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe('resubmission', () => {
    it('moves a REJECTED product back to PENDING_REVIEW and clears the rejection', async () => {
      const rejected = pendingProduct().reject(ProductRejectionReason.OTHER, 'fix this', NOW);
      const products = productRepo({ findById: vi.fn().mockResolvedValue(rejected) });

      const { product } = await build(products).execute({
        principal: vendorPrincipal,
        productId: rejected.id,
      });

      expect(product.status).toBe('PENDING_REVIEW');
      expect(product.rejectionReason).toBeNull();
      expect(product.rejectionNote).toBeNull();
    });
  });

  describe('conflicts', () => {
    it('reports a lost submission race as a conflict, not a silent overwrite', async () => {
      const existing = draftProduct();
      const products = productRepo({
        findById: vi.fn().mockResolvedValue(existing),
        submitForReviewIfEligible: vi.fn().mockResolvedValue(false),
      });

      await expect(
        build(products).execute({ principal: vendorPrincipal, productId: existing.id }),
      ).rejects.toBeInstanceOf(ProductSubmissionConflictError);
    });

    it('lets the domain refuse a product already PENDING_REVIEW', async () => {
      const existing = pendingProduct();
      const products = productRepo({ findById: vi.fn().mockResolvedValue(existing) });

      expect(
        await issueOf(() =>
          build(products).execute({ principal: vendorPrincipal, productId: existing.id }),
        ),
      ).toMatch(/cannot be submitted/);
      expect(products.submitForReviewIfEligible).not.toHaveBeenCalled();
    });
  });

  describe('audit', () => {
    const entryOf = (writer: AuditWriter): AuditWriterInput => {
      const [entry] = (writer as RecordingAuditWriter).entries;
      if (!entry) throw new Error('expected an audit entry');
      return entry;
    };

    it('records exactly one audit event', async () => {
      const existing = draftProduct();
      const auditWriter = new RecordingAuditWriter();

      await build(
        productRepo({ findById: vi.fn().mockResolvedValue(existing) }),
        categoryRepo(category()),
        auditWriter,
      ).execute({
        principal: vendorPrincipal,
        productId: existing.id,
      });

      expect(auditWriter.entries).toHaveLength(1);
      expect(entryOf(auditWriter).action).toBe(
        CATALOGUE_AUDIT_ACTIONS.PRODUCT_SUBMITTED_FOR_REVIEW,
      );
    });

    it('writes no audit row when the submission race is lost', async () => {
      const existing = draftProduct();
      const auditWriter = new RecordingAuditWriter();
      const products = productRepo({
        findById: vi.fn().mockResolvedValue(existing),
        submitForReviewIfEligible: vi.fn().mockResolvedValue(false),
      });

      await expect(
        build(products, categoryRepo(category()), auditWriter).execute({
          principal: vendorPrincipal,
          productId: existing.id,
        }),
      ).rejects.toBeInstanceOf(ProductSubmissionConflictError);
      expect(auditWriter.entries).toHaveLength(0);
    });

    it('rolls back the submission when the audit write fails', async () => {
      const existing = draftProduct();
      let rolledBack = false;

      await expect(
        build(
          productRepo({ findById: vi.fn().mockResolvedValue(existing) }),
          categoryRepo(category()),
          new FailingAuditWriter(),
          () => {
            rolledBack = true;
          },
        ).execute({ principal: vendorPrincipal, productId: existing.id }),
      ).rejects.toThrow(/audit log unavailable/);

      expect(rolledBack).toBe(true);
    });
  });
});

describe('DecideProductUseCase', () => {
  const build = (
    products: ProductRepository = productRepo({
      findById: vi.fn().mockResolvedValue(pendingProduct()),
    }),
    auditWriter: AuditWriter = new RecordingAuditWriter(),
    onRollback?: () => void,
    media: ProductMediaRepository = mediaRepo(),
  ): DecideProductUseCase =>
    new DecideProductUseCase({
      productRepository: products,
      productMediaRepository: media,
      transactionRunner: runner(onRollback),
      auditWriter,
      outboxWriter: new RecordingOutboxWriter(),
      clock,
      logger: new NullLogger(),
    });

  describe('published events (S6-NOTIFY-LIFECYCLE)', () => {
    /** Built directly rather than through `build`, so the recorder is reachable for assertions. */
    const withOutbox = (
      outboxWriter: RecordingOutboxWriter,
      auditWriter: AuditWriter = new RecordingAuditWriter(),
      onRollback?: () => void,
    ): DecideProductUseCase =>
      new DecideProductUseCase({
        productRepository: productRepo({ findById: vi.fn().mockResolvedValue(pendingProduct()) }),
        productMediaRepository: mediaRepo(),
        transactionRunner: runner(onRollback),
        auditWriter,
        outboxWriter,
        clock,
        logger: new NullLogger(),
      });
    it('publishes exactly one product.approved on approval', async () => {
      const outbox = new RecordingOutboxWriter();

      await withOutbox(outbox).execute({
        principal: adminPrincipal(),
        productId: toProductId(ids.generate()),
        command: { decision: 'APPROVE' },
      });

      expect(outbox.events).toHaveLength(1);
      expect(outbox.events[0]).toMatchObject({
        eventType: 'product.approved',
        aggregateType: 'Product',
      });
    });

    it('publishes exactly one product.rejected on rejection', async () => {
      const outbox = new RecordingOutboxWriter();

      await withOutbox(outbox).execute({
        principal: adminPrincipal(),
        productId: toProductId(ids.generate()),
        command: { decision: 'REJECT', reason: 'POLICY_VIOLATION', note: 'reviewer prose' },
      });

      expect(outbox.events).toHaveLength(1);
      expect(outbox.events[0]?.eventType).toBe('product.rejected');
    });

    it('names the vendor in the payload, so the consumer needs no reach into products', async () => {
      const outbox = new RecordingOutboxWriter();

      await withOutbox(outbox).execute({
        principal: adminPrincipal(),
        productId: toProductId(ids.generate()),
        command: { decision: 'APPROVE' },
      });

      expect(outbox.events[0]?.payload).toHaveProperty('vendorId');
      expect(outbox.events[0]?.payload).toHaveProperty('productId');
    });

    it('never puts the rejection reason or the reviewer’s note in the payload', async () => {
      // The same restraint the audit row and the log line already apply.
      const outbox = new RecordingOutboxWriter();
      const note = 'internal reviewer prose about this vendor';

      await withOutbox(outbox).execute({
        principal: adminPrincipal(),
        productId: toProductId(ids.generate()),
        command: { decision: 'REJECT', reason: 'POLICY_VIOLATION', note },
      });

      const serialised = JSON.stringify(outbox.events);
      expect(serialised).not.toContain(note);
      expect(serialised).not.toContain('POLICY_VIOLATION');
    });

    it('publishes nothing when the transaction rolls back', async () => {
      // A failing audit write aborts the transaction; the event must not
      // survive to announce a decision that never committed.
      const outbox = new RecordingOutboxWriter();
      let rolledBack = false;

      await expect(
        withOutbox(outbox, new FailingAuditWriter(), () => {
          rolledBack = true;
        }).execute({
          principal: adminPrincipal(),
          productId: toProductId(ids.generate()),
          command: { decision: 'APPROVE' },
        }),
      ).rejects.toThrow();

      expect(rolledBack).toBe(true);
      // The audit write throws before the outbox write is reached, so nothing
      // was even attempted — and the real writer is transactional besides.
      expect(outbox.events).toHaveLength(0);
    });
  });

  describe('approval', () => {
    it('moves the product to APPROVED', async () => {
      const { product } = await build().execute({
        principal: adminPrincipal(),
        productId: toProductId(ids.generate()),
        command: { decision: 'APPROVE' },
      });

      expect(product.status).toBe('APPROVED');
    });

    it('persists through the conditional decision, never a plain update', async () => {
      const products = productRepo({ findById: vi.fn().mockResolvedValue(pendingProduct()) });

      await build(products).execute({
        principal: adminPrincipal(),
        productId: toProductId(ids.generate()),
        command: { decision: 'APPROVE' },
      });

      expect(products.decideIfPendingReview).toHaveBeenCalledTimes(1);
      expect(products.update).not.toHaveBeenCalled();
    });

    it('refuses a product that is not PENDING_REVIEW', async () => {
      const products = productRepo({ findById: vi.fn().mockResolvedValue(draftProduct()) });

      expect(
        await issueOf(() =>
          build(products).execute({
            principal: adminPrincipal(),
            productId: toProductId(ids.generate()),
            command: { decision: 'APPROVE' },
          }),
        ),
      ).toMatch(/must be in PENDING_REVIEW/);
    });
  });

  describe('media readiness gate (S2-8, SDD 12.2 step 6)', () => {
    const approve = (
      products: ProductRepository,
      media: ProductMediaRepository,
    ): Promise<{ product: Product }> =>
      build(products, new RecordingAuditWriter(), undefined, media).execute({
        principal: adminPrincipal(),
        productId: toProductId(ids.generate()),
        command: { decision: 'APPROVE' },
      });

    it('rejects approval with zero media', async () => {
      const products = productRepo({ findById: vi.fn().mockResolvedValue(pendingProduct()) });
      const media = mediaRepo({ listByProductId: vi.fn().mockResolvedValue([]) });

      await expect(approve(products, media)).rejects.toBeInstanceOf(ProductMediaNotReadyError);
      expect(products.decideIfPendingReview).not.toHaveBeenCalled();
    });

    it('rejects approval when the only media is soft-deleted', async () => {
      // listByProductId already excludes deleted rows — this is the same
      // "no live media" case as zero media, from the gate's point of view.
      const products = productRepo({ findById: vi.fn().mockResolvedValue(pendingProduct()) });
      const media = mediaRepo({ listByProductId: vi.fn().mockResolvedValue([]) });

      await expect(approve(products, media)).rejects.toBeInstanceOf(ProductMediaNotReadyError);
    });

    it('allows approval with exactly one READY item', async () => {
      const products = productRepo({ findById: vi.fn().mockResolvedValue(pendingProduct()) });
      const media = mediaRepo({ listByProductId: vi.fn().mockResolvedValue([readyMedia()]) });

      const { product } = await approve(products, media);
      expect(product.status).toBe('APPROVED');
    });

    it('allows approval with multiple READY items', async () => {
      const products = productRepo({ findById: vi.fn().mockResolvedValue(pendingProduct()) });
      const media = mediaRepo({
        listByProductId: vi.fn().mockResolvedValue([readyMedia(), readyMedia(), readyMedia()]),
      });

      const { product } = await approve(products, media);
      expect(product.status).toBe('APPROVED');
    });

    it.each([
      ['READY + PROCESSING', () => [readyMedia(), processingMedia()]],
      ['READY + FAILED', () => [readyMedia(), failedMedia()]],
      ['READY + AWAITING_UPLOAD', () => [readyMedia(), awaitingUploadMedia()]],
      ['only PROCESSING', () => [processingMedia()]],
      ['only FAILED', () => [failedMedia()]],
      ['only AWAITING_UPLOAD', () => [awaitingUploadMedia()]],
    ])('rejects approval for %s', async (_label, items) => {
      const products = productRepo({ findById: vi.fn().mockResolvedValue(pendingProduct()) });
      const media = mediaRepo({ listByProductId: vi.fn().mockResolvedValue(items()) });

      await expect(approve(products, media)).rejects.toBeInstanceOf(ProductMediaNotReadyError);
    });

    it('ignores a soft-deleted PROCESSING/FAILED item when a live READY one exists', async () => {
      // listByProductId's own "live only" contract is what makes this
      // correct — the deleted rows simply never appear in the list the gate
      // reads, so no separate deleted-vs-live filtering is needed here.
      const products = productRepo({ findById: vi.fn().mockResolvedValue(pendingProduct()) });
      const media = mediaRepo({ listByProductId: vi.fn().mockResolvedValue([readyMedia()]) });

      const { product } = await approve(products, media);
      expect(product.status).toBe('APPROVED');
    });

    it('leaves the product status unchanged when approval is refused for media', async () => {
      const pending = pendingProduct();
      const products = productRepo({ findById: vi.fn().mockResolvedValue(pending) });
      const media = mediaRepo({ listByProductId: vi.fn().mockResolvedValue([]) });

      await expect(approve(products, media)).rejects.toBeInstanceOf(ProductMediaNotReadyError);

      expect(products.decideIfPendingReview).not.toHaveBeenCalled();
      expect(pending.status).toBe('PENDING_REVIEW');
    });

    it('does not gate a REJECT decision on media at all', async () => {
      const products = productRepo({ findById: vi.fn().mockResolvedValue(pendingProduct()) });
      const media = mediaRepo({ listByProductId: vi.fn().mockResolvedValue([]) });

      const { product } = await build(
        products,
        new RecordingAuditWriter(),
        undefined,
        media,
      ).execute({
        principal: adminPrincipal(),
        productId: toProductId(ids.generate()),
        command: { decision: 'REJECT', reason: 'PRICING_ISSUE' },
      });

      expect(product.status).toBe('REJECTED');
    });

    it('checks media readiness only after confirming the product is legally decidable', async () => {
      // A DRAFT product must still answer "must be in PENDING_REVIEW", never
      // a media error that would be true but beside the point.
      const products = productRepo({ findById: vi.fn().mockResolvedValue(draftProduct()) });
      const media = mediaRepo({ listByProductId: vi.fn().mockResolvedValue([]) });

      expect(
        await issueOf(() =>
          build(products, new RecordingAuditWriter(), undefined, media).execute({
            principal: adminPrincipal(),
            productId: toProductId(ids.generate()),
            command: { decision: 'APPROVE' },
          }),
        ),
      ).toMatch(/must be in PENDING_REVIEW/);
    });
  });

  describe('rejection', () => {
    it.each([
      'INCOMPLETE_MANDATORY_FIELDS',
      'POLICY_VIOLATION',
      'MISLEADING_LISTING',
      'DUPLICATE_LISTING',
      'PRICING_ISSUE',
      'OTHER',
    ])('accepts %s with a note', async (reason) => {
      const { product } = await build().execute({
        principal: adminPrincipal(),
        productId: toProductId(ids.generate()),
        command: { decision: 'REJECT', reason, note: 'Explanation for the vendor.' },
      });

      expect(product.status).toBe('REJECTED');
      expect(product.rejectionReason?.name).toBe(reason);
      expect(product.rejectionNote).toBe('Explanation for the vendor.');
    });

    it('accepts REJECT with no note at all — SDD 15.2 makes it optional', async () => {
      const { product } = await build().execute({
        principal: adminPrincipal(),
        productId: toProductId(ids.generate()),
        command: { decision: 'REJECT', reason: 'PRICING_ISSUE' },
      });

      expect(product.status).toBe('REJECTED');
      expect(product.rejectionReason?.name).toBe('PRICING_ISSUE');
      expect(product.rejectionNote).toBeNull();
    });

    it('refuses a supplied but blank note, through the domain rule — omit it instead', async () => {
      expect(
        await issueOf(() =>
          build().execute({
            principal: adminPrincipal(),
            productId: toProductId(ids.generate()),
            command: { decision: 'REJECT', reason: 'PRICING_ISSUE', note: '   ' },
          }),
        ),
      ).toMatch(/must not be blank/);
    });

    it('rejects a reason outside the closed set', async () => {
      expect(
        await issueOf(() =>
          build().execute({
            principal: adminPrincipal(),
            productId: toProductId(ids.generate()),
            command: { decision: 'REJECT', reason: 'BECAUSE_I_SAID_SO', note: 'x' },
          }),
        ),
      ).toMatch(/must be one of/);
    });
  });

  describe('conflicts', () => {
    it('reports a lost decision race as a conflict, not a silent overwrite', async () => {
      const products = productRepo({
        findById: vi.fn().mockResolvedValue(pendingProduct()),
        decideIfPendingReview: vi.fn().mockResolvedValue(false),
      });

      await expect(
        build(products).execute({
          principal: adminPrincipal(),
          productId: toProductId(ids.generate()),
          command: { decision: 'APPROVE' },
        }),
      ).rejects.toBeInstanceOf(ProductAlreadyDecidedError);
    });

    it('reports a missing product as not found', async () => {
      const products = productRepo({ findById: vi.fn().mockResolvedValue(null) });

      await expect(
        build(products).execute({
          principal: adminPrincipal(),
          productId: toProductId(ids.generate()),
          command: { decision: 'APPROVE' },
        }),
      ).rejects.toBeInstanceOf(ProductNotFoundError);
    });
  });

  describe('audit', () => {
    const entryOf = (writer: AuditWriter): AuditWriterInput => {
      const [entry] = (writer as RecordingAuditWriter).entries;
      if (!entry) throw new Error('expected an audit entry');
      return entry;
    };

    it('records the approved action, product id and deciding admin', async () => {
      const auditWriter = new RecordingAuditWriter();

      await build(undefined, auditWriter).execute({
        principal: adminPrincipal(admin),
        productId: toProductId(ids.generate()),
        command: { decision: 'APPROVE' },
      });

      const entry = entryOf(auditWriter);
      expect(entry.action).toBe(CATALOGUE_AUDIT_ACTIONS.PRODUCT_APPROVED);
      expect(entry.actorId).toBe(admin);
    });

    it('records the coded rejection reason and never the free-text note', async () => {
      const auditWriter = new RecordingAuditWriter();
      const note = 'Reviewer prose about this specific listing.';

      await build(undefined, auditWriter).execute({
        principal: adminPrincipal(),
        productId: toProductId(ids.generate()),
        command: { decision: 'REJECT', reason: 'POLICY_VIOLATION', note },
      });

      const entry = entryOf(auditWriter);
      expect(entry.action).toBe(CATALOGUE_AUDIT_ACTIONS.PRODUCT_REJECTED);
      expect(entry.reason).toBe('POLICY_VIOLATION');
      expect(JSON.stringify(entry)).not.toContain(note);
    });

    it('writes no audit row when the decision race is lost', async () => {
      const auditWriter = new RecordingAuditWriter();
      const products = productRepo({
        findById: vi.fn().mockResolvedValue(pendingProduct()),
        decideIfPendingReview: vi.fn().mockResolvedValue(false),
      });

      await expect(
        build(products, auditWriter).execute({
          principal: adminPrincipal(),
          productId: toProductId(ids.generate()),
          command: { decision: 'APPROVE' },
        }),
      ).rejects.toBeInstanceOf(ProductAlreadyDecidedError);
      expect(auditWriter.entries).toHaveLength(0);
    });

    it('rolls back the decision when the audit write fails', async () => {
      let rolledBack = false;

      await expect(
        build(undefined, new FailingAuditWriter(), () => {
          rolledBack = true;
        }).execute({
          principal: adminPrincipal(),
          productId: toProductId(ids.generate()),
          command: { decision: 'APPROVE' },
        }),
      ).rejects.toThrow(/audit log unavailable/);

      expect(rolledBack).toBe(true);
    });
  });
});

describe('ListProductReviewQueueUseCase', () => {
  const queryPort = (overrides: Partial<ProductReviewQueryPort> = {}): ProductReviewQueryPort => ({
    listForReview: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    findDetailById: vi.fn().mockResolvedValue(null),
    ...overrides,
  });

  it('defaults to PENDING_REVIEW only — there is no claim step to widen it', async () => {
    const listForReview = vi
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    const useCase = new ListProductReviewQueueUseCase({
      productReviewQuery: queryPort({ listForReview }),
      logger: new NullLogger(),
    });

    await useCase.execute({ limit: 20 });

    expect(listForReview).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['PENDING_REVIEW'] }),
    );
  });

  it('passes through an explicit status filter', async () => {
    const listForReview = vi
      .fn()
      .mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    const useCase = new ListProductReviewQueueUseCase({
      productReviewQuery: queryPort({ listForReview }),
      logger: new NullLogger(),
    });

    await useCase.execute({ statuses: ['APPROVED', 'REJECTED'], limit: 20 });

    expect(listForReview).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: ['APPROVED', 'REJECTED'] }),
    );
  });
});

describe('GetProductReviewUseCase', () => {
  it('is not found for an unknown product', async () => {
    const useCase = new GetProductReviewUseCase({
      productReviewQuery: {
        listForReview: vi.fn(),
        findDetailById: vi.fn().mockResolvedValue(null),
      },
      logger: new NullLogger(),
    });

    await expect(
      useCase.execute({ productId: toProductId(ids.generate()) }),
    ).rejects.toBeInstanceOf(ProductNotFoundError);
  });
});
