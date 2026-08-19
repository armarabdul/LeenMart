import type { UserId } from '../../../identity/index.js';
import type {
  NotificationChannelName,
  NotificationRecipientKind,
} from '../services/notification-policy.js';

/** One notification as it is stored and read back. */
export interface NotificationRecord {
  readonly id: string;
  readonly createdAt: Date;
  readonly recipientUserId: string;
  readonly recipientKind: NotificationRecipientKind;
  readonly outboxEventId: string;
  readonly channel: NotificationChannelName;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly title: string;
  readonly body: string;
  readonly readAt: Date | null;
}

/** Everything one notification needs to exist. */
export interface NewNotification {
  readonly recipientUserId: string;
  readonly recipientKind: NotificationRecipientKind;
  readonly outboxEventId: string;
  readonly channel: NotificationChannelName;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly title: string;
  readonly body: string;
}

/**
 * What one write attempt actually did.
 *
 * Three outcomes rather than a boolean, because "no row was created" covers
 * two situations a caller must be able to tell apart: the row was already
 * there (correct, expected under at-least-once delivery) and the recipient no
 * longer exists (also permanent, but worth logging).
 */
export type NotificationWriteOutcome = 'created' | 'already-present' | 'recipient-missing';

/**
 * The orchestrator's write side (S6-NOTIFY-INAPP).
 *
 * Bound to `leenmart_checkout`: the worker resolves recipients across vendors
 * and then writes rows for users it is not acting as, which the vendor-scoped
 * `leenmart_app` credential cannot do without impersonating each recipient.
 * It is the same cross-vendor credential `PlaceOrderUseCase` already uses.
 */
export interface NotificationWriteRepository {
  /**
   * Creates the notification unless one already exists for the same
   * `(outboxEventId, channel, recipientUserId)`.
   *
   * **This is where SDD 11.3's idempotency key is actually enforced.** The
   * database's unique index has to carry the partition key, so it cannot be
   * the guarantee on its own; this check is written against the logical key
   * and is what makes a redelivered event — or a retried BullMQ job — produce
   * one row rather than two.
   *
   * `recipient-missing` is the third outcome, and it is not a failure. A
   * notification whose recipient no longer has a `users` row can never be
   * created and can never succeed on retry, so reporting it as an error would
   * buy three doomed attempts and a dead letter for a row nobody can read.
   */
  createIfAbsent(notification: NewNotification): Promise<NotificationWriteOutcome>;
}

/** A page of the caller's own notifications, newest first. */
export interface NotificationPage {
  readonly items: readonly NotificationRecord[];
  /** The cursor to pass for the next page, or `null` at the end. */
  readonly nextCursor: string | null;
}

/**
 * The recipient's read side (S6-NOTIFY-INAPP).
 *
 * Bound to the tenant-scoped `leenmart_app` client, so
 * `notifications_recipient_select` and `notifications_recipient_update` confine
 * every statement to `recipient_user_id = app.user_id`. The `userId` passed
 * here is belt-and-braces on top of that, not the enforcement.
 */
export interface NotificationReadRepository {
  /** One page of this user's notifications in one inbox, newest first. */
  listForRecipient(
    userId: UserId,
    query: {
      readonly kind: NotificationRecipientKind;
      readonly limit: number;
      readonly cursor?: string | undefined;
      readonly unreadOnly?: boolean | undefined;
    },
  ): Promise<NotificationPage>;

  /** How many of this user's notifications in one inbox are unread. */
  countUnread(userId: UserId, kind: NotificationRecipientKind): Promise<number>;

  /**
   * Marks one notification read. Returns `false` when the id names nothing the
   * caller owns — RLS makes another user's row invisible, so "not yours" and
   * "does not exist" are the same answer, which is the point.
   */
  markRead(userId: UserId, notificationId: string, readAt: Date): Promise<boolean>;

  /** Marks every unread notification in one inbox read. Returns how many changed. */
  markAllRead(userId: UserId, kind: NotificationRecipientKind, readAt: Date): Promise<number>;
}
