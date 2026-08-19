import { describe, expect, it } from 'vitest';
import {
  horizonEndDate,
  offeredSlots,
  offersSlots,
  resolveSelection,
  type DeliverySlotTemplate,
  type SlotBooking,
} from '../../../../../src/modules/vendor/domain/services/delivery-slot-policy.js';

/**
 * `2026-08-17T12:00:00Z` is 17:30 IST on **Monday** 17 August 2026. Every case
 * below is expressed against that instant, so "today" and "this weekday" mean
 * something specific rather than whatever the machine happens to think.
 */
const MONDAY_1730_IST = new Date('2026-08-17T12:00:00.000Z');
const MONDAY = 1;
const TUESDAY = 2;

const slot = (overrides: Partial<DeliverySlotTemplate> = {}): DeliverySlotTemplate => ({
  weekday: MONDAY,
  startMinute: 9 * 60,
  endMinute: 11 * 60,
  capacity: 5,
  ...overrides,
});

const HORIZON = 7;

describe('offersSlots', () => {
  it('reports a vendor with no templates as offering none', () => {
    // The backward-compatible default D7 and H4-A each established: a vendor
    // who has configured nothing still takes orders, without a slot.
    expect(offersSlots([])).toBe(false);
  });

  it('reports a vendor with templates as offering them', () => {
    expect(offersSlots([slot()])).toBe(true);
  });
});

describe('offeredSlots (S4-SLOTS)', () => {
  it('offers nothing at all for a vendor with no templates', () => {
    expect(offeredSlots([], [], MONDAY_1730_IST, HORIZON)).toEqual([]);
  });

  it('offers a window on every matching weekday inside the horizon', () => {
    const result = offeredSlots(
      [slot({ startMinute: 20 * 60, endMinute: 21 * 60 })],
      [],
      MONDAY_1730_IST,
      8,
    );

    // Monday 17th (still ahead at 17:30) and Monday 24th.
    expect(result.map((s) => s.date)).toEqual(['2026-08-17', '2026-08-24']);
  });

  it('does not offer a window that has already ended today', () => {
    // 09:00–11:00 on Monday, asked at 17:30 IST on Monday.
    const result = offeredSlots([slot()], [], MONDAY_1730_IST, HORIZON);

    expect(result.map((s) => s.date)).toEqual([]);
  });

  it('still offers a window that has started but not ended', () => {
    const result = offeredSlots(
      [slot({ startMinute: 17 * 60, endMinute: 19 * 60 })],
      [],
      MONDAY_1730_IST,
      1,
    );

    expect(result).toHaveLength(1);
  });

  it('offers tomorrow’s window regardless of today’s time', () => {
    const result = offeredSlots([slot({ weekday: TUESDAY })], [], MONDAY_1730_IST, HORIZON);

    expect(result[0]?.date).toBe('2026-08-18');
  });

  it('subtracts bookings from the vendor’s declared capacity', () => {
    const bookings: SlotBooking[] = [{ date: '2026-08-18', startMinute: 9 * 60, booked: 2 }];

    const result = offeredSlots([slot({ weekday: TUESDAY })], bookings, MONDAY_1730_IST, HORIZON);

    expect(result[0]).toMatchObject({ capacity: 5, booked: 2, remaining: 3 });
  });

  it('shows a full window as full rather than hiding it', () => {
    // A window that silently vanished would read as "this vendor stopped
    // offering Tuesdays", which is a different fact entirely.
    const bookings: SlotBooking[] = [{ date: '2026-08-18', startMinute: 9 * 60, booked: 5 }];

    const result = offeredSlots([slot({ weekday: TUESDAY })], bookings, MONDAY_1730_IST, HORIZON);

    expect(result).toHaveLength(1);
    expect(result[0]?.remaining).toBe(0);
  });

  it('never reports negative remaining capacity', () => {
    const bookings: SlotBooking[] = [{ date: '2026-08-18', startMinute: 9 * 60, booked: 99 }];

    const result = offeredSlots([slot({ weekday: TUESDAY })], bookings, MONDAY_1730_IST, HORIZON);

    expect(result[0]?.remaining).toBe(0);
  });

  it('offers several windows on one weekday, in time order', () => {
    const result = offeredSlots(
      [
        slot({ weekday: TUESDAY, startMinute: 16 * 60, endMinute: 18 * 60 }),
        slot({ weekday: TUESDAY, startMinute: 7 * 60, endMinute: 9 * 60 }),
      ],
      [],
      MONDAY_1730_IST,
      2,
    );

    expect(result.map((s) => s.startMinute)).toEqual([7 * 60, 16 * 60]);
  });

  it('honours the horizon exactly', () => {
    const oneDay = offeredSlots([slot({ weekday: TUESDAY })], [], MONDAY_1730_IST, 1);
    const twoDays = offeredSlots([slot({ weekday: TUESDAY })], [], MONDAY_1730_IST, 2);

    expect(oneDay).toHaveLength(0);
    expect(twoDays).toHaveLength(1);
  });

  it('rolls the IST date forward across the 18:30 UTC boundary', () => {
    // 18:30 UTC is midnight IST — the trap that makes a naive UTC
    // implementation offer yesterday's slots.
    const justAfterIstMidnight = new Date('2026-08-17T18:31:00.000Z');

    const result = offeredSlots([slot({ weekday: TUESDAY })], [], justAfterIstMidnight, 1);

    expect(result[0]?.date).toBe('2026-08-18');
  });
});

