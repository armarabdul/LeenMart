import { Prisma, type PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { toOrderItemId, toSubOrderId } from '../../../order/index.js';
import { toProductId, toProductVariantId } from '../../../catalogue/index.js';
import { toUserId, type UserId } from '../../../identity/index.js';
import { Review, type ReviewModerationStatusName } from '../../domain/entities/review.entity.js';
import { ReviewAlreadyExistsError } from '../../domain/errors/review-errors.js';
import { toReviewId } from '../../domain/value-objects/review-id.value-object.js';
import type { ReviewRepository } from '../../application/ports/review.repository.js';

/** Prisma's unique-constraint-violation code, same as `PrismaProductVariantRepository`. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

interface ReviewRow {
  readonly id: string;
  readonly customerId: string;
  readonly productId: string;
  readonly variantId: string;
  readonly subOrderId: string;
  readonly orderItemId: string;
  readonly rating: number;
  readonly body: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const toDomain = (row: ReviewRow): Review =>
  Review.reconstitute({
    id: toReviewId(row.id),
    customerId: toUserId(row.customerId),
    productId: toProductId(row.productId),
    variantId: toProductVariantId(row.variantId),
    subOrderId: toSubOrderId(row.subOrderId),
    orderItemId: toOrderItemId(row.orderItemId),
    rating: row.rating,
    body: row.body,
    status: row.status as ReviewModerationStatusName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });

/**
 * Translates `uq_reviews_order_item`'s violation into the error that names
 * the rule actually broken. Mirrors `PrismaProductVariantRepository`'s
 * `translateUniqueViolation`.
 */
const translateUniqueViolation = (error: unknown): never => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  ) {
    throw new ReviewAlreadyExistsError();
  }
  throw error;
};

/**
 * `ReviewRepository` on `leenmart_app` (S8-REVIEWS). RLS
 * (`reviews_customer_select`/`reviews_customer_insert`, 20260820180000)
 * confines every query here to `customer_id = app.user_id` — this class
 * adds no `WHERE customerId` of its own for that reason, the same
 * "RLS is the actual enforcement" reasoning `PrismaNotificationWriteRepository`
 * and `GetPublicProductDetailUseCase` both already establish for their own
 * tables.
 *
 * `withTransaction` (S9-NOTIFY-REVIEW) lets `CreateReviewUseCase` write this
 * insert and its `review.received` outbox event on the one connection, so
 * they commit or roll back together — the same conditional-scope pattern
 * `PrismaReviewModerationRepository` already uses for its own writes.
 */
export class PrismaReviewRepository implements ReviewRepository {
  constructor(private readonly prisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): ReviewRepository {
    return new PrismaReviewRepository(scope as unknown as PrismaClient);
  }

  async create(review: Review): Promise<void> {
    try {
      await this.prisma.review.create({
        data: {
          id: review.id,
          customerId: review.customerId,
          productId: review.productId,
          variantId: review.variantId,
          subOrderId: review.subOrderId,
          orderItemId: review.orderItemId,
          rating: review.rating,
          body: review.body,
          status: review.status,
          createdAt: review.createdAt,
          updatedAt: review.updatedAt,
        },
      });
    } catch (error) {
      translateUniqueViolation(error);
    }
  }

  async findAllByCustomerId(customerId: UserId): Promise<readonly Review[]> {
    const rows = await this.prisma.review.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toDomain);
  }
}
