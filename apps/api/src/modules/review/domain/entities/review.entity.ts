import type { OrderItemId, SubOrderId } from '../../../order/index.js';
import type { ProductId, ProductVariantId } from '../../../catalogue/index.js';
import type { UserId } from '../../../identity/index.js';
import {
  InvalidReviewBodyError,
  InvalidReviewModerationTransitionError,
  InvalidReviewRatingError,
} from '../errors/review-errors.js';
import type { ReviewId } from '../value-objects/review-id.value-object.js';

/**
 * Locked V1 moderation states (S8-REVIEWS) — deliberately not the SDD module
 * #14's fuller `review_moderation` history table, one column on this entity.
 * Decoupled from Prisma's generated enum on purpose (SDD 3.4), the same
 * `ProductStatusName` precedent.
 */
export type ReviewModerationStatusName = 'SUBMITTED' | 'APPROVED' | 'HIDDEN';

export const REVIEW_RATING_MIN = 1;
export const REVIEW_RATING_MAX = 5;
export const REVIEW_BODY_MAX_LENGTH = 2000;

export interface ReviewProps {
  readonly id: ReviewId;
  readonly customerId: UserId;
  readonly productId: ProductId;
  readonly variantId: ProductVariantId;
  readonly subOrderId: SubOrderId;
  readonly orderItemId: OrderItemId;
  readonly rating: number;
  readonly body: string;
  readonly status: ReviewModerationStatusName;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const assertValidRating = (rating: number): void => {
  if (!Number.isInteger(rating) || rating < REVIEW_RATING_MIN || rating > REVIEW_RATING_MAX) {
    throw new InvalidReviewRatingError();
  }
};

const assertValidBody = (body: string): string => {
  const trimmed = body.trim();
  if (trimmed.length === 0) {
    throw new InvalidReviewBodyError('Must not be blank.');
  }
  if (trimmed.length > REVIEW_BODY_MAX_LENGTH) {
    throw new InvalidReviewBodyError(`Must be at most ${REVIEW_BODY_MAX_LENGTH} characters.`);
  }
  return trimmed;
};

/**
 * A customer's review of one verified purchase (S8-REVIEWS, SDD module #14
 * V1 slice). `id`, `customerId`, `productId`, `variantId`, `subOrderId`,
 * `orderItemId` and `createdAt` are absent from every mutator by
 * construction: ownership and the purchase a review is about never change
 * once submitted — there is no edit in this milestone's locked scope
 * (FR-52's fuller ask, deferred).
 *
 * **Verified-purchase eligibility is not this entity's job.** `submit()`
 * only enforces the bare shape invariants (rating range, non-blank bounded
 * body) — whether the caller actually owns a `DELIVERED`/`COMPLETED`
 * purchase for `orderItemId` is a fact this entity cannot see, and is
 * checked by `CreateReviewUseCase` against the real order records before
 * this constructor ever runs, the same separation `CartItem`'s own doc
 * comment draws between "this entity's bare invariant" and "the use case's
 * eligibility check".
 */
export class Review {
  private constructor(private readonly props: ReviewProps) {}

  static submit(props: {
    id: ReviewId;
    customerId: UserId;
    productId: ProductId;
    variantId: ProductVariantId;
    subOrderId: SubOrderId;
    orderItemId: OrderItemId;
    rating: number;
    body: string;
    now: Date;
  }): Review {
    assertValidRating(props.rating);
    const body = assertValidBody(props.body);
    return new Review({
      id: props.id,
      customerId: props.customerId,
      productId: props.productId,
      variantId: props.variantId,
      subOrderId: props.subOrderId,
      orderItemId: props.orderItemId,
      rating: props.rating,
      body,
      status: 'SUBMITTED',
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: ReviewProps): Review {
    return new Review(props);
  }

  get id(): ReviewId {
    return this.props.id;
  }

  get customerId(): UserId {
    return this.props.customerId;
  }

  get productId(): ProductId {
    return this.props.productId;
  }

  get variantId(): ProductVariantId {
    return this.props.variantId;
  }

  get subOrderId(): SubOrderId {
    return this.props.subOrderId;
  }

  get orderItemId(): OrderItemId {
    return this.props.orderItemId;
  }

  get rating(): number {
    return this.props.rating;
  }

  get body(): string {
    return this.props.body;
  }

  get status(): ReviewModerationStatusName {
    return this.props.status;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** Locked V1 transitions: reachable from `SUBMITTED` (first decision) or `HIDDEN` (restoring visibility). */
  approve(now: Date): Review {
    if (this.props.status !== 'SUBMITTED' && this.props.status !== 'HIDDEN') {
      throw new InvalidReviewModerationTransitionError(this.props.status, 'approve');
    }
    return new Review({ ...this.props, status: 'APPROVED', updatedAt: now });
  }

  /** Locked V1 transitions: reachable from `SUBMITTED` (moderator declines to publish) or `APPROVED` (later hidden). */
  hide(now: Date): Review {
    if (this.props.status !== 'SUBMITTED' && this.props.status !== 'APPROVED') {
      throw new InvalidReviewModerationTransitionError(this.props.status, 'hide');
    }
    return new Review({ ...this.props, status: 'HIDDEN', updatedAt: now });
  }
}
