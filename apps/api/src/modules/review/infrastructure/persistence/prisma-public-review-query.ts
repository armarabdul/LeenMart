import type { PrismaClient } from '@prisma/client';
import type { ProductId } from '../../../catalogue/index.js';
import { toReviewId } from '../../domain/value-objects/review-id.value-object.js';
import type {
  ProductReviewSummary,
  PublicReviewItem,
  PublicReviewPage,
  PublicReviewQuery,
} from '../../application/ports/public-review-query.port.js';

const ITEM_SELECT = { id: true, rating: true, body: true, createdAt: true } as const;

/**
 * `PublicReviewQuery` on `leenmart_public` (S8-REVIEWS). RLS
 * (`reviews_public_read`, 20260820180000) confines every row this credential
 * can ever see to `status = 'APPROVED'` — this class adds no status filter
 * of its own for the same "RLS is the actual enforcement" reasoning
 * `GetPublicProductDetailUseCase` already documents for `products_public_read`.
 *
 * Locked V1 aggregation: a plain `AVG`/`COUNT` over whatever this credential
 * can see, computed on read rather than stored — no Bayesian weighting,
 * recency decay, or a denormalised column on `products` (out of this
 * milestone's scope, and this table's own volume gives no performance
 * reason to precompute it).
 */
export class PrismaPublicReviewQuery implements PublicReviewQuery {
  constructor(private readonly publicPrisma: PrismaClient) {}

  async listApprovedByProduct(
    productId: ProductId,
    limit: number,
    cursor?: string,
  ): Promise<PublicReviewPage> {
    const take = limit + 1;

    const rows = await this.publicPrisma.review.findMany({
      where: { productId },
      select: ITEM_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const items: readonly PublicReviewItem[] = page.map((row) => ({
      id: toReviewId(row.id),
      rating: row.rating,
      body: row.body,
      createdAt: row.createdAt,
    }));

    return { items, nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null };
  }

  async summarizeByProduct(productId: ProductId): Promise<ProductReviewSummary> {
    const result = await this.publicPrisma.review.aggregate({
      where: { productId },
      _avg: { rating: true },
      _count: { _all: true },
    });

    return {
      averageRating: result._avg.rating,
      approvedReviewCount: result._count._all,
    };
  }
}
