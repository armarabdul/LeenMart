import { Link } from 'react-router-dom';
import { PageContainer } from '@/components/PageContainer';
import { env } from '@/shared/config/env';

/**
 * Only routes this app actually has, grouped the way a shopper thinks about
 * them. Nothing here is invented: there is deliberately no "About", "Contact",
 * "Privacy Policy" or "Returns" column, because none of those pages exist yet
 * (the legal pages are still an open launch item), and a footer link to a
 * 404 is worse than no link.
 */
const FOOTER_SECTIONS = [
  {
    heading: 'Shop',
    links: [
      { to: '/', label: 'Home' },
      { to: '/catalogue', label: 'Catalogue' },
      { to: '/cart', label: 'Cart' },
    ],
  },
  {
    heading: 'Your account',
    links: [
      { to: '/orders', label: 'My orders' },
      { to: '/notifications', label: 'Notifications' },
      { to: '/account', label: 'Account' },
    ],
  },
] as const;

const footerLinkClassName =
  'inline-flex min-h-8 items-center text-sm text-text-muted transition-colors hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded';

/**
 * The marketplace footer (Phase C).
 *
 * Previously a single copyright line, which left every page ending abruptly.
 * It now closes the page properly and gives the secondary destinations a home
 * — the ones that do not earn a place in a header that is already carrying
 * search, cart and notifications.
 *
 * Two columns from `sm` up rather than three or four: with only two genuine
 * groups of real routes, more columns would mean inventing content to fill
 * them.
 */
export const Footer = (): JSX.Element => (
  <footer className="mt-12 border-t border-border bg-surface">
    <PageContainer>
      <div className="grid gap-8 py-10 sm:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(0,1fr))]">
        <div className="max-w-sm">
          <p className="font-display text-base font-bold tracking-tight text-primary">
            {env.appName}
          </p>
          {/* The same sentence the home page already uses — not new marketing copy. */}
          <p className="mt-2 text-sm text-text-muted">
            Browse products from independent vendors across every category.
          </p>
        </div>

        {FOOTER_SECTIONS.map((section) => (
          <nav key={section.heading} aria-label={section.heading}>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-text">
              {section.heading}
            </h2>
            <ul className="mt-3 flex flex-col gap-1">
              {section.links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to} className={footerLinkClassName}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      {/* Copyright only. Anything else here — a tax statement, a returns
          promise, an address — would be a claim this app cannot currently
          back, and the order pages already say "GST to be confirmed". */}
      <div className="border-t border-border py-6 text-xs text-text-faint">
        {/* No year: the repo bans a bare `new Date()` (the Clock port rule,
            SDD 24.3) and a presentational footer has no clock to inject. The
            copyright reads exactly as it did before Phase C. */}
        <p>© {env.appName}</p>
      </div>
    </PageContainer>
  </footer>
);
