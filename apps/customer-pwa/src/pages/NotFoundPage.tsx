import { Link } from 'react-router-dom';
import { PageContainer } from '@/components/PageContainer';

export const NotFoundPage = (): JSX.Element => (
  <main className="flex min-h-screen flex-col justify-center">
    <PageContainer>
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 py-12 text-center">
        <p className="font-display text-5xl font-bold text-primary">404</p>
        <h1 className="font-display text-lg font-semibold text-text">Page not found</h1>
        <p className="text-sm text-text-muted">The page you are looking for does not exist.</p>
        <Link
          to="/"
          className="inline-flex h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-on-primary transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Back to home
        </Link>
      </div>
    </PageContainer>
  </main>
);
