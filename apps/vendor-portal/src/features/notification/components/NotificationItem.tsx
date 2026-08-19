import { Link } from 'react-router-dom';
import type { NotificationResponse } from '@leen-mart/contracts';
import { useMarkNotificationReadMutation } from '../notification.api';

const formatReceivedAt = (isoDateTime: string): string =>
  new Date(isoDateTime).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });

/**
 * Whether this notification is about an order at all.
 *
 * **Deliberately not a deep link to that order.** The payload carries the
 * *parent* `orderId`, while this app's `/orders/:id` route takes a **sub-order**
 * id — the vendor's own slice of a possibly multi-vendor order (ASM-03). A
 * link built from `orderId` renders "The requested order was not found", which
 * a walkthrough of the real portal confirmed.
 *
 * The two ways to fix that properly are both closed here: widening the event
 * payload to carry sub-order ids is out of scope for this milestone, and
 * reshaping the stored payload would mean the notification no longer records
 * what the event actually said. So the vendor is sent to the order list, which
 * is where the new order is, and the label says exactly that rather than
 * promising a specific order it cannot open.
 */
const isAboutAnOrder = (payload: Record<string, unknown>): boolean => {
  const { orderId } = payload;
  return typeof orderId === 'string' && orderId.length > 0;
};

export const NotificationItem = ({
  notification,
}: {
  readonly notification: NotificationResponse;
}): JSX.Element => {
  const [markRead, { isLoading }] = useMarkNotificationReadMutation();
  const isUnread = notification.readAt === null;
  const isOrderNotification = isAboutAnOrder(notification.payload);

  return (
    <li
      className={`flex flex-col gap-2 rounded-lg border p-4 ${
        isUnread ? 'border-brand-200 bg-brand-50' : 'border-slate-200 bg-white'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-semibold text-slate-900">
            {notification.title}
            {isUnread && <span className="sr-only"> (unread)</span>}
          </span>
          <span className="text-sm text-slate-700">{notification.body}</span>
        </div>
        <time dateTime={notification.createdAt} className="shrink-0 text-xs text-slate-500">
          {formatReceivedAt(notification.createdAt)}
        </time>
      </div>

      <div className="flex items-center gap-3">
        {isOrderNotification && (
          <Link to="/orders" className="text-sm font-medium text-brand-700 hover:underline">
            View orders
          </Link>
        )}
        {isUnread && (
          <button
            type="button"
            disabled={isLoading}
            onClick={() => void markRead(notification.id)}
            className="text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
          >
            Mark as read
          </button>
        )}
      </div>
    </li>
  );
};
