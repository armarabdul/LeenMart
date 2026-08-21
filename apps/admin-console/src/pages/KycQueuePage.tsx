import { useEffect, useState } from 'react';
import type { AdminKycQueueItem, AdminKycQueueStatus } from '@leen-mart/contracts';
import { QueueStateView } from '@/components/QueueStateView';
import { useListKycQueueQuery } from '@/features/kyc-review/kyc-review.api';
import { KycStatusFilter } from '@/features/kyc-review/components/KycStatusFilter';
import { KycQueueRow } from '@/features/kyc-review/components/KycQueueRow';

const DEFAULT_STATUSES: readonly AdminKycQueueStatus[] = ['KYC_SUBMITTED', 'KYC_UNDER_REVIEW'];

/** `GET /admin/kyc/submissions` (Phase L, L4) — the vendor KYC review queue. */
export const KycQueuePage = (): JSX.Element => {
  const [statuses, setStatuses] = useState<readonly AdminKycQueueStatus[]>(DEFAULT_STATUSES);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<readonly AdminKycQueueItem[]>([]);

  const { data, isLoading, isFetching, isError, error, refetch } = useListKycQueueQuery({
    limit: 20,
    cursor,
    status: statuses.length > 0 ? [...statuses] : undefined,
  });

  // Filters changing (statuses) resets the accumulated list and the cursor;
  // a page arriving for the *current* filter set appends to it — the
  // standard "load more" shape, kept as component state rather than
  // relying on RTK Query's own cache merge (this app has no other paginated
  // list yet to share that setup with).
  useEffect(() => {
    setItems([]);
    setCursor(undefined);
  }, [statuses]);

  useEffect(() => {
    if (!data) return;
    setItems((current) => (cursor ? [...current, ...data.items] : data.items));
  }, [data, cursor]);

  const isInitialLoad = isLoading && items.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">KYC Review</h1>
        <p className="text-sm text-slate-600">Vendor KYC submissions awaiting a decision.</p>
      </div>

      <KycStatusFilter selected={statuses} onChange={setStatuses} />

      <QueueStateView
        isInitialLoad={isInitialLoad}
        skeletonLabel="Loading KYC queue"
        isError={isError}
        error={error}
        errorFallback="The KYC queue could not be loaded."
        onRetry={() => void refetch()}
        isEmpty={items.length === 0}
        emptyTitle="No submissions in this view"
        emptyDescription="Nothing matches the selected status filters right now."
        hasMore={Boolean(data?.hasMore)}
        isFetchingMore={isFetching && !isInitialLoad}
        onLoadMore={() => setCursor(data?.nextCursor ?? undefined)}
      >
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <KycQueueRow key={item.kycId} item={item} />
          ))}
        </ul>
      </QueueStateView>
    </main>
  );
};
