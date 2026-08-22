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
 * The whole app's chrome (Phase L) — mirrors `vendor-portal`'s own
 * `AppLayout` shape exactly, including its mobile-overflow fix (the header
 * row scrolls internally via `overflow-x-auto` rather than the page itself
 * overflowing horizontally at narrow widths). Navigation exposes only the
 * screens actually implemented so far (L3, plus Audit Log in Phase L.3) — no
 * placeholder entries for refunds, settlement, fraud, or any other
 * decision-gated capability.
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
        <div className="flex items-center gap-4 overflow-x-auto px-4 py-3">
          <Link to="/" className="shrink-0 text-lg font-bold tracking-tight text-brand-700">
            {env.appName}
          </Link>
          {isAuthenticated && (
            <nav className="flex shrink-0 items-center gap-1">
              <NavLink to="/" end className={navLinkClassName}>
                Dashboard
              </NavLink>
              <NavLink to="/kyc-review" className={navLinkClassName}>
                KYC Review
              </NavLink>
              <NavLink to="/product-moderation" className={navLinkClassName}>
                Product Moderation
              </NavLink>
              <NavLink to="/review-moderation" className={navLinkClassName}>
                Review Moderation
              </NavLink>
              <NavLink to="/categories" className={navLinkClassName}>
                Categories
              </NavLink>
              <NavLink to="/audit-log" className={navLinkClassName}>
                Audit Log
              </NavLink>
            </nav>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-3">
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
        <div className="px-4 py-6 text-xs text-slate-500">© {env.appName}</div>
      </footer>
    </div>
  );
};
