import type { Clock, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import { toUuid } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import { VENDOR_AUDIT_ACTIONS, VENDOR_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import type { VendorKyc } from '../../domain/entities/vendor-kyc.entity.js';
import {
  KycReviewAlreadyClaimedError,
  KycSubmissionNotFoundError,
} from '../../domain/errors/kyc-errors.js';
import type { VendorKycRepository } from '../../domain/repositories/vendor-kyc.repository.js';
import type { KycId } from '../../domain/value-objects/kyc-id.value-object.js';

export interface StartKycReviewInput {
  readonly principal: Principal;
  readonly kycId: KycId;
}

export interface StartKycReviewResult {
  readonly kyc: VendorKyc;
}

export interface StartKycReviewDeps {
  readonly vendorKycRepository: VendorKycRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * An administrator claims a submission for review (SDD 15.1's
 * `START_KYC_REVIEW`).
 *
 * Claiming is a distinct act from deciding, and deliberately so: SDD 15.1
 * requires the deciding human's identity to be recorded, and a review that
 * began by itself has nobody to name. It is also what makes the queue useful
 * to a second reviewer, who can see an item is already being worked.
 *
 * The reviewer is `principal.userId` — taken from the verified access token,
 * never from the request body. Accepting it from the caller would let one
 * administrator record work under a colleague's name.
 *
 * **The aggregate sets `reviewedBy` and `startedAt`, not this use case.**
 * `startReview` refuses a submission already claimed or already decided, so
 * the ordinary conflict is caught in the domain; the conditional write below
 * catches only the race the aggregate cannot see.
 */
export class StartKycReviewUseCase {
  constructor(private readonly deps: StartKycReviewDeps) {}

  async execute(input: StartKycReviewInput): Promise<StartKycReviewResult> {
    const { vendorKycRepository, transactionRunner, auditWriter, clock, logger } = this.deps;

    return transactionRunner.run(async (scope) => {
      const repository = vendorKycRepository.withTransaction(scope);

      const existing = await repository.findById(input.kycId);
      if (!existing) {
        throw new KycSubmissionNotFoundError();
      }

      // Domain first: it owns "may this be claimed at all?" and throws for a
      // submission already claimed or already decided.
      const claimed = existing.startReview(input.principal.userId, clock.now());

      // Then the race the aggregate cannot see. Both reviewers may have loaded
      // the same unclaimed row before either wrote; only one conditional
      // update can flip `reviewed_by` away from null.
      if (!(await repository.claimForReviewIfUnclaimed(claimed))) {
        throw new KycReviewAlreadyClaimedError();
      }

      // Only the winner reaches here — the loser threw above and this
      // transaction never opened for them, so a lost race writes no audit row.
      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: VENDOR_AUDIT_ACTIONS.KYC_REVIEW_STARTED,
        entityType: VENDOR_AUDIT_ENTITY_TYPES.KYC,
        entityId: toUuid(claimed.id),
        after: { vendorId: claimed.vendorId },
      });

      logger.info({ kycId: input.kycId }, 'Admin claimed a KYC submission for review');

      return { kyc: claimed };
    });
  }
}
