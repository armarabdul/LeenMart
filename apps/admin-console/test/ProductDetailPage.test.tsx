import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AdminProductDetail } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { ProductDetailPage } from '@/pages/ProductDetailPage';
import {
  useDecideProductMutation,
  useGetProductSubmissionQuery,
} from '@/features/product-moderation/product-moderation.api';

vi.mock('@/features/product-moderation/product-moderation.api', () => ({
  useGetProductSubmissionQuery: vi.fn(),
  useDecideProductMutation: vi.fn(),
}));

const mockedUseGetProductSubmissionQuery = vi.mocked(useGetProductSubmissionQuery);
const mockedUseDecideProductMutation = vi.mocked(useDecideProductMutation);
const mockDecideProduct = vi.fn();

const detail = (overrides: Partial<AdminProductDetail> = {}): AdminProductDetail => ({
  productId: 'product-1',
  vendorId: 'vendor-1',
  categoryId: 'category-1',
  name: 'Fresh apples',
  brand: 'Local Farms',
  description: 'Crisp red apples.',
  hsnCode: '0808',
  countryOfOrigin: 'IN',
  netQuantity: '1 kg',
  attributeValues: {},
  status: 'PENDING_REVIEW',
  rejectionReason: null,
  rejectionNote: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const stub = (
  data: AdminProductDetail | undefined,
  options: { isLoading?: boolean; isError?: boolean } = {},
): void => {
  mockDecideProduct.mockReset();
  mockedUseGetProductSubmissionQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetProductSubmissionQuery>);
  mockedUseDecideProductMutation.mockReturnValue([
    mockDecideProduct,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useDecideProductMutation>);
};

const renderDetail = (): void => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/product-moderation/product-1']}>
        <Routes>
          <Route path="/product-moderation/:productId" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
};

describe('ProductDetailPage', () => {
  it('shows an error state when the product cannot be found', () => {
    stub(undefined, { isError: true });
    renderDetail();

    expect(screen.getByRole('alert')).toHaveTextContent('This product could not be found.');
  });

  it('shows the product identity and compliance fields the contract actually provides', () => {
    stub(detail());
    renderDetail();

    expect(screen.getByText('Fresh apples')).toBeInTheDocument();
    expect(screen.getByText('Local Farms')).toBeInTheDocument();
    expect(screen.getByText('0808')).toBeInTheDocument();
    expect(screen.getByText('Crisp red apples.')).toBeInTheDocument();
  });

  it('offers the decision form only while the product is pending review', () => {
    stub(detail({ status: 'PENDING_REVIEW' }));
    renderDetail();

    expect(screen.getByText('Decision')).toBeInTheDocument();
  });

  it('does not offer a decision form for an already-decided product', () => {
    stub(detail({ status: 'APPROVED' }));
    renderDetail();

    expect(screen.queryByText('Decision')).not.toBeInTheDocument();
  });

  it('approves with only a decision field', () => {
    stub(detail());
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(mockDecideProduct).toHaveBeenCalledWith({
      productId: 'product-1',
      body: { decision: 'APPROVE' },
    });
  });

  it('rejects using the product rejection vocabulary, distinct from the KYC one', () => {
    stub(detail());
    renderDetail();

    fireEvent.change(screen.getByLabelText('Rejection reason'), {
      target: { value: 'MISLEADING_LISTING' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(mockDecideProduct).toHaveBeenCalledWith({
      productId: 'product-1',
      body: { decision: 'REJECT', reason: 'MISLEADING_LISTING' },
    });
    expect(screen.queryByText('DOCUMENT_UNCLEAR')).not.toBeInTheDocument();
  });

  it('shows the rejection reason and note for a rejected product', () => {
    stub(
      detail({
        status: 'REJECTED',
        rejectionReason: 'POLICY_VIOLATION',
        rejectionNote: 'Banned item',
      }),
    );
    renderDetail();

    expect(screen.getByText('This product was rejected')).toBeInTheDocument();
    expect(screen.getByText('Banned item')).toBeInTheDocument();
  });
});
