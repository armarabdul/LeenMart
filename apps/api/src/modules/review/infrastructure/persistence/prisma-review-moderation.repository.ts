import type { PrismaClient, ReviewModerationStatus } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { toOrderItemId, toSubOrderId } from '../../../order/index.js';
import { toProductId, toProductVariantId } from '../../../catalogue/index.js';
import { toUserId } from '../../../identity/index.js';
import { Review, type ReviewModerationStatusName } from '../../domain/entities/review.entity.js';
import { toReviewId, type ReviewId } from '../../domain/value-objects/review-id.value-object.js';
import type {
  ReviewModerationPage,
  ReviewModerationRepository,
} from '../../application/ports/review-moderation.repository.js';

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
 * `ReviewModerationRepository` on `leenmart_admin` (S8-REVIEWS). Mirrors
 * `PrismaProductReviewQuery`/`ProductRepository`'s combined shape: full
 * table reach (`reviews_admin_select`/`reviews_admin_update`,
 * 20260820180000) — this class adds no `WHERE customerId`/status filter of
 * its own beyond what the caller asks for, the same "RLS confines the
 * credential, the query states the intent" split every admin repository in
 * this codebase already follows.
 */
export class PrismaReviewModerationRepository implements ReviewModerationRepository {
  constructor(private readonly adminPrisma: PrismaClient) {}

  withTransaction(scope: TransactionScope): ReviewModerationRepository {
    return new PrismaReviewModerationRepository(scope as unknown as PrismaClient);
  }

  async listQueue(
    statuses: readonly ReviewModerationStatusName[],
    limit: number,
    cursor?: string,
  ): Promise<ReviewModerationPage> {
    // One row beyond the page, so `hasMore` is an observation rather than a
    // second `count` query racing the first — mirrors `PrismaProductReviewQuery`.
    const take = limit + 1;

    const rows = await this.adminPrisma.review.findMany({
      where: { status: { in: [...statuses] as ReviewModerationStatus[] } },
      // Oldest first: a queue surfacing the newest submission first would
      // starve whoever has waited longest. `id` breaks ties so the keyset
      // cursor below cannot skip or repeat a row.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    return {
      items: page.map(toDomain),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async findById(id: ReviewId): Promise<Review | null> {
    const row = await this.adminPrisma.review.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async updateIfStatus(
    review: Review,
    expectedStatus: ReviewModerationStatusName,
  ): Promise<boolean> {
    const result = await this.adminPrisma.review.updateMany({
      where: { id: review.id, status: expectedStatus },
      data: { status: review.status, updatedAt: review.updatedAt },
    });
    return result.count === 1;
  }
}
