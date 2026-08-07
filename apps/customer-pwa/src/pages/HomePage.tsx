import { env } from '@/shared/config/env';
import { useGetReadinessQuery } from '@/shared/api/health.api';
import { StatusPill } from '@/components/StatusPill';

/**
 * Foundation shell.
 *
 * Deliberately not a product page. It exists to prove the whole vertical slice
 * works end to end: env validation, the Redux store, RTK Query against the API,
 * Tailwind, and the error boundary.
 */
export const HomePage = (): JSX.Element => {
  const { data, isLoading, isError, refetch } = useGetReadinessQuery();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-8 px-5 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">
          Foundation scaffold
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{env.appName}</h1>
        <p className="text-sm text-slate-600">
          No business modules are implemented. This shell verifies that the frontend, the API and
          the backing services are correctly wired together.
        </p>
      </header>

      <section
        aria-labelledby="platform-status"
        className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="platform-status" className="text-sm font-semibold text-slate-900">
            Platform status
          </h2>
          <button
            type="button"
            onClick={() => void refetch()}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            Refresh
          </button>
        </div>

        {isLoading && <p className="text-sm text-slate-500">Checking dependencies…</p>}

        {isError && (
          <p className="text-sm text-red-700">
            The API is unreachable. Start it with <code className="font-mono">pnpm dev</code> and
            make sure <code className="font-mono">pnpm infra:up</code> has been run.
          </p>
        )}

        {data && (
          <ul className="flex flex-col divide-y divide-slate-100">
            <li className="flex items-center justify-between py-2">
              <span className="text-sm text-slate-700">API</span>
              <StatusPill status={data.status === 'ok' ? 'up' : 'down'} />
            </li>
            {data.dependencies.map((dependency) => (
              <li key={dependency.name} className="flex items-center justify-between py-2">
                <span className="text-sm text-slate-700">
                  {dependency.name}
                  {typeof dependency.latencyMs === 'number' && (
                    <span className="ml-2 text-xs text-slate-400">{dependency.latencyMs} ms</span>
                  )}
                </span>
                <StatusPill status={dependency.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Environment</dt>
          <dd className="mt-1 font-medium text-slate-900">{env.environment}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Version</dt>
          <dd className="mt-1 font-medium text-slate-900">{env.appVersion}</dd>
        </div>
      </dl>
    </main>
  );
};
