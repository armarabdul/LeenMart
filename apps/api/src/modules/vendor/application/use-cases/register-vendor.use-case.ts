import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import { toVendorId, type Principal } from '../../../identity/index.js';
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
 * design, and session revocation (7.2) is what handles a role that changes
 * mid-session. Registration deliberately does not touch `User.role` — a
 * registered vendor is still a CUSTOMER account until the lifecycle says
 * otherwise.
 */
export class RegisterVendorUseCase {
  constructor(private readonly deps: RegisterVendorDeps) {}

  async execute(input: RegisterVendorInput): Promise<VendorProfile> {
    const { vendorRepository, idGenerator, clock, logger } = this.deps;
    const { principal } = input;

    if (principal.role !== 'CUSTOMER') {
      throw new VendorRegistrationNotAllowedError();
    }

    const existing = await vendorRepository.findByUserId(principal.userId);
    if (existing) {
      throw new VendorAlreadyRegisteredError();
    }

    const vendor = VendorProfile.register({
      id: toVendorId(idGenerator.generate()),
      userId: principal.userId,
      now: clock.now(),
    });
    await vendorRepository.create(vendor);

    logger.info({ vendorId: vendor.id, userId: principal.userId }, 'Vendor registered');
    return vendor;
  }
}
