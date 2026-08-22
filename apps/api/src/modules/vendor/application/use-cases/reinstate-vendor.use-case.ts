import type { Clock, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import { toUuid } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type { Principal, UserRepository, VendorId } from '../../../identity/index.js';
import { VENDOR_AUDIT_ACTIONS, VENDOR_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import type { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import { VendorProfileNotFoundError } from '../../domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';

export interface ReinstateVendorInput {
  readonly principal: Principal;
  readonly vendorId: VendorId;
  /** Optional: SDD §16.1 requires a reason specifically for *suspending*, not for reinstating. */
  readonly reason?: string | undefined;
}

export interface ReinstateVendorDeps {
  readonly vendorRepository: VendorRepository;
  readonly userRepository: UserRepository;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * An administrator returns a suspended vendor to service (SDD §15.1
 * `REINSTATE`), gated by the same `SUSPEND_VENDOR_OR_USER` permission
 * `SuspendVendorUseCase` uses.
 *
 * **Mirrors that use case's linked-`User` transition, with one deliberate
 * asymmetry `SuspendVendorUseCase`'s doc comment does not have to handle.**
 * `VendorProfile.reinstate()` lands straight on `ACTIVE` — "they already
 * cleared KYC." `User.reinstate()` does not: its own doc comment states the
 * "one stated invariant" of that entity — a suspended (or locked) account
 * cannot become `ACTIVE` *directly*, only via `reinstate()`, which lands on
 * `PENDING`, followed by a separate, explicit `activate()`. Calling only
 * `reinstate()` here would leave `VendorProfile = ACTIVE` beside
 * `User = PENDING` — a vendor whose profile says they may trade and whose
 * account cannot yet authenticate to do it. So this use case calls
 * `owner.reinstate(now).activate(now)`, chained: `reinstate()` clears the
 * suspended/locked block `activate()`'s own `assertCanAuthenticate()` guard
 * enforces, so the second call is legal immediately, landing the account on
 * `ACTIVE` in the same write `VendorProfile` reaches it. No new `User` state
 * is introduced — both calls are the entity's own, pre-existing lifecycle
 * methods.
 *
 * **No session revocation.** Nothing was left holding a stale credential:
 * `SuspendVendorUseCase` already revoked every session this account had, and
 * reinstatement's whole point is restoring the ability to authenticate, not
 * granting a token — the vendor authenticates again through the ordinary
 * login flow, same as anyone whose account was ever suspended and cleared.
 *
 * **Same BR-27 boundary `SuspendVendorUseCase` states.** Only
 * `VendorProfile.status`, the linked `User.status`, and the audit record
 * change — no product, order, or fund-hold side effect.
 */
export class ReinstateVendorUseCase {
  constructor(private readonly deps: ReinstateVendorDeps) {}

  async execute(input: ReinstateVendorInput): Promise<VendorProfile> {
    const { vendorRepository, userRepository, transactionRunner, auditWriter, clock, logger } =
      this.deps;
    const { principal, vendorId, reason } = input;

    return transactionRunner.run(async (scope) => {
      const repository = vendorRepository.withTransaction(scope);
      const users = userRepository.withTransaction(scope);

      const vendor = await repository.findById(vendorId);
      if (!vendor) {
        throw new VendorProfileNotFoundError();
      }

      const now = clock.now();
      // VendorProfile's own transition table refuses anything but
      // SUSPENDED -> ACTIVE (InvalidVendorStatusTransitionError otherwise).
      const vendorReinstated = vendor.reinstate(now);

      const owner = await users.findById(vendor.userId);
      if (!owner) {
        // `vendors.user_id` is a foreign key to `users`, so this is
        // unreachable in practice; naming the invariant is cheaper than
        // silently reinstating a profile with nobody behind it.
        throw new Error(`Vendor ${vendor.id} has no linked user (userId ${vendor.userId}).`);
      }
      // reinstate() -> PENDING, then activate() -> ACTIVE. See the class doc
      // comment: skipping the second call would leave the account unable to
      // authenticate despite the profile reporting ACTIVE.
      const ownerReinstated = owner.reinstate(now).activate(now);

      await repository.update(vendorReinstated);
      await users.update(ownerReinstated);

      await auditWriter.withTransaction(scope).record({
        actorId: principal.userId,
        actorRole: principal.role,
        action: VENDOR_AUDIT_ACTIONS.REINSTATED,
        entityType: VENDOR_AUDIT_ENTITY_TYPES.VENDOR,
        entityId: toUuid(vendor.id),
        reason: reason ?? null,
        before: { status: vendor.status.name },
        after: { status: vendorReinstated.status.name },
      });

      logger.info({ vendorId: vendor.id }, 'Admin reinstated a suspended vendor');
      return vendorReinstated;
    });
  }
}
