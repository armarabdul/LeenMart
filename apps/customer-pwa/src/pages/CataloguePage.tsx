import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { PublicCategoryNode } from '@leen-mart/contracts';
import { Alert, Badge, Breadcrumb, Button, Drawer } from '@leen-mart/ui';
import {
  useGetCategoryBySlugQuery,
  useGetCategoryTreeQuery,
} from '@/features/catalogue/catalogue.api';
import { useProductSearch } from '@/features/catalogue/hooks/useProductSearch';
import { CategoryTree } from '@/features/catalogue/components/CategoryTree';
import { ProductGrid } from '@/features/catalogue/components/ProductGrid';
import { PageContainer } from '@/components/PageContainer';

const resolveHeading = (
  slug: string | undefined,
  category: PublicCategoryNode | undefined,
  isCategoryLoading: boolean,
): string => {
  if (!slug) return 'All products';
  if (category) return category.name;
  return isCategoryLoading ? 'Loading…' : 'Category';
};

const FilterIcon = (): JSX.Element => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-4 w-4">
    <path
      d="M4 6h16M7 12h10M10 18h4"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
  </svg>
);

/**
 * The one filter this catalogue actually has.
 *
 * `publicProductSearchQuerySchema` accepts `q`, `categoryId` and `vendorId` —
 * there is no price range, no sort, no rating filter, no availability filter.
 * So this rail is a category navigator and is labelled as one, rather than a
 * "Filters" panel that would imply controls the API cannot honour.
 */
const CategoryNavigator = ({
  roots,
  current,
}: {
  readonly roots: readonly PublicCategoryNode[] | undefined;
  readonly current: PublicCategoryNode | undefined;
}): JSX.Element => {
  // Inside a category, its own children are the useful next step; at the top
  // level, the roots are.
  const nodes = current && current.children.length > 0 ? current.children : (roots ?? []);
  if (nodes.length === 0) {
    return <p className="text-sm text-text-muted">No sub-categories.</p>;
  }
  return (
    <>
      {current && (
        <Link
          to="/catalogue"
          className="mb-2 inline-flex min-h-9 items-center rounded-md px-2 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          Clear category
        </Link>
      )}
      <CategoryTree nodes={nodes} maxDepth={1} />
    </>
  );
};

/** Title, loaded-count and the mobile category trigger — split out to keep the page's own branching low. */
const CatalogueHeader = ({
  heading,
  shownCount,
  hasMore,
  onOpenFilters,
}: {
  readonly heading: string;
  readonly shownCount: number;
  readonly hasMore: boolean;
  readonly onOpenFilters: () => void;
}): JSX.Element => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex items-center gap-3">
      <h1 className="font-display text-xl font-bold tracking-tight text-text sm:text-2xl">
        {heading}
      </h1>
      {/* A count of what is loaded, not a total: the endpoint is
          cursor-paginated and returns no total, so "24 products" would be a
          number the API never gave us. */}
      {shownCount > 0 && (
        <Badge tone="neutral">
          {shownCount}
          {hasMore ? '+' : ''} shown
        </Badge>
      )}
    </div>

    <Button
      type="button"
      variant="secondary"
      size="sm"
      leadingIcon={<FilterIcon />}
      onClick={onOpenFilters}
      aria-haspopup="dialog"
      // `size="sm"` keeps the label compact, but this is the only way into the
      // category navigator on a phone, so it keeps a 44px touch target.
      className="min-h-11 md:hidden"
    >
      Categories
    </Button>
  </div>
);

/**
 * `/catalogue` (unfiltered browse) and `/catalogue/:slug` (one category)
 * share this page — the slug just adds a `categoryId` filter on top of the
 * same search, rather than being a separate screen.
 *
 * **Layout (Phase D).** A persistent category rail from `md` up; on a phone
 * the same navigator moves into a `Drawer` behind a "Categories" button, so
 * the product grid owns the whole width. There is no sort control because the
 * search endpoint accepts no sort parameter — adding one would be a control
 * that silently does nothing.
 */
export const CataloguePage = (): JSX.Element => {
  const { slug } = useParams<{ slug?: string }>();
  const [isFilterOpen, setIsFilterOpen] = useState(false);

  const {
    data: category,
    isLoading: isCategoryLoading,
    isError: isCategoryError,
  } = useGetCategoryBySlugQuery(slug ?? '', { skip: !slug });

  const { data: roots } = useGetCategoryTreeQuery();

  const { items, isLoading, isFetchingMore, isError, hasMore, loadMore } = useProductSearch({
    categoryId: slug ? category?.id : undefined,
  });

  const isCategoryNotFound = Boolean(slug) && isCategoryError;
  const isResolvingCategory = Boolean(slug) && isCategoryLoading;
  const heading = resolveHeading(slug, category, isCategoryLoading);

  if (isCategoryNotFound) {
    return (
      <main>
        <PageContainer>
          <div className="py-8">
            <Alert tone="danger" title="Category not found">
              This category couldn’t be found. It may have been renamed or removed.
            </Alert>
          </div>
        </PageContainer>
      </main>
    );
  }

  return (
    <main>
      <PageContainer>
        <div className="py-6 sm:py-8">
          <Breadcrumb
            className="mb-4"
            items={[
              { label: 'Home', href: '/' },
              { label: 'Catalogue', href: '/catalogue' },
              ...(category ? [{ label: category.name }] : []),
            ]}
            renderLink={({ href, children }) => <Link to={href}>{children}</Link>}
          />

          <CatalogueHeader
            heading={heading}
            shownCount={isLoading ? 0 : items.length}
            hasMore={hasMore}
            onOpenFilters={() => setIsFilterOpen(true)}
          />

          <div className="mt-6 flex gap-8">
            <aside
              aria-label="Category navigation"
              className="hidden w-56 shrink-0 md:block lg:w-64"
            >
              <div className="sticky top-24">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Categories
                </h2>
                <CategoryNavigator roots={roots} current={category} />
              </div>
            </aside>

            <div className="min-w-0 flex-1">
              <ProductGrid
                items={items}
                isLoading={isLoading || isResolvingCategory}
                isFetching={isFetchingMore}
                isError={isError}
                hasMore={hasMore}
                onLoadMore={loadMore}
                emptyTitle="No products in this category yet"
                emptyDescription="Try another category, or browse everything."
                emptyAction={
                  <Link
                    to="/catalogue"
                    className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-on-primary hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                  >
                    Browse all products
                  </Link>
                }
              />
            </div>
          </div>
        </div>
      </PageContainer>

      <Drawer
        open={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        title="Categories"
        placement="bottom"
      >
        <div onClick={() => setIsFilterOpen(false)}>
          <CategoryNavigator roots={roots} current={category} />
        </div>
      </Drawer>
    </main>
  );
};
