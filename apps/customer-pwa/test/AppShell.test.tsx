import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createStore } from '@/app/store';
import { AppLayout } from '@/components/AppLayout';
import { Footer } from '@/components/Footer';
import { useGetCartQuery } from '@/features/cart/cart.api';
import { useUnreadNotificationCountQuery } from '@/features/notification/notification.api';

vi.mock('@/features/cart/cart.api', () => ({ useGetCartQuery: vi.fn() }));
vi.mock('@/features/notification/notification.api', () => ({
  useUnreadNotificationCountQuery: vi.fn(),
}));

vi.mocked(useGetCartQuery).mockReturnValue({ data: undefined } as unknown as ReturnType<
  typeof useGetCartQuery
>);
vi.mocked(useUnreadNotificationCountQuery).mockReturnValue({
  data: { unread: 0 },
} as unknown as ReturnType<typeof useUnreadNotificationCountQuery>);

const renderShell = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route
              path="/"
              element={
                <main>
                  <h1>Page content</h1>
                </main>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('AppLayout (Phase C shell)', () => {
  it('puts a skip link ahead of the header chrome', () => {
    // WCAG 2.4.1: the header carries brand, nav, search, cart and
    // notifications, so a keyboard user needs a way past all of it.
    renderShell();

    const skip = screen.getByRole('link', { name: 'Skip to content' });
    expect(skip).toHaveAttribute('href', '#main-content');
  });

  it('gives the skip link a real, focusable target', () => {
    renderShell();

    const target = document.getElementById('main-content');
    expect(target).not.toBeNull();
    // Without a tabindex the jump would move the scroll position but not focus.
    expect(target).toHaveAttribute('tabindex', '-1');
  });

  it('renders exactly one main landmark — the page owns it, not the shell', () => {
    renderShell();

    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('renders the page inside the shell', () => {
    renderShell();

    expect(screen.getByRole('heading', { name: 'Page content' })).toBeInTheDocument();
  });
});

describe('Footer (Phase C shell)', () => {
  const renderFooter = (): void => {
    render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );
  };

  it('groups its links under named navigation landmarks', () => {
    renderFooter();

    const shop = screen.getByRole('navigation', { name: 'Shop' });
    expect(within(shop).getByRole('link', { name: 'Catalogue' })).toBeInTheDocument();

    const account = screen.getByRole('navigation', { name: 'Your account' });
    expect(within(account).getByRole('link', { name: 'My orders' })).toBeInTheDocument();
  });

  it('links only to routes this app actually has', () => {
    // A footer link to a page that does not exist is worse than no link, and
    // the legal pages are still an open launch item.
    renderFooter();

    const existing = ['/', '/catalogue', '/cart', '/orders', '/notifications', '/account'];
    for (const link of screen.getAllByRole('link')) {
      expect(existing).toContain(link.getAttribute('href'));
    }
  });

  it('claims nothing the app cannot back — no invented policy, tax or contact copy', () => {
    renderFooter();

    expect(document.body.textContent).not.toMatch(
      /privacy|terms|refund|returns|contact us|address|GST|phone/i,
    );
  });
});
