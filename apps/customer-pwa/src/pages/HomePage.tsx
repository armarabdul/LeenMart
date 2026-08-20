import { Link } from 'react-router-dom';
import { Alert } from '@leen-mart/ui';
import { env } from '@/shared/config/env';
import { useGetCategoryTreeQuery } from '@/features/catalogue/catalogue.api';
import { CategoryChips } from '@/features/catalogue/components/CategoryChips';
import { CategoryTree } from '@/features/catalogue/components/CategoryTree';
import { ProductGrid } from '@/features/catalogue/components/ProductGrid';
import { SearchBar } from '@/features/catalogue/components/SearchBar';
import { useProductSearch } from '@/features/catalogue/hooks/useProductSearch';
import { PageContainer } from '@/components/PageContainer';

/** Enough to fill two rows of the widest grid without turning home into an endless scroll. */
const HOME_PRODUCT_LIMIT = 8;

/**
 * Home shows a *sample* of categories, not the whole taxonomy.
 *
 * `GET /catalogue/categories` returns the entire tree with no pagination, and
 * a marketplace's taxonomy is not bounded — rendering all of it turns the
 * home page into thousands of links and starves the main thread. "Shop by
 * category" is a starting point; `/catalogue` is where the full list lives.
 */
const HOME_CATEGORY_LIMIT = 12;

/**
 * The storefront introduction.
 *
 * Deliberately short — one screen-height hero would push every product below
 * the fold on a phone, and there is no promotional content to justify it: the
 * API has no campaigns, banners or offers, so a large hero would have to be
 * filled with invented marketing. This states what the marketplace is, gives
 * search top billing, and gets out of the way.
 */
const Hero = (): JSX.Element => (
  <section className="border-b border-border bg-surface">
    <PageContainer>
      <div className="flex flex-col items-center gap-4 py-8 text-center sm:py-12">
        <h1 className="font-display text-2xl font-bold tracking-tight text-text sm:text-3xl">
          {env.appName}
        </h1>
        <p className="max-w-md text-sm text-text-muted">
          Browse products from independent vendors across every category.
        </p>
        <div className="w-full max-w-xl">
          <SearchBar />
        </div>
      </div>
    </PageContainer>
  </section>
);

/**
 * Marketplace home (Phase D).
 *
 * Three bands: introduce, let the shopper pick a category, then show actual
 * products. The product band matters most — the previous home page listed
 * categories and stopped, so a first-time visitor never saw a single item
 * without navigating first.
 *
 * **The product section is headed "Browse products", not "Featured" or
 * "Trending".** The search endpoint takes no sort and returns no popularity
 * signal, so any curated-sounding label would be a claim the data cannot
 * support.
 */
export const HomePage = (): JSX.Element => {
  const {
    data: categories,
    isLoading: isCategoriesLoading,
    isError: isCategoriesError,
  } = useGetCategoryTreeQuery();

  const { items, isLoading, isError } = useProductSearch({});
  const products = items.slice(0, HOME_PRODUCT_LIMIT);
  const shownCategories = categories?.slice(0, HOME_CATEGORY_LIMIT) ?? [];

  return (
    <main>
      <Hero />

      <PageContainer>
        <div className="flex flex-col gap-10 py-8">
          <section aria-labelledby="browse-categories" className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="browse-categories" className="text-base font-semibold text-text">
                Shop by category
              </h2>
              <Link
                to="/catalogue"
                className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                View all
              </Link>
            </div>

            {isCategoriesLoading && (
              <p className="text-sm text-text-muted" role="status">
                Loading categories…
              </p>
            )}

            {isCategoriesError && (
              <Alert tone="danger">
                Categories couldn’t be loaded right now. Please try again shortly.
              </Alert>
            )}

            {categories && categories.length === 0 && (
              <p className="text-sm text-text-muted">No categories are available yet.</p>
            )}

            {categories && categories.length > 0 && (
              <>
                {/* Chips on a phone, the tree from `sm` up where the vertical
                    space is affordable and the hierarchy is useful. Both render
                    the same bounded slice, so the hidden one costs a dozen nodes
                    rather than the whole taxonomy. */}
                <div className="sm:hidden">
                  <CategoryChips nodes={shownCategories} label="Categories" />
                </div>
                <div className="hidden rounded-card border border-border bg-surface p-4 sm:block">
                  <CategoryTree nodes={shownCategories} maxDepth={0} />
                </div>
              </>
            )}
          </section>

          <section aria-labelledby="browse-products" className="flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-4">
              <h2 id="browse-products" className="text-base font-semibold text-text">
                Browse products
              </h2>
              <Link
                to="/catalogue"
                className="rounded text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                See more
              </Link>
            </div>

            <ProductGrid
              items={products}
              isLoading={isLoading}
              isError={isError}
              emptyTitle="No products yet"
              emptyDescription="Products will appear here once vendors start listing them."
            />
          </section>
        </div>
      </PageContainer>
    </main>
  );
};