describe('resolveSelection (S4-SLOTS)', () => {
  it('resolves a window the vendor actually offers', () => {
    const result = resolveSelection(
      [slot({ weekday: TUESDAY })],
      { date: '2026-08-18', startMinute: 9 * 60 },
      MONDAY_1730_IST,
      HORIZON,
    );

    expect(result).toMatchObject({ startMinute: 9 * 60, endMinute: 11 * 60, capacity: 5 });
  });

  it('refuses a start minute the vendor does not offer', () => {
    const result = resolveSelection(
      [slot({ weekday: TUESDAY })],
      { date: '2026-08-18', startMinute: 9 * 60 + 1 },
      MONDAY_1730_IST,
      HORIZON,
    );

    expect(result).toBeNull();
  });

  it('refuses a date whose weekday the vendor does not serve', () => {
    const result = resolveSelection(
      [slot({ weekday: TUESDAY })],
      { date: '2026-08-19', startMinute: 9 * 60 },
      MONDAY_1730_IST,
      HORIZON,
    );

    expect(result).toBeNull();
  });

  it('refuses a window that has already ended today', () => {
    const result = resolveSelection(
      [slot()],
      { date: '2026-08-17', startMinute: 9 * 60 },
      MONDAY_1730_IST,
      HORIZON,
    );

    expect(result).toBeNull();
  });

  it('refuses a date in the past', () => {
    const result = resolveSelection(
      [slot()],
      { date: '2026-08-10', startMinute: 9 * 60 },
      MONDAY_1730_IST,
      HORIZON,
    );

    expect(result).toBeNull();
  });

  it('refuses a date beyond the horizon', () => {
    const result = resolveSelection(
      [slot({ weekday: TUESDAY })],
      { date: '2026-08-25', startMinute: 9 * 60 },
      MONDAY_1730_IST,
      HORIZON,
    );

    expect(result).toBeNull();
  });

  it('refuses a malformed date rather than coercing it', () => {
    const result = resolveSelection(
      [slot({ weekday: TUESDAY })],
      { date: 'tomorrow', startMinute: 9 * 60 },
      MONDAY_1730_IST,
      HORIZON,
    );

    expect(result).toBeNull();
  });

  it('returns the template’s own end and capacity, never the caller’s', () => {
    // The security property: a client sends only a date and a start minute,
    // so it cannot widen a window or inflate a capacity.
    const template = slot({ weekday: TUESDAY, endMinute: 23 * 60, capacity: 2 });

    const result = resolveSelection(
      [template],
      { date: '2026-08-18', startMinute: 9 * 60 },
      MONDAY_1730_IST,
      HORIZON,
    );

    expect(result).toEqual(template);
  });

  it('refuses everything for a vendor with no templates', () => {
    const result = resolveSelection(
      [],
      { date: '2026-08-18', startMinute: 9 * 60 },
      MONDAY_1730_IST,
      HORIZON,
    );

    expect(result).toBeNull();
  });
});

describe('horizonEndDate', () => {
  it('is inclusive of today, so a 1-day horizon ends today', () => {
    expect(horizonEndDate(MONDAY_1730_IST, 1)).toBe('2026-08-17');
  });

  it('spans a month boundary correctly', () => {
    expect(horizonEndDate(new Date('2026-08-30T12:00:00.000Z'), 7)).toBe('2026-09-05');
  });
});
