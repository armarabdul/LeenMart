/**
 * The IST wall-clock view of a UTC instant (S4-HOURS).
 *
 * ASM-01 fixes the platform to a single Indian region, **IST only**, so the
 * offset is the constant +05:30. India observes no daylight saving, which is
 * what makes a fixed offset correct here rather than a simplification — a
 * timezone database would add a dependency and a failure mode for a value that
 * cannot change.
 *
 * Deliberately *not* `toLocaleString`/`Intl`: those read the host's ICU data
 * and would make the result depend on where the process runs, which is exactly
 * the non-determinism the tests must exclude. The arithmetic below depends on
 * nothing but the input instant.
 */
const IST_OFFSET_MINUTES = 5 * 60 + 30;

export const MINUTES_PER_DAY = 1440;

export interface IstInstant {
  /** 0 = Sunday … 6 = Saturday, in IST — not the UTC weekday, which differs for 18:30–24:00 UTC. */
  readonly weekday: number;
  /** Minutes since IST midnight, 0…1439. */
  readonly minuteOfDay: number;
  /** The IST calendar date as `YYYY-MM-DD`, for matching dated closures. */
  readonly date: string;
}

/**
 * Projects a UTC instant into IST.
 *
 * Implemented by shifting the instant forward by the offset and then reading
 * the **UTC** fields of the shifted value. Reading local fields instead would
 * reintroduce the host timezone; reading UTC fields of a shifted instant is
 * the standard trick that keeps this pure.
 */
export const toIst = (instant: Date): IstInstant => {
  const shifted = new Date(instant.getTime() + IST_OFFSET_MINUTES * 60_000);
  const year = shifted.getUTCFullYear();
  const month = `${shifted.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${shifted.getUTCDate()}`.padStart(2, '0');

  return {
    weekday: shifted.getUTCDay(),
    minuteOfDay: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
    date: `${year}-${month}-${day}`,
  };
};

/** `YYYY-MM-DD` for a `@db.Date` column, which Prisma hands back as a UTC-midnight `Date`. */
export const toIsoDate = (value: Date): string => value.toISOString().slice(0, 10);

/**
 * The reverse of `toIst`: the UTC instant for a given IST wall-clock date and
 * minute-of-day (S7-SCHED). Used where a stored IST slot (`sub_orders.slot_date`
 * + `slot_start_minute`, S4-SLOTS) must be compared against `Clock.now()` as an
 * absolute instant — the pickup-reminder due-window check is the first caller.
 *
 * Same trick as `toIst`, run backward: build the instant from the date's UTC
 * fields plus the minute offset, then subtract the fixed IST offset. Never
 * reads `Date.UTC`'s implicit local-time overloads or `Intl`, for the same
 * determinism reason `toIst`'s own comment gives.
 */
export const fromIst = (isoDate: string, minuteOfDay: number): Date => {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const utcMidnight = Date.UTC(year, month - 1, day);
  return new Date(utcMidnight + minuteOfDay * 60_000 - IST_OFFSET_MINUTES * 60_000);
};

/** Adds `days` to an IST calendar date, staying in `YYYY-MM-DD` and never touching the host timezone — the same arithmetic `delivery-slot-policy.ts`'s own private `addDays` uses, promoted here so a second caller does not have to duplicate it. */
export const addIstDays = (isoDate: string, days: number): string => {
  const shifted = new Date(`${isoDate}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};
