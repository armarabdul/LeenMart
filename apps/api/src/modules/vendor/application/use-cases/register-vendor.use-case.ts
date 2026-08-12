import type { Clock, IdGenerator, Logger, TransactionRunner } from '@leen-mart/domain-kit';
import {
  toVendorId,
  type Principal,
  type SessionDenylist,
  type SessionId,
  type SessionRepository,
  type UserRepository,
} from '../../../identity/index.js';
import { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import {
  VendorAlreadyRegisteredError,
  VendorRegistrationNotAllowedError,
} from '../../domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';

export interface RegisterVendorInput {
  /** The authenticated caller, as established by the `authenticate()` middleware (SDD 7.4 step 1). */
  readonly principal: Principal;
}

export interface RegisterVendorDeps {
  readonly vendorRepository: VendorRepository;
  readonly userRepository: UserRepository;
  readonly sessionRepository: SessionRepository;
  readonly sessionDenylist: SessionDenylist;
  /** Makes the vendor row and the role promotion one write (SDD 2.3). */
  readonly transactionRunner: TransactionRunner;
  /** The access-token lifetime, which is how long a denylist entry must live (SDD 7.2). */
  readonly accessTokenTtlSeconds: number;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Customer self-service vendor registration — the entry point of SDD 15.1's
 * lifecycle, which always begins at `REGISTERED`.
 *
 * Collects no business fields: everything SDD 15.1 describes (KYC
 * documents, penny-drop and GSTIN checks, the Razorpay linked account, the
 * trust tier) belongs to submission and approval, not to registration.
 *
 * The caller's role is read from the verified access token rather than
 * re-loaded from the database: SDD 7.2 carries `role` as a token claim by
 * design.
 *
 * **Registration promotes the account to VENDOR_OWNER**, atomically with
 * creating the vendor row. Without it the account would own a vendor it has no
 * permission to act for: SDD 8.2 grants `SUBMIT_OR_EDIT_KYC` to VENDOR_OWNER
 * and withholds it from CUSTOMER, so a vendor whose account stayed CUSTOMER
 * could never submit the KYC its own lifecycle requires. The two writes live
 * in one transaction because either alone is a broken account — a promoted
 * user with no vendor, or a vendor whose owner cannot reach it.
 *
 * Promotion invalidates the caller's own session along with every other one
 * they hold. `role` is an access-token claim, so tokens minted before this
 * moment assert CUSTOMER and would keep doing so until they expired; the
 * session denylist (SDD 7.2) is what makes the change take effect now rather
 * than up to one access-token lifetime from now. The caller must
 * re-authenticate, and their next login mints VENDOR_OWNER.
 */
/**
 * Kills every session the user holds and denies each one's access token.
 *
 * Reuses SDD 7.2's existing two-step revocation exactly as
 * `RefreshSessionUseCase` does: revoking the refresh rows bounds future
 * rotations, and denying each `sid` is what stops the access tokens already
 * in flight. Denies *all* session ids, not just the ones this call killed —
 * a session revoked at logout minutes ago can still hold a signature-valid
 * token carrying the old role, which is precisely the credential that must
 * stop working.
 */
const revokeEverySession = async (
  deps: RegisterVendorDeps,
  userId: Principal['userId'],
  now: Date,
): Promise<void> => {
  const { sessionRepository, sessionDenylist, accessTokenTtlSeconds, logger } = deps;

  const revoked = await sessionRepository.revokeAllForUser(userId, now);
  const allSessionIds = await sessionRepository.findSessionIdsByUserId(userId);
  await Promise.all(
    allSessionIds.map((sessionId: SessionId) =>
      sessionDenylist.deny(sessionId, accessTokenTtlSeconds),
    ),
  );

  logger.info(
    { userId, revokedCount: revoked.length, deniedCount: allSessionIds.length },
    'Vendor promotion revoked every session for the account (SDD 7.2)',
  );
};

export class RegisterVendorUseCase {
  constructor(private readonly deps: RegisterVendorDeps) {}

  async execute(input: RegisterVendorInput): Promise<VendorProfile> {
    const { vendorRepository, userRepository, transactionRunner, idGenerator, clock, logger } =
      this.deps;
    const { principal } = input;

    // Duplicate first, role second. Registration now promotes the caller, so a
    // second attempt arrives as VENDOR_OWNER rather than CUSTOMER — checking
    // the role first would answer "you may not register" when the truthful
    // answer is "you already did", and would leave
    // `VendorAlreadyRegisteredError` unreachable for the one account that can
    // actually trigger it. A caller with no vendor still falls through to the
    // role guard unchanged.
    const existing = await vendorRepository.findByUserId(principal.userId);
    if (existing) {
      throw new VendorAlreadyRegisteredError();
    }

    if (principal.role !== 'CUSTOMER') {
      throw new VendorRegistrationNotAllowedError();
    }

    const now = clock.now();
    const owner = await userRepository.findById(principal.userId);
    if (!owner) {
      // The principal came from a verified token, so the account existed when
      // it was minted. Reaching here means it was deleted mid-session, which
      // is not a registration problem to report in registration's vocabulary.
      throw new VendorRegistrationNotAllowedError();
    }

    const vendor = VendorProfile.register({
      id: toVendorId(idGenerator.generate()),
      userId: principal.userId,
      now,
    });

    await transactionRunner.run(async (scope) => {
      await vendorRepository.withTransaction(scope).create(vendor);
      await userRepository.withTransaction(scope).update(owner.promoteToVendorOwner(now));
    });

    // Outside the transaction on purpose. Revocation is not part of the write
    // it protects: if it failed inside, it would roll back a vendor that was
    // legitimately created, and if the process died between the two the worst
    // case is a stale CUSTOMER claim that expires on its own within the
    // access-token lifetime — the same bound SDD 7.2 already accepts.
    await revokeEverySession(this.deps, principal.userId, now);

    logger.info({ vendorId: vendor.id, userId: principal.userId }, 'Vendor registered');
    return vendor;
  }
}
