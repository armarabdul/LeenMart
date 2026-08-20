import { Outlet } from 'react-router-dom';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

/**
 * Wraps the marketplace surface (home/catalogue/search) in the shared
 * header/footer chrome. `/login`, `/register`, and `/account` deliberately
 * stay outside this layout — they already have their own focused,
 * unauthenticated-friendly presentation and must keep working exactly as
 * they do today.
 *
 * **The skip link is the first focusable thing on the page** (Phase C,
 * WCAG 2.1 AA 2.4.1). The header now carries brand, nav, search, cart and
 * notifications, so a keyboard or screen-reader user would otherwise tab
 * through all of it on every navigation before reaching the content.
 *
 * The target is a plain `div`, not a `<main>`: every page in this app already
 * renders its own `<main>`, and nesting one inside another would produce two
 * main landmarks. `tabIndex={-1}` makes the div programmatically focusable so
 * the jump actually moves focus rather than only moving the scroll position.
 */
export const AppLayout = (): JSX.Element => (
  <div className="flex min-h-screen flex-col bg-background">
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-on-primary"
    >
      Skip to content
    </a>
    <Header />
    <div id="main-content" tabIndex={-1} className="flex-1 focus:outline-none">
      <Outlet />
    </div>
    <Footer />
  </div>
);
