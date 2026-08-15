import { env } from '@/shared/config/env';
import { useGetCategoryTreeQuery } from '@/features/catalogue/catalogue.api';
import { CategoryTree } from '@/features/catalogue/components/CategoryTree';
import { SearchBar } from '@/features/catalogue/components/SearchBar';

/**
 * Marketplace home (Phase 2). Replaces the earlier foundation-scaffold
 * content — that vertical-slice check now lives implicitly in every screen
 * that calls the API, so a dedicated status page is no longer needed here.
 */
export const HomePage = (): JSX.Element => {
  const { data: categories, isLoading, isError } = useGetCategoryTreeQuery();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10">
      <section className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{env.appName}</h1>
        <p className="max-w-md text-sm text-slate-600">
          Browse products from independent vendors across every category.
        </p>
        <div className="w-full max-w-lg">
          <SearchBar autoFocus />
        </div>
      </section>

      <section aria-labelledby="browse-categories" className="flex flex-col gap-3">
        <h2 id="browse-categories" className="text-sm font-semibold text-slate-900">
          Browse categories
        </h2>

        {isLoading && <p className="text-sm text-slate-500">Loading categories…</p>}

        {isError && (
          <p role="alert" className="text-sm text-red-700">
            Categories couldn&apos;t be loaded right now. Please try again shortly.
          </p>
        )}

        {categories && categories.length === 0 && (
          <p className="text-sm text-slate-500">No categories are available yet.</p>
        )}

        {categories && categories.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <CategoryTree nodes={categories} />
          </div>
        )}
      </section>
    </main>
  );
};
