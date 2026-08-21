import { Alert, Button } from '@leen-mart/ui';
import { apiErrorMessage } from '@/shared/api/base-api';
import { PageContainer } from '@/components/PageContainer';
import { NotificationList } from '@/features/notification/components/NotificationList';
import {
  useMarkAllNotificationsReadMutation,
  useUnreadNotificationCountQuery,
} from '@/features/notification/notification.api';

/**
 * The customer's in-app inbox (S6-NOTIFY-INAPP).
 *
 * Opening this page marks nothing read — that is a locked decision, not an
 * omission. Read state changes only when the reader says so, either per
 * notification or with "Mark all as read".
 */
export const NotificationsPage = (): JSX.Element => {
  const { data: count } = useUnreadNotificationCountQuery();
  const [markAllRead, { isLoading: isMarkingAll, error: markAllError }] =
    useMarkAllNotificationsReadMutation();
  const unread = count?.unread ?? 0;

  return (
    <main>
      <PageContainer>
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 py-6 sm:py-8">
          <div className="flex items-center justify-between gap-4">
            <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
              Notifications
            </h1>
            {unread > 0 && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={isMarkingAll}
                onClick={() => void markAllRead()}
              >
                Mark all as read
              </Button>
            )}
          </div>
          {/* Phase I: a failed "mark all" must never look identical to
              success — the button simply stops loading either way, so the
              only way the reader learns it didn't work is this. */}
          {markAllError !== undefined && (
            <Alert tone="danger">
              {apiErrorMessage(
                markAllError,
                'Notifications could not be marked as read. Please try again.',
              )}
            </Alert>
          )}
          <NotificationList />
        </div>
      </PageContainer>
    </main>
  );
};
