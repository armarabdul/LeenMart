import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { env } from '@/shared/config/env';

interface AuthLayoutProps {
  readonly title: string;
  readonly subtitle: string;
  readonly children: ReactNode;
  readonly footer: ReactNode;
}

/**
 * Shared shell for `/login` and `/register` (Phase F).
 *
 * Deliberately outside `AppLayout` — matching that component's own documented
 * decision (`AppLayout.tsx`) that the auth pages keep their own focused,
 * unauthenticated-friendly presentation rather than the full marketplace
 * header/footer chrome. The brand mark links home so a visitor never gets
 * stuck on a page with no way out other than the browser back button.
 */
export const AuthLayout = ({ title, subtitle, children, footer }: AuthLayoutProps): JSX.Element => (
  <main className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12">
    <div className="flex w-full max-w-md flex-col gap-6">
      <Link
        to="/"
        className="self-center rounded-md font-display text-2xl font-bold tracking-tight text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {env.appName}
      </Link>

      <div className="flex flex-col gap-6 rounded-card border border-border bg-surface p-6 shadow-card sm:p-8">
        <header className="flex flex-col gap-1 text-center">
          <h1 className="font-display text-2xl font-bold tracking-tight text-text">{title}</h1>
          <p className="text-sm text-text-muted">{subtitle}</p>
        </header>
        {children}
      </div>

      {footer}
    </div>
  </main>
);
