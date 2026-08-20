import { describe, expect, it } from 'vitest';
import {
  addIstDays,
  fromIst,
  toIst,
} from '../../../../src/modules/vendor/domain/value-objects/ist-instant.value-object.js';

describe('fromIst (S7-SCHED)', () => {
  it('is the exact inverse of toIst', () => {
    const instant = new Date('2026-08-20T09:30:00.000Z');
    const ist = toIst(instant);

    expect(fromIst(ist.date, ist.minuteOfDay)).toEqual(instant);
  });

  it('IST midnight is 18:30 UTC the previous day (the fixed +05:30 offset)', () => {
    expect(fromIst('2026-08-20', 0)).toEqual(new Date('2026-08-19T18:30:00.000Z'));
  });

  it('two hours after IST midnight lands at 20:30 UTC the previous day', () => {
    expect(fromIst('2026-08-20', 120)).toEqual(new Date('2026-08-19T20:30:00.000Z'));
  });

  it('the last minute of the IST day (23:59) is 18:29 UTC the same day', () => {
    expect(fromIst('2026-08-20', 23 * 60 + 59)).toEqual(new Date('2026-08-20T18:29:00.000Z'));
  });

  it('round-trips across a UTC calendar-date boundary (late-evening IST slot)', () => {
    // 22:00 IST on 2026-08-20 is still 2026-08-20 in UTC (16:30 UTC) — the
    // boundary case toIst's own comment calls out ("differs for 18:30-24:00 UTC").
    const instant = fromIst('2026-08-20', 22 * 60);
    expect(toIst(instant)).toEqual({ weekday: 4, minuteOfDay: 22 * 60, date: '2026-08-20' });
  });
});

describe('addIstDays (S7-SCHED)', () => {
  it('adds a day within the same month', () => {
    expect(addIstDays('2026-08-20', 1)).toBe('2026-08-21');
  });

  it('crosses a month boundary', () => {
    expect(addIstDays('2026-08-31', 1)).toBe('2026-09-01');
  });

  it('crosses a year boundary', () => {
    expect(addIstDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('zero days is a no-op', () => {
    expect(addIstDays('2026-08-20', 0)).toBe('2026-08-20');
  });
});
