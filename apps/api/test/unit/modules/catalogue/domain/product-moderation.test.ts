import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/index.js';
import {
  Product,
  type ProductStatusName,
} from '../../../../../src/modules/catalogue/domain/entities/product.entity.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { ProductRejectionReason } from '../../../../../src/modules/catalogue/domain/value-objects/product-rejection-reason.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');
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

const pendingReview = (): Product => draft().submitForReview(NOW);

const rejected = (): Product =>
  pendingReview().reject(
    ProductRejectionReason.MISLEADING_LISTING,
    'Title does not match photos',
    LATER,
  );

const issueOf = (act: () => unknown): string => {
  try {
    act();
    return 'did not throw';
  } catch (error) {
    const failure = error as { details?: { field: string; issue: string }[] };
    return failure.details?.[0]?.issue ?? 'no detail';
  }
};

describe('Product moderation transitions (S2-5)', () => {
  describe('submitForReview', () => {
    it('moves a DRAFT product to PENDING_REVIEW', () => {
      const submitted = draft().submitForReview(NOW);
      expect(submitted.status).toBe('PENDING_REVIEW');
      expect(submitted.updatedAt).toEqual(NOW);
    });

    it('moves a REJECTED product back to PENDING_REVIEW, on resubmission', () => {
      const resubmitted = rejected().submitForReview(LATER);
      expect(resubmitted.status).toBe('PENDING_REVIEW');
    });

    it('clears any prior rejection on resubmission', () => {
      const resubmitted = rejected().submitForReview(LATER);
      expect(resubmitted.rejectionReason).toBeNull();
      expect(resubmitted.rejectionNote).toBeNull();
    });

    it.each<ProductStatusName>(['PENDING_REVIEW', 'APPROVED'])(
      'refuses submission from %s',
      (status) => {
        const product =
          status === 'PENDING_REVIEW' ? pendingReview() : pendingReview().approve(NOW);
        expect(issueOf(() => product.submitForReview(LATER))).toMatch(/cannot be submitted/i);
      },
    );

    it('refuses submission of a deleted product', () => {
      const deleted = draft().softDelete(NOW);
      expect(issueOf(() => deleted.submitForReview(LATER))).toMatch(/deleted/i);
    });
  });

  describe('approve', () => {
    it('moves a PENDING_REVIEW product to APPROVED', () => {
      const approved = pendingReview().approve(LATER);
      expect(approved.status).toBe('APPROVED');
      expect(approved.updatedAt).toEqual(LATER);
    });

    it('carries no rejection', () => {
      const approved = pendingReview().approve(LATER);
      expect(approved.rejectionReason).toBeNull();
      expect(approved.rejectionNote).toBeNull();
    });

    it.each<ProductStatusName>(['DRAFT', 'APPROVED', 'REJECTED'])(
      'refuses approval from %s',
      (status) => {
        const product =
          status === 'DRAFT'
            ? draft()
            : status === 'APPROVED'
              ? pendingReview().approve(NOW)
              : rejected();
        expect(issueOf(() => product.approve(LATER))).toMatch(/must be in PENDING_REVIEW/i);
      },
    );
  });

  describe('reject', () => {
    it('moves a PENDING_REVIEW product to REJECTED with the reason and note', () => {
      const result = pendingReview().reject(
        ProductRejectionReason.PRICING_ISSUE,
        'Price is implausible',
        LATER,
      );
      expect(result.status).toBe('REJECTED');
      expect(result.rejectionReason?.name).toBe('PRICING_ISSUE');
      expect(result.rejectionNote).toBe('Price is implausible');
      expect(result.updatedAt).toEqual(LATER);
    });

    it('moves a PENDING_REVIEW product to REJECTED with the reason and no note (SDD 15.2: note is optional)', () => {
      const result = pendingReview().reject(ProductRejectionReason.PRICING_ISSUE, null, LATER);
      expect(result.status).toBe('REJECTED');
      expect(result.rejectionReason?.name).toBe('PRICING_ISSUE');
      expect(result.rejectionNote).toBeNull();
    });

    it('trims a supplied note', () => {
      const result = pendingReview().reject(ProductRejectionReason.OTHER, '  needs work  ', LATER);
      expect(result.rejectionNote).toBe('needs work');
    });

    it('refuses a supplied but blank note, for every reason — a caller that writes nothing should omit it, not send whitespace', () => {
      expect(
        issueOf(() => pendingReview().reject(ProductRejectionReason.DUPLICATE_LISTING, '', LATER)),
      ).toMatch(/must not be blank/i);
      expect(
        issueOf(() =>
          pendingReview().reject(ProductRejectionReason.DUPLICATE_LISTING, '   ', LATER),
        ),
      ).toMatch(/must not be blank/i);
    });

    it('refuses a note over 1000 characters', () => {
      expect(
        issueOf(() =>
          pendingReview().reject(ProductRejectionReason.OTHER, 'x'.repeat(1001), LATER),
        ),
      ).toMatch(/at most 1000/i);
    });

    it('accepts a note at exactly the length limit', () => {
      expect(() =>
        pendingReview().reject(ProductRejectionReason.OTHER, 'x'.repeat(1000), LATER),
      ).not.toThrow();
    });

    it.each<ProductStatusName>(['DRAFT', 'APPROVED', 'REJECTED'])(
      'refuses rejection from %s',
      (status) => {
        const product =
          status === 'DRAFT'
            ? draft()
            : status === 'APPROVED'
              ? pendingReview().approve(NOW)
              : rejected();
        expect(issueOf(() => product.reject(ProductRejectionReason.OTHER, null, LATER))).toMatch(
          /must be in PENDING_REVIEW/i,
        );
      },
    );
  });

  describe('updateDetails interaction', () => {
    it('does not clear a rejection by itself — only submitForReview does', () => {
      const edited = rejected().updateDetails({ name: 'Fixed name' }, LATER);
      expect(edited.status).toBe('REJECTED');
      expect(edited.rejectionReason?.name).toBe('MISLEADING_LISTING');
    });
  });

  describe('reenterReviewForMediaChange (S2-6a, ASM-14)', () => {
    it('moves an APPROVED product back to PENDING_REVIEW', () => {
      const approved = pendingReview().approve(NOW);
      const reopened = approved.reenterReviewForMediaChange(LATER);
      expect(reopened.status).toBe('PENDING_REVIEW');
      expect(reopened.updatedAt).toEqual(LATER);
    });

    it('touches only status and updatedAt — title, category, brand and every other field are untouched', () => {
      const approved = pendingReview().approve(NOW);
      const reopened = approved.reenterReviewForMediaChange(LATER);

      expect(reopened.name).toBe(approved.name);
      expect(reopened.categoryId).toBe(approved.categoryId);
      expect(reopened.brand).toBe(approved.brand);
      expect(reopened.id).toBe(approved.id);
      expect(reopened.vendorId).toBe(approved.vendorId);
    });

    it('carries no rejection — this is not a decision, just a reopening', () => {
      const reopened = pendingReview().approve(NOW).reenterReviewForMediaChange(LATER);
      expect(reopened.rejectionReason).toBeNull();
      expect(reopened.rejectionNote).toBeNull();
    });

    it.each<ProductStatusName>(['DRAFT', 'PENDING_REVIEW', 'REJECTED'])(
      'refuses from %s — only an APPROVED product can be returned to review this way',
      (status) => {
        const product =
          status === 'DRAFT' ? draft() : status === 'PENDING_REVIEW' ? pendingReview() : rejected();
        expect(issueOf(() => product.reenterReviewForMediaChange(LATER))).toMatch(
          /must be APPROVED/i,
        );
      },
    );

    it('refuses on a deleted product', () => {
      const deleted = pendingReview().approve(NOW).softDelete(LATER);
      expect(issueOf(() => deleted.reenterReviewForMediaChange(LATER))).toMatch(/deleted/i);
    });
  });
});
