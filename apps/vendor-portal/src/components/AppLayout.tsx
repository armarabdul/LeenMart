import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { useLogoutMutation } from '@/features/auth/auth.api';
import {
  selectCurrentUser,
  selectIsAuthenticated,
  selectRefreshToken,
} from '@/shared/api/session.slice';
import { env } from '@/shared/config/env';

const navLinkClassName = ({ isActive }: { isActive: boolean }): string =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'text-brand-700' : 'text-slate-700 hover:text-brand-700'
  }`;

/**
 * The whole app's chrome — deliberately smaller than `customer-pwa`'s own
 * `AppLayout`/`Header`: no search, no cart, no catalogue nav, since this
 * app has exactly one authenticated surface (S3-5's own minimal scope).
 */
export const AppLayout = (): JSX.Element => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const user = useAppSelector(selectCurrentUser);
  const refreshToken = useAppSelector(selectRefreshToken);
  const navigate = useNavigate();
  const [logout] = useLogoutMutation();

  const handleLogout = async (): Promise<void> => {
    if (refreshToken) {
      await logout({ refreshToken }).catch(() => undefined);
    }
    void navigate('/login', { replace: true });
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-3">
          <Link to="/" className="shrink-0 text-lg font-bold tracking-tight text-brand-700">
            {env.appName}
          </Link>
          {isAuthenticated && (
            <nav className="flex items-center gap-1">
              <NavLink to="/orders" end className={navLinkClassName}>
                Orders
              </NavLink>
              <NavLink to="/earnings" end className={navLinkClassName}>
                Earnings
              </NavLink>
              <NavLink to="/pickup/redeem" end className={navLinkClassName}>
                Redeem pickup
              </NavLink>
            </nav>
          )}
          <div className="ml-auto flex items-center gap-3">
            {isAuthenticated ? (
              <>
                <span className="text-sm text-slate-600">{user?.email}</span>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Log out
                </button>
              </>
            ) : (
              <Link
                to="/login"
                className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
              >
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>
      <div className="flex-1">
        <Outlet />
      </div>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-4xl px-4 py-6 text-xs text-slate-500">© {env.appName}</div>
      </footer>
    </div>
  );
};
