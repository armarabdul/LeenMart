import { Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import type { Clock, IdGenerator } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type {
  NewNotification,
  NotificationPage,
  NotificationReadRepository,
  NotificationRecord,
  NotificationWriteOutcome,
  NotificationWriteRepository,
} from '../../domain/repositories/notification.repository.js';
import type {
  NotificationChannelName,
  NotificationRecipientKind,
} from '../../domain/services/notification-policy.js';

/** The columns every read returns — never `select: undefined`, so a new column is a deliberate choice. */
const COLUMNS = {
  id: true,
  createdAt: true,
  recipientUserId: true,
  recipientKind: true,
  outboxEventId: true,
  channel: true,
  eventType: true,
  payload: true,
  title: true,
  body: true,
  readAt: true,
} as const;

interface Row {
  id: string;
  createdAt: Date;
  recipientUserId: string;
  recipientKind: NotificationRecipientKind;
  outboxEventId: string;
  channel: NotificationChannelName;
  eventType: string;
  payload: Prisma.JsonValue;
  title: string;
  body: string;
  readAt: Date | null;
}

/**
 * The page cursor: the sort key, both halves of it.
 *
 * Opaque to the client by intent — it is a position in a list, not an id to
 * construct — but deliberately not encrypted: it carries only a timestamp and
 * an id the caller can already see in the page it came from.
 */
const encodeCursor = (createdAt: Date, id: string): string => `${createdAt.toISOString()}|${id}`;

const decodeCursor = (cursor: string | undefined): { createdAt: Date; id: string } | null => {
  if (!cursor) return null;
  const separator = cursor.lastIndexOf('|');
  if (separator <= 0) return null;
  const createdAt = new Date(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);
  // A malformed cursor returns the first page rather than an error: it is a
  // position, and the honest answer to "I do not know where that is" is the
  // start of the list.
  return Number.isNaN(createdAt.getTime()) || id.length === 0 ? null : { createdAt, id };
};

/**
 * A foreign-key violation on the recipient, as opposed to any other write
 * error. Matched on the constraint name so an unrelated FK failure — one that
 * would signal a real bug — still surfaces as a failure.
 */
const isMissingRecipient = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2003' &&
  JSON.stringify(error.meta ?? {}).includes('recipient_user_id');

const toRecord = (row: Row): NotificationRecord => ({
  id: row.id,
  createdAt: row.createdAt,
  recipientUserId: row.recipientUserId,
  recipientKind: row.recipientKind,
  outboxEventId: row.outboxEventId,
  channel: row.channel,
  eventType: row.eventType,
  payload:
    typeof row.payload === 'object' && row.payload !== null && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {},
  title: row.title,
  body: row.body,
  readAt: row.readAt,
});

/**
 * The orchestrator's write side (S6-NOTIFY-INAPP).
 *
 * Bound to `leenmart_checkout` — the credential with cross-vendor reach and the
 * only one holding INSERT here. See `notifications_worker_insert` in the
 * migration for why insertion cannot be scoped to `app.user_id`.
 */
export class PrismaNotificationWriteRepository implements NotificationWriteRepository {
  constructor(
    private readonly checkoutPrisma: PrismaClient,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /**
   * **Where SDD 11.3's idempotency key is genuinely enforced.**
   *
   * The database's unique index has to carry `created_at` (PostgreSQL requires
   * the partition key in a partitioned unique constraint), so it cannot be the
   * whole guarantee. This checks the logical key
   * `(outboxEventId, channel, recipientUserId)` first, then inserts with
   * `createMany({ skipDuplicates })` — the same insert-if-absent shape
   * `slot_capacity`'s lazy materialisation uses.
   *
   * The check-then-insert is not a lock, and two workers racing the same job
   * could in principle both pass the check. `skipDuplicates` closes that for
   * the same-month case the index does cover, and BullMQ's deterministic job id
   * makes the race itself very unlikely; a duplicate surviving both would need
   * a redelivery to straddle a month boundary, which is far outside the relay's
   * six-minute attempt budget. That residue is documented rather than hidden.
   */
  async createIfAbsent(notification: NewNotification): Promise<NotificationWriteOutcome> {
    const existing = await this.checkoutPrisma.notification.findFirst({
      where: {
        outboxEventId: notification.outboxEventId,
        channel: notification.channel,
        recipientUserId: notification.recipientUserId,
      },
      select: { id: true },
    });
    if (existing) return 'already-present';

    try {
      const result = await this.checkoutPrisma.notification.createMany({
        data: [
          {
            id: this.idGenerator.generate(),
            createdAt: this.clock.now(),
            recipientUserId: notification.recipientUserId,
            recipientKind: notification.recipientKind,
            outboxEventId: notification.outboxEventId,
            channel: notification.channel,
            eventType: notification.eventType,
            payload: notification.payload as Prisma.InputJsonValue,
            title: notification.title,
            body: notification.body,
          },
        ],
        skipDuplicates: true,
      });
      return result.count === 1 ? 'created' : 'already-present';
    } catch (error) {
      // The recipient's `users` row is gone. `ON DELETE RESTRICT` means this
      // cannot happen while a notification already exists, so it only arises
      // for an event whose subject was removed before the worker reached it —
      // and no number of retries will bring them back.
      if (isMissingRecipient(error)) return 'recipient-missing';
      throw error;
    }
  }
}

/**
 * The recipient's read side (S6-NOTIFY-INAPP).
 *
 * Bound to the tenant-scoped `leenmart_app` client, so
 * `notifications_recipient_select`/`_update` confine every statement to
 * `recipient_user_id = app.user_id`. The `userId` argument is belt-and-braces
 * on top of RLS, not the enforcement — which is why "someone else's id" and "no
 * such row" produce the same answer.
 */
export class PrismaNotificationReadRepository implements NotificationReadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * One page, newest first.
   *
   * **The cursor is composite — `createdAt|id` — and that is not decoration.**
   * One order placed with two vendors produces two notifications in the same
   * millisecond, so a cursor carrying only a timestamp would skip every row
   * sharing the boundary instant: `createdAt < cursor` excludes its own ties.
   * The keyset below compares the pair, so a page break inside a group of
   * simultaneous rows resumes exactly where it stopped.
   */
  async listForRecipient(
    userId: UserId,
    query: {
      readonly kind: NotificationRecipientKind;
      readonly limit: number;
      readonly cursor?: string | undefined;
      readonly unreadOnly?: boolean | undefined;
    },
  ): Promise<NotificationPage> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.prisma.notification.findMany({
      where: {
        recipientUserId: userId,
        recipientKind: query.kind,
        ...(query.unreadOnly === true ? { readAt: null } : {}),
        // Keyset pagination: strictly older, or the same instant with a lower
        // id. Offset pagination would skip rows under concurrent inserts
        // (SDD 9.2), and this is the tie-safe form of the same idea.
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // One more than asked for, so "is there another page" is answered
      // without a second count query.
      take: query.limit + 1,
      select: COLUMNS,
    });

    const items = rows.slice(0, query.limit).map(toRecord);
    const hasMore = rows.length > query.limit;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? encodeCursor(last.createdAt, last.id) : null,
    };
  }
  async countUnread(userId: UserId, kind: NotificationRecipientKind): Promise<number> {
    return this.prisma.notification.count({
      where: { recipientUserId: userId, recipientKind: kind, readAt: null },
    });
  }

  /**
   * Conditional on `readAt: null`, so marking an already-read notification read
   * again reports `false` rather than moving its timestamp — the read moment is
   * a fact about when the user first saw it.
   */
  async markRead(userId: UserId, notificationId: string, readAt: Date): Promise<boolean> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, recipientUserId: userId, readAt: null },
      data: { readAt },
    });
    return result.count > 0;
  }

  async markAllRead(
    userId: UserId,
    kind: NotificationRecipientKind,
    readAt: Date,
  ): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { recipientUserId: userId, recipientKind: kind, readAt: null },
      data: { readAt },
    });
    return result.count;
  }
}
