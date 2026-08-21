import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminCategory, AdminCategoryAttribute } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { CategoryDetailPage } from '@/pages/CategoryDetailPage';
import {
  useGetCategoryQuery,
  useRemoveCategoryMutation,
  useReparentCategoryMutation,
  useUpdateCategoryMutation,
} from '@/features/category-management/category.api';
import {
  useAddCategoryAttributeMutation,
  useListCategoryAttributesQuery,
  useRemoveCategoryAttributeMutation,
  useUpdateCategoryAttributeMutation,
} from '@/features/category-management/category-attribute.api';

vi.mock('@/features/category-management/category.api', () => ({
  useGetCategoryQuery: vi.fn(),
  useUpdateCategoryMutation: vi.fn(),
  useReparentCategoryMutation: vi.fn(),
  useRemoveCategoryMutation: vi.fn(),
}));
vi.mock('@/features/category-management/category-attribute.api', () => ({
  useListCategoryAttributesQuery: vi.fn(),
  useAddCategoryAttributeMutation: vi.fn(),
  useUpdateCategoryAttributeMutation: vi.fn(),
  useRemoveCategoryAttributeMutation: vi.fn(),
}));

const mockedUseGetCategoryQuery = vi.mocked(useGetCategoryQuery);
const mockedUseUpdateCategoryMutation = vi.mocked(useUpdateCategoryMutation);
const mockedUseReparentCategoryMutation = vi.mocked(useReparentCategoryMutation);
const mockedUseRemoveCategoryMutation = vi.mocked(useRemoveCategoryMutation);
const mockedUseListCategoryAttributesQuery = vi.mocked(useListCategoryAttributesQuery);
const mockedUseAddCategoryAttributeMutation = vi.mocked(useAddCategoryAttributeMutation);
const mockedUseUpdateCategoryAttributeMutation = vi.mocked(useUpdateCategoryAttributeMutation);
const mockedUseRemoveCategoryAttributeMutation = vi.mocked(useRemoveCategoryAttributeMutation);

const mockUpdateCategory = vi.fn();
const mockReparentCategory = vi.fn();
const mockRemoveCategory = vi.fn();
const mockAddAttribute = vi.fn();
const mockUpdateAttribute = vi.fn();
const mockRemoveAttribute = vi.fn();

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

