import { createIdType, type Brand } from '@leen-mart/domain-kit';

export type ReviewId = Brand<string, 'ReviewId'>;

const reviewId = createIdType('ReviewId');

export const isReviewId = reviewId.is;
export const toReviewId = reviewId.from;
