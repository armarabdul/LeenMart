import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import { toUserId } from '../../../../../src/modules/identity/index.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import type { AuditWriter } from '../../../../../src/modules/audit/index.js';
import { toProductId, toProductVariantId } from '../../../../../src/modules/catalogue/index.js';
import { toOrderItemId, toSubOrderId } from '../../../../../src/modules/order/index.js';
import { DecideReviewModerationUseCase } from '../../../../../src/modules/review/application/use-cases/decide-review-moderation.use-case.js';
import type { ReviewModerationRepository } from '../../../../../src/modules/review/application/ports/review-moderation.repository.js';
import { Review } from '../../../../../src/modules/review/domain/entities/review.entity.js';
import {
  ReviewAlreadyModeratedError,
  ReviewNotFoundError,
} from '../../../../../src/modules/review/domain/errors/review-errors.js';
import { toReviewId } from '../../../../../src/modules/review/domain/value-objects/review-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-21T00:00:00.000Z');
const clock = new FixedClock(NOW);

const moderatorPrincipal: Principal = {
  userId: toUserId(ids.generate()),
  sessionId: toSessionId(ids.generate()),
  role: 'CATALOGUE_MODERATOR',
};

const reviewId = toReviewId(ids.generate());
const customerId = toUserId(ids.generate());
const productId = toProductId(ids.generate());
const variantId = toProductVariantId(ids.generate());
const subOrderId = toSubOrderId(ids.generate());
const orderItemId = toOrderItemId(ids.generate());

const buildReview = (status: 'SUBMITTED' | 'APPROVED' | 'HIDDEN'): Review =>
  Review.reconstitute({
    id: reviewId,
    customerId,
    productId,
    variantId,
    subOrderId,
    orderItemId,
    rating: 5,
    body: 'Great!',
    status,
    createdAt: NOW,
    updatedAt: NOW,
  });

const runner = (): TransactionRunner => ({
  run: async (work) => work({} as TransactionScope),
});

const auditWriter = (record = vi.fn()): AuditWriter => ({
  withTransaction: () => auditWriter(record),
  record,
});

const buildRepo = (
  existing: Review | null,
  updateResult = true,
): ReviewModerationRepository & { updateIfStatus: ReturnType<typeof vi.fn> } => {
  const updateIfStatus = vi.fn().mockResolvedValue(updateResult);
  const repo: ReviewModerationRepository & { updateIfStatus: ReturnType<typeof vi.fn> } = {
    withTransaction: () => repo,
    listQueue: vi.fn(),
    findById: vi.fn().mockResolvedValue(existing),
    updateIfStatus,
  };
  return repo;
};

describe('DecideReviewModerationUseCase (S8-REVIEWS)', () => {
  it('APPROVE moves a SUBMITTED review to APPROVED and records an audit entry', async () => {
    const repo = buildRepo(buildReview('SUBMITTED'));
    const record = vi.fn();

    const { review } = await new DecideReviewModerationUseCase({
      reviewModerationRepository: repo,
      transactionRunner: runner(),
      auditWriter: auditWriter(record),
      clock,
      logger: new NullLogger(),
    }).execute({ principal: moderatorPrincipal, reviewId, decision: 'APPROVE' });

    expect(review.status).toBe('APPROVED');
    expect(repo.updateIfStatus).toHaveBeenCalledWith(review, 'SUBMITTED');
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'review.approved',
        entityType: 'Review',
        before: { status: 'SUBMITTED' },
        after: { status: 'APPROVED' },
      }),
    );
  });

  it('HIDE moves a SUBMITTED review to HIDDEN', async () => {
    const repo = buildRepo(buildReview('SUBMITTED'));

    const { review } = await new DecideReviewModerationUseCase({
      reviewModerationRepository: repo,
      transactionRunner: runner(),
      auditWriter: auditWriter(),
      clock,
      logger: new NullLogger(),
    }).execute({ principal: moderatorPrincipal, reviewId, decision: 'HIDE' });

    expect(review.status).toBe('HIDDEN');
  });

  it('APPROVE restores visibility on a HIDDEN review', async () => {
    const repo = buildRepo(buildReview('HIDDEN'));

    const { review } = await new DecideReviewModerationUseCase({
      reviewModerationRepository: repo,
      transactionRunner: runner(),
      auditWriter: auditWriter(),
      clock,
      logger: new NullLogger(),
    }).execute({ principal: moderatorPrincipal, reviewId, decision: 'APPROVE' });

    expect(review.status).toBe('APPROVED');
  });

  it('rejects when the review does not exist', async () => {
    const repo = buildRepo(null);

    await expect(
      new DecideReviewModerationUseCase({
        reviewModerationRepository: repo,
        transactionRunner: runner(),
        auditWriter: auditWriter(),
        clock,
        logger: new NullLogger(),
      }).execute({ principal: moderatorPrincipal, reviewId, decision: 'APPROVE' }),
    ).rejects.toThrow(ReviewNotFoundError);
  });

  it('rejects an illegal transition (APPROVED -> APPROVED) before ever touching the repository write', async () => {
    const repo = buildRepo(buildReview('APPROVED'));

    await expect(
      new DecideReviewModerationUseCase({
        reviewModerationRepository: repo,
        transactionRunner: runner(),
        auditWriter: auditWriter(),
        clock,
        logger: new NullLogger(),
      }).execute({ principal: moderatorPrincipal, reviewId, decision: 'APPROVE' }),
    ).rejects.toThrow();
    expect(repo.updateIfStatus).not.toHaveBeenCalled();
  });

  it('surfaces a lost race (two moderators deciding at once) as ReviewAlreadyModeratedError', async () => {
    const repo = buildRepo(buildReview('SUBMITTED'), false);

    await expect(
      new DecideReviewModerationUseCase({
        reviewModerationRepository: repo,
        transactionRunner: runner(),
        auditWriter: auditWriter(),
        clock,
        logger: new NullLogger(),
      }).execute({ principal: moderatorPrincipal, reviewId, decision: 'APPROVE' }),
    ).rejects.toThrow(ReviewAlreadyModeratedError);
  });

  it('never records an audit entry for a race the caller lost', async () => {
    const repo = buildRepo(buildReview('SUBMITTED'), false);
    const record = vi.fn();

    await expect(
      new DecideReviewModerationUseCase({
        reviewModerationRepository: repo,
        transactionRunner: runner(),
        auditWriter: auditWriter(record),
        clock,
        logger: new NullLogger(),
      }).execute({ principal: moderatorPrincipal, reviewId, decision: 'APPROVE' }),
    ).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });
});
