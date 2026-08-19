import { MINUTES_PER_DAY, toIst } from '../value-objects/ist-instant.value-object.js';

/** One recurring window a vendor offers, in minutes since IST midnight. */
export interface DeliverySlotTemplate {
  readonly weekday: number;
  readonly startMinute: number;
  readonly endMinute: number;
  /** Vendor-declared, ≥ 1 (locked decision S1). One sub-order consumes one unit (S2). */
  readonly capacity: number;
}

/** A concrete, dated window a customer can actually choose. */
export interface OfferedSlot {
  /** `YYYY-MM-DD`, IST. */
  readonly date: string;
  readonly startMinute: number;
  readonly endMinute: number;
  readonly capacity: number;
  readonly booked: number;
  readonly remaining: number;
}

/** How many sub-orders are already booked into one dated window. */
export interface SlotBooking {
  readonly date: string;
  readonly startMinute: number;
  readonly booked: number;
}

/** What a customer chose, as it arrives from the wire and as it is snapshotted. */
export interface SlotSelection {
  readonly date: string;
  readonly startMinute: number;
}

/** The number of days of availability a single request may ask for (PERF-08's "hard ceiling"). */
export const MAX_SLOT_HORIZON_DAYS = 14;
export const DEFAULT_SLOT_HORIZON_DAYS = 7;

const key = (date: string, startMinute: number): string => `${date}#${startMinute}`;

/** Adds `days` to an IST calendar date, staying in `YYYY-MM-DD` and never touching the host timezone. */
const addDays = (isoDate: string, days: number): string => {
  const shifted = new Date(`${isoDate}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
};

/** The IST weekday of an IST calendar date. */
const weekdayOf = (isoDate: string): number => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

/**
 * **The single place "which slots can this customer choose?" is answered**
 * (S4-SLOTS).
 *
 * A pure function of the vendor's templates, the bookings already taken and
 * one instant — so it is exhaustively testable without a database, a clock or
 * a timezone. The instant comes from the injected `Clock` at the call site and
 * is never read here.
 *
 * The rules, exactly as locked:
 *
 *  1. **No templates → no slots.** The caller reads that as "this vendor takes
 *     orders without a slot", the backward-compatible default `D7` and `H4-A`
 *     each already established. This function does not decide that; it simply
 *     has nothing to offer.
 *  2. A window is offered on a date only if the vendor has a template for that
 *     date's **IST weekday**.
 *  3. A window whose **end has already passed in IST is not offered** — a
 *     customer cannot book a delivery for this morning at six in the evening.
 *     The end, not the start: a window still running is still joinable, which
 *     is the same inclusive-start/exclusive-end convention `business_hours`
 *     uses.
 *  4. A window with `booked >= capacity` is returned with `remaining: 0`
 *     rather than omitted, so the customer sees "17:00–19:00 — full" instead
 *     of a window that silently vanished.
 */
export const offeredSlots = (
  templates: readonly DeliverySlotTemplate[],
  bookings: readonly SlotBooking[],
  now: Date,
  horizonDays: number,
): readonly OfferedSlot[] => {
  if (templates.length === 0) return [];

  const ist = toIst(now);
  const bookedBy = new Map(bookings.map((b) => [key(b.date, b.startMinute), b.booked]));
  const slots: OfferedSlot[] = [];

  for (let offset = 0; offset < horizonDays; offset += 1) {
    const date = addDays(ist.date, offset);
    const weekday = weekdayOf(date);
    for (const template of templates) {
      if (template.weekday !== weekday) continue;
      // Today only: a window that has already ended is not a choice.
      if (offset === 0 && template.endMinute <= ist.minuteOfDay) continue;

      const booked = bookedBy.get(key(date, template.startMinute)) ?? 0;
      slots.push({
        date,
        startMinute: template.startMinute,
        endMinute: template.endMinute,
        capacity: template.capacity,
        booked,
        remaining: Math.max(0, template.capacity - booked),
      });
    }
  }

  return slots.sort((a, b) =>
    a.date === b.date ? a.startMinute - b.startMinute : a.date.localeCompare(b.date),
  );
};

/**
 * Whether a vendor offers slots at all (locked decisions S1/S3 read through
 * the `D7`/`H4-A` precedent): no templates means slot selection is not
 * required from this vendor, and never means the vendor is unavailable.
 */
export const offersSlots = (templates: readonly DeliverySlotTemplate[]): boolean =>
  templates.length > 0;

/**
 * Resolves a customer's selection against what the vendor actually offers.
 *
 * Returns the matching template, or `null` if the selection names a window
 * this vendor does not offer on that date, or one that has already ended.
 * **Capacity is deliberately not consulted here** — availability at validation
 * time proves nothing about availability a millisecond later, so the only
 * honest capacity check is the atomic conditional UPDATE at consumption time.
 * This answers "is this a real window?", never "is there room?".
 */
export const resolveSelection = (
  templates: readonly DeliverySlotTemplate[],
  selection: SlotSelection,
  now: Date,
  horizonDays: number,
): DeliverySlotTemplate | null => {
  if (!isWithinHorizon(selection.date, now, horizonDays)) return null;

  const ist = toIst(now);
  const weekday = weekdayOf(selection.date);
  const template = templates.find(
    (candidate) => candidate.weekday === weekday && candidate.startMinute === selection.startMinute,
  );
  if (!template) return null;
  if (selection.date === ist.date && template.endMinute <= ist.minuteOfDay) return null;
  return template;
};

/** `true` while the date lies between today (IST) and the horizon, inclusive of today. */
const isWithinHorizon = (isoDate: string, now: Date, horizonDays: number): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return false;
  const today = toIst(now).date;
  return isoDate >= today && isoDate < addDays(today, horizonDays);
};

/** The last IST date a selection may name, for the availability query's own bounds. */
export const horizonEndDate = (now: Date, horizonDays: number): string =>
  addDays(toIst(now).date, horizonDays - 1);

export { MINUTES_PER_DAY };
