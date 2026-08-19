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
 * The order this notification is about, if the payload names one.
 *
 * Read from the stored payload rather than from a URL baked into the text:
 * the server records facts, and where those facts lead is a decision each
 * client makes for its own routes.
 */
const orderIdOf = (payload: Record<string, unknown>): string | null => {
  const { orderId } = payload;
  return typeof orderId === 'string' && orderId.length > 0 ? orderId : null;
};

export const NotificationItem = ({
  notification,
}: {
  readonly notification: NotificationResponse;
}): JSX.Element => {
  const [markRead, { isLoading }] = useMarkNotificationReadMutation();
  const isUnread = notification.readAt === null;
  const orderId = orderIdOf(notification.payload);

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
        {orderId && (
          <Link
            to={`/orders/${orderId}`}
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            View order
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
