import type { Clock, Logger } from '@leen-mart/domain-kit';
import type { ScheduledJob } from '../../../../shared/application/ports/scheduled-job.port.js';
import type { OutboxWriter } from '../../../../shared/application/ports/outbox-writer.port.js';
import {
  toIst,
  addIstDays,
} from '../../../vendor/domain/value-objects/ist-instant.value-object.js';
import { ORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import {
  PICKUP_REMINDER_EVENT_TYPE,
  PICKUP_REMINDER_TICK_INTERVAL_MS,
  isDueForPickupReminder,
} from '../../domain/services/pickup-reminder-policy.js';
import type { PickupReminderCandidateQuery } from '../ports/pickup-reminder-query.port.js';
import type { PickupReminderOutboxLookup } from '../ports/pickup-reminder-outbox-lookup.port.js';

export interface SendPickupRemindersDeps {
  /** `leenmart_checkout`-backed — the cross-vendor sweep read. */
  readonly pickupReminderQuery: PickupReminderCandidateQuery;
  /** `leenmart_app`-backed — the idempotency check against `outbox_events`. */
  readonly pickupReminderOutboxLookup: PickupReminderOutboxLookup;
  /** `leenmart_app`-backed, the same credential the lookup above uses — the actual write, so the check and the write that follows it read and write the same table through the same reach. */
  readonly outboxWriter: OutboxWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * The scheduler platform's first consumer (S7-SCHED): the pickup T-2h
 * reminder. One tick of `ScheduledJob.run()`:
 *
 *   1. Read every `READY_FOR_PICKUP`, `PICKUP`-mode sub-order with a slot in
 *      the next two IST calendar days (a coarse, cheap pre-filter — see
 *      `PrismaPickupReminderCandidateQuery`'s own doc comment).
 *   2. Keep only the ones `isDueForPickupReminder` says are inside the T-2h
 *      window right now.
 *   3. For each, write one `sub_order.pickup_reminder` outbox event —
 *      *unless* one already exists for this sub-order, which is the whole
 *      of this job's idempotency guarantee (locked scope: "same pickup
 *      sub-order + same reminder event -> at most one effective
 *      notification").
 *
 * **Never called concurrently with itself.** The scheduler platform's
 * `AdvisoryLock` guarantees at most one worker process is inside `run()` at
 * any moment, cluster-wide — this class does not acquire or know about the
 * lock itself, the same separation `OutboxHandler` keeps from the relay
 * that calls it.
 *
 * **Still idempotent on its own**, independent of the lock: a missed tick's
 * catch-up window (`PICKUP_REMINDER_SWEEP_WINDOW_MS`) means the same
 * sub-order can legitimately be a candidate on two different ticks, and the
 * existence check above is what keeps that from producing a second event.
 *
 * The outbox payload carries `customerId`, resolved server-side by the
 * query from `orders.customer_id` — never a value this job invents or a
 * client supplies. `DeliverNotificationUseCase` reads it directly for any
 * `CUSTOMER`-kind event, the same way it already does for `order.confirmed`
 * et al.
 */
export class SendPickupRemindersUseCase implements ScheduledJob {
  readonly name = 'pickup-reminder';
  readonly intervalMs = PICKUP_REMINDER_TICK_INTERVAL_MS;

  constructor(private readonly deps: SendPickupRemindersDeps) {}

  async run(): Promise<void> {
    const { pickupReminderQuery, pickupReminderOutboxLookup, outboxWriter, clock, logger } =
      this.deps;
    const now = clock.now();

    // Tomorrow's IST date is always enough headroom: a slot due for its T-2h
    // reminder today is on today's IST date, and the one edge case — a slot
    // just after IST midnight whose reminder window starts shortly before
    // midnight — is covered by including today itself, since `fromDate` and
    // `toDate` bound the slot's *date*, not the reminder instant.
    const todayIst = toIst(now).date;
    const tomorrowIst = addIstDays(todayIst, 1);

    const candidates = await pickupReminderQuery.findCandidates(todayIst, tomorrowIst);
    const due = candidates.filter((candidate) =>
      isDueForPickupReminder(candidate.pickupInstant, now),
    );

    let created = 0;
    let alreadyPresent = 0;
    for (const candidate of due) {
      const exists = await pickupReminderOutboxLookup.exists(candidate.subOrderId);
      if (exists) {
        alreadyPresent += 1;
        continue;
      }
      await outboxWriter.write({
        aggregateType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
        aggregateId: candidate.subOrderId,
        eventType: PICKUP_REMINDER_EVENT_TYPE,
        payload: {
          subOrderId: candidate.subOrderId,
          orderId: candidate.orderId,
          vendorId: candidate.vendorId,
          customerId: candidate.customerId,
        },
      });
      created += 1;
    }

    if (created > 0 || alreadyPresent > 0) {
      logger.info(
        { candidates: candidates.length, due: due.length, created, alreadyPresent },
        'Pickup reminder sweep complete',
      );
    }
  }
}
