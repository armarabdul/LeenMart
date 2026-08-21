import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { AdminCategory } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { CategoriesPage } from '@/pages/CategoriesPage';
import {
  useCreateCategoryMutation,
  useListCategoriesQuery,
} from '@/features/category-management/category.api';
import type { CategoryListPage } from '@/features/category-management/category.api';

vi.mock('@/features/category-management/category.api', () => ({
  useListCategoriesQuery: vi.fn(),
  useCreateCategoryMutation: vi.fn(),
}));

const mockedUseListCategoriesQuery = vi.mocked(useListCategoriesQuery);
const mockedUseCreateCategoryMutation = vi.mocked(useCreateCategoryMutation);
const mockRefetch = vi.fn();
const mockCreateCategory = vi.fn();

const category = (overrides: Partial<AdminCategory> = {}): AdminCategory => ({
  id: 'category-1',
  parentId: null,
  path: [],
  depth: 1,
  name: 'Groceries',
  slug: 'groceries',
  riskLevel: 'LOW',
  requirements: { requiresHsn: false, requiresCountryOfOrigin: false, requiresNetQuantity: false },
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const stub = (
  data: CategoryListPage | undefined,
  options: { isLoading?: boolean; isFetching?: boolean; isError?: boolean } = {},
): void => {
  mockRefetch.mockClear();
  mockCreateCategory.mockReset();
  mockCreateCategory.mockReturnValue({
    unwrap: () => Promise.resolve(category()),
  });
  mockedUseListCategoriesQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isFetching: options.isFetching ?? false,
    isError: options.isError ?? false,
    error: undefined,
    refetch: mockRefetch,
  } as unknown as ReturnType<typeof useListCategoriesQuery>);
  mockedUseCreateCategoryMutation.mockReturnValue([
    mockCreateCategory,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useCreateCategoryMutation>);
};

const renderPage = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    </Provider>,
  );
};

describe('CategoriesPage', () => {
  it('shows an error state with a retry action', () => {
    stub(undefined, { isError: true });
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('Categories could not be loaded.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows an empty state prompting the first root category', () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    expect(screen.getByText('No categories yet')).toBeInTheDocument();
  });

  it('lists each category, indented by depth, and links it to its detail page', () => {
    stub({
      items: [category({ id: 'category-1', name: 'Groceries', depth: 2 })],
      nextCursor: null,
      hasMore: false,
    });
    renderPage();

    const link = screen.getByRole('link', { name: /Groceries/ });
    expect(link).toHaveAttribute('href', '/categories/category-1');
    expect(link).toHaveStyle({ marginLeft: '2.5rem' });
  });

  it('marks an inactive category', () => {
    stub({ items: [category({ isActive: false })], nextCursor: null, hasMore: false });
    renderPage();

    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('creates a root category with parentId null, never a field the user edits', async () => {
    stub({ items: [], nextCursor: null, hasMore: false });
    renderPage();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Groceries' } });
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'groceries' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(mockCreateCategory).toHaveBeenCalledWith(
        expect.objectContaining({ parentId: null, name: 'Groceries', slug: 'groceries' }),
      ),
    );
  });
});
