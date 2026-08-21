import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PublicCategoryNode, VendorProduct } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { VendorProductEditPage } from '@/pages/VendorProductEditPage';
import { useGetCategoryTreeQuery } from '@/features/catalogue/catalogue.api';
import {
  useDeleteProductMutation,
  useGetProductQuery,
  useSubmitProductMutation,
  useUpdateProductMutation,
} from '@/features/vendor-product/vendor-product.api';
import {
  useAddVariantMutation,
  useListVariantsQuery,
} from '@/features/vendor-product/vendor-product-variant.api';
import {
  useCompleteMediaUploadMutation,
  useCreateMediaUploadIntentMutation,
  useDeleteMediaMutation,
  useListMediaQuery,
} from '@/features/vendor-product/vendor-product-media.api';

vi.mock('@/features/catalogue/catalogue.api', () => ({ useGetCategoryTreeQuery: vi.fn() }));
vi.mock('@/features/vendor-product/vendor-product.api', () => ({
  useGetProductQuery: vi.fn(),
  useUpdateProductMutation: vi.fn(),
  useDeleteProductMutation: vi.fn(),
  useSubmitProductMutation: vi.fn(),
}));
vi.mock('@/features/vendor-product/vendor-product-variant.api', () => ({
  useListVariantsQuery: vi.fn(),
  useAddVariantMutation: vi.fn(),
  useUpdateVariantMutation: vi.fn(),
  useDeleteVariantMutation: vi.fn(),
}));
vi.mock('@/features/vendor-product/vendor-inventory.api', () => ({
  useGetInventoryQuery: vi.fn(),
  useSetInventoryMutation: vi.fn(),
}));
vi.mock('@/features/vendor-product/vendor-product-media.api', () => ({
  useListMediaQuery: vi.fn(),
  useCreateMediaUploadIntentMutation: vi.fn(),
  useCompleteMediaUploadMutation: vi.fn(),
  useDeleteMediaMutation: vi.fn(),
}));

const mockedUseGetCategoryTreeQuery = vi.mocked(useGetCategoryTreeQuery);
const mockedUseGetProductQuery = vi.mocked(useGetProductQuery);
const mockedUseUpdateProductMutation = vi.mocked(useUpdateProductMutation);
const mockedUseDeleteProductMutation = vi.mocked(useDeleteProductMutation);
const mockedUseSubmitProductMutation = vi.mocked(useSubmitProductMutation);
const mockedUseListVariantsQuery = vi.mocked(useListVariantsQuery);
const mockedUseAddVariantMutation = vi.mocked(useAddVariantMutation);
const mockedUseListMediaQuery = vi.mocked(useListMediaQuery);
const mockedUseCreateMediaUploadIntentMutation = vi.mocked(useCreateMediaUploadIntentMutation);
const mockedUseCompleteMediaUploadMutation = vi.mocked(useCompleteMediaUploadMutation);
const mockedUseDeleteMediaMutation = vi.mocked(useDeleteMediaMutation);

const mockUpdateProduct = vi.fn();
const mockDeleteProduct = vi.fn();
const mockSubmitProduct = vi.fn();

const CATEGORY_ID = '11111111-1111-7111-8111-111111111111';

