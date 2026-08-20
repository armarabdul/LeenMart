import { Link } from 'react-router-dom';
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

const BellIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
    <path
      d="M18 8a6 6 0 1 0-12 0c0 4-1.5 5.5-2 6h16c-.5-.5-2-2-2-6Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
    <path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/** Past this the badge stops being a number and becomes "a lot", which is all it needs to say. */
const BADGE_CEILING = 9;

/**
 * The header's unread indicator (S6-NOTIFY-INAPP).
 *
 * Skipped entirely for an anonymous visitor, the same way `CartLink` is: the
 * route is `SELF_SCOPED`, so asking without a session would produce a 401 the
 * shell has no useful way to show.
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
    <Link
      to="/notifications"
      // The accessible name carries the count because the badge is a visual
      // affordance: a screen reader hearing only "Notifications" would lose
      // the one piece of information the badge exists to convey.
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications, none unread'}
      // Phase C: an icon control matching the header's other actions. The
      // link target, the accessible name and the badge all stay exactly as
      // they were — only the visual treatment changed.
      className="relative flex h-10 w-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-alt hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <BellIcon />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-on-primary"
        >
          {unread > BADGE_CEILING ? `${BADGE_CEILING}+` : unread}
        </span>
      )}
    </Link>
  );
};
