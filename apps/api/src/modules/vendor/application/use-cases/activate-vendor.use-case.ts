import type { Clock, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import { toUuid } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal, VendorId } from '../../../identity/index.js';
import { VENDOR_AUDIT_ACTIONS, VENDOR_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import type { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import { VendorProfileNotFoundError } from '../../domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';

export interface ActivateVendorInput {
  readonly principal: Principal;
  readonly vendorId: VendorId;
}

export interface ActivateVendorDeps {
  readonly vendorRepository: VendorRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * The minimal application path `VendorProfile.activate()` never had (S3-3A,
 * decision D-S3-04). `VendorProfile.entity.ts` has drawn `KYC_APPROVED ->
 * ACTIVE` since it was first written; nothing in the codebase ever called
 * it, so no vendor could reach `ACTIVE` outside of raw SQL seeding — which
 * is exactly what this milestone's order-placement demo needs to stop
 * relying on (a genuinely-active vendor, reached through the application).
 *
 * Deliberately narrow, matching the decision's own scope: it does not
 * redesign KYC, does not weaken it (the transition table still refuses
 * anything but `KYC_APPROVED -> ACTIVE`), does not expose a public
 * endpoint, and does not let a vendor self-activate — only an admin
 * carrying `APPROVE_OR_REJECT_VENDOR_KYC` at `FULL` access (the same gate
 * `DecideVendorKycUseCase` already uses) may call this. No new permission
 * was introduced: SDD 8.2's matrix has no row for "activate vendor"
 * distinct from the KYC-decision authority, and reusing it keeps this
 * change to the minimum the approved decision asked for.
 *
 * One transaction, one write, one audit record — the same shape
 * `DecideVendorKycUseCase` uses for its own single-table lifecycle
 * transition, minus the second table that use case's KYC row requires.
 */
export class ActivateVendorUseCase {
  constructor(private readonly deps: ActivateVendorDeps) {}

  async execute(input: ActivateVendorInput): Promise<VendorProfile> {
    const { vendorRepository, transactionRunner, auditWriter, clock, logger } = this.deps;
    const { principal, vendorId } = input;

    return transactionRunner.run(async (scope) => {
      const repository = vendorRepository.withTransaction(scope);

      const vendor = await repository.findById(vendorId);
      if (!vendor) {
        throw new VendorProfileNotFoundError();
      }

      const now = clock.now();
      // VendorProfile's own transition table refuses anything but
      // KYC_APPROVED -> ACTIVE (InvalidVendorStatusTransitionError otherwise)
      // — this use case adds no rule of its own beyond calling it.
      const activated = vendor.activate(now);
      await repository.update(activated);

      await auditWriter.withTransaction(scope).record({
        actorId: principal.userId,
        actorRole: principal.role,
        action: VENDOR_AUDIT_ACTIONS.ACTIVATED,
        entityType: VENDOR_AUDIT_ENTITY_TYPES.VENDOR,
        entityId: toUuid(vendor.id),
        before: { status: vendor.status.name },
        after: { status: activated.status.name },
      });

      logger.info({ vendorId: vendor.id }, 'Admin activated a KYC-approved vendor');
      return activated;
    });
  }
}
