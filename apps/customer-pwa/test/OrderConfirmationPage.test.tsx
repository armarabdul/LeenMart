import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  OrderItemResponse,
  OrderResponse,
  OrderStatusDto,
  SubOrderResponse,
} from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { OrderConfirmationPage } from '@/pages/OrderConfirmationPage';
import { useCancelOrderMutation, useGetOrderQuery } from '@/features/checkout/checkout.api';
import {
  useConfirmPaymentMutation,
  useInitiatePaymentMutation,
} from '@/features/payment/payment.api';

vi.mock('@/features/checkout/checkout.api', () => ({
  useGetOrderQuery: vi.fn(),
  useCancelOrderMutation: vi.fn(),
}));
vi.mock('@/features/payment/payment.api', () => ({
  useInitiatePaymentMutation: vi.fn(),
  useConfirmPaymentMutation: vi.fn(),
}));

const mockedUseGetOrderQuery = vi.mocked(useGetOrderQuery);
const mockedUseCancelOrderMutation = vi.mocked(useCancelOrderMutation);
const mockedUseInitiatePaymentMutation = vi.mocked(useInitiatePaymentMutation);
const mockedUseConfirmPaymentMutation = vi.mocked(useConfirmPaymentMutation);

const orderItem = (overrides: Partial<OrderItemResponse> = {}): OrderItemResponse => ({
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
  ...overrides,
});

const subOrder = (overrides: Partial<SubOrderResponse> = {}): SubOrderResponse => ({
  id: 'sub-order-1',
  vendorShopName: 'Ratnagiri Orchards',
  status: 'PENDING_PAYMENT',
  totalAmount: { amount: '19800', currency: 'INR' },
  items: [orderItem()],
  ...overrides,
});

const order = (overrides: Partial<OrderResponse> = {}): OrderResponse => ({
  id: 'order-1',
  status: 'PENDING_PAYMENT',
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
  subOrders: [subOrder()],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderOrderPage = (
  data: OrderResponse | undefined,
  options: {
    isLoading?: boolean;
    isError?: boolean;
    cancelOrder?: ReturnType<typeof vi.fn>;
    cancelState?: { isLoading?: boolean; error?: unknown };
  } = {},
): { cancelOrder: ReturnType<typeof vi.fn> } => {
  const cancelOrder = options.cancelOrder ?? vi.fn();
  mockedUseGetOrderQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetOrderQuery>);
  mockedUseCancelOrderMutation.mockReturnValue([
    cancelOrder,
    { isLoading: options.cancelState?.isLoading ?? false, error: options.cancelState?.error },
  ] as unknown as ReturnType<typeof useCancelOrderMutation>);
  mockedUseInitiatePaymentMutation.mockReturnValue([
    vi.fn(),
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useInitiatePaymentMutation>);
  mockedUseConfirmPaymentMutation.mockReturnValue([
    vi.fn(),
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useConfirmPaymentMutation>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/orders/order-1']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderConfirmationPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

  return { cancelOrder };
};

describe('OrderConfirmationPage', () => {
  it('shows an error state when the order cannot be found', () => {
    renderOrderPage(undefined, { isError: true });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it("renders every figure from the order's own snapshot", () => {
    renderOrderPage(order());

    expect(screen.getByText(/Alphonso Mango — 500 g pack/)).toBeInTheDocument();
    expect(screen.getByText('Sold by Ratnagiri Orchards')).toBeInTheDocument();
    expect(screen.getByText(/Total: ₹198\.00/)).toBeInTheDocument();
  });

  it('shows an honest "GST to be confirmed" label rather than a fabricated tax figure', () => {
    renderOrderPage(order());

    expect(screen.getByText('GST to be confirmed')).toBeInTheDocument();
  });

  it('shows the resolved tax amount when the backend has resolved it', () => {
    renderOrderPage(
      order({
        subOrders: [
          subOrder({
            items: [
              orderItem({
                tax: {
                  resolved: true,
                  rateBasisPoints: 500,
                  amount: { amount: '990', currency: 'INR' },
                },
              }),
            ],
          }),
        ],
      }),
    );

    expect(screen.getByText(/GST: ₹9\.90/)).toBeInTheDocument();
  });

  it('shows the test payment panel, honestly labelled as test mode, while payment is pending', () => {
    renderOrderPage(order({ status: 'PENDING_PAYMENT' }));

    expect(screen.getByText('Payment — TEST / DEMO mode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start test payment' })).toBeInTheDocument();
  });

  it('does not show the payment panel once the order is confirmed', () => {
    renderOrderPage(order({ status: 'CONFIRMED' }));

    expect(screen.queryByText('Payment — TEST / DEMO mode')).not.toBeInTheDocument();
  });

  it("renders the order's delivery address snapshot", () => {
    renderOrderPage(order());

    expect(screen.getByText(/Asha Rao/)).toBeInTheDocument();
    expect(screen.getByText(/221B Baker Street/)).toBeInTheDocument();
  });

  describe('cancel order (S3-4)', () => {
    const cancellableStatuses: OrderStatusDto[] = ['PENDING_PAYMENT', 'CONFIRMED'];
    const nonCancellableStatuses: OrderStatusDto[] = ['PROCESSING', 'CANCELLED'];

    it.each(cancellableStatuses)('shows the cancel button while the order is %s', (status) => {
      renderOrderPage(order({ status }));

      expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
    });

    it.each(nonCancellableStatuses)('hides the cancel button once the order is %s', (status) => {
      renderOrderPage(order({ status }));

      expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    });

    it('shows a loading state while cancelling', () => {
      renderOrderPage(order({ status: 'PENDING_PAYMENT' }), {
        cancelState: { isLoading: true },
      });

      expect(screen.getByRole('button', { name: 'Cancelling…' })).toBeDisabled();
    });

    it('calls the cancel mutation with the order id on click', () => {
      const { cancelOrder } = renderOrderPage(order({ status: 'PENDING_PAYMENT' }));
      cancelOrder.mockReturnValue({
        unwrap: () => Promise.resolve(order({ status: 'CANCELLED' })),
      });

      fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));

      expect(cancelOrder).toHaveBeenCalledWith('order-1');
    });

    it('surfaces a cancellation error without claiming the order was cancelled', async () => {
      const { cancelOrder } = renderOrderPage(order({ status: 'PENDING_PAYMENT' }), {
        cancelState: {
          error: {
            status: 422,
            data: {
              error: {
                code: 'ORDER_CANCELLATION_NOT_ALLOWED',
                message: 'This order can no longer be cancelled.',
              },
            },
          },
        },
      });
      cancelOrder.mockReturnValue({
        unwrap: () =>
          Promise.reject(
            Object.assign(new Error('rejected'), {
              status: 422,
              data: {
                error: {
                  code: 'ORDER_CANCELLATION_NOT_ALLOWED',
                  message: 'This order can no longer be cancelled.',
                },
              },
            }),
          ),
      });

      fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));

      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
      expect(screen.getByRole('alert')).toHaveTextContent('This order can no longer be cancelled.');
    });
  });
});
