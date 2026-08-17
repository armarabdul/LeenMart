import { describe, expect, it } from 'vitest';
import {
  BusinessHoursVerdict,
  isOpenVerdict,
  resolveBusinessHours,
  type VendorBusinessHours,
} from '../../../../../src/modules/vendor/domain/services/business-hours-policy.js';
import { toIst } from '../../../../../src/modules/vendor/domain/value-objects/ist-instant.value-object.js';

/**
 * Every instant below is written as UTC and reasoned about in IST (+05:30),
 * because that offset is the whole point of the conversion. 2026-08-19 is a
 * Wednesday (weekday 3) in IST.
 */
const AT = (utc: string): Date => new Date(utc);

/** 2026-08-19T04:30:00Z === 10:00 IST, Wednesday. */
const WED_1000_IST = AT('2026-08-19T04:30:00.000Z');
/** 2026-08-19T01:00:00Z === 06:30 IST, Wednesday. */
const WED_0630_IST = AT('2026-08-19T01:00:00.000Z');

const hours = (partial: Partial<VendorBusinessHours> = {}): VendorBusinessHours => ({
  intervals: partial.intervals ?? [{ weekday: 3, openMinute: 9 * 60, closeMinute: 18 * 60 }],
  closures: partial.closures ?? [],
});

describe('IST conversion (ASM-01)', () => {
  it('shifts a UTC instant by +05:30', () => {
    const ist = toIst(WED_1000_IST);

    expect(ist.weekday).toBe(3);
    expect(ist.minuteOfDay).toBe(10 * 60);
    expect(ist.date).toBe('2026-08-19');
  });

  it('rolls the IST weekday and date forward across the 18:30 UTC boundary', () => {
    // 18:29 UTC Wednesday is still Wednesday 23:59 IST…
    const before = toIst(AT('2026-08-19T18:29:00.000Z'));
    expect(before.weekday).toBe(3);
    expect(before.date).toBe('2026-08-19');

    // …and 18:30 UTC is already Thursday 00:00 IST. A UTC-based check would
    // still say Wednesday here, which is the bug this test exists to catch.
    const after = toIst(AT('2026-08-19T18:30:00.000Z'));
    expect(after.weekday).toBe(4);
    expect(after.date).toBe('2026-08-20');
    expect(after.minuteOfDay).toBe(0);
  });

  it('never interprets the instant as UTC wall-clock', () => {
    // 00:00 UTC is 05:30 IST — not midnight, and not the previous weekday.
    const ist = toIst(AT('2026-08-19T00:00:00.000Z'));

    expect(ist.minuteOfDay).toBe(5 * 60 + 30);
    expect(ist.weekday).toBe(3);
  });
});

