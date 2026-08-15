import { useSearchParams } from 'react-router-dom';
import { useProductSearch } from '@/features/catalogue/hooks/useProductSearch';
import { ProductGrid } from '@/features/catalogue/components/ProductGrid';

export const SearchPage = (): JSX.Element => {
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';

  const { items, isLoading, isFetchingMore, isError, hasMore, loadMore } = useProductSearch({
    q: q || undefined,
  });

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8">
      <h1 className="text-xl font-bold tracking-tight text-slate-900">
        {q ? (
          <>
            Results for <span className="text-brand-700">&ldquo;{q}&rdquo;</span>
          </>
        ) : (
          'Search'
        )}
      </h1>

      {q ? (
        <ProductGrid
          items={items}
          isLoading={isLoading}
          isFetching={isFetchingMore}
          isError={isError}
          hasMore={hasMore}
          onLoadMore={loadMore}
        />
      ) : (
        <p className="text-sm text-slate-500">Enter a search term to find products.</p>
      )}
    </main>
  );
};
