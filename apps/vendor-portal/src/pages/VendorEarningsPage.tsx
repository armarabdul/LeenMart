import { useState } from 'react';
import type {
  VendorEarningsLineResponse,
  VendorEarningsSummaryResponse,
} from '@leen-mart/contracts';
import { apiErrorMessage } from '@/shared/api/base-api';
import { formatMoney } from '@/shared/lib/format-money';
import {
  useGetVendorEarningsQuery,
  type VendorEarningsPage as VendorEarningsQueryResult,
} from '@/features/vendor-earnings/vendor-earnings.api';

const STATEMENT_PAGE_SIZE = 20;

const EarningsSkeleton = (): JSX.Element => (
  <div className="flex flex-col gap-4">
    {Array.from({ length: 3 }, (_, index) => (
      <div key={index} className="h-20 w-full animate-pulse rounded-md bg-slate-100" />
    ))}
  </div>
);

/**
 * "Gross accrued" / "Commission" / "Net accrued" — deliberately never
 * "Net payable": locked decision #1 draws a hard line between what has
 * *accrued* (this) and what has been *paid out* (unresolved BR-04, out of
 * scope). This card exists to answer "how much have I earned so far", never
 * "how much will I be paid and when".
 */
const EarningsSummaryCard = ({
  summary,
}: {
  readonly summary: VendorEarningsSummaryResponse;
}): JSX.Element => (
  <section className="rounded-lg border border-slate-200 bg-white p-4">
    <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
      Earnings summary
    </h2>
    <dl className="mt-3 grid grid-cols-3 gap-4">
      <div>
        <dt className="text-xs text-slate-500">Gross accrued</dt>
        <dd className="text-lg font-semibold text-slate-900">
          {formatMoney(summary.grossAccrued)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">Commission</dt>
        <dd className="text-lg font-semibold text-slate-900">{formatMoney(summary.commission)}</dd>
      </div>
      <div>
        <dt className="text-xs text-slate-500">Net accrued</dt>
        <dd className="text-lg font-semibold text-brand-700">{formatMoney(summary.netAccrued)}</dd>
      </div>
    </dl>
    <p className="mt-4 rounded-md bg-slate-50 p-3 text-xs text-slate-600">
      Accrued earnings, not a payout. This statement reflects amounts earned from confirmed customer
      payments so far — it does not mean any amount has been paid to you, and figures are shown
      before final tax treatment.
    </p>
  </section>
);

const formatOccurredAt = (isoDateTime: string): string =>
  new Date(isoDateTime).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

const StatementRow = ({ line }: { readonly line: VendorEarningsLineResponse }): JSX.Element => (
  <li className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white p-4">
    <div className="flex flex-col gap-1">
      <span className="font-mono text-xs text-slate-500">{line.subOrderId}</span>
      <span className="text-sm text-slate-600">{formatOccurredAt(line.occurredAt)}</span>
    </div>
    <div className="flex flex-col items-end gap-1 text-sm">
      <span className="text-slate-600">Gross {formatMoney(line.grossAmount)}</span>
      <span className="text-slate-600">Commission {formatMoney(line.commissionAmount)}</span>
      <span className="font-medium text-slate-900">Net {formatMoney(line.netAmount)}</span>
    </div>
  </li>
);

interface AccumulatedPage {
  readonly cursor: string | undefined;
  readonly lines: readonly VendorEarningsLineResponse[];
}

interface EarningsStatement {
  readonly data: VendorEarningsQueryResult | undefined;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly isFetching: boolean;
  readonly lines: readonly VendorEarningsLineResponse[];
  readonly loadMore: () => void;
}

/**
 * Folds every fetched page into one growing list, keyed by cursor rather
 * than an effect — split out of `VendorEarningsPage` purely to keep that
 * component under this file's complexity budget.
 */
const useEarningsStatement = (): EarningsStatement => {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  // `null` means "no page folded in yet" — distinct from `cursor: undefined`,
  // which is the legitimate first page, so the very first arrival is not
  // mistaken for one already synced.
  const [accumulated, setAccumulated] = useState<AccumulatedPage | null>(null);
  const { data, isLoading, isError, error, isFetching } = useGetVendorEarningsQuery({
    cursor,
    limit: STATEMENT_PAGE_SIZE,
  });

  // Adjusts accumulated state during render rather than in an effect (React's
  // own documented pattern for "state derived from a prop/argument change") —
  // when a new page's data has arrived for the cursor just requested, fold it
  // in immediately; React re-runs this render with the settled value before
  // painting, so nothing downstream ever sees a stale page.
  if (data && (accumulated === null || accumulated.cursor !== cursor)) {
    setAccumulated({
      cursor,
      lines: accumulated === null ? data.lines : [...accumulated.lines, ...data.lines],
    });
  }

  return {
    data,
    isLoading,
    isError,
    error,
    isFetching,
    lines: accumulated?.lines ?? data?.lines ?? [],
    loadMore: () => {
      if (data?.nextCursor) setCursor(data.nextCursor);
    },
  };
};

/**
 * "Vendor Earnings" (S3-8). Read-only throughout — there is no button here
 * that could be mistaken for a payout, withdrawal, or settlement action
 * (locked decision #9). Follows the loading/error/empty/list shape every
 * other vendor-portal page already established.
 */
export const VendorEarningsPage = (): JSX.Element => {
  const { data, isLoading, isError, error, isFetching, lines, loadMore } = useEarningsStatement();

  if (isLoading) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Earnings</h1>
        <EarningsSkeleton />
      </main>
    );
  }

  if (isError || !data) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Earnings</h1>
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          {apiErrorMessage(error, 'Your earnings could not be loaded. Please try again.')}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">Earnings</h1>
      <EarningsSummaryCard summary={data.summary} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Statement</h2>
        {lines.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600">
            No accrued earnings yet. Confirmed customer payments will show up here.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {lines.map((line) => (
              <StatementRow key={line.subOrderId} line={line} />
            ))}
          </ul>
        )}
        {data.hasMore && (
          <button
            type="button"
            onClick={loadMore}
            disabled={isFetching}
            className="self-center rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {isFetching ? 'Loading…' : 'Load more'}
          </button>
        )}
      </section>
    </main>
  );
};
