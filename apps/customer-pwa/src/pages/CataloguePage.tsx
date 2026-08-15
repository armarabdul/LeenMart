import { useParams } from 'react-router-dom';
import type { PublicCategoryNode } from '@leen-mart/contracts';
import { useGetCategoryBySlugQuery } from '@/features/catalogue/catalogue.api';
import { useProductSearch } from '@/features/catalogue/hooks/useProductSearch';
import { CategoryTree } from '@/features/catalogue/components/CategoryTree';
import { ProductGrid } from '@/features/catalogue/components/ProductGrid';

const resolveHeading = (
  slug: string | undefined,
  category: PublicCategoryNode | undefined,
  isCategoryLoading: boolean,
): string => {
  if (!slug) return 'All products';
  if (category) return category.name;
  return isCategoryLoading ? 'Loading…' : 'Category';
};

interface CategoryResultsProps {
  readonly isCategoryNotFound: boolean;
  readonly items: ReturnType<typeof useProductSearch>['items'];
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isError: boolean;
  readonly hasMore: boolean;
  readonly onLoadMore: () => void;
}

const CategoryResults = ({
  isCategoryNotFound,
  items,
  isLoading,
  isFetching,
  isError,
  hasMore,
  onLoadMore,
}: CategoryResultsProps): JSX.Element => {
  if (isCategoryNotFound) {
    return (
      <p role="alert" className="text-sm text-red-700">
        This category couldn&apos;t be found.
      </p>
    );
  }

  return (
    <ProductGrid
      items={items}
      isLoading={isLoading}
      isFetching={isFetching}
      isError={isError}
      hasMore={hasMore}
      onLoadMore={onLoadMore}
    />
  );
};

/**
 * `/catalogue` (unfiltered browse) and `/catalogue/:slug` (one category)
 * share this page — the slug just adds a `categoryId` filter on top of the
 * same search, rather than being a separate screen.
 */
export const CataloguePage = (): JSX.Element => {
  const { slug } = useParams<{ slug?: string }>();

  const {
    data: category,
    isLoading: isCategoryLoading,
    isError: isCategoryError,
  } = useGetCategoryBySlugQuery(slug ?? '', { skip: !slug });

  const { items, isLoading, isFetchingMore, isError, hasMore, loadMore } = useProductSearch({
    categoryId: slug ? category?.id : undefined,
  });

  const isCategoryNotFound = Boolean(slug) && isCategoryError;
  const isResolvingCategory = Boolean(slug) && isCategoryLoading;

  return (
    <main className="mx-auto flex w-full max-w-6xl gap-6 px-4 py-8">
      <aside className="hidden w-56 shrink-0 md:block">
        {category && category.children.length > 0 && <CategoryTree nodes={category.children} />}
      </aside>

      <div className="flex flex-1 flex-col gap-4">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">
          {resolveHeading(slug, category, isCategoryLoading)}
        </h1>

        <CategoryResults
          isCategoryNotFound={isCategoryNotFound}
          items={items}
          isLoading={isLoading || isResolvingCategory}
          isFetching={isFetchingMore}
          isError={isError}
          hasMore={hasMore}
          onLoadMore={loadMore}
        />
      </div>
    </main>
  );
};
