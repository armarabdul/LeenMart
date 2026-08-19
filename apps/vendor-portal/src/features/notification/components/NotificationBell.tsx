import { NavLink } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { selectIsAuthenticated } from '@/shared/api/session.slice';
import { useUnreadNotificationCountQuery } from '../notification.api';

/**
 * How often the unread count is re-checked.
 *
 * A minute is a deliberate compromise: fast enough that a vendor notices a new
 * order without reloading, slow enough that an idle tab is not a load
 * generator. Only the count is polled — never the list, which is far larger
 * and which the reader is looking at anyway.
 */
const UNREAD_POLL_MS = 60_000;

/** Past this the badge stops being a number and becomes "a lot", which is all it needs to say. */
const BADGE_CEILING = 9;

const navLinkClassName = ({ isActive }: { isActive: boolean }): string =>
  `relative rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'text-brand-700' : 'text-slate-700 hover:text-brand-700'
  }`;

/**
 * The portal's unread indicator (S6-NOTIFY-INAPP).
 *
 * Counts the VENDOR inbox only: a vendor owner who also shops here would
 * otherwise see their own delivery updates inflating the number they use to
 * decide whether an order needs attention.
 */
export const NotificationBell = (): JSX.Element | null => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const { data } = useUnreadNotificationCountQuery(undefined, {
    skip: !isAuthenticated,
    // Notifications arrive server-side, asynchronously, with nothing the
    // client did to trigger them — so no tag invalidation can ever fire for
    // them. Without a poll the badge shows whatever was true when the page
    // loaded and never changes, which is worse than showing no badge at all.
    // SSE and Web Push are both out of scope for this milestone; polling one
    // small count is the honest mechanism that remains.
    pollingInterval: UNREAD_POLL_MS,
    refetchOnFocus: true,
  });

  if (!isAuthenticated) return null;

  const unread = data?.unread ?? 0;

  return (
    <NavLink
      to="/notifications"
      end
      // The count belongs in the accessible name: the badge is a visual
      // affordance, and "Notifications" alone would drop the only thing it says.
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications, none unread'}
      className={navLinkClassName}
    >
      Notifications
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-0 top-0 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand-700 px-1 text-[10px] font-semibold leading-none text-white"
        >
          {unread > BADGE_CEILING ? `${BADGE_CEILING}+` : unread}
        </span>
      )}
    </NavLink>
  );
};
