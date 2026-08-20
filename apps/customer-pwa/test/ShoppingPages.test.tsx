import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PublicCategoryNode, PublicProductSearchResult } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { HomePage } from '@/pages/HomePage';
import { CataloguePage } from '@/pages/CataloguePage';
import { SearchPage } from '@/pages/SearchPage';
import {
  useGetCategoryBySlugQuery,
  useGetCategoryTreeQuery,
} from '@/features/catalogue/catalogue.api';
import { useProductSearch } from '@/features/catalogue/hooks/useProductSearch';

vi.mock('@/features/catalogue/catalogue.api', () => ({
  useGetCategoryTreeQuery: vi.fn(),
  useGetCategoryBySlugQuery: vi.fn(),
}));
vi.mock('@/features/catalogue/hooks/useProductSearch', () => ({ useProductSearch: vi.fn() }));

const mockedTree = vi.mocked(useGetCategoryTreeQuery);
const mockedBySlug = vi.mocked(useGetCategoryBySlugQuery);
const mockedSearch = vi.mocked(useProductSearch);

const category = (overrides: Partial<PublicCategoryNode> = {}): PublicCategoryNode =>
  ({
    id: 'cat-1',
    parentId: null,
    name: 'Fruit',
    slug: 'fruit',
    children: [],
    ...overrides,
  }) as PublicCategoryNode;

const product = (overrides: Partial<PublicProductSearchResult> = {}): PublicProductSearchResult =>
  ({
    id: 'p1',
    categoryId: 'cat-1',
    name: 'Alphonso Mango',
    brand: 'FarmFresh',
    description: null,
    hsnCode: null,
    countryOfOrigin: null,
    netQuantity: '1 kg',
    attributeValues: {},
    mediaCount: 0,
    createdAt: '2026-08-20T06:00:00.000Z',
    updatedAt: '2026-08-20T06:00:00.000Z',
    ...overrides,
  }) as PublicProductSearchResult;

interface SearchState {
  items?: PublicProductSearchResult[];
  isLoading?: boolean;
  isError?: boolean;
  hasMore?: boolean;
}

const setSearch = (state: SearchState = {}): void => {
  mockedSearch.mockReturnValue({
    items: state.items ?? [],
    isLoading: state.isLoading ?? false,
    isFetchingMore: false,
    isError: state.isError ?? false,
    hasMore: state.hasMore ?? false,
    loadMore: vi.fn(),
  });
};

const setCategories = (nodes: PublicCategoryNode[] | undefined, extra = {}): void => {
  mockedTree.mockReturnValue({
    data: nodes,
    isLoading: false,
    isError: false,
    ...extra,
  } as unknown as ReturnType<typeof useGetCategoryTreeQuery>);
};

