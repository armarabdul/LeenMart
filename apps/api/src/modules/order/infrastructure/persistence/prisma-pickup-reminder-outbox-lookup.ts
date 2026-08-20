import type { PrismaClient } from '@prisma/client';
import { PICKUP_REMINDER_EVENT_TYPE } from '../../domain/services/pickup-reminder-policy.js';
import type { PickupReminderOutboxLookup } from '../../application/ports/pickup-reminder-outbox-lookup.port.js';
import { ORDER_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';

/**
 * `PickupReminderOutboxLookup` on `leenmart_app` (S7-SCHED).
 *
 * **Bound to `leenmart_app`, not `leenmart_checkout` — this is the
 * grant-driven half of the design.** `leenmart_checkout` holds `INSERT` only
 * on `outbox_events` (S3-3A's own migration: every existing producer is
 * insert-only there, by design, so a checkout-path bug cannot read events
 * meant for other consumers). `leenmart_app` already holds full
 * `SELECT`/`INSERT`/`UPDATE`/`DELETE` on `outbox_events` — it is what the
 * outbox relay itself reads and marks with (`PrismaOutboxRelayStore`, on
 * `container.prisma`) — so this reuses that existing reach rather than
 * widening `leenmart_checkout`'s grant to get a second credential that can
 * read the table. No migration, no grant change.
 *
 * `idx_outbox_aggregate` on `(aggregate_type, aggregate_id)` is what keeps
 * this cheap — the `eventType` filter narrows an already-small per-sub-order
 * result set rather than scanning the table.
 */
export class PrismaPickupReminderOutboxLookup implements PickupReminderOutboxLookup {
  constructor(private readonly prisma: PrismaClient) {}

  async exists(subOrderId: string): Promise<boolean> {
    const row = await this.prisma.outboxEvent.findFirst({
      where: {
        aggregateType: ORDER_AUDIT_ENTITY_TYPES.SUB_ORDER,
        aggregateId: subOrderId,
        eventType: PICKUP_REMINDER_EVENT_TYPE,
      },
      select: { id: true },
    });
    return row !== null;
  }
}
