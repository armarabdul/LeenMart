import type { Principal } from '../../../identity/index.js';
import type { Review } from '../../domain/entities/review.entity.js';
import type { ReviewRepository } from '../ports/review.repository.js';

export interface ListMyReviewsInput {
  readonly principal: Principal;
}

export interface ListMyReviewsDeps {
  readonly reviewRepository: ReviewRepository;
}

/** Lists the caller's own reviews, every status — always scoped to `principal.userId`, never a client-supplied id. Mirrors `ListAddressesUseCase` exactly. */
export class ListMyReviewsUseCase {
  constructor(private readonly deps: ListMyReviewsDeps) {}

  async execute(input: ListMyReviewsInput): Promise<readonly Review[]> {
    return this.deps.reviewRepository.findAllByCustomerId(input.principal.userId);
  }
}
