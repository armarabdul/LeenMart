import { describe, expect, it } from 'vitest';
import { FixedClock, SystemClock } from '../src/ports/clock.js';

describe('Clock', () => {
  it('SystemClock reports the current time', () => {
    const before = Date.now();
    const now = new SystemClock().nowMs();
    expect(now).toBeGreaterThanOrEqual(before);
  });

  it('FixedClock makes time-dependent behaviour deterministic', () => {
    const clock = new FixedClock(new Date('2026-08-07T06:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-08-07T06:00:00.000Z');

    clock.advanceMs(90 * 60 * 1000);
    expect(clock.now().toISOString()).toBe('2026-08-07T07:30:00.000Z');
  });

  it('FixedClock returns a defensive copy', () => {
    const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
    const first = clock.now();
    first.setFullYear(1999);
    expect(clock.now().getFullYear()).toBe(2026);
  });
});
