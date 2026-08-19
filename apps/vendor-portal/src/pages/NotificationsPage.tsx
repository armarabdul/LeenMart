import { NotificationList } from '@/features/notification/components/NotificationList';
import {
  useMarkAllNotificationsReadMutation,
  useUnreadNotificationCountQuery,
} from '@/features/notification/notification.api';

/**
 * The vendor's in-app inbox (S6-NOTIFY-INAPP).
 *
 * Same `/me/notifications` family the customer app uses — there is no
 * `/vendor/notifications`. What separates the two inboxes is the `kind`
 * parameter and the RLS policy behind it, not a second set of routes.
 *
 * Opening this page marks nothing read; that is a locked decision.
 */
export const NotificationsPage = (): JSX.Element => {
  const { data: count } = useUnreadNotificationCountQuery();
  const [markAllRead, { isLoading: isMarkingAll }] = useMarkAllNotificationsReadMutation();
  const unread = count?.unread ?? 0;

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Notifications</h1>
        {unread > 0 && (
          <button
            type="button"
            disabled={isMarkingAll}
            onClick={() => void markAllRead()}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Mark all as read
          </button>
        )}
      </div>
      <NotificationList />
    </main>
  );
};
