import type { Logger } from '@leen-mart/domain-kit';
import type {
  ProductReviewQueryPort,
  ProductReviewQueuePage,
  ProductReviewStatus,
} from '../ports/product-review-query.port.js';

/**
 * The status a reviewer sees when they ask for no particular one: awaiting a
 * decision, and nothing else. Unlike KYC's `DEFAULT_REVIEW_STATUSES`, there is
 * no claimed-but-undecided state to include — S2-5 builds no claim step
 * (D-5-D), so "awaiting a decision" is exactly `PENDING_REVIEW`.
 */
export const DEFAULT_PRODUCT_REVIEW_STATUSES: readonly ProductReviewStatus[] = ['PENDING_REVIEW'];

export interface ListProductReviewQueueInput {
  readonly statuses?: readonly ProductReviewStatus[] | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface ListProductReviewQueueDeps {
  readonly productReviewQuery: ProductReviewQueryPort;
  readonly logger: Logger;
}

/**
 * The administrator's product review queue (SDD 15.2).
 *
 * Read-only, and deliberately so — it decides nothing and writes nothing.
 * Carries no role check of its own: whether the caller may read this at all
 * is answered by `requirePermission` in the interface layer against the
 * permission matrix, the same division `ListKycReviewQueueUseCase` draws.
 */
export class ListProductReviewQueueUseCase {
  constructor(private readonly deps: ListProductReviewQueueDeps) {}

  async execute(input: ListProductReviewQueueInput): Promise<ProductReviewQueuePage> {
    const { productReviewQuery, logger } = this.deps;

    // An explicitly empty filter would otherwise mean "match nothing", which
    // reads as a broken queue rather than as the caller's mistake.
    const statuses =
      input.statuses && input.statuses.length > 0
        ? input.statuses
        : DEFAULT_PRODUCT_REVIEW_STATUSES;

    const page = await productReviewQuery.listForReview({
      statuses,
      limit: input.limit,
      cursor: input.cursor,
    });

    // Counts and filters only — no vendor id, no product name: a log line per
    // queue page carrying tenant ids would build a shadow copy of the queue in
    // log storage.
    logger.info(
      { statuses, returned: page.items.length, hasMore: page.hasMore },
      'Admin product review queue read',
    );

    return page;
  }
}