const attribute = (overrides: Partial<AdminCategoryAttribute> = {}): AdminCategoryAttribute => ({
  id: 'attribute-1',
  categoryId: 'category-1',
  key: 'net_weight',
  label: 'Net weight',
  dataType: 'NUMBER',
  isRequired: true,
  unit: 'g',
  options: [],
  position: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const stub = (
  data: AdminCategory | undefined,
  attributes: readonly AdminCategoryAttribute[] = [],
  options: { isLoading?: boolean; isError?: boolean } = {},
): void => {
  for (const mock of [
    mockUpdateCategory,
    mockReparentCategory,
    mockRemoveCategory,
    mockAddAttribute,
    mockUpdateAttribute,
    mockRemoveAttribute,
  ]) {
    mock.mockReset();
  }
  mockedUseGetCategoryQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetCategoryQuery>);
  mockedUseUpdateCategoryMutation.mockReturnValue([
    mockUpdateCategory,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useUpdateCategoryMutation>);
  mockedUseReparentCategoryMutation.mockReturnValue([
    mockReparentCategory,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useReparentCategoryMutation>);
  mockRemoveCategory.mockReturnValue({ data });
  mockedUseRemoveCategoryMutation.mockReturnValue([
    mockRemoveCategory,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useRemoveCategoryMutation>);
  mockedUseListCategoryAttributesQuery.mockReturnValue({
    data: attributes,
    isLoading: false,
    isError: false,
    error: undefined,
  } as unknown as ReturnType<typeof useListCategoryAttributesQuery>);
  mockedUseAddCategoryAttributeMutation.mockReturnValue([
    mockAddAttribute,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useAddCategoryAttributeMutation>);
  mockedUseUpdateCategoryAttributeMutation.mockReturnValue([
    mockUpdateAttribute,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useUpdateCategoryAttributeMutation>);
  mockedUseRemoveCategoryAttributeMutation.mockReturnValue([
    mockRemoveAttribute,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useRemoveCategoryAttributeMutation>);
};

const renderDetail = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/categories/category-1']}>
        <Routes>
          <Route path="/categories/:categoryId" element={<CategoryDetailPage />} />
          <Route path="/categories" element={<p>Categories list</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('CategoryDetailPage', () => {
  it('shows an error state when the category cannot be found', () => {
    stub(undefined, [], { isError: true });
    renderDetail();

    expect(screen.getByRole('alert')).toHaveTextContent('This category could not be found.');
  });

  it('edits name, risk level and requirements, never slug or parentId', async () => {
    stub(category());
    renderDetail();

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Fresh groceries' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(mockUpdateCategory).toHaveBeenCalledWith({
        categoryId: 'category-1',
        body: {
          name: 'Fresh groceries',
          riskLevel: 'LOW',
          requirements: {
            requiresHsn: false,
            requiresCountryOfOrigin: false,
            requiresNetQuantity: false,
          },
          isActive: true,
        },
      }),
    );
  });

  it('never renders a commission-rate field, even though the permission name mentions commission', () => {
    stub(category());
    renderDetail();

    expect(screen.queryByLabelText(/commission/i)).not.toBeInTheDocument();
  });

  it('moves a category under a new parent as a separate action, not a field on the edit form', () => {
    stub(category());
    renderDetail();

    fireEvent.change(screen.getByLabelText('New parent category id'), {
      target: { value: 'category-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move under parent' }));

    expect(mockReparentCategory).toHaveBeenCalledWith({
      categoryId: 'category-1',
      body: { parentId: 'category-2' },
    });
  });

  it('makes a category root via a dedicated action, sending parentId null', () => {
    stub(category({ parentId: 'category-0' }));
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Make root category' }));

    expect(mockReparentCategory).toHaveBeenCalledWith({
      categoryId: 'category-1',
      body: { parentId: null },
    });
  });

  it('deletes the category and navigates back to the list', async () => {
    stub(category());
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Delete category' }));

    expect(mockRemoveCategory).toHaveBeenCalledWith('category-1');
    expect(await screen.findByText('Categories list')).toBeInTheDocument();
  });
});

// A sibling top-level block rather than a nested one, mirroring
// `RegisterPage.test.tsx`'s own reasoning: the single describe would
// otherwise exceed this repository's function-length budget.
describe('CategoryDetailPage attribute management', () => {
  it('lists existing attributes with their type and unit', () => {
    stub(category(), [attribute({ label: 'Net weight', unit: 'g' })]);
    renderDetail();

    expect(
      screen.getByText((_, element) => element?.textContent === 'Net weight (net_weight)'),
    ).toBeInTheDocument();
    expect(screen.getByText('NUMBER · g')).toBeInTheDocument();
  });

  it('adds a NUMBER attribute with an optional unit', async () => {
    stub(category());
    mockAddAttribute.mockReturnValue({});
    renderDetail();

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'net_weight' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Net weight' } });
    fireEvent.change(screen.getByLabelText('Data type'), { target: { value: 'NUMBER' } });
    fireEvent.change(screen.getByLabelText('Unit (optional)'), { target: { value: 'g' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }));

    await waitFor(() =>
      expect(mockAddAttribute).toHaveBeenCalledWith({
        categoryId: 'category-1',
        body: {
          key: 'net_weight',
          label: 'Net weight',
          isRequired: false,
          position: 0,
          dataType: 'NUMBER',
          unit: 'g',
        },
      }),
    );
  });

  it('adds an ENUM attribute with parsed options, never fewer than one', async () => {
    stub(category());
    mockAddAttribute.mockReturnValue({});
    renderDetail();

    fireEvent.change(screen.getByLabelText('Key'), { target: { value: 'size' } });
    fireEvent.change(screen.getByLabelText('Label'), { target: { value: 'Size' } });
    fireEvent.change(screen.getByLabelText('Data type'), { target: { value: 'ENUM' } });
    fireEvent.change(screen.getByLabelText('Options'), {
      target: { value: 'Small, Medium, Large' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }));

    await waitFor(() =>
      expect(mockAddAttribute).toHaveBeenCalledWith({
        categoryId: 'category-1',
        body: {
          key: 'size',
          label: 'Size',
          isRequired: false,
          position: 0,
          dataType: 'ENUM',
          options: ['Small', 'Medium', 'Large'],
        },
      }),
    );
  });

  it('removes an attribute', () => {
    stub(category(), [attribute()]);
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    expect(mockRemoveAttribute).toHaveBeenCalledWith({
      categoryId: 'category-1',
      attributeId: 'attribute-1',
    });
  });

  it('edits an attribute label, position and required flag, but never its key or data type', async () => {
    stub(category(), [attribute()]);
    mockUpdateAttribute.mockReturnValue({});
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const [rowLabelInput] = screen.getAllByLabelText('Label');
    if (!rowLabelInput) throw new Error('Expected the attribute row to render a Label input.');
    fireEvent.change(rowLabelInput, { target: { value: 'Weight (net)' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateAttribute).toHaveBeenCalledWith({
        categoryId: 'category-1',
        attributeId: 'attribute-1',
        body: { label: 'Weight (net)', isRequired: true, position: 0 },
      }),
    );
  });
});