const renderAt = (path: string, routePath: string, element: JSX.Element): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={element} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('HomePage (Phase D)', () => {
  it('shows real products, not just a category list', () => {
    setCategories([category()]);
    setSearch({ items: [product()] });

    renderAt('/', '/', <HomePage />);

    expect(screen.getByRole('heading', { name: 'Browse products' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alphonso Mango' })).toBeInTheDocument();
  });

  it('labels the product band factually — no "Featured" or "Trending" the API cannot support', () => {
    setCategories([category()]);
    setSearch({ items: [product()] });

    renderAt('/', '/', <HomePage />);

    expect(document.body.textContent).not.toMatch(
      /featured|trending|best.?sell|popular|deal|% off/i,
    );
  });

  it('offers category discovery and a route into the catalogue', () => {
    setCategories([category()]);
    setSearch({ items: [] });

    renderAt('/', '/', <HomePage />);

    expect(screen.getByRole('heading', { name: 'Shop by category' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Fruit' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'View all' })).toHaveAttribute('href', '/catalogue');
  });

  it('surfaces a category failure without breaking the page', () => {
    setCategories(undefined, { isError: true });
    setSearch({ items: [product()] });

    renderAt('/', '/', <HomePage />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Products still render — one failed query must not blank the storefront.
    expect(screen.getByRole('heading', { name: 'Alphonso Mango' })).toBeInTheDocument();
  });
});

describe('CataloguePage (Phase D)', () => {
  const setSlugCategory = (data: PublicCategoryNode | undefined, extra = {}): void => {
    mockedBySlug.mockReturnValue({
      data,
      isLoading: false,
      isError: false,
      ...extra,
    } as unknown as ReturnType<typeof useGetCategoryBySlugQuery>);
  };

  it('heads an unfiltered browse "All products"', () => {
    setCategories([category()]);
    setSlugCategory(undefined);
    setSearch({ items: [product()] });

    renderAt('/catalogue', '/catalogue', <CataloguePage />);

    expect(screen.getByRole('heading', { level: 1, name: 'All products' })).toBeInTheDocument();
  });

  it('reports how many products are shown, never a total the API never sent', () => {
    setCategories([category()]);
    setSlugCategory(undefined);
    setSearch({ items: [product(), product({ id: 'p2' })], hasMore: true });

    renderAt('/catalogue', '/catalogue', <CataloguePage />);

    // "2+ shown", because more pages exist and no total is available.
    expect(screen.getByText(/2\+ shown/)).toBeInTheDocument();
  });

  it('exposes a category rail as a navigation landmark', () => {
    setCategories([category()]);
    setSlugCategory(undefined);
    setSearch({ items: [product()] });

    renderAt('/catalogue', '/catalogue', <CataloguePage />);

    expect(screen.getByRole('complementary', { name: 'Category navigation' })).toBeInTheDocument();
  });

  it('opens the categories drawer from the mobile trigger', () => {
    setCategories([category()]);
    setSlugCategory(undefined);
    setSearch({ items: [product()] });

    renderAt('/catalogue', '/catalogue', <CataloguePage />);
    fireEvent.click(screen.getByRole('button', { name: /categories/i }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('link', { name: 'Fruit' }).length).toBeGreaterThan(0);
  });

  it('reports a missing category instead of an empty grid', () => {
    setCategories([category()]);
    setSlugCategory(undefined, { isError: true });
    setSearch({ items: [] });

    renderAt('/catalogue/nope', '/catalogue/:slug', <CataloguePage />);

    expect(screen.getByRole('alert')).toHaveTextContent(/couldn’t be found/i);
  });

  it('gives the mobile categories trigger a 44px touch target', () => {
    // Measured at 390px this button was 32px tall — below the 44px guideline,
    // and it is the only way into the category navigator on a phone.
    setCategories([category()]);
    setSlugCategory(undefined);
    setSearch({ items: [product()] });

    renderAt('/catalogue', '/catalogue', <CataloguePage />);

    expect(screen.getByRole('button', { name: /categories/i })).toHaveClass('min-h-11');
  });

  it('offers no sort control, because the search endpoint accepts no sort', () => {
    setCategories([category()]);
    setSlugCategory(undefined);
    setSearch({ items: [product()] });

    renderAt('/catalogue', '/catalogue', <CataloguePage />);

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/sort by|price: low|newest first/i);
  });
});

describe('SearchPage (Phase D)', () => {
  it('invites a query when there is none', () => {
    setSearch({ items: [] });

    renderAt('/search', '/search', <SearchPage />);

    expect(screen.getByText('Search the marketplace')).toBeInTheDocument();
  });

  it('restates the query in the heading', () => {
    setSearch({ items: [product()] });

    renderAt('/search?q=mango', '/search', <SearchPage />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Results for “mango”');
  });

  it('offers a way out when nothing matched', () => {
    setSearch({ items: [] });

    renderAt('/search?q=kiwi', '/search', <SearchPage />);

    expect(screen.getByText('No products match “kiwi”')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse the catalogue' })).toHaveAttribute(
      'href',
      '/catalogue',
    );
  });

  it('says "1 product shown", not "1 products shown"', () => {
    setSearch({ items: [product()], hasMore: false });

    renderAt('/search?q=mango', '/search', <SearchPage />);

    expect(screen.getByText(/product shown/)).toBeInTheDocument();
    expect(screen.queryByText(/products shown/)).not.toBeInTheDocument();
  });

  it('shows no count while results are still loading', () => {
    setSearch({ items: [], isLoading: true });

    renderAt('/search?q=mango', '/search', <SearchPage />);

    expect(screen.queryByText(/shown/)).not.toBeInTheDocument();
  });
});
