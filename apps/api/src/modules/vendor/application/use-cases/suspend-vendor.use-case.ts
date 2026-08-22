import type { Clock, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import { toUuid } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import type {
  Principal,
  SessionDenylist,
  SessionRepository,
  UserRepository,
  VendorId,
} from '../../../identity/index.js';
import { revokeEverySession } from '../../../../shared/application/services/revoke-every-session.js';
import { VENDOR_AUDIT_ACTIONS, VENDOR_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import type { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import { VendorProfileNotFoundError } from '../../domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';

export interface SuspendVendorInput {
  readonly principal: Principal;
  readonly vendorId: VendorId;
  /** SDD §16.1: "no automatic suspension — every suspension... requires a human decision... recorded with a reason." Required, never persisted on `VendorProfile` (it has no column for one) — it lives on the audit record. */
  readonly reason: string;
}

export interface SuspendVendorDeps {
  readonly vendorRepository: VendorRepository;
  readonly userRepository: UserRepository;
  readonly sessionRepository: SessionRepository;
  readonly sessionDenylist: SessionDenylist;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly accessTokenTtlSeconds: number;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * An administrator suspends a vendor (SDD §15.1 `SUSPEND`, §16.1's
 * risk-analyst-only, reason-required decision), gated by
 * `SUSPEND_VENDOR_OR_USER` (RISK_ANALYST/SUPER_ADMIN, `FULL` only).
 *
 * **Suspension is not cosmetic.** `VendorProfile.suspend()` alone only
 * changes what the vendor's *profile* reports — nothing reads that column at
 * authentication time. The `User` entity's own doc comment names the exact
 * failure this use case exists to close: revoking sessions alone "achieves
 * nothing if [the account] can simply log in again," because
 * `LoginUseCase.execute()` checks `User.status`, never `VendorProfile.status`.
 * So this use case transitions **both** aggregates — `VendorProfile` to
 * `SUSPENDED` and the linked `User` to `SUSPENDED` (`User.suspend()`, which
 * had no caller before this) — in the same transaction, then revokes every
 * session that account holds. Only then is a suspended vendor actually unable
 * to trade: unable to re-authenticate (`assertCanAuthenticate()` on the next
 * login), and unable to keep using a token already in hand (the session
 * denylist SDD 7.2 already checks on every authenticated request).
 *
 * The linked `User` *is* the vendor's authentication identity — there is no
 * separate vendor-only credential — so suspending it necessarily suspends
 * that account everywhere, not just on vendor-scoped routes. That is the
 * intended and only coherent behaviour here, not a separate "suspend a user"
 * feature: `SUSPEND_VENDOR_OR_USER` is deliberately broader than vendor
 * suspension (it also names a bare user-suspension capability, SDD 15.1's
 * identity-side `UserSuspended` event), but nothing here exposes that half —
 * only a vendor id in, a vendor's own account transitioned as a consequence.
 *
 * **Deliberately narrow, matching BR-27's own boundary.** BR-27 (unresolved,
 * P1) is the open question of what happens to a suspended vendor's open
 * orders, held funds, reviews and product listings — this use case changes
 * none of them. Only `VendorProfile.status`, the linked `User.status`,
 * session access, and the audit record change. Answering BR-27 is a
 * business decision this code does not make.
 *
 * Mirrors `ActivateVendorUseCase`'s shape (one transaction, one domain
 * transition, one audit record) plus the linked-`User` transition
 * `RegisterVendorUseCase` already established as a precedent for writing
 * across the vendor/identity boundary in one transaction, and its
 * `revokeEverySession` call (now shared, not duplicated).
 */
export class SuspendVendorUseCase {
  constructor(private readonly deps: SuspendVendorDeps) {}

  async execute(input: SuspendVendorInput): Promise<VendorProfile> {
    const { vendorRepository, userRepository, transactionRunner, auditWriter, clock, logger } =
      this.deps;
    const { principal, vendorId, reason } = input;

    const suspended = await transactionRunner.run(async (scope) => {
      const repository = vendorRepository.withTransaction(scope);
      const users = userRepository.withTransaction(scope);

      const vendor = await repository.findById(vendorId);
      if (!vendor) {
        throw new VendorProfileNotFoundError();
      }

      const now = clock.now();
      // VendorProfile's own transition table refuses anything but
      // ACTIVE -> SUSPENDED (InvalidVendorStatusTransitionError otherwise) —
      // this use case adds no rule of its own beyond calling it.
      const vendorSuspended = vendor.suspend(now);

      const owner = await users.findById(vendor.userId);
      if (!owner) {
        // `vendors.user_id` is a foreign key to `users`, so this is
        // unreachable in practice; naming the invariant is cheaper than
        // silently suspending a profile with nobody behind it.
        throw new Error(`Vendor ${vendor.id} has no linked user (userId ${vendor.userId}).`);
      }
      // SUSPENDED and LOCKED are the only two states `assertCanAuthenticate()`
      // refuses — this is what actually stops the account authenticating
      // again, closing the gap the class doc comment above names.
      const ownerSuspended = owner.suspend(now);

      // Both writes and the audit record share this transaction: a suspended
      // profile beside a still-ACTIVE account (or vice versa) is exactly the
      // half-suspended state that must never be observable, and a failure
      // anywhere in this callback rolls every write in it back together.
      await repository.update(vendorSuspended);
      await users.update(ownerSuspended);

      await auditWriter.withTransaction(scope).record({
        actorId: principal.userId,
        actorRole: principal.role,
        action: VENDOR_AUDIT_ACTIONS.SUSPENDED,
        entityType: VENDOR_AUDIT_ENTITY_TYPES.VENDOR,
        entityId: toUuid(vendor.id),
        reason,
        before: { status: vendor.status.name },
        after: { status: vendorSuspended.status.name },
      });

      return vendorSuspended;
    });

    // Outside the transaction on purpose — the same reasoning
    // `revokeEverySession`'s own doc comment gives (neither the session store
    // nor the Redis denylist participate in this Postgres transaction), and
    // the same choice `RegisterVendorUseCase` already made for the identical
    // shape of problem: a revocation that failed here must not roll back a
    // suspension that was legitimately committed. The worst case is a session
    // that outlives the suspension by at most one access-token lifetime — the
    // same bound SDD 7.2 already accepts elsewhere.
    await revokeEverySession(this.deps, suspended.userId, clock.now());

    logger.info({ vendorId: suspended.id }, 'Admin suspended a vendor');
    return suspended;
  }
}
