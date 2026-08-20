import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import { toUserId } from '../../../../../src/modules/identity/index.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { toProductId, toProductVariantId } from '../../../../../src/modules/catalogue/index.js';
import { toOrderItemId, toSubOrderId } from '../../../../../src/modules/order/index.js';
import { CreateReviewUseCase } from '../../../../../src/modules/review/application/use-cases/create-review.use-case.js';
import type { ReviewRepository } from '../../../../../src/modules/review/application/ports/review.repository.js';
import type { VerifiedPurchaseQuery } from '../../../../../src/modules/review/application/ports/verified-purchase-query.port.js';
import { PurchaseNotEligibleForReviewError } from '../../../../../src/modules/review/domain/errors/review-errors.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-21T00:00:00.000Z');
const clock = new FixedClock(NOW);

const customerId = toUserId(ids.generate());
const principal: Principal = {
  userId: customerId,
  sessionId: toSessionId(ids.generate()),
  role: 'CUSTOMER',
};
const orderItemId = toOrderItemId(ids.generate());
const productId = toProductId(ids.generate());
const variantId = toProductVariantId(ids.generate());
const subOrderId = toSubOrderId(ids.generate());

const buildDeps = (
  purchase: {
    orderItemId: typeof orderItemId;
    subOrderId: typeof subOrderId;
    productId: typeof productId;
    variantId: typeof variantId;
  } | null,
): {
  verifiedPurchaseQuery: VerifiedPurchaseQuery;
  reviewRepository: ReviewRepository;
  idGenerator: UuidV7Generator;
  clock: FixedClock;
  logger: NullLogger;
  create: ReturnType<typeof vi.fn>;
  findEligiblePurchase: ReturnType<typeof vi.fn>;
} => {
  const create = vi.fn().mockResolvedValue(undefined);
  const findEligiblePurchase = vi.fn().mockResolvedValue(purchase);
  return {
    verifiedPurchaseQuery: { findEligiblePurchase },
    reviewRepository: { create, findAllByCustomerId: vi.fn() },
    idGenerator: ids,
    clock,
    logger: new NullLogger(),
    create,
    findEligiblePurchase,
  };
};

describe('CreateReviewUseCase (S8-REVIEWS)', () => {
  it('writes a review derived entirely from the verified purchase, never from a client-supplied product/variant/subOrder', async () => {
    const deps = buildDeps({ orderItemId, subOrderId, productId, variantId });

    const review = await new CreateReviewUseCase(deps).execute({
      principal,
      orderItemId,
      rating: 5,
      body: 'Great!',
    });

    expect(deps.findEligiblePurchase).toHaveBeenCalledWith(orderItemId, customerId);
    expect(review.customerId).toBe(customerId);
    expect(review.productId).toBe(productId);
    expect(review.variantId).toBe(variantId);
    expect(review.subOrderId).toBe(subOrderId);
    expect(review.orderItemId).toBe(orderItemId);
    expect(review.status).toBe('SUBMITTED');
    expect(deps.create).toHaveBeenCalledTimes(1);
    expect(deps.create).toHaveBeenCalledWith(review);
  });

  it('refuses when the purchase is not eligible — no such order item, another customer’s, or not yet delivered/completed, indistinguishably', async () => {
    const deps = buildDeps(null);

    await expect(
      new CreateReviewUseCase(deps).execute({ principal, orderItemId, rating: 5, body: 'Great!' }),
    ).rejects.toThrow(PurchaseNotEligibleForReviewError);

    expect(deps.create).not.toHaveBeenCalled();
  });

  it('checks eligibility for the authenticated principal, never a client-supplied customer id', async () => {
    const deps = buildDeps({ orderItemId, subOrderId, productId, variantId });

    await new CreateReviewUseCase(deps).execute({
      principal,
      orderItemId,
      rating: 4,
      body: 'Good',
    });

    // The only customer id passed anywhere is `principal.userId` — there is
    // no field on `CreateReviewInput` for the caller to supply a different
    // one, so this asserts the wiring rather than a bypassable check.
    expect(deps.findEligiblePurchase).toHaveBeenCalledWith(orderItemId, principal.userId);
  });

  it('propagates the invalid-rating rejection from the domain rather than swallowing it', async () => {
    const deps = buildDeps({ orderItemId, subOrderId, productId, variantId });

    await expect(
      new CreateReviewUseCase(deps).execute({ principal, orderItemId, rating: 6, body: 'Great!' }),
    ).rejects.toThrow();
    expect(deps.create).not.toHaveBeenCalled();
  });
});
