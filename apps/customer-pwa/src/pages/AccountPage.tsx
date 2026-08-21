import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card } from '@leen-mart/ui';
import { useAppSelector } from '@/app/hooks';
import { useLogoutMutation } from '@/features/auth/auth.api';
import { useUnreadNotificationCountQuery } from '@/features/notification/notification.api';
import { selectCurrentUser, selectRefreshToken } from '@/shared/api/session.slice';
import { env } from '@/shared/config/env';

const OrdersIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
    <path
      d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
    <path
      d="M4 8.5 12 13l8-4.5M12 13v7"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

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

const ChevronIcon = (): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className="h-4 w-4 shrink-0 text-text-faint"
  >
    <path
      d="m9 6 6 6-6 6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

interface AccountRowProps {
  readonly to: string;
  readonly icon: JSX.Element;
  readonly label: string;
  readonly description: string;
  readonly badge?: number | undefined;
}

/** One destination row (Phase F) — 44px+ tall for a comfortable tap target, matching the header drawer's own convention. */
const AccountRow = ({ to, icon, label, description, badge }: AccountRowProps): JSX.Element => (
  <Link
    to={to}
    className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
  >
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
      {icon}
    </span>
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="flex items-center gap-2">
        <span className="text-sm font-semibold text-text">{label}</span>
        {badge !== undefined && badge > 0 && (
          <Badge tone="primary">{badge > 9 ? '9+' : badge}</Badge>
        )}
      </span>
      <span className="truncate text-xs text-text-muted">{description}</span>
    </span>
    <ChevronIcon />
  </Link>
);

/**
 * The account dashboard (Phase F). Outside `AppLayout`, matching `/login`/
 * `/register`'s own documented decision to keep a focused presentation
 * rather than the full marketplace chrome — see `AppLayout.tsx`.
 *
 * Only surfaces destinations that actually exist today (`/orders`,
 * `/notifications`) — there is no standalone address book or editable
 * profile page in this app, and this dashboard does not invent one.
 */
export const AccountPage = (): JSX.Element => {
  const user = useAppSelector(selectCurrentUser);
  const refreshToken = useAppSelector(selectRefreshToken);
  const { data: unreadCount } = useUnreadNotificationCountQuery();
  const navigate = useNavigate();
  const [logout, { isLoading }] = useLogoutMutation();

  const handleLogout = async (): Promise<void> => {
    if (refreshToken) {
      await logout({ refreshToken }).catch(() => undefined);
    }
    void navigate('/login', { replace: true });
  };

  const initial = user?.email?.[0]?.toUpperCase() ?? '?';

  return (
    <main className="flex min-h-screen flex-col bg-background px-4 py-10 sm:py-12">
      <div className="mx-auto flex w-full max-w-md flex-col gap-6">
        <Link
          to="/"
          className="self-center rounded-md font-display text-lg font-bold tracking-tight text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {env.appName}
        </Link>

        <Card className="flex items-center gap-4">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-semibold text-on-primary"
          >
            {initial}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-base font-semibold text-text">{user?.email}</h1>
            <Badge tone="primary" className="self-start">
              Customer
            </Badge>
          </div>
        </Card>

        <Card padding="sm" className="flex flex-col divide-y divide-border">
          <AccountRow
            to="/orders"
            icon={<OrdersIcon />}
            label="My orders"
            description="Track and manage your orders"
          />
          <AccountRow
            to="/notifications"
            icon={<BellIcon />}
            label="Notifications"
            description="Updates about your orders"
            badge={unreadCount?.unread}
          />
        </Card>

        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={() => void handleLogout()}
          disabled={isLoading}
          className="w-full"
        >
          {isLoading ? 'Logging out…' : 'Log out'}
        </Button>
      </div>
    </main>
  );
};
