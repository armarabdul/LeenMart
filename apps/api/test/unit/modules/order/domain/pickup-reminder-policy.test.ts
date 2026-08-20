import { describe, expect, it } from 'vitest';
import {
  PICKUP_REMINDER_LEAD_MS,
  PICKUP_REMINDER_SWEEP_WINDOW_MS,
  PICKUP_REMINDER_TICK_INTERVAL_MS,
  isDueForPickupReminder,
} from '../../../../../src/modules/order/domain/services/pickup-reminder-policy.js';

const NOW = new Date('2026-08-20T10:00:00.000Z');
const atLeadMs = (offsetMs: number): Date =>
  new Date(NOW.getTime() + PICKUP_REMINDER_LEAD_MS + offsetMs);

describe('pickup reminder constants (S7-SCHED)', () => {
  it('the lead time is exactly T-2h — the only approved reminder timing', () => {
    expect(PICKUP_REMINDER_LEAD_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('the sweep window is two tick intervals — a one-tick catch-up margin', () => {
    expect(PICKUP_REMINDER_SWEEP_WINDOW_MS).toBe(2 * PICKUP_REMINDER_TICK_INTERVAL_MS);
  });
});

describe('isDueForPickupReminder (S7-SCHED)', () => {
  it('is due at exactly the T-2h instant', () => {
    expect(isDueForPickupReminder(atLeadMs(0), NOW)).toBe(true);
  });

  it('is not due one millisecond before the T-2h instant (never early)', () => {
    expect(isDueForPickupReminder(atLeadMs(1), NOW)).toBe(false);
  });

  it('is due just inside the trailing edge of the sweep window', () => {
    expect(isDueForPickupReminder(atLeadMs(-(PICKUP_REMINDER_SWEEP_WINDOW_MS - 1)), NOW)).toBe(
      true,
    );
  });

  it('is not due exactly at the trailing edge of the sweep window (exclusive)', () => {
    expect(isDueForPickupReminder(atLeadMs(-PICKUP_REMINDER_SWEEP_WINDOW_MS), NOW)).toBe(false);
  });

  it('is not due well past the sweep window — the sub-order simply misses this reminder', () => {
    expect(isDueForPickupReminder(atLeadMs(-PICKUP_REMINDER_SWEEP_WINDOW_MS - 60_000), NOW)).toBe(
      false,
    );
  });

  it('is not due for a pickup far in the future (more than 2h away)', () => {
    expect(isDueForPickupReminder(atLeadMs(60_000), NOW)).toBe(false);
  });

  it('is not due for a pickup already in the past', () => {
    expect(isDueForPickupReminder(new Date(NOW.getTime() - 60_000), NOW)).toBe(false);
  });

  it('a pickup instant legitimately stays due across more than one tick — the catch-up margin, by design', () => {
    // The sweep window is deliberately wider than one tick interval (two
    // ticks) so a single missed/delayed tick does not silently drop a
    // reminder. That means the *same* fixed pickup instant can correctly
    // read as due on two consecutive ticks — this function only answers
    // "is this instant in range right now"; the idempotency check at the
    // call site (an existing `outbox_events` row) is what actually
    // delivers the locked scope's "at most one effective notification"
    // guarantee, not this function alone.
    const pickupInstant = atLeadMs(0);
    const firstTickNow = NOW;
    const secondTickNow = new Date(NOW.getTime() + PICKUP_REMINDER_TICK_INTERVAL_MS);

    expect(isDueForPickupReminder(pickupInstant, firstTickNow)).toBe(true);
    expect(isDueForPickupReminder(pickupInstant, secondTickNow)).toBe(true);
  });

  it('a pickup instant is eventually outside every window as time passes', () => {
    const pickupInstant = atLeadMs(0);
    const wayLater = new Date(NOW.getTime() + PICKUP_REMINDER_SWEEP_WINDOW_MS + 60_000);

    expect(isDueForPickupReminder(pickupInstant, wayLater)).toBe(false);
  });
});
