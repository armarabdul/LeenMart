import type { Logger, TransactionRunner } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import { VendorProfileNotFoundError } from '../../domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';
import type { BusinessHoursRepository } from '../../domain/repositories/business-hours.repository.js';
import type { VendorBusinessHours } from '../../domain/services/business-hours-policy.js';

export interface VendorBusinessHoursResult {
  readonly vendorId: string;
  /**
   * Whether the vendor has declared any trading intervals. `false` means the
   * vendor currently accepts DELIVERY at any time (locked decision H4-A) —
   * surfaced explicitly so the portal can say so rather than showing an empty
   * schedule that reads as "never open".
   */
  readonly configured: boolean;
  readonly hours: VendorBusinessHours;
}

export interface GetVendorBusinessHoursInput {
  readonly principal: Principal;
}

export interface SetVendorBusinessHoursInput {
  readonly principal: Principal;
  readonly hours: VendorBusinessHours;
}

export interface VendorBusinessHoursDeps {
  readonly vendorRepository: VendorRepository;
  readonly businessHoursRepository: BusinessHoursRepository;
  readonly transactionRunner: TransactionRunner;
  readonly logger: Logger;
}

/** Stable ordering, so the stored schedule and every response read the same way twice. */
const normalise = (hours: VendorBusinessHours): VendorBusinessHours => ({
  intervals: [...hours.intervals].sort(
    (a, b) => a.weekday - b.weekday || a.openMinute - b.openMinute,
  ),
  closures: [...hours.closures].sort(
    (a, b) =>
      (a.weekday ?? 99) - (b.weekday ?? 99) || (a.closedOn ?? '').localeCompare(b.closedOn ?? ''),
  ),
});

/**
 * A vendor reads back its own operating schedule (S4-HOURS).
 *
 * Resolved from `principal.userId`, never from a request-supplied vendor id —
 * the same discipline every other `/me/*` vendor route follows, and what makes
 * "vendor A reads vendor B's hours" unspellable rather than merely refused.
 */
export class GetVendorBusinessHoursUseCase {
  constructor(private readonly deps: VendorBusinessHoursDeps) {}

  async execute(input: GetVendorBusinessHoursInput): Promise<VendorBusinessHoursResult> {
    const vendor = await this.deps.vendorRepository.findByUserId(input.principal.userId);
    if (!vendor) {
      throw new VendorProfileNotFoundError();
    }

    const hours = await this.deps.businessHoursRepository.findByVendor(vendor.id);
    return { vendorId: vendor.id, configured: hours.intervals.length > 0, hours };
  }
}

/**
 * A vendor replaces its own operating schedule (S4-HOURS, locked decisions
 * H3-C and H4-A). Gated by `CONFIGURE_DELIVERY_SLOTS` — SDD 8.2's own
 * "Configure delivery/slots" row, the same permission S4-SERV already uses for
 * the sibling delivery-configuration surface.
 *
 * **Transactional**, for a sharper reason than the pincode set: replacement is
 * delete-then-insert across *two* tables, and a crash between them would leave
 * a vendor with closures but no intervals — which under H4-A reads as "open
 * always", the exact opposite of a partially-applied restriction.
 *
 * An empty schedule is accepted and meaningful: it clears the configuration
 * and returns the vendor to the unconfigured, always-open state.
 *
 * No audit record, following the established shop-profile convention every
 * sibling use case here already uses: `auditWriter` in this module is reserved
 * for KYC and admin decisions.
 */
export class SetVendorBusinessHoursUseCase {
  constructor(private readonly deps: VendorBusinessHoursDeps) {}

  async execute(input: SetVendorBusinessHoursInput): Promise<VendorBusinessHoursResult> {
    const { vendorRepository, businessHoursRepository, transactionRunner, logger } = this.deps;

    const vendor = await vendorRepository.findByUserId(input.principal.userId);
    if (!vendor) {
      throw new VendorProfileNotFoundError();
    }

    const hours = normalise(input.hours);
    await transactionRunner.run(async (scope) => {
      await businessHoursRepository.withTransaction(scope).replaceForVendor(vendor.id, hours);
    });

    logger.info(
      {
        vendorId: vendor.id,
        intervalCount: hours.intervals.length,
        closureCount: hours.closures.length,
      },
      'Vendor replaced their business hours',
    );
    return { vendorId: vendor.id, configured: hours.intervals.length > 0, hours };
  }
}
