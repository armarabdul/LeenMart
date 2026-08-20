import { useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Drawer, cn } from '@leen-mart/ui';
import { useAppSelector } from '@/app/hooks';
import { selectCurrentUser, selectIsAuthenticated } from '@/shared/api/session.slice';
import { SearchBar } from '@/features/catalogue/components/SearchBar';
import { useGetCartQuery } from '@/features/cart/cart.api';
import { NotificationBell } from '@/features/notification/components/NotificationBell';
import { PageContainer } from '@/components/PageContainer';
import { env } from '@/shared/config/env';

/** The marketplace destinations, in one place so the desktop bar and the mobile drawer cannot drift apart. */
const PRIMARY_NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/catalogue', label: 'Catalogue', end: false },
] as const;

const desktopNavClassName = ({ isActive }: { isActive: boolean }): string =>
  [
    'relative rounded-md px-3 py-2 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    isActive
      ? 'text-primary after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-primary'
      : 'text-text-muted hover:text-text',
  ].join(' ');

const drawerNavClassName = ({ isActive }: { isActive: boolean }): string =>
  [
    // 44px min target: a drawer row is the one place a thumb reaches most often.
    'flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
    isActive ? 'bg-primary-soft text-primary' : 'text-text hover:bg-surface-alt',
  ].join(' ');

const CartIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
    <path
      d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.55L20.5 8H6"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="10" cy="19" r="1.4" fill="currentColor" />
    <circle cx="17" cy="19" r="1.4" fill="currentColor" />
  </svg>
);

const MenuIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
    <path
      d="M4 7h16M4 12h16M4 17h16"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

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
      // The count belongs in the accessible name: the badge is a visual
      // affordance, and "Cart" alone would drop the only thing it conveys.
      aria-label={
        itemCount > 0 ? `Cart, ${itemCount} item${itemCount === 1 ? '' : 's'}` : 'Cart, empty'
      }
      className="relative flex h-10 w-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-alt hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <CartIcon />
      {itemCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-on-primary"
        >
          {itemCount > 9 ? '9+' : itemCount}
        </span>
      )}
    </Link>
  );
};

const AccountControl = ({ inDrawer = false }: { readonly inDrawer?: boolean }): JSX.Element => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const user = useAppSelector(selectCurrentUser);

  if (!isAuthenticated) {
    // A `Link` styled to match `Button`'s primary variant rather than a
    // `Button` wrapping a `Link`: this navigates, so it must be an anchor for
    // middle-click, copy-link and screen-reader semantics. `Button` is a
    // `<button>` and has no `asChild` escape hatch.
    return (
      <Link
        to="/login"
        className={cn(
          'inline-flex items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          inDrawer ? 'h-11 w-full' : 'h-9',
        )}
      >
        Sign in
      </Link>
    );
  }

  return (
    <Link
      to="/account"
      className={
        inDrawer
          ? 'flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-text hover:bg-surface-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          : 'flex h-10 max-w-[12rem] items-center rounded-md px-3 text-sm font-medium text-text-muted transition-colors hover:bg-surface-alt hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      }
    >
      {/* An email can be long; truncation keeps it from pushing the row wide. */}
      <span className="truncate">{user?.email ?? 'Account'}</span>
    </Link>
  );
};

/**
 * The marketplace header (Phase C).
 *
 * **Two rows on mobile, one on desktop.** Search is the primary action on a
 * phone, so it gets a full-width row of its own beneath the brand and the
 * icon actions rather than competing with them for the same line — the
 * previous single wrapping row put a shrunken search box beside a "Menu"
 * button at 320px. From `md` up there is room for one row, and search takes
 * the centre.
 *
 * Secondary navigation moves into a `Drawer` on mobile instead of expanding
 * the header in place, so opening the menu can never push the page content
 * down or leave a half-height header behind.
 */
export const Header = (): JSX.Element => {
  const isAuthenticated = useAppSelector(selectIsAuthenticated);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const closeMenu = (): void => setIsMenuOpen(false);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-surface">
      <PageContainer>
        <div className="flex h-14 items-center gap-2 md:h-16 md:gap-6">
          <Link
            to="/"
            className="shrink-0 rounded-md font-display text-lg font-bold tracking-tight text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:text-xl"
          >
            {env.appName}
          </Link>

          <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
            {PRIMARY_NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={desktopNavClassName}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* Desktop: search owns the middle. Mobile: it moves to its own row below. */}
          <div className="hidden min-w-0 flex-1 md:block">
            <SearchBar />
          </div>

          <div className="ml-auto flex items-center gap-1">
            <CartLink />
            <NotificationBell />
            <div className="hidden md:block">
              <AccountControl />
            </div>
            <button
              type="button"
              onClick={() => setIsMenuOpen(true)}
              aria-expanded={isMenuOpen}
              aria-haspopup="dialog"
              aria-label="Open menu"
              className="flex h-10 w-10 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-alt hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary md:hidden"
            >
              <MenuIcon />
            </button>
          </div>
        </div>

        {/* The mobile search row. `pb-3` rather than a taller header keeps the
            sticky chrome shallow enough to leave real content on screen at 320px. */}
        <div className="pb-3 md:hidden">
          <SearchBar />
        </div>
      </PageContainer>

      <Drawer open={isMenuOpen} onClose={closeMenu} title="Menu" placement="right">
        <nav aria-label="Mobile" className="flex flex-col gap-1">
          {PRIMARY_NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={drawerNavClassName}
              onClick={closeMenu}
            >
              {item.label}
            </NavLink>
          ))}
          <NavLink to="/cart" className={drawerNavClassName} onClick={closeMenu}>
            Cart
          </NavLink>
          {isAuthenticated && (
            <>
              <NavLink to="/orders" className={drawerNavClassName} onClick={closeMenu}>
                My orders
              </NavLink>
              <NavLink to="/notifications" className={drawerNavClassName} onClick={closeMenu}>
                Notifications
              </NavLink>
            </>
          )}
          <div className="mt-2 border-t border-border pt-3" onClick={closeMenu}>
            <AccountControl inDrawer />
          </div>
        </nav>
      </Drawer>
    </header>
  );
};