const product = (overrides: Partial<VendorProduct> = {}): VendorProduct => ({
  id: 'product-1',
  categoryId: CATEGORY_ID,
  name: 'Fresh apples',
  brand: null,
  description: null,
  hsnCode: null,
  countryOfOrigin: null,
  netQuantity: null,
  attributeValues: {},
  status: 'DRAFT',
  rejectionReason: null,
  rejectionNote: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const CATEGORIES: PublicCategoryNode[] = [
  { id: CATEGORY_ID, parentId: null, name: 'Groceries', slug: 'groceries', children: [] },
];

interface StubOptions {
  readonly product?: VendorProduct;
  readonly isLoading?: boolean;
  readonly isError?: boolean;
  readonly categoriesLoading?: boolean;
  readonly saveError?: unknown;
}

const stub = (options: StubOptions = {}): void => {
  mockUpdateProduct.mockReset();
  mockDeleteProduct.mockReset();
  mockSubmitProduct.mockReset();

  mockedUseGetProductQuery.mockReturnValue({
    data:
      options.isLoading === true || options.isError === true
        ? undefined
        : (options.product ?? product()),
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetProductQuery>);

  mockedUseGetCategoryTreeQuery.mockReturnValue({
    data: options.categoriesLoading === true ? undefined : CATEGORIES,
    isLoading: options.categoriesLoading ?? false,
  } as unknown as ReturnType<typeof useGetCategoryTreeQuery>);

  mockUpdateProduct.mockReturnValue({ unwrap: () => Promise.resolve(product()) });
  mockedUseUpdateProductMutation.mockReturnValue([
    mockUpdateProduct,
    { isLoading: false, error: options.saveError },
  ] as unknown as ReturnType<typeof useUpdateProductMutation>);

  mockDeleteProduct.mockReturnValue({ unwrap: () => Promise.resolve(product()) });
  mockedUseDeleteProductMutation.mockReturnValue([
    mockDeleteProduct,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useDeleteProductMutation>);

  mockSubmitProduct.mockReturnValue({ unwrap: () => Promise.resolve(product()) });
  mockedUseSubmitProductMutation.mockReturnValue([
    mockSubmitProduct,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useSubmitProductMutation>);

  mockedUseListVariantsQuery.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: undefined,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useListVariantsQuery>);
  mockedUseAddVariantMutation.mockReturnValue([
    vi.fn(),
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useAddVariantMutation>);

  mockedUseListMediaQuery.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    error: undefined,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useListMediaQuery>);
  mockedUseCreateMediaUploadIntentMutation.mockReturnValue([
    vi.fn(),
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useCreateMediaUploadIntentMutation>);
  mockedUseCompleteMediaUploadMutation.mockReturnValue([
    vi.fn(),
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useCompleteMediaUploadMutation>);
  mockedUseDeleteMediaMutation.mockReturnValue([
    vi.fn(),
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useDeleteMediaMutation>);
};

const renderPage = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/products/product-1']}>
        <Routes>
          <Route path="/products/:id" element={<VendorProductEditPage />} />
          <Route path="/products" element={<p>Products list page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('VendorProductEditPage', () => {
  it('shows a loading state before the product arrives', () => {
    stub({ isLoading: true });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Edit product' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Product name')).not.toBeInTheDocument();
  });

  it('surfaces a load failure', () => {
    stub({ isError: true });
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('This product could not be found.');
  });

  it('populates the form from the loaded product', () => {
    stub({ product: product({ name: 'Fresh apples', brand: 'Local Farms' }) });
    renderPage();

    expect(screen.getByLabelText('Product name')).toHaveValue('Fresh apples');
    expect(screen.getByLabelText('Brand (optional)')).toHaveValue('Local Farms');
  });

  it('disables the category select while categories load', () => {
    stub({ categoriesLoading: true });
    renderPage();

    expect(screen.getByLabelText('Category')).toBeDisabled();
  });

  it('saves edited product details', async () => {
    stub();
    renderPage();

    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Updated name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(mockUpdateProduct).toHaveBeenCalled());
    const call = mockUpdateProduct.mock.calls[0]?.[0] as {
      productId: string;
      body: { name: string };
    };
    expect(call.productId).toBe('product-1');
    expect(call.body.name).toBe('Updated name');
  });

  it('confirms a successful save', async () => {
    stub();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Product details saved.'),
    );
  });

  it('surfaces a save error without claiming success', () => {
    stub({
      saveError: {
        status: 500,
        data: {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'boom',
            requestId: 'req-1',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });

  it('shows a submit-for-review action for a DRAFT product', () => {
    stub({ product: product({ status: 'DRAFT' }) });
    renderPage();

    expect(screen.getByRole('button', { name: 'Submit for review' })).toBeInTheDocument();
  });

  it('does not show a submit-for-review action for an APPROVED product', () => {
    stub({ product: product({ status: 'APPROVED' }) });
    renderPage();

    expect(screen.queryByRole('button', { name: 'Submit for review' })).not.toBeInTheDocument();
  });

  it('submits the product for review', async () => {
    stub({ product: product({ status: 'DRAFT' }) });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));

    await waitFor(() => expect(mockSubmitProduct).toHaveBeenCalledWith('product-1'));
  });

  it('deletes the product and returns to the list', async () => {
    stub();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Delete product' }));

    await waitFor(() => expect(mockDeleteProduct).toHaveBeenCalledWith('product-1'));
    expect(await screen.findByText('Products list page')).toBeInTheDocument();
  });

  it('shows the rejection reason for a REJECTED product', () => {
    stub({
      product: product({
        status: 'REJECTED',
        rejectionReason: 'POLICY_VIOLATION',
        rejectionNote: 'Contains a banned ingredient.',
      }),
    });
    renderPage();

    expect(screen.getByText('This product was rejected')).toBeInTheDocument();
    expect(screen.getByText('Contains a banned ingredient.')).toBeInTheDocument();
  });
});
