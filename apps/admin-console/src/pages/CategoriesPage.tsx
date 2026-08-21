import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminCategory } from '@leen-mart/contracts';
import { StatusBadge } from '@leen-mart/ui';
import { QueueStateView } from '@/components/QueueStateView';
import { useListCategoriesQuery } from '@/features/category-management/category.api';
import { CategoryCreateForm } from '@/features/category-management/components/CategoryCreateForm';
import { CATEGORY_RISK_TONE } from '@/features/category-management/lib/category-risk-tone';

/**
 * `GET /admin/categories` (Phase L, L7). The backend list is a flat,
 * cursor-paginated collection ordered `(depth, id)` — not grouped by parent
 * — so this renders as a depth-indented list rather than a constructed tree:
 * building a real nested tree client-side across pages would show an
 * incomplete/incorrect structure until every page loads, which is worse
 * than an honest flat view. Reparenting/subcategory-creation are reached
 * from a category's own detail page.
 */
export const CategoriesPage = (): JSX.Element => {
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [items, setItems] = useState<readonly AdminCategory[]>([]);

  const { data, isLoading, isFetching, isError, error, refetch } = useListCategoriesQuery({
    limit: 20,
    cursor,
  });

  useEffect(() => {
    if (!data) return;
    setItems((current) => (cursor ? [...current, ...data.items] : data.items));
  }, [data, cursor]);

  const isInitialLoad = isLoading && items.length === 0;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Categories</h1>
        <p className="text-sm text-slate-600">Platform taxonomy and per-category attributes.</p>
      </div>

      <CategoryCreateForm parentId={null} onCreated={() => void refetch()} />

      <QueueStateView
        isInitialLoad={isInitialLoad}
        skeletonLabel="Loading categories"
        isError={isError}
        error={error}
        errorFallback="Categories could not be loaded."
        onRetry={() => void refetch()}
        isEmpty={items.length === 0}
        emptyTitle="No categories yet"
        emptyDescription="Create the first root category above."
        hasMore={Boolean(data?.hasMore)}
        isFetchingMore={isFetching && !isInitialLoad}
        onLoadMore={() => setCursor(data?.nextCursor ?? undefined)}
      >
        <ul className="flex flex-col gap-2">
          {items.map((category) => (
            <li key={category.id}>
              <Link
                to={`/categories/${category.id}`}
                style={{ marginLeft: `${category.depth * 1.25}rem` }}
                className="flex items-center justify-between gap-3 rounded-card border border-border bg-surface p-3 hover:bg-surface-alt"
              >
                <div>
                  <p className="text-sm font-medium text-text">{category.name}</p>
                  <p className="text-xs text-text-muted">{category.slug}</p>
                </div>
                <div className="flex items-center gap-2">
                  {!category.isActive && <StatusBadge tone="neutral" label="Inactive" />}
                  <StatusBadge
                    tone={CATEGORY_RISK_TONE[category.riskLevel]}
                    label={category.riskLevel}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </QueueStateView>
    </main>
  );
};
