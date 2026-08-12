import type { Logger } from '@leen-mart/domain-kit';
import type {
  KycReviewQueryPort,
  KycReviewQueuePage,
  KycReviewStatus,
} from '../ports/kyc-review-query.port.js';

/**
 * The statuses a reviewer sees when they ask for no particular ones.
 *
 * Both halves of "awaiting a decision" (SDD 15.1). A claimed submission stays
 * in the queue so a second reviewer can see it is already being worked; the
 * alternative — dropping it on claim — makes "someone has this" and "this is
 * gone" indistinguishable.
 */
export const DEFAULT_REVIEW_STATUSES: readonly KycReviewStatus[] = [
  'KYC_SUBMITTED',
  'KYC_UNDER_REVIEW',
];

export interface ListKycReviewQueueInput {
  readonly statuses?: readonly KycReviewStatus[] | undefined;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface ListKycReviewQueueDeps {
  readonly kycReviewQuery: KycReviewQueryPort;
  readonly logger: Logger;
}

/**
 * The administrator's KYC review queue (SDD 15.1: "a human makes the
 * decision").
 *
 * Read-only, and deliberately so — it claims nothing, decides nothing and
 * writes nothing. Listing the queue is not an act on any submission, so a
 * reviewer opening it must not change what another reviewer then sees.
 *
 * Carries no role check of its own. Whether the caller may read this at all is
 * SDD 7.4 step 2's question, already answered by `requirePermission` in the
 * interface layer against the permission matrix; asking it again here would be
 * a second authorisation mechanism to keep in sync with the first.
 */
export class ListKycReviewQueueUseCase {
  constructor(private readonly deps: ListKycReviewQueueDeps) {}

  async execute(input: ListKycReviewQueueInput): Promise<KycReviewQueuePage> {
    const { kycReviewQuery, logger } = this.deps;

    // An explicitly empty filter would otherwise mean "match nothing", which
    // reads as a broken queue rather than as the caller's mistake.
    const statuses =
      input.statuses && input.statuses.length > 0 ? input.statuses : DEFAULT_REVIEW_STATUSES;

    const page = await kycReviewQuery.listForReview({
      statuses,
      limit: input.limit,
      cursor: input.cursor,
    });

    // Counts and filters only. No vendor id, no identifier fragment: a log
    // line per queue page carrying tenant ids would build a shadow copy of the
    // queue in log storage.
    logger.info(
      { statuses, returned: page.items.length, hasMore: page.hasMore },
      'Admin KYC review queue read',
    );

    return page;
  }
}
