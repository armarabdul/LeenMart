import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { useAppSelector } from '@/app/hooks';
import { selectCurrentUser, selectIsAuthenticated } from '@/shared/api/session.slice';
import { SearchBar } from '@/features/catalogue/components/SearchBar';
import { useGetCartQuery } from '@/features/cart/cart.api';
import { NotificationBell } from '@/features/notification/components/NotificationBell';
import { env } from '@/shared/config/env';

const navLinkClassName = ({ isActive }: { isActive: boolean }): string =>
  `rounded-md px-3 py-2 text-sm font-medium ${
    isActive ? 'text-brand-700' : 'text-slate-700 hover:text-brand-700'
  }`;

/**
 * A cart badge for an anonymous visitor would either lie (always zero) or
 * require a request `RequireAuth` will reject — `skip` keeps this from
 * firing at all until a session exists, and `/cart` itself already redirects
 * an anonymous click through login via the same guard `/account` uses.
 */
const CartLink = (): JSX.Element => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const { data: cart } = useGetCartQuery(undefined, { skip: !isAuthenticated });
  const itemCount = cart?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;

  return (
    <Link
      to="/cart"
      className="relative rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:text-brand-700"
    >
      Cart
      {itemCount > 0 && (
        <span
          aria-label={`${itemCount} item${itemCount === 1 ? '' : 's'} in cart`}
          className="absolute -right-1 -top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-brand-700 px-1 text-[10px] font-semibold leading-none text-white"
        >
          {itemCount}
        </span>
      )}
    </Link>
  );
};

export const Header = (): JSX.Element => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const user = useAppSelector(selectCurrentUser);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);

  return (
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap sm:gap-6">
        <Link to="/" className="shrink-0 text-lg font-bold tracking-tight text-brand-700">
          {env.appName}
        </Link>

        <nav className="hidden items-center gap-1 sm:flex">
          <NavLink to="/" end className={navLinkClassName}>
            Home
          </NavLink>
          <NavLink to="/catalogue" className={navLinkClassName}>
            Catalogue
          </NavLink>
        </nav>

        <div className="order-3 w-full sm:order-none sm:max-w-sm sm:flex-1">
          <SearchBar />
        </div>

        <div className="ml-auto hidden items-center gap-2 sm:flex">
          <CartLink />
          <NotificationBell />
          {isAuthenticated ? (
            <Link
              to="/account"
              className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:text-brand-700"
            >
              {user?.email ?? 'Account'}
            </Link>
          ) : (
            <Link
              to="/login"
              className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              Sign in
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsMobileNavOpen((open) => !open)}
          aria-expanded={isMobileNavOpen}
          aria-controls="mobile-nav"
          className="ml-auto rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 sm:hidden"
        >
          Menu
        </button>
      </div>

      {isMobileNavOpen && (
        <nav
          id="mobile-nav"
          className="flex flex-col gap-1 border-t border-slate-200 px-4 py-2 sm:hidden"
        >
          <NavLink
            to="/"
            end
            className={navLinkClassName}
            onClick={() => setIsMobileNavOpen(false)}
          >
            Home
          </NavLink>
          <NavLink
            to="/catalogue"
            className={navLinkClassName}
            onClick={() => setIsMobileNavOpen(false)}
          >
            Catalogue
          </NavLink>
          <NavLink
            to="/cart"
            className={navLinkClassName}
            onClick={() => setIsMobileNavOpen(false)}
          >
            Cart
          </NavLink>
          {isAuthenticated && (
            <NavLink
              to="/notifications"
              className={navLinkClassName}
              onClick={() => setIsMobileNavOpen(false)}
            >
              Notifications
            </NavLink>
          )}
          {isAuthenticated ? (
            <NavLink
              to="/account"
              className={navLinkClassName}
              onClick={() => setIsMobileNavOpen(false)}
            >
              {user?.email ?? 'Account'}
            </NavLink>
          ) : (
            <NavLink
              to="/login"
              className={navLinkClassName}
              onClick={() => setIsMobileNavOpen(false)}
            >
              Sign in
            </NavLink>
          )}
        </nav>
      )}
    </header>
  );
};
