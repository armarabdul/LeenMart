import { Link } from 'react-router-dom';

export const NotFoundPage = (): JSX.Element => (
  <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-5 text-center">
    <p className="text-5xl font-bold text-brand-700">404</p>
    <h1 className="text-lg font-semibold text-slate-900">Page not found</h1>
    <p className="text-sm text-slate-600">The page you are looking for does not exist.</p>
    <Link
      to="/"
      className="rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
    >
      Back to home
    </Link>
  </main>
);
