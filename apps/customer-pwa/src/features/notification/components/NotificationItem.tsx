import { Link } from 'react-router-dom';
import type { NotificationResponse } from '@leen-mart/contracts';
import { Alert, Badge, Button, Card, cn } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
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
  const [markRead, { isLoading, error }] = useMarkNotificationReadMutation();
  const isUnread = notification.readAt === null;
  const orderId = orderIdOf(notification.payload);

  return (
    <li>
      <Card
        className={cn(
          'flex flex-col gap-2 border-l-4',
          isUnread ? 'border-l-primary bg-primary-soft/40' : 'border-l-transparent',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="flex items-center gap-2">
              <span className="text-sm font-semibold text-text">{notification.title}</span>
              {isUnread && (
                <Badge tone="primary">
                  New<span className="sr-only"> (unread)</span>
                </Badge>
              )}
            </span>
            <span className="text-sm text-text-muted">{notification.body}</span>
          </div>
          <time dateTime={notification.createdAt} className="shrink-0 text-xs text-text-faint">
            {formatReceivedAt(notification.createdAt)}
          </time>
        </div>

        {(orderId !== null || isUnread) && (
          <div className="flex items-center gap-4">
            {orderId && (
              <Link
                to={`/orders/${orderId}`}
                className="-ml-2 inline-flex min-h-11 items-center rounded px-2 text-sm font-medium text-primary hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                View order
              </Link>
            )}
            {isUnread && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                loading={isLoading}
                onClick={() => void markRead(notification.id)}
                className="-ml-2"
              >
                Mark as read
              </Button>
            )}
          </div>
        )}

        {/* Phase I: scoped to this one card, not a page-wide banner — each
            notification owns its own mutation state, so only the item that
            actually failed ever shows one. */}
        {error !== undefined && (
          <Alert tone="danger">
            {apiErrorMessage(error, 'This notification could not be marked as read.')}
          </Alert>
        )}
      </Card>
    </li>
  );
};
