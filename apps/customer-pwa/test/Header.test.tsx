import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { AuthSessionResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { sessionEstablished } from '@/shared/api/session.slice';
import { Header } from '@/components/Header';
import { useGetCartQuery } from '@/features/cart/cart.api';
import { useUnreadNotificationCountQuery } from '@/features/notification/notification.api';

vi.mock('@/features/cart/cart.api', () => ({ useGetCartQuery: vi.fn() }));
vi.mock('@/features/notification/notification.api', () => ({
  useUnreadNotificationCountQuery: vi.fn(),
}));

const mockedCart = vi.mocked(useGetCartQuery);
const mockedUnread = vi.mocked(useUnreadNotificationCountQuery);

const session: AuthSessionResponse = {
  user: {
    id: '00000000-0000-7000-8000-000000000001',
    email: 'shopper@example.com',
    role: 'CUSTOMER',
  },
  accessToken: 'access-token',
  accessTokenExpiresAt: '2026-01-01T00:15:00.000Z',
  refreshToken: 'refresh-token',
  refreshTokenExpiresAt: '2026-01-31T00:00:00.000Z',
};

const renderHeader = (
  options: { authenticated?: boolean; cartQuantities?: number[] } = {},
): void => {
  mockedCart.mockReturnValue({
    data: options.cartQuantities
      ? { items: options.cartQuantities.map((quantity) => ({ quantity })) }
      : undefined,
  } as unknown as ReturnType<typeof useGetCartQuery>);
  mockedUnread.mockReturnValue({ data: { unread: 0 } } as unknown as ReturnType<
    typeof useUnreadNotificationCountQuery
  >);

  const store = createStore();
  if (options.authenticated === true) store.dispatch(sessionEstablished(session));

  render(
    <Provider store={store}>
      <MemoryRouter>
        <Header />
      </MemoryRouter>
    </Provider>,
  );
};

describe('Header (Phase C shell)', () => {
  describe('structure', () => {
    it('exposes a named primary navigation landmark', () => {
      renderHeader();

      const nav = screen.getByRole('navigation', { name: 'Primary' });
      expect(within(nav).getByRole('link', { name: 'Home' })).toBeInTheDocument();
      expect(within(nav).getByRole('link', { name: 'Catalogue' })).toBeInTheDocument();
    });

    it('renders search in the header on every viewport', () => {
      // Two instances by design: a desktop slot and a mobile row, each hidden
      // at the other's breakpoint. Both are real, so both are queryable here.
      renderHeader();

      expect(screen.getAllByRole('search').length).toBeGreaterThanOrEqual(1);
    });

    it('offers sign-in to an anonymous visitor and the account link to a member', () => {
      renderHeader();
      expect(screen.getAllByRole('link', { name: 'Sign in' }).length).toBeGreaterThan(0);

      renderHeader({ authenticated: true });
      expect(screen.getAllByRole('link', { name: 'shopper@example.com' }).length).toBeGreaterThan(
        0,
      );
    });
  });

  describe('cart affordance', () => {
    it('describes an empty cart without a badge', () => {
      renderHeader();

      expect(screen.getByRole('link', { name: 'Cart, empty' })).toBeInTheDocument();
    });

    it('puts the item count in the accessible name, not only in the badge', () => {
      renderHeader({ authenticated: true, cartQuantities: [2, 1] });

      expect(screen.getByRole('link', { name: 'Cart, 3 items' })).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('says "1 item", not "1 items"', () => {
      renderHeader({ authenticated: true, cartQuantities: [1] });

      expect(screen.getByRole('link', { name: 'Cart, 1 item' })).toBeInTheDocument();
    });

    it('caps the badge so a large cart cannot distort the header', () => {
      renderHeader({ authenticated: true, cartQuantities: [40] });

      expect(screen.getByText('9+')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Cart, 40 items' })).toBeInTheDocument();
    });
  });

  describe('mobile menu', () => {
    it('is closed until asked for', () => {
      renderHeader();

      expect(screen.getByRole('button', { name: 'Open menu' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
      expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();
    });

    it('opens a drawer carrying the same destinations as the desktop bar', () => {
      renderHeader();
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

      const drawerNav = screen.getByRole('navigation', { name: 'Mobile' });
      expect(within(drawerNav).getByRole('link', { name: 'Home' })).toBeInTheDocument();
      expect(within(drawerNav).getByRole('link', { name: 'Catalogue' })).toBeInTheDocument();
      expect(within(drawerNav).getByRole('link', { name: 'Cart' })).toBeInTheDocument();
    });

    it('offers the signed-in destinations only to a member', () => {
      renderHeader();
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));
      expect(screen.queryByRole('link', { name: 'My orders' })).not.toBeInTheDocument();

      renderHeader({ authenticated: true });
      const [, secondMenuButton] = screen.getAllByRole('button', { name: 'Open menu' });
      fireEvent.click(secondMenuButton!);
      expect(screen.getByRole('link', { name: 'My orders' })).toBeInTheDocument();
    });

    it('closes when a destination is chosen, so the drawer never covers the page it navigated to', () => {
      renderHeader();
      fireEvent.click(screen.getByRole('button', { name: 'Open menu' }));

      const drawerNav = screen.getByRole('navigation', { name: 'Mobile' });
      fireEvent.click(within(drawerNav).getByRole('link', { name: 'Catalogue' }));

      expect(screen.queryByRole('navigation', { name: 'Mobile' })).not.toBeInTheDocument();
    });
  });
});
