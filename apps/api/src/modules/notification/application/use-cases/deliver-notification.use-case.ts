import type { Logger } from '@leen-mart/domain-kit';
import type { NotificationWriteRepository } from '../../domain/repositories/notification.repository.js';
import {
  IN_APP,
  contentFor,
  isNotifiedEventType,
  recipientKindFor,
  subjectIdFieldOf,
  subjectOf,
  type NotificationSubject,
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

    const subject = subjectOf(eventType);
    const subjectIdField = subjectIdFieldOf(subject);
    const subjectId = subjectIdField === null ? null : stringField(payload, subjectIdField);
    if (subjectIdField !== null && subjectId === null) {
      // The event does not name the thing it is about. Inventing a reference
      // would put a wrong order or product number in front of someone.
      this.deps.logger.warn(
        { outboxEventId, eventType, expectedField: subjectIdField },
        'Notification skipped: event does not name its subject',
      );
      return EMPTY;
    }

    const recipientUserIds = await this.resolveRecipients(eventType, payload, subject, subjectId);
    const content = contentFor(eventType, { subjectId });
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
   * Who the event reaches, which depends on what it is about.
   *
   * An order event carries one side and needs the other looked up: the
   * customer is in the payload, the vendors are not. A product-moderation or
   * KYC event is a decision *about* a vendor and names that vendor directly,
   * so only the vendor's owner has to be resolved.
   *
   * Every branch resolves the recipient from persisted state or from a
   * server-written payload field. Nothing here reads anything a client sent.
   */
  private async resolveRecipients(
    eventType: NotifiedEventType,
    payload: Record<string, unknown>,
    subject: NotificationSubject,
    subjectId: string | null,
  ): Promise<readonly string[]> {
    if (subject === 'PRODUCT' || subject === 'VENDOR_KYC') {
      return this.resolveVendorOwner(payload);
    }
    if (recipientKindFor(eventType) === 'CUSTOMER') {
      const customerId = stringField(payload, 'customerId');
      return customerId === null ? [] : [customerId];
    }
    // An ORDER/VENDOR event: `subjectId` is the order id, non-null because the
    // caller already refused the event otherwise.
    const vendorUserIds = await this.deps.recipients.vendorUserIdsForOrder(subjectId ?? '');
    // Duplicates collapsed — one person owning two of the order's vendors
    // receives one "New order", not two, because the logical idempotency key
    // is per user rather than per vendor.
    return [...new Set(vendorUserIds)];
  }

  /**
   * The owner of the vendor the decision was about (S6-NOTIFY-LIFECYCLE).
   *
   * A missing or unresolvable `vendorId` yields no recipients rather than a
   * substitute: there is no second candidate who should read another vendor's
   * moderation outcome.
   */
  private async resolveVendorOwner(payload: Record<string, unknown>): Promise<readonly string[]> {
    const vendorId = stringField(payload, 'vendorId');
    if (vendorId === null) return [];
    const ownerUserId = await this.deps.recipients.vendorOwnerUserId(vendorId);
    return ownerUserId === null ? [] : [ownerUserId];
  }
}
