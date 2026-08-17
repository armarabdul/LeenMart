import { toIst } from '../value-objects/ist-instant.value-object.js';

/** One trading interval on one weekday, in minutes since IST midnight. */
export interface BusinessHourInterval {
  readonly weekday: number;
  readonly openMinute: number;
  readonly closeMinute: number;
}

/** A day the vendor does not trade: either every `weekday`, or the single date `closedOn`. */
export interface BusinessHourClosure {
  readonly weekday: number | null;
  /** `YYYY-MM-DD`, IST. */
  readonly closedOn: string | null;
}

export interface VendorBusinessHours {
  readonly intervals: readonly BusinessHourInterval[];
  readonly closures: readonly BusinessHourClosure[];
}

export const BusinessHoursVerdict = {
  /** No `business_hours` rows at all — locked decision H4-A. */
  OPEN_UNCONFIGURED: 'OPEN_UNCONFIGURED',
  OPEN: 'OPEN',
  CLOSED_OUTSIDE_HOURS: 'CLOSED_OUTSIDE_HOURS',
  CLOSED_RECURRING_HOLIDAY: 'CLOSED_RECURRING_HOLIDAY',
  CLOSED_DATED_CLOSURE: 'CLOSED_DATED_CLOSURE',
} as const;

export type BusinessHoursVerdictName =
  (typeof BusinessHoursVerdict)[keyof typeof BusinessHoursVerdict];

export const isOpenVerdict = (verdict: BusinessHoursVerdictName): boolean =>
  verdict === BusinessHoursVerdict.OPEN || verdict === BusinessHoursVerdict.OPEN_UNCONFIGURED;

/**
 * **The single place the open/closed question is answered** (S4-HOURS).
 *
 * A pure function of the vendor's configuration and one instant, so it is
 * exhaustively testable without a database, a clock or a timezone — the
 * instant is supplied by the injected `Clock` at the call site and never read
 * here.
 *
 * The rules, exactly as locked:
 *
 *  1. **No `business_hours` rows → OPEN** (H4-A). Every vendor predates this
 *     table, so reading an empty configuration as "closed" would take the
 *     entire existing delivery fleet offline the moment this shipped. The rule
 *     is keyed on the *intervals*, precisely as the decision states — a vendor
 *     that has somehow recorded closures but no hours is therefore still open,
 *     which is the literal reading and is asserted in the tests rather than
 *     left implicit.
 *  2. A **recurring weekly holiday** for today's IST weekday closes the vendor.
 *  3. A **dated closure** matching today's IST date closes the vendor.
 *  4. Otherwise the vendor is open only while the current IST minute lies
 *     inside one of today's intervals.
 *
 * Boundaries: opening minute is **inclusive**, closing minute is
 * **exclusive** — a vendor closing at 18:00 is shut at 18:00, which is what
 * "closes at six" means. No interval spans midnight (the database refuses
 * `open >= close`), so no wrap-around case exists.
 */
export const resolveBusinessHours = (
  hours: VendorBusinessHours,
  now: Date,
): BusinessHoursVerdictName => {
  if (hours.intervals.length === 0) {
    return BusinessHoursVerdict.OPEN_UNCONFIGURED;
  }

  const ist = toIst(now);

  if (hours.closures.some((closure) => closure.weekday === ist.weekday)) {
    return BusinessHoursVerdict.CLOSED_RECURRING_HOLIDAY;
  }
  if (hours.closures.some((closure) => closure.closedOn === ist.date)) {
    return BusinessHoursVerdict.CLOSED_DATED_CLOSURE;
  }

  const openNow = hours.intervals.some(
    (interval) =>
      interval.weekday === ist.weekday &&
      ist.minuteOfDay >= interval.openMinute &&
      ist.minuteOfDay < interval.closeMinute,
  );

  return openNow ? BusinessHoursVerdict.OPEN : BusinessHoursVerdict.CLOSED_OUTSIDE_HOURS;
};
