import { useEffect, useState } from 'react';
import type { AdminProductQueueItem, AdminProductQueueStatus } from '@leen-mart/contracts';
import { QueueStateView } from '@/components/QueueStateView';
import { useListProductQueueQuery } from '@/features/product-moderation/product-moderation.api';
import { ProductStatusFilter } from '@/features/product-moderation/components/ProductStatusFilter';
import { ProductQueueRow } from '@/features/product-moderation/components/ProductQueueRow';

const DEFAULT_STATUSES: readonly AdminProductQueueStatus[] = ['PENDING_REVIEW'];

/** `GET /admin/products/submissions` (Phase L, L5) — the product moderation queue. */
export const ProductQueuePage = (): JSX.Element => {
  const [statuses, setStatuses] = useState<readonly AdminProductQueueStatus[]>(DEFAULT_STATUSES);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<readonly AdminProductQueueItem[]>([]);

  const { data, isLoading, isFetching, isError, error, refetch } = useListProductQueueQuery({
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
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Product Moderation</h1>
        <p className="text-sm text-slate-600">Products submitted for listing.</p>
      </div>

      <ProductStatusFilter selected={statuses} onChange={setStatuses} />

      <QueueStateView
        isInitialLoad={isInitialLoad}
        skeletonLabel="Loading product queue"
        isError={isError}
        error={error}
        errorFallback="The product queue could not be loaded."
        onRetry={() => void refetch()}
        isEmpty={items.length === 0}
        emptyTitle="No products in this view"
        emptyDescription="Nothing matches the selected status filters right now."
        hasMore={Boolean(data?.hasMore)}
        isFetchingMore={isFetching && !isInitialLoad}
        onLoadMore={() => setCursor(data?.nextCursor ?? undefined)}
      >
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <ProductQueueRow key={item.productId} item={item} />
          ))}
        </ul>
      </QueueStateView>
    </main>
  );
};
