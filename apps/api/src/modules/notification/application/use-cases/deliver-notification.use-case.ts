import type { Logger } from '@leen-mart/domain-kit';
import type { NotificationWriteRepository } from '../../domain/repositories/notification.repository.js';
import {
  IN_APP,
  contentFor,
  isNotifiedEventType,
  recipientKindFor,
  type NotifiedEventType,
} from '../../domain/services/notification-policy.js';
import type { NotificationRecipientResolver } from '../ports/notification-recipient-resolver.port.js';

export interface DeliverNotificationInput {
  readonly outboxEventId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
}

export interface DeliverNotificationResult {
  readonly created: number;
  readonly alreadyPresent: number;
  /** Recipients whose `users` row no longer exists — permanent, and not an error. */
  readonly recipientMissing: number;
  readonly recipients: number;
}

/** Nothing to do, for the several distinct reasons that produce it. */
const EMPTY: DeliverNotificationResult = {
  created: 0,
  alreadyPresent: 0,
  recipientMissing: 0,
  recipients: 0,
};

export interface DeliverNotificationDeps {
  readonly repository: NotificationWriteRepository;
  readonly recipients: NotificationRecipientResolver;
  readonly logger: Logger;
}

/** The two payload fields the four notified events are guaranteed to carry. */
const stringField = (payload: Record<string, unknown>, key: string): string | null => {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
};

/**
 * The `NotificationOrchestrator` of SDD 11.1 (S6-NOTIFY-INAPP).
 *
 * Runs in the BullMQ worker, never in the outbox relay: the relay's handler
 * enqueues and returns, so a slow or failing notification write can never stall
 * the relay's claim loop or consume its attempt budget.
 *
 * Of §11.1's five steps this implements three — resolve recipient, select
 * channel, dispatch — and deliberately omits two: preferences and quiet hours
 * (FR-58, excluded from this milestone: these are transactional messages, which
 * §11.1 itself says are never suppressible) and template rendering (FR-59,
 * deferred — the strings are fixed and the payload is stored for later).
 *
 * **Safe under at-least-once delivery.** The relay can redeliver an event and
 * BullMQ can retry a job; both land here, and both produce the same rows,
 * because every write goes through `createIfAbsent` on the logical key
 * `(outboxEventId, channel, recipientUserId)`.
 *
 * An event outside the four notified types is not an error — it is the
 * expected case for six of the ten types that exist, and returning quietly is
 * what keeps them flowing through the relay unconsumed.
 *
 * Neither is a recipient who no longer exists. A job that can never succeed
 * is not made more likely to succeed by retrying it, so that case is counted
 * and logged rather than thrown.
 */
export class DeliverNotificationUseCase {
  constructor(private readonly deps: DeliverNotificationDeps) {}

  async execute(input: DeliverNotificationInput): Promise<DeliverNotificationResult> {
    const { eventType, payload, outboxEventId } = input;
    if (!isNotifiedEventType(eventType)) {
      return EMPTY;
    }

    const orderId = stringField(payload, 'orderId');
    if (orderId === null) {
      // Every notified event is an order event and carries `orderId`. One that
      // does not is malformed, and inventing a reference for it would put a
      // wrong order number in front of a customer.
      this.deps.logger.warn(
        { outboxEventId, eventType },
        'Notification skipped: event carries no orderId',
      );
      return EMPTY;
    }

    const recipientUserIds = await this.resolveRecipients(eventType, payload, orderId);
    const content = contentFor(eventType, { orderId });
    const kind = recipientKindFor(eventType);

    let created = 0;
    let alreadyPresent = 0;
    let recipientMissing = 0;
    for (const recipientUserId of recipientUserIds) {
      const outcome = await this.deps.repository.createIfAbsent({
        recipientUserId,
        recipientKind: kind,
        outboxEventId,
        channel: IN_APP,
        eventType,
        payload,
        title: content.title,
        body: content.body,
      });
      if (outcome === 'created') created += 1;
      else if (outcome === 'already-present') alreadyPresent += 1;
      else recipientMissing += 1;
    }

    if (created > 0) {
      this.deps.logger.info(
        { outboxEventId, eventType, recipientKind: kind, created, alreadyPresent },
        'In-app notifications delivered',
      );
    }
    if (recipientMissing > 0) {
      // Warn rather than throw: the job has done everything it can, and
      // failing it would only replay the same impossible write twice more
      // before dead-lettering it.
      this.deps.logger.warn(
        { outboxEventId, eventType, recipientKind: kind, recipientMissing },
        'Notification skipped: recipient no longer exists',
      );
    }
    return { created, alreadyPresent, recipientMissing, recipients: recipientUserIds.length };
  }

  /**
   * The customer comes from the payload; the vendors are looked up.
   *
   * Duplicates are collapsed — one person owning two of the order's vendors
   * receives one "New order", not two, because the logical idempotency key is
   * per user rather than per vendor.
   */
  private async resolveRecipients(
    eventType: NotifiedEventType,
    payload: Record<string, unknown>,
    orderId: string,
  ): Promise<readonly string[]> {
    if (recipientKindFor(eventType) === 'CUSTOMER') {
      const customerId = stringField(payload, 'customerId');
      return customerId === null ? [] : [customerId];
    }
    const vendorUserIds = await this.deps.recipients.vendorUserIdsForOrder(orderId);
    return [...new Set(vendorUserIds)];
  }
}
