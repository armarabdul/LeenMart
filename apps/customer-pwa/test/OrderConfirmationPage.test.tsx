import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OrderItemResponse, OrderResponse, SubOrderResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { OrderConfirmationPage } from '@/pages/OrderConfirmationPage';
import { useGetOrderQuery } from '@/features/checkout/checkout.api';

vi.mock('@/features/checkout/checkout.api', () => ({ useGetOrderQuery: vi.fn() }));

const mockedUseGetOrderQuery = vi.mocked(useGetOrderQuery);

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
  options: { isLoading?: boolean; isError?: boolean } = {},
): void => {
  mockedUseGetOrderQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetOrderQuery>);

  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/orders/order-1']}>
        <Routes>
          <Route path="/orders/:id" element={<OrderConfirmationPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );
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

  it('shows a payment-pending banner honestly labelled as test mode', () => {
    renderOrderPage(order({ status: 'PENDING_PAYMENT' }));

    expect(screen.getByText(/no real charge was made/)).toBeInTheDocument();
  });

  it('does not show the payment-pending banner once the order is confirmed', () => {
    renderOrderPage(order({ status: 'CONFIRMED' }));

    expect(screen.queryByText(/no real charge was made/)).not.toBeInTheDocument();
  });

  it("renders the order's delivery address snapshot", () => {
    renderOrderPage(order());

    expect(screen.getByText(/Asha Rao/)).toBeInTheDocument();
    expect(screen.getByText(/221B Baker Street/)).toBeInTheDocument();
  });
});
