import type { Clock, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import type { VendorKyc } from '../../domain/entities/vendor-kyc.entity.js';
import type { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import {
  KycAlreadyDecidedError,
  KycSubmissionNotFoundError,
} from '../../domain/errors/kyc-errors.js';
import type { VendorKycRepository } from '../../domain/repositories/vendor-kyc.repository.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';
import type { KycId } from '../../domain/value-objects/kyc-id.value-object.js';
import { KycRejectionReason } from '../../domain/value-objects/kyc-rejection-reason.value-object.js';

/**
 * Approve, or reject with a reason. A discriminated command rather than two
 * use cases: the two outcomes share every step except one domain call, and
 * splitting them would duplicate the transaction, the concurrency arbitration
 * and the lifecycle transition three-quarters identically.
 */
export type KycDecisionCommand =
  | { readonly decision: 'APPROVE' }
  | { readonly decision: 'REJECT'; readonly reason: string; readonly note?: string | undefined };

export interface DecideVendorKycInput {
  readonly principal: Principal;
  readonly kycId: KycId;
  readonly command: KycDecisionCommand;
}

export interface DecideVendorKycResult {
  readonly kyc: VendorKyc;
  readonly vendor: VendorProfile;
}

export interface DecideVendorKycDeps {
  readonly vendorKycRepository: VendorKycRepository;
  readonly vendorRepository: VendorRepository;
  readonly transactionRunner: TransactionRunner;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * An administrator's KYC decision (SDD 15.1: "a human makes the decision and
 * their identity is recorded").
 *
 * **Stops at `KYC_APPROVED`.** Activation is a separate step in SDD 15.1's
 * lifecycle with its own consequences — a Razorpay linked account, a published
 * shop — and none of that belongs to deciding whether the paperwork is good.
 *
 * Everything happens in **one transaction** because two rows change together:
 * the submission's decision and the vendor's lifecycle state. A decided
 * submission beside an untransitioned vendor is unrecoverable by retry — the
 * conditional write would refuse the second attempt, leaving the vendor stuck.
 */
export class DecideVendorKycUseCase {
  constructor(private readonly deps: DecideVendorKycDeps) {}

  async execute(input: DecideVendorKycInput): Promise<DecideVendorKycResult> {
    const { vendorKycRepository, vendorRepository, transactionRunner, clock, logger } = this.deps;

    return transactionRunner.run(async (scope) => {
      const kycRepository = vendorKycRepository.withTransaction(scope);
      const profileRepository = vendorRepository.withTransaction(scope);

      const existing = await kycRepository.findById(input.kycId);
      if (!existing) {
        throw new KycSubmissionNotFoundError();
      }
      const vendor = await profileRepository.findById(existing.vendorId);
      if (!vendor) {
        // The composite foreign key makes this unreachable; if it ever happens
        // the submission is orphaned, which is not a reviewer's problem to
        // read about in a decision response.
        throw new KycSubmissionNotFoundError();
      }

      const now = clock.now();
      // The aggregate owns every rule: a decision needs a claimed review, a
      // decision may be made once, and `OTHER` must carry an explanation.
      const decided = decide(existing, input, now);
      // `VendorProfile` owns its own transition table, which refuses anything
      // but `KYC_UNDER_REVIEW → KYC_APPROVED | KYC_REJECTED`.
      const transitioned =
        input.command.decision === 'APPROVE' ? vendor.approveKyc(now) : vendor.rejectKyc(now);

      // The KYC row is the arbiter, so it is written first: a competing
      // decider blocks here and then finds `decided_at` set. The vendor
      // transition follows inside the same transaction, so a failure there
      // rolls the decision back rather than stranding a decided submission
      // beside an untransitioned vendor.
      if (!(await kycRepository.saveDecisionIfUndecided(decided))) {
        throw new KycAlreadyDecidedError();
      }
      await profileRepository.update(transitioned);

      // The decision and the id only — never the reason's free text, which is
      // a reviewer's prose about a named vendor.
      logger.info(
        {
          kycId: input.kycId,
          decision: input.command.decision,
          vendorStatus: transitioned.status.name,
        },
        'Admin recorded a KYC decision',
      );

      return { kyc: decided, vendor: transitioned };
    });
  }
}

/** Kept out of `execute` so the transaction body stays readable at a glance. */
const decide = (kyc: VendorKyc, input: DecideVendorKycInput, now: Date): VendorKyc => {
  if (input.command.decision === 'APPROVE') {
    return kyc.approve(input.principal.userId, now);
  }
  // `fromName` rejects anything outside the closed set; the contract already
  // narrows it, and this is the domain refusing independently of the wire.
  return kyc.reject(
    input.principal.userId,
    KycRejectionReason.fromName(input.command.reason),
    input.command.note ?? null,
    now,
  );
};