describe('resolveBusinessHours (S4-HOURS)', () => {
  describe('unconfigured vendors (locked decision H4-A)', () => {
    it('treats a vendor with no intervals as open', () => {
      const verdict = resolveBusinessHours({ intervals: [], closures: [] }, WED_1000_IST);

      expect(verdict).toBe(BusinessHoursVerdict.OPEN_UNCONFIGURED);
      expect(isOpenVerdict(verdict)).toBe(true);
    });

    it('is open at any hour, including the middle of the night', () => {
      // 21:00 UTC === 02:30 IST.
      const verdict = resolveBusinessHours(
        { intervals: [], closures: [] },
        AT('2026-08-19T21:00:00.000Z'),
      );

      expect(isOpenVerdict(verdict)).toBe(true);
    });

    it('stays open even with closures recorded but no intervals', () => {
      // The rule is keyed on intervals, exactly as H4-A words it. Asserted
      // explicitly so this corner is visible rather than accidental.
      const verdict = resolveBusinessHours(
        { intervals: [], closures: [{ weekday: 3, closedOn: null }] },
        WED_1000_IST,
      );

      expect(verdict).toBe(BusinessHoursVerdict.OPEN_UNCONFIGURED);
    });
  });

  describe('configured weekly hours', () => {
    it('is open inside the interval', () => {
      expect(resolveBusinessHours(hours(), WED_1000_IST)).toBe(BusinessHoursVerdict.OPEN);
    });

    it('is closed before opening', () => {
      expect(resolveBusinessHours(hours(), WED_0630_IST)).toBe(
        BusinessHoursVerdict.CLOSED_OUTSIDE_HOURS,
      );
    });

    it('is closed on a weekday with no intervals', () => {
      // Thursday, while only Wednesday is configured.
      expect(resolveBusinessHours(hours(), AT('2026-08-20T04:30:00.000Z'))).toBe(
        BusinessHoursVerdict.CLOSED_OUTSIDE_HOURS,
      );
    });

    it('opens exactly at the opening minute (inclusive boundary)', () => {
      // 03:30 UTC === 09:00 IST.
      expect(resolveBusinessHours(hours(), AT('2026-08-19T03:30:00.000Z'))).toBe(
        BusinessHoursVerdict.OPEN,
      );
    });

    it('is already closed at the closing minute (exclusive boundary)', () => {
      // 12:30 UTC === 18:00 IST — "closes at six" means shut at six.
      expect(resolveBusinessHours(hours(), AT('2026-08-19T12:30:00.000Z'))).toBe(
        BusinessHoursVerdict.CLOSED_OUTSIDE_HOURS,
      );
    });

    it('is open one minute before closing', () => {
      expect(resolveBusinessHours(hours(), AT('2026-08-19T12:29:00.000Z'))).toBe(
        BusinessHoursVerdict.OPEN,
      );
    });

    it('honours split shifts on one weekday', () => {
      const split = hours({
        intervals: [
          { weekday: 3, openMinute: 7 * 60, closeMinute: 11 * 60 },
          { weekday: 3, openMinute: 16 * 60, closeMinute: 20 * 60 },
        ],
      });

      // 08:00 IST — inside the morning shift.
      expect(resolveBusinessHours(split, AT('2026-08-19T02:30:00.000Z'))).toBe(
        BusinessHoursVerdict.OPEN,
      );
      // 13:00 IST — the gap between shifts.
      expect(resolveBusinessHours(split, AT('2026-08-19T07:30:00.000Z'))).toBe(
        BusinessHoursVerdict.CLOSED_OUTSIDE_HOURS,
      );
      // 17:00 IST — inside the evening shift.
      expect(resolveBusinessHours(split, AT('2026-08-19T11:30:00.000Z'))).toBe(
        BusinessHoursVerdict.OPEN,
      );
    });

    it('ignores another weekday’s intervals', () => {
      const tuesdayOnly = hours({
        intervals: [{ weekday: 2, openMinute: 0, closeMinute: 1440 }],
      });

      expect(resolveBusinessHours(tuesdayOnly, WED_1000_IST)).toBe(
        BusinessHoursVerdict.CLOSED_OUTSIDE_HOURS,
      );
    });
  });

  describe('closures (H3-C)', () => {
    it('a recurring weekly holiday closes an otherwise-open day', () => {
      const withHoliday = hours({ closures: [{ weekday: 3, closedOn: null }] });

      expect(resolveBusinessHours(withHoliday, WED_1000_IST)).toBe(
        BusinessHoursVerdict.CLOSED_RECURRING_HOLIDAY,
      );
    });

    it('a recurring holiday on another weekday does not close today', () => {
      const withHoliday = hours({ closures: [{ weekday: 0, closedOn: null }] });

      expect(resolveBusinessHours(withHoliday, WED_1000_IST)).toBe(BusinessHoursVerdict.OPEN);
    });

    it('a dated closure closes an otherwise-open day', () => {
      const withClosure = hours({ closures: [{ weekday: null, closedOn: '2026-08-19' }] });

      expect(resolveBusinessHours(withClosure, WED_1000_IST)).toBe(
        BusinessHoursVerdict.CLOSED_DATED_CLOSURE,
      );
    });

    it('a dated closure on another date does not close today', () => {
      const withClosure = hours({ closures: [{ weekday: null, closedOn: '2026-08-20' }] });

      expect(resolveBusinessHours(withClosure, WED_1000_IST)).toBe(BusinessHoursVerdict.OPEN);
    });

    it('matches a dated closure against the IST date, not the UTC date', () => {
      // 2026-08-19T19:00Z is already 2026-08-20 in IST, so a closure dated the
      // 20th must bite even though the UTC date still reads the 19th.
      const withClosure = hours({
        intervals: [{ weekday: 4, openMinute: 0, closeMinute: 1440 }],
        closures: [{ weekday: null, closedOn: '2026-08-20' }],
      });

      expect(resolveBusinessHours(withClosure, AT('2026-08-19T19:00:00.000Z'))).toBe(
        BusinessHoursVerdict.CLOSED_DATED_CLOSURE,
      );
    });

    it('closes even inside an interval — a closure outranks the schedule', () => {
      const withClosure = hours({
        intervals: [{ weekday: 3, openMinute: 0, closeMinute: 1440 }],
        closures: [{ weekday: null, closedOn: '2026-08-19' }],
      });

      expect(isOpenVerdict(resolveBusinessHours(withClosure, WED_1000_IST))).toBe(false);
    });
  });

  describe('determinism', () => {
    it('returns the same verdict for the same instant every time', () => {
      const schedule = hours();
      const first = resolveBusinessHours(schedule, WED_1000_IST);
      const second = resolveBusinessHours(schedule, new Date(WED_1000_IST.getTime()));

      expect(second).toBe(first);
    });
  });
});
