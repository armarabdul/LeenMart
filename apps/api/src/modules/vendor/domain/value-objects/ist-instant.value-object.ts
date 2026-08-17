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
