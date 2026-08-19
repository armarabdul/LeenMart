import type {
  NotificationListResponse,
  NotificationMarkAllReadResponse,
  NotificationMarkReadResponse,
  NotificationUnreadCountResponse,
} from '@leen-mart/contracts';
import type { SuccessEnvelope } from '@/shared/api/base-api';
import { baseApi } from '@/shared/api/base-api';

/**
 * This app only ever asks for the VENDOR inbox (S6-NOTIFY-INAPP).
 *
 * The kind is a request parameter rather than a property of the session
 * because one person can be both: a vendor owner sells here and buys in the
 * customer app on the same account. Hard-coding it in this app is what keeps
 * their own shopping notifications out of the order inbox they work from.
 */
const KIND = 'VENDOR';

interface ListArgs {
  readonly cursor?: string | undefined;
}

export const notificationApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    listNotifications: builder.query<NotificationListResponse, ListArgs | void>({
      query: (args) => ({
        url: '/me/notifications',
        params: { kind: KIND, ...(args?.cursor ? { cursor: args.cursor } : {}) },
      }),
      transformResponse: (response: SuccessEnvelope<NotificationListResponse>) => response.data,
      providesTags: ['Notification'],
      // Opening the inbox should show what is there now, not what was there
      // when the app started; the cached page can be minutes old.
      keepUnusedDataFor: 30,
    }),

    /**
     * Separate from the list on purpose: the header badge needs a number on
     * every page, and fetching a whole page of rows to count them would make
     * the cheapest thing in the shell the most expensive.
     */
    unreadNotificationCount: builder.query<NotificationUnreadCountResponse, void>({
      query: () => ({ url: '/me/notifications/unread-count', params: { kind: KIND } }),
      transformResponse: (response: SuccessEnvelope<NotificationUnreadCountResponse>) =>
        response.data,
      providesTags: ['Notification'],
    }),

    /**
     * Marking read is an explicit act. Opening the list does not call this —
     * the locked decision is that reading a list is not the same as having
     * read what is in it.
     */
    markNotificationRead: builder.mutation<NotificationMarkReadResponse, string>({
      query: (id) => ({ url: `/me/notifications/${encodeURIComponent(id)}/read`, method: 'POST' }),
      transformResponse: (response: SuccessEnvelope<NotificationMarkReadResponse>) => response.data,
      invalidatesTags: ['Notification'],
    }),

    markAllNotificationsRead: builder.mutation<NotificationMarkAllReadResponse, void>({
      query: () => ({
        url: '/me/notifications/read-all',
        method: 'POST',
        params: { kind: KIND },
      }),
      transformResponse: (response: SuccessEnvelope<NotificationMarkAllReadResponse>) =>
        response.data,
      invalidatesTags: ['Notification'],
    }),
  }),
});

export const {
  useListNotificationsQuery,
  useUnreadNotificationCountQuery,
  useMarkNotificationReadMutation,
  useMarkAllNotificationsReadMutation,
} = notificationApi;
