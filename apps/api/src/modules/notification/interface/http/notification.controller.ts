import type { Request, Response } from 'express';
import type {
  NotificationInboxQuery,
  NotificationListQuery,
  NotificationListResponse,
  NotificationMarkAllReadResponse,
  NotificationMarkReadResponse,
  NotificationResponse,
  NotificationUnreadCountResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { NotificationRecord } from '../../domain/repositories/notification.repository.js';
import type {
  CountUnreadNotificationsUseCase,
  ListNotificationsUseCase,
  MarkAllNotificationsReadUseCase,
  MarkNotificationReadUseCase,
} from '../../application/use-cases/read-notifications.use-case.js';

export interface NotificationController {
  readonly list: (req: Request, res: Response) => Promise<void>;
  readonly unreadCount: (req: Request, res: Response) => Promise<void>;
  readonly markRead: (req: Request, res: Response) => Promise<void>;
  readonly markAllRead: (req: Request, res: Response) => Promise<void>;
}

export interface NotificationControllerDeps {
  readonly listNotificationsUseCase: ListNotificationsUseCase;
  readonly countUnreadNotificationsUseCase: CountUnreadNotificationsUseCase;
  readonly markNotificationReadUseCase: MarkNotificationReadUseCase;
  readonly markAllNotificationsReadUseCase: MarkAllNotificationsReadUseCase;
}

/**
 * Mapped field by field, never spread — `recipientUserId` and `outboxEventId`
 * are deliberately absent: the caller already knows who they are, and the
 * outbox id is an internal correlation key with no client use.
 */
const toResponse = (notification: NotificationRecord): NotificationResponse => ({
  id: notification.id,
  createdAt: notification.createdAt.toISOString(),
  recipientKind: notification.recipientKind,
  channel: notification.channel,
  eventType: notification.eventType,
  title: notification.title,
  body: notification.body,
  payload: notification.payload,
  readAt: notification.readAt === null ? null : notification.readAt.toISOString(),
});

/** Every handler needs the principal; `authenticate()` guarantees it, so its absence is a wiring bug. */
const requirePrincipal = (req: Request, route: string): NonNullable<Request['principal']> => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware - req.principal is unset.`);
  }
  return req.principal;
};

export const createNotificationController = (
  deps: NotificationControllerDeps,
): NotificationController => ({
  list: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'GET /me/notifications');
    const { query } = validatedData<unknown, NotificationListQuery>(req);

    const page = await deps.listNotificationsUseCase.execute({
      principal,
      kind: query.kind,
      limit: query.limit,
      cursor: query.cursor,
      unreadOnly: query.unreadOnly,
    });

    const data: NotificationListResponse = {
      items: page.items.map(toResponse),
      nextCursor: page.nextCursor,
    };
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },

  unreadCount: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'GET /me/notifications/unread-count');
    const { query } = validatedData<unknown, NotificationInboxQuery>(req);

    const data: NotificationUnreadCountResponse =
      await deps.countUnreadNotificationsUseCase.execute({ principal, kind: query.kind });
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },

  markRead: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'POST /me/notifications/:id/read');
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const data: NotificationMarkReadResponse = await deps.markNotificationReadUseCase.execute({
      principal,
      notificationId: params.id,
    });
    // 200 with `updated: false` rather than 404: under RLS "not yours" and "no
    // such row" are the same observation, and a 404 that distinguished them
    // would confirm another user's notification exists.
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },

  markAllRead: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'POST /me/notifications/read-all');
    const { query } = validatedData<unknown, NotificationInboxQuery>(req);

    const data: NotificationMarkAllReadResponse =
      await deps.markAllNotificationsReadUseCase.execute({ principal, kind: query.kind });
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },
});
