import type { Logger } from '@leen-mart/domain-kit';
import type { ReviewModerationStatusName } from '../../domain/entities/review.entity.js';
import type {
  ReviewModerationPage,
  ReviewModerationRepository,
} from '../ports/review-moderation.repository.js';

/** The status a moderator sees when they ask for no particular one: awaiting a decision. Mirrors `DEFAULT_PRODUCT_REVIEW_STATUSES`. */
export const DEFAULT_REVIEW_MODERATION_STATUSES: readonly ReviewModerationStatusName[] = [
  'SUBMITTED',
];

export interface ListReviewModerationQueueInput {
  readonly statuses?: readonly ReviewModerationStatusName[] | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface ListReviewModerationQueueDeps {
  readonly reviewModerationRepository: ReviewModerationRepository;
  readonly logger: Logger;
}

/**
 * The moderator's review queue (`MODERATE_REVIEWS`, SDD 8.2). Read-only —
 * decides nothing, writes nothing. Carries no role check of its own:
 * whether the caller may read this at all is answered by `requirePermission`
 * in the interface layer, the same division `ListProductReviewQueueUseCase`
 * draws.
 */
export class ListReviewModerationQueueUseCase {
  constructor(private readonly deps: ListReviewModerationQueueDeps) {}

  async execute(input: ListReviewModerationQueueInput): Promise<ReviewModerationPage> {
    const { reviewModerationRepository, logger } = this.deps;

    const statuses =
      input.statuses && input.statuses.length > 0
        ? input.statuses
        : DEFAULT_REVIEW_MODERATION_STATUSES;

    const page = await reviewModerationRepository.listQueue(statuses, input.limit, input.cursor);

    // Counts and filters only — no customer id, no review body: a log line
    // per queue page carrying review content would build a shadow copy of
    // the queue in log storage.
    logger.info({ statuses, returned: page.items.length }, 'Admin review moderation queue read');

    return page;
  }
}
