import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { PrismaProductRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-product.repository.js';
import { Product } from '../../src/modules/catalogue/domain/entities/product.entity.js';
import { Category } from '../../src/modules/catalogue/domain/entities/category.entity.js';
import { PrismaCategoryRepository } from '../../src/modules/catalogue/infrastructure/persistence/prisma-category.repository.js';
import { CategoryRiskLevel } from '../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategoryId } from '../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { toCategorySlug } from '../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';
import { toProductId } from '../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { ProductRejectionReason } from '../../src/modules/catalogue/domain/value-objects/product-rejection-reason.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const SLUG_PREFIX = 'product-mod-repo-cat-';
const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');

const NO_REQUIREMENTS = {
  requiresHsn: false,
  requiresCountryOfOrigin: false,
  requiresNetQuantity: false,
};

/**
 * `submitForReviewIfEligible`/`decideIfPendingReview` against real
 * PostgreSQL (S2-5) — the conditional writes that arbitrate concurrent
 * submissions and decisions. Run on the owner connection, no RLS assertions
 * here; those belong to `product-rls-isolation.test.ts`. Mirrors
 * `prisma-inventory.repository.test.ts`'s conditional-write proofs.
 */
describe('PrismaProductRepository moderation transitions', () => {
  const db = new PrismaClient();
  const repository = new PrismaProductRepository(db);
  const categoryRepository = new PrismaCategoryRepository(db);

  const userId = toUserId(ids.generate());
  const vendorId = toVendorId(ids.generate());
  const categoryId = toCategoryId(ids.generate());

  const draft = (): Product =>
    Product.create({
      id: toProductId(ids.generate()),
      vendorId,
      categoryId,
      name: 'Fresh Rohu Fish',
      brand: null,
      description: null,
      hsnCode: null,
      countryOfOrigin: null,
      netQuantity: null,
      attributeValues: {},
      now: NOW,
    });

  const seeded = async (): Promise<Product> => {
    const product = draft();
    await repository.create(product);
    return product;
  };

  beforeAll(async () => {
    const stamp = Date.now();
    await db.user.create({
      data: {
        id: userId,
        email: `product-mod-repo-${stamp}@example.com`,
        passwordHash: 'hashed:x',
      },
    });
    await db.vendorProfile.create({
      data: { id: vendorId, userId, status: 'REGISTERED', createdAt: NOW, updatedAt: NOW },
    });
    const category = Category.create({
      id: categoryId,
      parent: null,
      name: `${SLUG_PREFIX}${stamp}`,
      slug: toCategorySlug(`${SLUG_PREFIX}${stamp}`),
      riskLevel: CategoryRiskLevel.LOW,
      requirements: NO_REQUIREMENTS,
      now: NOW,
    });
    await categoryRepository.create(category);
  });

  afterAll(async () => {
    await db.product.deleteMany({ where: { vendorId } });
    await db.category.deleteMany({ where: { id: categoryId } });
    await db.vendorProfile.deleteMany({ where: { id: vendorId } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  });

  describe('submitForReviewIfEligible', () => {
    it('moves an eligible DRAFT row to PENDING_REVIEW', async () => {
      const product = await seeded();
      const submitted = product.submitForReview(NOW);

      expect(await repository.submitForReviewIfEligible(submitted)).toBe(true);

      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.status).toBe('PENDING_REVIEW');
    });

    it('refuses a row that is no longer DRAFT/REJECTED', async () => {
      const product = await seeded();
      const submitted = product.submitForReview(NOW);
      expect(await repository.submitForReviewIfEligible(submitted)).toBe(true);

      // Same transition applied again against the now-stale in-memory entity.
      expect(await repository.submitForReviewIfEligible(submitted)).toBe(false);

      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.status).toBe('PENDING_REVIEW');
    });

    it('lets exactly one of two simultaneous submissions win, never a silent overwrite', async () => {
      const product = await seeded();
      const submitted = product.submitForReview(NOW);

      const results = await Promise.all([
        repository.submitForReviewIfEligible(submitted),
        repository.submitForReviewIfEligible(submitted),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.status).toBe('PENDING_REVIEW');
    });
  });

  describe('decideIfPendingReview', () => {
    const pending = async (): Promise<Product> => {
      const product = await seeded();
      const submitted = product.submitForReview(NOW);
      await repository.submitForReviewIfEligible(submitted);
      return submitted;
    };

    it('moves an eligible PENDING_REVIEW row to APPROVED', async () => {
      const product = await pending();
      const approved = product.approve(LATER);

      expect(await repository.decideIfPendingReview(approved)).toBe(true);

      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.status).toBe('APPROVED');
      expect(row.rejectionReason).toBeNull();
      expect(row.rejectionNote).toBeNull();
    });

    it('moves an eligible PENDING_REVIEW row to REJECTED with the reason and note', async () => {
      const product = await pending();
      const rejected = product.reject(ProductRejectionReason.PRICING_ISSUE, 'Too expensive', LATER);

      expect(await repository.decideIfPendingReview(rejected)).toBe(true);

      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.status).toBe('REJECTED');
      expect(row.rejectionReason).toBe('PRICING_ISSUE');
      expect(row.rejectionNote).toBe('Too expensive');
    });

    it('moves an eligible PENDING_REVIEW row to REJECTED with the reason and no note (SDD 15.2: note is optional)', async () => {
      const product = await pending();
      const rejected = product.reject(ProductRejectionReason.PRICING_ISSUE, null, LATER);

      expect(await repository.decideIfPendingReview(rejected)).toBe(true);

      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.status).toBe('REJECTED');
      expect(row.rejectionReason).toBe('PRICING_ISSUE');
      expect(row.rejectionNote).toBeNull();
    });

    it('refuses a row that is no longer PENDING_REVIEW', async () => {
      const product = await pending();
      const approved = product.approve(LATER);
      expect(await repository.decideIfPendingReview(approved)).toBe(true);

      // A second decision attempt against the same stale entity.
      const rejected = product.reject(ProductRejectionReason.OTHER, 'too late', LATER);
      expect(await repository.decideIfPendingReview(rejected)).toBe(false);

      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.status).toBe('APPROVED');
    });

    it('lets exactly one of two simultaneous decisions win, with no last-writer-wins', async () => {
      const product = await pending();
      const approved = product.approve(LATER);
      const rejected = product.reject(ProductRejectionReason.OTHER, 'clashing decision', LATER);

      const results = await Promise.all([
        repository.decideIfPendingReview(approved),
        repository.decideIfPendingReview(rejected),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(['APPROVED', 'REJECTED']).toContain(row.status);
      // The persisted reason/note agree with whichever decision actually won.
      if (row.status === 'REJECTED') {
        expect(row.rejectionReason).toBe('OTHER');
      } else {
        expect(row.rejectionReason).toBeNull();
      }
    });

    it('the note-optional fix does not change which decision wins a race', async () => {
      // Same race as above, but the rejection carries no note — proving the
      // relaxed constraint didn't touch the arbitration itself.
      const product = await pending();
      const approved = product.approve(LATER);
      const rejected = product.reject(ProductRejectionReason.OTHER, null, LATER);

      const results = await Promise.all([
        repository.decideIfPendingReview(approved),
        repository.decideIfPendingReview(rejected),
      ]);

      expect(results.filter(Boolean)).toHaveLength(1);
      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(['APPROVED', 'REJECTED']).toContain(row.status);
      if (row.status === 'REJECTED') {
        expect(row.rejectionReason).toBe('OTHER');
        expect(row.rejectionNote).toBeNull();
      }
    });

    it('resubmission clears a prior rejection at the database level', async () => {
      const product = await pending();
      const rejected = product.reject(
        ProductRejectionReason.MISLEADING_LISTING,
        'fix title',
        LATER,
      );
      await repository.decideIfPendingReview(rejected);

      const resubmitted = rejected.submitForReview(LATER);
      expect(await repository.submitForReviewIfEligible(resubmitted)).toBe(true);

      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.status).toBe('PENDING_REVIEW');
      expect(row.rejectionReason).toBeNull();
      expect(row.rejectionNote).toBeNull();
    });
  });

  describe('chk_products_rejection_requires_reason_and_note (S2-5 review fix: reason required, note optional)', () => {
    it('refuses a REJECTED row with no reason, even from an owner connection', async () => {
      const product = await seeded();
      await expect(
        db.product.update({
          where: { id: product.id },
          data: { status: 'REJECTED', rejectionNote: 'orphan note' },
        }),
      ).rejects.toThrow();
    });

    it('allows a REJECTED row with a reason and no note — SDD 15.2 makes the note optional', async () => {
      const product = await seeded();
      await expect(
        db.product.update({
          where: { id: product.id },
          data: { status: 'REJECTED', rejectionReason: 'OTHER', rejectionNote: null },
        }),
      ).resolves.toBeDefined();

      const row = await db.product.findUniqueOrThrow({ where: { id: product.id } });
      expect(row.status).toBe('REJECTED');
      expect(row.rejectionReason).toBe('OTHER');
      expect(row.rejectionNote).toBeNull();
    });

    it('allows a REJECTED row with both a reason and a note', async () => {
      const product = await seeded();
      await expect(
        db.product.update({
          where: { id: product.id },
          data: { status: 'REJECTED', rejectionReason: 'OTHER', rejectionNote: 'explained' },
        }),
      ).resolves.toBeDefined();
    });

    it('refuses an APPROVED row carrying a rejection reason', async () => {
      const product = await seeded();
      await expect(
        db.product.update({
          where: { id: product.id },
          data: { status: 'APPROVED', rejectionReason: 'OTHER' },
        }),
      ).rejects.toThrow();
    });

    it('refuses a PENDING_REVIEW row carrying a rejection reason', async () => {
      const product = await seeded();
      await expect(
        db.product.update({
          where: { id: product.id },
          data: { status: 'PENDING_REVIEW', rejectionReason: 'OTHER' },
        }),
      ).rejects.toThrow();
    });

    it('refuses a DRAFT row carrying a rejection note with no reason', async () => {
      const product = await seeded();
      await expect(
        db.product.update({
          where: { id: product.id },
          data: { rejectionNote: 'orphaned' },
        }),
      ).rejects.toThrow();
    });
  });
});
