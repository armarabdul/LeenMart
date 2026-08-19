import type { Clock } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import type {
  NotificationPage,
  NotificationReadRepository,
} from '../../domain/repositories/notification.repository.js';
import type { NotificationRecipientKind } from '../../domain/services/notification-policy.js';

/**
 * Which inbox a caller is reading.
 *
 * A vendor owner holds both: they buy as a customer and sell as a vendor, on
 * one `users` row. The kind is therefore a parameter of the request rather than
 * a property of the account — the vendor portal asks for `VENDOR`, the customer
 * PWA for `CUSTOMER`, and neither can see the other's list even though the
 * authenticated identity is the same.
 *
 * This is why there is one `/me/notifications` family rather than a separate
 * vendor route tree: the identity anchor is the user, and `recipient_kind` is
 * the only thing that differs.
 */
export interface NotificationInboxQuery {
  readonly principal: Principal;
  readonly kind: NotificationRecipientKind;
}

export interface ListNotificationsInput extends NotificationInboxQuery {
  readonly limit: number;
  readonly cursor?: string | undefined;
  readonly unreadOnly?: boolean | undefined;
}

export interface NotificationReadDeps {
  readonly repository: NotificationReadRepository;
  readonly clock: Clock;
}

/**
 * The caller's own notifications, newest first (S6-NOTIFY-INAPP).
 *
 * Resolved from `principal.userId` and never from a request-supplied id — the
 * same discipline every other `/me/*` route follows, and what makes "read
 * someone else's inbox" unspellable rather than merely refused. RLS confines
 * the query independently.
 *
 * **Reading a list never marks anything read** (locked decision): this use case
 * has no write path at all.
 */
export class ListNotificationsUseCase {
  constructor(private readonly deps: NotificationReadDeps) {}

  async execute(input: ListNotificationsInput): Promise<NotificationPage> {
    return this.deps.repository.listForRecipient(input.principal.userId, {
      kind: input.kind,
      limit: input.limit,
      cursor: input.cursor,
      unreadOnly: input.unreadOnly,
    });
  }
}

/** How many unread notifications the caller has in one inbox — the badge. */
export class CountUnreadNotificationsUseCase {
  constructor(private readonly deps: NotificationReadDeps) {}

  async execute(input: NotificationInboxQuery): Promise<{ readonly unread: number }> {
    const unread = await this.deps.repository.countUnread(input.principal.userId, input.kind);
    return { unread };
  }
}

/**
 * Marks one notification read.
 *
 * Answers `false` for an id the caller does not own *and* for one that does not
 * exist, because under RLS those are the same observation — which is the point:
 * a 404 that distinguishes them would confirm the existence of another user's
 * notification.
 */
export class MarkNotificationReadUseCase {
  constructor(private readonly deps: NotificationReadDeps) {}

  async execute(input: {
    readonly principal: Principal;
    readonly notificationId: string;
  }): Promise<{ readonly updated: boolean }> {
    const updated = await this.deps.repository.markRead(
      input.principal.userId,
      input.notificationId,
      this.deps.clock.now(),
    );
    return { updated };
  }
}

/** Marks every unread notification in one inbox read. */
export class MarkAllNotificationsReadUseCase {
  constructor(private readonly deps: NotificationReadDeps) {}

  async execute(input: NotificationInboxQuery): Promise<{ readonly updated: number }> {
    const updated = await this.deps.repository.markAllRead(
      input.principal.userId,
      input.kind,
      this.deps.clock.now(),
    );
    return { updated };
  }
}
