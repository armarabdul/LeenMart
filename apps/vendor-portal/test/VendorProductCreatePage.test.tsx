import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CreateProductRequest, PublicCategoryNode } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { VendorProductCreatePage } from '@/pages/VendorProductCreatePage';
import { useGetCategoryTreeQuery } from '@/features/catalogue/catalogue.api';
import { useCreateProductMutation } from '@/features/vendor-product/vendor-product.api';

vi.mock('@/features/catalogue/catalogue.api', () => ({ useGetCategoryTreeQuery: vi.fn() }));
vi.mock('@/features/vendor-product/vendor-product.api', () => ({
  useCreateProductMutation: vi.fn(),
}));

const mockedUseGetCategoryTreeQuery = vi.mocked(useGetCategoryTreeQuery);
const mockedUseCreateProductMutation = vi.mocked(useCreateProductMutation);
const mockCreateProduct = vi.fn();

const CATEGORY_ID = '11111111-1111-7111-8111-111111111111';
const CATEGORIES: PublicCategoryNode[] = [
  { id: CATEGORY_ID, parentId: null, name: 'Groceries', slug: 'groceries', children: [] },
];

interface StubOptions {
  readonly categoriesLoading?: boolean;
  readonly isSaving?: boolean;
  readonly saveError?: unknown;
  readonly createRejects?: boolean;
}

const stub = (options: StubOptions = {}): void => {
  mockCreateProduct.mockReset();
  mockedUseGetCategoryTreeQuery.mockReturnValue({
    data: options.categoriesLoading === true ? undefined : CATEGORIES,
    isLoading: options.categoriesLoading ?? false,
  } as unknown as ReturnType<typeof useGetCategoryTreeQuery>);
  mockCreateProduct.mockReturnValue({
    unwrap: () =>
      options.createRejects === true
        ? Promise.reject(Object.assign(new Error('nope'), { status: 400 }))
        : Promise.resolve({ product: { id: 'product-1' } }),
  });
  mockedUseCreateProductMutation.mockReturnValue([
    mockCreateProduct,
    { isLoading: options.isSaving ?? false, error: options.saveError },
  ] as unknown as ReturnType<typeof useCreateProductMutation>);
};

const renderPage = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/products/new']}>
        <Routes>
          <Route path="/products/new" element={<VendorProductCreatePage />} />
          <Route path="/products/:id" element={<p>Product edit page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

const fillValid = (): void => {
  fireEvent.change(screen.getByLabelText('Category'), { target: { value: CATEGORY_ID } });
  fireEvent.change(screen.getByLabelText('Product name'), {
    target: { value: 'Fresh apples' },
  });
  fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 'SKU-001' } });
  fireEvent.change(screen.getByLabelText('Variant name'), {
    target: { value: '1 kg pack' },
  });
  fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '99.00' } });
  fireEvent.change(screen.getByLabelText('Unit of measure'), { target: { value: 'kg' } });
  fireEvent.change(screen.getByLabelText('Quantity step'), { target: { value: '1' } });
};

describe('VendorProductCreatePage', () => {
  it('shows a loading state for the category select while categories load', () => {
    stub({ categoriesLoading: true });
    renderPage();

    expect(screen.getByLabelText('Category')).toBeDisabled();
  });

  it('lists the categories from the real category tree, not a hardcoded list', () => {
    stub();
    renderPage();

    expect(screen.getByRole('option', { name: 'Groceries' })).toBeInTheDocument();
  });

  it('rejects an empty submission with inline errors and never calls the API', () => {
    stub();
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Create product' }));

    expect(screen.getByText('Invalid uuid')).toBeInTheDocument();
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it('rejects an invalid price and never calls the API', () => {
    stub();
    renderPage();

    fireEvent.change(screen.getByLabelText('Category'), { target: { value: CATEGORY_ID } });
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Fresh apples' },
    });
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 'SKU-001' } });
    fireEvent.change(screen.getByLabelText('Variant name'), { target: { value: '1 kg pack' } });
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: 'not-a-price' } });
    fireEvent.change(screen.getByLabelText('Unit of measure'), { target: { value: 'kg' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create product' }));

    expect(screen.getByText('Enter a valid amount, e.g. 99.00')).toBeInTheDocument();
    expect(mockCreateProduct).not.toHaveBeenCalled();
  });

  it('converts rupees to integer minor-unit paise before submitting', async () => {
    stub();
    renderPage();

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Create product' }));

    await waitFor(() => expect(mockCreateProduct).toHaveBeenCalled());
    const body = mockCreateProduct.mock.calls[0]?.[0] as CreateProductRequest;
    expect(body.categoryId).toBe(CATEGORY_ID);
    expect(body.name).toBe('Fresh apples');
    expect(body.variant.sku).toBe('SKU-001');
    expect(body.variant.price).toEqual({ amount: '9900', currency: 'INR' });
  });

  it('sends optional fields as null, not empty strings, when left blank', async () => {
    stub();
    renderPage();

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Create product' }));

    await waitFor(() => expect(mockCreateProduct).toHaveBeenCalled());
    const body = mockCreateProduct.mock.calls[0]?.[0] as CreateProductRequest;
    expect(body.brand).toBeNull();
    expect(body.description).toBeNull();
    expect(body.hsnCode).toBeNull();
  });

  it('navigates to the new product edit page on success', async () => {
    stub();
    renderPage();

    fillValid();
    fireEvent.click(screen.getByRole('button', { name: 'Create product' }));

    expect(await screen.findByText('Product edit page')).toBeInTheDocument();
  });

  it('surfaces a server error without claiming success', () => {
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

  it('disables submission while a save is already in flight', () => {
    stub({ isSaving: true });
    renderPage();

    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
  });
});
