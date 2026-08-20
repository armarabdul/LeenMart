/**
 * The outbox `eventType` / notification-policy key for this milestone's one
 * new event (S7-SCHED locked scope). `sub_order`-scoped, matching
 * `ORDER_AUDIT_ACTIONS`'s own naming convention for sub-order-level facts
 * (`sub_order.pickup_completed` etc.) even though this one is never written
 * to the audit log — it has no human or system *actor* deciding anything,
 * only a scheduler observing that time has passed, so `AuditWriter` is never
 * called for it.
 */
export const PICKUP_REMINDER_EVENT_TYPE = 'sub_order.pickup_reminder';

/**
 * When a `READY_FOR_PICKUP` sub-order's slot becomes due for its T-2h
 * reminder (S7-SCHED). The only approved lead time — a delivery-slot
 * reminder's own lead time is explicitly undecided and this module says
 * nothing about it.
 */
export const PICKUP_REMINDER_LEAD_MS = 2 * 60 * 60 * 1000;

/**
 * How often the scheduler ticks for this job. Five minutes: fine enough
 * that a customer is never told "2 hours" when it is closer to 2h05, coarse
 * enough that the sweep query and the advisory lock are not fighting for
 * work every few seconds for a reminder whose entire purpose is measured in
 * hours.
 */
export const PICKUP_REMINDER_TICK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * The catch-up margin behind the T-2h mark (S7-SCHED, locked scope: "do not
 * send the reminder early by an arbitrary amount unless the existing
 * architecture requires a bounded sweep window").
 *
 * Two ticks wide, not one — a single missed or delayed tick (a worker
 * restart, a stalled lock) must not silently drop a reminder. The window is
 * **never open before the exact T-2h instant** (a customer is never told
 * "2 hours" when it is really 2h05 away) and **never open more than this
 * margin after it** (a reminder that means nothing 20 minutes before pickup
 * is not worth sending late — the sub-order simply misses this reminder,
 * which is the accepted trade of a bounded window rather than an unbounded
 * "eventually" sweep).
 */
export const PICKUP_REMINDER_SWEEP_WINDOW_MS = 2 * PICKUP_REMINDER_TICK_INTERVAL_MS;

/**
 * Whether a pickup instant is due for its T-2h reminder right now.
 *
 * A pure function of two instants — no `Clock`, no database, no IST
 * conversion of its own (the caller already turned `slotDate`/
 * `slotStartMinute` into `pickupInstant` via `fromIst`, S4-SLOTS' own IST
 * convention, reused rather than re-invented here). Exhaustively testable
 * against fixed instants for exactly that reason.
 *
 * True for `minutesUntilPickup` in `(LEAD - WINDOW, LEAD]` — inclusive of
 * the exact T-2h instant, exclusive of the trailing edge so a sub-order
 * caught by one tick's window is never picked up again by a stale
 * re-evaluation of the same boundary. The idempotency check at the call
 * site (an existing `outbox_events` row for this sub-order) is what
 * actually prevents a second reminder if two ticks' windows do overlap —
 * this function only decides "is this instant in range", never "has this
 * already been sent".
 */
export const isDueForPickupReminder = (pickupInstant: Date, now: Date): boolean => {
  const msUntilPickup = pickupInstant.getTime() - now.getTime();
  return (
    msUntilPickup <= PICKUP_REMINDER_LEAD_MS &&
    msUntilPickup > PICKUP_REMINDER_LEAD_MS - PICKUP_REMINDER_SWEEP_WINDOW_MS
  );
};
