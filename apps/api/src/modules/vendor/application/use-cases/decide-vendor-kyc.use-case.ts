import type { Clock, Logger, TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import { toUuid } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal } from '../../../identity/index.js';
import { VENDOR_AUDIT_ACTIONS, VENDOR_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import { VENDOR_OUTBOX_EVENTS } from '../../domain/outbox-events.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
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
  readonly auditWriter: AuditWriter;
  /**
   * S6-NOTIFY-LIFECYCLE. Written inside the decision's own transaction, so a
   * rollback leaves no event announcing a decision that never happened.
   */
  readonly outboxWriter: OutboxWriter;
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

  /**
   * The audit row and the published event, split out of `execute` purely to
   * keep it under this file's function-length budget — the same reason every
   * other builder split in this codebase gives. Both take the caller's open
   * `scope`, so they commit with the decision or not at all.
   */
  private async recordDecision(
    scope: TransactionScope,
    input: DecideVendorKycInput,
    decided: VendorKyc,
  ): Promise<void> {
    const { auditWriter, outboxWriter } = this.deps;

    // Only the winner reaches here — the loser threw above and this
    // transaction never opened for them, so a lost race writes no audit
    // row. The coded reason travels on a rejection; the reviewer's
    // free-text note never does — it is a reviewer's prose about a named
    // vendor, not a lifecycle fact.
    await auditWriter.withTransaction(scope).record({
      actorId: input.principal.userId,
      actorRole: input.principal.role,
      action:
        input.command.decision === 'APPROVE'
          ? VENDOR_AUDIT_ACTIONS.KYC_APPROVED
          : VENDOR_AUDIT_ACTIONS.KYC_REJECTED,
      entityType: VENDOR_AUDIT_ENTITY_TYPES.KYC,
      entityId: toUuid(decided.id),
      reason: decided.review?.rejectionReason?.name ?? null,
      after: { vendorId: decided.vendorId },
    });

    // Same transaction as the decision, the vendor transition and the audit
    // row above, so all four commit or roll back together (SDD 4.2). The
    // payload names the vendor — the subject of the decision and the only
    // identity the consumer needs — and carries neither the coded reason
    // nor the reviewer's note.
    await outboxWriter.withTransaction(scope).write({
      aggregateType: VENDOR_AUDIT_ENTITY_TYPES.VENDOR,
      aggregateId: toUuid(decided.vendorId),
      eventType:
        input.command.decision === 'APPROVE'
          ? VENDOR_OUTBOX_EVENTS.KYC_APPROVED
          : VENDOR_OUTBOX_EVENTS.KYC_REJECTED,
      payload: { vendorId: decided.vendorId, kycId: decided.id },
    });
  }
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

      await this.recordDecision(scope, input, decided);

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
