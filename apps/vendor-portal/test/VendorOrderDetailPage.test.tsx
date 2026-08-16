import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OrderStatusDto, VendorSubOrderResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { VendorOrderDetailPage } from '@/pages/VendorOrderDetailPage';
import {
  useGetVendorOrderQuery,
  useStartProcessingMutation,
} from '@/features/vendor-order/vendor-order.api';

vi.mock('@/features/vendor-order/vendor-order.api', () => ({
  useGetVendorOrderQuery: vi.fn(),
  useStartProcessingMutation: vi.fn(),
}));

const mockedUseGetVendorOrderQuery = vi.mocked(useGetVendorOrderQuery);
const mockedUseStartProcessingMutation = vi.mocked(useStartProcessingMutation);

const order = (overrides: Partial<VendorSubOrderResponse> = {}): VendorSubOrderResponse => ({
  id: 'sub-order-1',
  orderId: 'order-1',
  status: 'CONFIRMED',
  totalAmount: { amount: '19800', currency: 'INR' },
  address: {
    recipientName: 'Asha Rao',
    phone: '+919876543210',
    line1: '221B Baker Street',
    line2: null,
    city: 'Bengaluru',
    state: 'Karnataka',
    pincode: '560001',
    landmark: null,
    label: 'Home',
  },
  items: [
    {
      id: 'item-1',
      productId: 'product-1',
      variantId: 'variant-1',
      productName: 'Alphonso Mango',
      variantName: '500 g pack',
      vendorShopName: 'Ratnagiri Orchards',
      unitOfMeasure: 'g',
      quantity: 2,
      unitPrice: { amount: '9900', currency: 'INR' },
      lineAmount: { amount: '19800', currency: 'INR' },
      hsnCode: '08045020',
      tax: { resolved: false },
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderOrderPage = (
  data: VendorSubOrderResponse | undefined,
  options: {
    isLoading?: boolean;
    isError?: boolean;
    startProcessing?: ReturnType<typeof vi.fn>;
    startState?: { isLoading?: boolean; error?: unknown };
  } = {},
): { startProcessing: ReturnType<typeof vi.fn> } => {
  const startProcessing = options.startProcessing ?? vi.fn();
  mockedUseGetVendorOrderQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetVendorOrderQuery>);
  mockedUseStartProcessingMutation.mockReturnValue([
    startProcessing,
    { isLoading: options.startState?.isLoading ?? false, error: options.startState?.error },
  ] as unknown as ReturnType<typeof useStartProcessingMutation>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/orders/sub-order-1']}>
        <Routes>
          <Route path="/orders/:id" element={<VendorOrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

  return { startProcessing };
};

describe('VendorOrderDetailPage', () => {
  it('shows an error state when the order cannot be found', () => {
    renderOrderPage(undefined, { isError: true });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it("renders every figure from the sub-order's own snapshot", () => {
    renderOrderPage(order());

    expect(screen.getByText(/Alphonso Mango — 500 g pack/)).toBeInTheDocument();
    expect(screen.getByText(/Total: ₹198\.00/)).toBeInTheDocument();
    expect(screen.getByText(/Asha Rao/)).toBeInTheDocument();
    expect(screen.getByText(/221B Baker Street/)).toBeInTheDocument();
  });

  describe('Start Processing (S3-5, accept/process only)', () => {
    const visibleStatuses: OrderStatusDto[] = ['CONFIRMED'];
    const hiddenStatuses: OrderStatusDto[] = ['PENDING_PAYMENT', 'PROCESSING', 'CANCELLED'];

    it.each(visibleStatuses)('shows Start processing while the order is %s', (status) => {
      renderOrderPage(order({ status }));

      expect(screen.getByRole('button', { name: 'Start processing' })).toBeInTheDocument();
    });

    it.each(hiddenStatuses)('hides Start processing once the order is %s', (status) => {
      renderOrderPage(order({ status }));

      expect(screen.queryByRole('button', { name: 'Start processing' })).not.toBeInTheDocument();
    });

    it('shows a loading state while starting', () => {
      renderOrderPage(order({ status: 'CONFIRMED' }), { startState: { isLoading: true } });

      expect(screen.getByRole('button', { name: 'Starting…' })).toBeDisabled();
    });

    it('calls the mutation with the sub-order id on click', () => {
      const { startProcessing } = renderOrderPage(order({ status: 'CONFIRMED' }));
      startProcessing.mockReturnValue({
        unwrap: () => Promise.resolve(order({ status: 'PROCESSING' })),
      });

      fireEvent.click(screen.getByRole('button', { name: 'Start processing' }));

      expect(startProcessing).toHaveBeenCalledWith('sub-order-1');
    });

    it('surfaces an error without claiming the order was started', async () => {
      const { startProcessing } = renderOrderPage(order({ status: 'CONFIRMED' }), {
        startState: {
          error: {
            status: 422,
            data: {
              error: {
                code: 'ORDER_INVALID_STATUS_TRANSITION',
                message: 'Cannot start this order.',
              },
            },
          },
        },
      });
      startProcessing.mockReturnValue({
        unwrap: () =>
          Promise.reject(
            Object.assign(new Error('rejected'), {
              status: 422,
              data: {
                error: {
                  code: 'ORDER_INVALID_STATUS_TRANSITION',
                  message: 'Cannot start this order.',
                },
              },
            }),
          ),
      });

      fireEvent.click(screen.getByRole('button', { name: 'Start processing' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByRole('alert')).toHaveTextContent('Cannot start this order.');
    });
  });
});
