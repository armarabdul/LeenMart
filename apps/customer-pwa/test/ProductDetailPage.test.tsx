import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { PublicProductDetail } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { ProductDetailPage } from '@/pages/ProductDetailPage';
import { useGetProductDetailQuery } from '@/features/product/product.api';

vi.mock('@/features/product/product.api', () => ({
  useGetProductDetailQuery: vi.fn(),
}));

vi.mock('@/features/cart/cart.api', () => ({
  useAddCartItemMutation: () => [vi.fn(), { isLoading: false, error: undefined }],
}));

const mockedUseGetProductDetailQuery = vi.mocked(useGetProductDetailQuery);

const baseProduct: PublicProductDetail = {
  id: 'product-1',
  categoryId: 'category-1',
  name: 'Alphonso Mango',
  brand: 'FarmFresh',
  description: 'Sweet and ripe, hand-picked.',
  hsnCode: '08045020',
  countryOfOrigin: 'IN',
  netQuantity: '1 kg',
  attributeValues: { Ripeness: 'Ready to eat' },
  mediaCount: 2,
  variants: [
    {
      id: 'variant-1',
      name: '500 g pack',
      price: { amount: '9900', currency: 'INR' },
      unitOfMeasure: 'g',
      quantityStep: 1,
      available: 10,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const renderPage = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/products/product-1']}>
        <Routes>
          <Route path="/products/:id" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

const queryResult = (
  overrides: Partial<ReturnType<typeof useGetProductDetailQuery>>,
): ReturnType<typeof useGetProductDetailQuery> =>
  ({
    data: undefined,
    isLoading: false,
    isError: false,
    error: undefined,
    ...overrides,
  }) as ReturnType<typeof useGetProductDetailQuery>;

describe('ProductDetailPage', () => {
  it('renders product information: name, brand, description, net quantity, country of origin, attributes', () => {
    mockedUseGetProductDetailQuery.mockReturnValue(queryResult({ data: baseProduct }));
    renderPage();

    expect(screen.getByRole('heading', { name: 'Alphonso Mango' })).toBeInTheDocument();
    expect(screen.getByText('FarmFresh')).toBeInTheDocument();
    expect(screen.getByText('Sweet and ripe, hand-picked.')).toBeInTheDocument();
    expect(screen.getByText('1 kg')).toBeInTheDocument();
    expect(screen.getByText('IN')).toBeInTheDocument();
    expect(screen.getByText('Ripeness')).toBeInTheDocument();
    expect(screen.getByText('Ready to eat')).toBeInTheDocument();
  });

  it('shows an error state when the product cannot be found', () => {
    mockedUseGetProductDetailQuery.mockReturnValue(
      queryResult({ isError: true, error: { status: 404, data: {} } }),
    );
    renderPage();

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('auto-selects the only variant and shows no variant selector', () => {
    mockedUseGetProductDetailQuery.mockReturnValue(queryResult({ data: baseProduct }));
    renderPage();

    expect(screen.queryByText('Choose an option')).not.toBeInTheDocument();
    expect(screen.getByText('₹99.00')).toBeInTheDocument();
  });

  it('shows a variant selector for a multi-variant product and switches price on selection', () => {
    const product: PublicProductDetail = {
      ...baseProduct,
      variants: [
        {
          id: 'small',
          name: 'Small pack',
          price: { amount: '9900', currency: 'INR' },
          unitOfMeasure: 'g',
          quantityStep: 1,
          available: 10,
        },
        {
          id: 'large',
          name: 'Large pack',
          price: { amount: '18900', currency: 'INR' },
          unitOfMeasure: 'kg',
          quantityStep: 1,
          available: 5,
        },
      ],
    };
    mockedUseGetProductDetailQuery.mockReturnValue(queryResult({ data: product }));
    renderPage();

    // The selected variant's price appears both as the headline price and
    // inside its own (now-highlighted) selector button — `getAllByText`
    // tolerates that duplication without asserting exactly how many times.
    expect(screen.getAllByText('₹99.00').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /Large pack/ }));
    expect(screen.getAllByText('₹189.00').length).toBeGreaterThan(0);
  });

  it('does not default-select an unavailable variant when an available one exists', () => {
    const product: PublicProductDetail = {
      ...baseProduct,
      variants: [
        {
          id: 'sold-out',
          name: 'Sold out pack',
          price: { amount: '5000', currency: 'INR' },
          unitOfMeasure: 'g',
          quantityStep: 1,
          available: 0,
        },
        {
          id: 'in-stock',
          name: 'In stock pack',
          price: { amount: '7500', currency: 'INR' },
          unitOfMeasure: 'g',
          quantityStep: 1,
          available: 8,
        },
      ],
    };
    mockedUseGetProductDetailQuery.mockReturnValue(queryResult({ data: product }));
    renderPage();

    // The available variant's price is shown by default, not the sold-out one's.
    expect(screen.getAllByText('₹75.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('₹50.00')).not.toBeInTheDocument();
  });

  it('clearly communicates that the product cannot be added when every variant is unavailable', () => {
    const product: PublicProductDetail = {
      ...baseProduct,
      variants: [{ ...baseProduct.variants[0]!, available: 0 }],
    };
    mockedUseGetProductDetailQuery.mockReturnValue(queryResult({ data: product }));
    renderPage();

    expect(screen.getByText('This option is currently out of stock.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add to cart/i })).not.toBeInTheDocument();
  });

  it('starts the quantity at the variant’s own quantityStep', () => {
    const product: PublicProductDetail = {
      ...baseProduct,
      variants: [{ ...baseProduct.variants[0]!, quantityStep: 5, available: 50 }],
    };
    mockedUseGetProductDetailQuery.mockReturnValue(queryResult({ data: product }));
    renderPage();

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('Sold in steps of 5')).toBeInTheDocument();
  });
});
