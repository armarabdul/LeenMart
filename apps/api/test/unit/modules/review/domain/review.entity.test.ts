import { describe, expect, it } from 'vitest';
import { toUserId } from '../../../../../src/modules/identity/index.js';
import { toProductId, toProductVariantId } from '../../../../../src/modules/catalogue/index.js';
import { toOrderItemId, toSubOrderId } from '../../../../../src/modules/order/index.js';
import { Review } from '../../../../../src/modules/review/domain/entities/review.entity.js';
import {
  InvalidReviewBodyError,
  InvalidReviewModerationTransitionError,
  InvalidReviewRatingError,
} from '../../../../../src/modules/review/domain/errors/review-errors.js';
import { toReviewId } from '../../../../../src/modules/review/domain/value-objects/review-id.value-object.js';

const id = toReviewId('00000000-0000-7000-8000-0000000000b1');
const customerId = toUserId('00000000-0000-7000-8000-0000000000b2');
const productId = toProductId('00000000-0000-7000-8000-0000000000b3');
const variantId = toProductVariantId('00000000-0000-7000-8000-0000000000b4');
const subOrderId = toSubOrderId('00000000-0000-7000-8000-0000000000b5');
const orderItemId = toOrderItemId('00000000-0000-7000-8000-0000000000b6');
const now = new Date('2026-08-21T00:00:00.000Z');

const submit = (overrides: { rating?: number; body?: string } = {}): Review =>
  Review.submit({
    id,
    customerId,
    productId,
    variantId,
    subOrderId,
    orderItemId,
    rating: overrides.rating ?? 5,
    body: overrides.body ?? 'Fresh, well packed, arrived on time.',
    now,
  });

describe('Review.submit (S8-REVIEWS)', () => {
  it('creates a review in SUBMITTED status with every field carried through', () => {
    const review = submit();

    expect(review.id).toBe(id);
    expect(review.customerId).toBe(customerId);
    expect(review.productId).toBe(productId);
    expect(review.variantId).toBe(variantId);
    expect(review.subOrderId).toBe(subOrderId);
    expect(review.orderItemId).toBe(orderItemId);
    expect(review.rating).toBe(5);
    expect(review.body).toBe('Fresh, well packed, arrived on time.');
    expect(review.status).toBe('SUBMITTED');
    expect(review.createdAt).toEqual(now);
    expect(review.updatedAt).toEqual(now);
  });

  it('trims the body', () => {
    const review = submit({ body: '  Great product!  ' });
    expect(review.body).toBe('Great product!');
  });

  describe('rating boundaries (locked V1 scope: integer 1–5 only)', () => {
    it.each([1, 2, 3, 4, 5])('accepts %i', (rating) => {
      expect(submit({ rating }).rating).toBe(rating);
    });

    it('rejects 0', () => {
      expect(() => submit({ rating: 0 })).toThrow(InvalidReviewRatingError);
    });

    it('rejects 6', () => {
      expect(() => submit({ rating: 6 })).toThrow(InvalidReviewRatingError);
    });

    it('rejects a negative rating', () => {
      expect(() => submit({ rating: -1 })).toThrow(InvalidReviewRatingError);
    });

    it('rejects a non-integer rating', () => {
      expect(() => submit({ rating: 4.5 })).toThrow(InvalidReviewRatingError);
    });

    it('rejects NaN', () => {
      expect(() => submit({ rating: Number.NaN })).toThrow(InvalidReviewRatingError);
    });
  });

  describe('body', () => {
    it('rejects an empty body', () => {
      expect(() => submit({ body: '' })).toThrow(InvalidReviewBodyError);
    });

    it('rejects a whitespace-only body', () => {
      expect(() => submit({ body: '   ' })).toThrow(InvalidReviewBodyError);
    });

    it('accepts a body at exactly the 2000-character limit', () => {
      const body = 'a'.repeat(2000);
      expect(submit({ body }).body).toBe(body);
    });

    it('rejects a body over the 2000-character limit', () => {
      const body = 'a'.repeat(2001);
      expect(() => submit({ body })).toThrow(InvalidReviewBodyError);
    });
  });
});

describe('Review moderation transitions (S8-REVIEWS locked V1 states)', () => {
  const laterNow = new Date('2026-08-22T00:00:00.000Z');

  describe('approve()', () => {
    it('SUBMITTED -> APPROVED', () => {
      const approved = submit().approve(laterNow);
      expect(approved.status).toBe('APPROVED');
      expect(approved.updatedAt).toEqual(laterNow);
    });

    it('HIDDEN -> APPROVED (restoring visibility)', () => {
      const hidden = submit().hide(now);
      const restored = hidden.approve(laterNow);
      expect(restored.status).toBe('APPROVED');
    });

    it('refuses APPROVED -> APPROVED (already decided)', () => {
      const approved = submit().approve(now);
      expect(() => approved.approve(laterNow)).toThrow(InvalidReviewModerationTransitionError);
    });

    it('does not mutate the original instance', () => {
      const review = submit();
      review.approve(laterNow);
      expect(review.status).toBe('SUBMITTED');
    });
  });

  describe('hide()', () => {
    it('SUBMITTED -> HIDDEN', () => {
      const hidden = submit().hide(laterNow);
      expect(hidden.status).toBe('HIDDEN');
      expect(hidden.updatedAt).toEqual(laterNow);
    });

    it('APPROVED -> HIDDEN', () => {
      const approved = submit().approve(now);
      const hidden = approved.hide(laterNow);
      expect(hidden.status).toBe('HIDDEN');
    });

    it('refuses HIDDEN -> HIDDEN (already hidden)', () => {
      const hidden = submit().hide(now);
      expect(() => hidden.hide(laterNow)).toThrow(InvalidReviewModerationTransitionError);
    });
  });
});
