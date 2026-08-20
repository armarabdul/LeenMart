/** One `READY_FOR_PICKUP` pickup sub-order with a slot, as read for the reminder sweep (S7-SCHED). */
export interface PickupReminderCandidate {
  readonly subOrderId: string;
  readonly orderId: string;
  readonly vendorId: string;
  /** The order's owning customer — read from persisted ownership, never client-supplied (locked scope). */
  readonly customerId: string;
  /** `slotDate`/`slotStartMinute` already converted to an absolute instant via `fromIst` — the query adapter owns the IST conversion, so every caller compares plain instants. */
  readonly pickupInstant: Date;
}

/**
 * Reads candidate pickup sub-orders for the T-2h reminder sweep (S7-SCHED).
 *
 * A deliberately coarse pre-filter: every `PICKUP`, `READY_FOR_PICKUP`
 * sub-order with a slot whose *date* falls in `[fromDate, toDate]` (IST,
 * inclusive) — cheap to index, and wide enough that the T-2h window can
 * never fall outside a well-chosen two-day range. The precise instant-level
 * decision belongs to `isDueForPickupReminder`, not this query.
 */
export interface PickupReminderCandidateQuery {
  findCandidates(fromDate: string, toDate: string): Promise<readonly PickupReminderCandidate[]>;
}
