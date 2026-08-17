import type { Clock } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';
import type { BusinessHoursLookupRepository } from '../../../vendor/domain/repositories/business-hours.repository.js';
import {
  isOpenVerdict,
  resolveBusinessHours,
} from '../../../vendor/domain/services/business-hours-policy.js';
import { toIst } from '../../../vendor/domain/value-objects/ist-instant.value-object.js';

export interface ResolveBusinessHoursInput {
  /** Only the vendors whose sub-order is `DELIVERY`; pickup vendors are never passed here (H2-A). */
  readonly deliveryVendorIds: readonly VendorId[];
}

export interface ResolveBusinessHoursDeps {
  readonly businessHoursLookupRepository: BusinessHoursLookupRepository;
  readonly clock: Clock;
}

/**
 * Decides which delivery vendors are currently closed (S4-HOURS, SDD 4.2 step
 * 4c, FR-27).
 *
 * A use case rather than logic inlined into `PlaceOrderUseCase`, for the same
 * reason `ResolveServiceabilityUseCase` is one: the decision has rules of its
 * own, and they belong somewhere a test can reach without a cart.
 *
 * **The current instant comes from the injected `Clock`**, never `new Date()`,
 * so a test can place the vendor on either side of a boundary deterministically
 * and the browser walkthrough can move the clock rather than wait for a
 * particular hour. It is converted to IST once, here, and both the query filter
 * and the policy see that same instant.
 *
 * The "unconfigured means open" rule (H4-A) is **not** implemented here — it
 * lives in `resolveBusinessHours`, the single place the open/closed question is
 * answered, so this use case cannot drift from it.
 *
 * Returns the closed vendors rather than throwing: the caller owns the
 * all-or-nothing policy (H1-A) and the error type.
 */
export class ResolveBusinessHoursUseCase {
  constructor(private readonly deps: ResolveBusinessHoursDeps) {}

  async execute(input: ResolveBusinessHoursInput): Promise<readonly VendorId[]> {
    const { deliveryVendorIds } = input;
    if (deliveryVendorIds.length === 0) {
      // A pickup-only order asks the database nothing at all (H2-A).
      return [];
    }

    const now = this.deps.clock.now();
    const ist = toIst(now);
    const schedules = await this.deps.businessHoursLookupRepository.findForVendors(
      deliveryVendorIds,
      { weekday: ist.weekday, isoDate: ist.date },
    );

    return deliveryVendorIds.filter((vendorId) => {
      const schedule = schedules.get(vendorId);
      // Absent from the map is treated exactly as unconfigured: the repository
      // contract already promises every requested vendor is present, and this
      // keeps H4-A the single answer for "we know nothing".
      if (!schedule) return false;
      return !isOpenVerdict(resolveBusinessHours(schedule, now));
    });
  }
}
