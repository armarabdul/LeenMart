import { useEffect, useState } from 'react';
import type { AdminReviewQueueItem, ReviewModerationStatusDto } from '@leen-mart/contracts';
import { QueueStateView } from '@/components/QueueStateView';
import { useListReviewQueueQuery } from '@/features/review-moderation/review-moderation.api';
import { ReviewStatusFilter } from '@/features/review-moderation/components/ReviewStatusFilter';
import { ReviewQueueRow } from '@/features/review-moderation/components/ReviewQueueRow';

const DEFAULT_STATUSES: readonly ReviewModerationStatusDto[] = ['SUBMITTED'];

/** `GET /admin/reviews` (Phase L, L6) — the review moderation queue. */
export const ReviewQueuePage = (): JSX.Element => {
  const [statuses, setStatuses] = useState<readonly ReviewModerationStatusDto[]>(DEFAULT_STATUSES);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<readonly AdminReviewQueueItem[]>([]);

  const { data, isLoading, isFetching, isError, error, refetch } = useListReviewQueueQuery({
    limit: 20,
    cursor,
    status: statuses.length > 0 ? [...statuses] : undefined,
  });

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
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Review Moderation</h1>
        <p className="text-sm text-slate-600">Customer reviews submitted for moderation.</p>
      </div>

      <ReviewStatusFilter selected={statuses} onChange={setStatuses} />

      <QueueStateView
        isInitialLoad={isInitialLoad}
        skeletonLabel="Loading review queue"
        isError={isError}
        error={error}
        errorFallback="The review queue could not be loaded."
        onRetry={() => void refetch()}
        isEmpty={items.length === 0}
        emptyTitle="No reviews in this view"
        emptyDescription="Nothing matches the selected status filters right now."
        hasMore={Boolean(data?.hasMore)}
        isFetchingMore={isFetching && !isInitialLoad}
        onLoadMore={() => setCursor(data?.nextCursor ?? undefined)}
      >
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <ReviewQueueRow key={item.id} item={item} />
          ))}
        </ul>
      </QueueStateView>
    </main>
  );
};
