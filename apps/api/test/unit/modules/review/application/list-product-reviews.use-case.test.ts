import { describe, expect, it, vi } from 'vitest';
import { toProductId } from '../../../../../src/modules/catalogue/index.js';
import { ListProductReviewsUseCase } from '../../../../../src/modules/review/application/use-cases/list-product-reviews.use-case.js';
import type { PublicReviewQuery } from '../../../../../src/modules/review/application/ports/public-review-query.port.js';

const productId = toProductId('00000000-0000-7000-8000-0000000000c1');
/** A fixed instant, not `new Date()` — the Clock port rule applies to tests too (SDD 24.3). */
const CREATED_AT = new Date('2026-08-21T00:00:00.000Z');

describe('ListProductReviewsUseCase (S8-REVIEWS)', () => {
  it('combines the approved-only list and the summary for the same product into one result', async () => {
    const listApprovedByProduct = vi.fn().mockResolvedValue({
      items: [{ id: 'r1', rating: 5, body: 'Great', createdAt: CREATED_AT }],
      nextCursor: null,
    });
    const summarizeByProduct = vi
      .fn()
      .mockResolvedValue({ averageRating: 4.5, approvedReviewCount: 2 });
    const publicReviewQuery: PublicReviewQuery = { listApprovedByProduct, summarizeByProduct };

    const result = await new ListProductReviewsUseCase({ publicReviewQuery }).execute({
      productId,
      limit: 20,
    });

    expect(listApprovedByProduct).toHaveBeenCalledWith(productId, 20, undefined);
    expect(summarizeByProduct).toHaveBeenCalledWith(productId);
    expect(result.summary).toEqual({ averageRating: 4.5, approvedReviewCount: 2 });
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it('reports a null average and zero count for a product with no approved reviews yet, without treating it as an error', async () => {
    const publicReviewQuery: PublicReviewQuery = {
      listApprovedByProduct: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
      summarizeByProduct: vi
        .fn()
        .mockResolvedValue({ averageRating: null, approvedReviewCount: 0 }),
    };

    const result = await new ListProductReviewsUseCase({ publicReviewQuery }).execute({
      productId,
      limit: 20,
    });

    expect(result.summary.averageRating).toBeNull();
    expect(result.summary.approvedReviewCount).toBe(0);
    expect(result.items).toEqual([]);
  });
});
