import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { OrderStatusDto, VendorSubOrderResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { VendorOrderDetailPage } from '@/pages/VendorOrderDetailPage';
import {
  useDeliverSubOrderMutation,
  useGetVendorOrderQuery,
  useShipSubOrderMutation,
  useStartProcessingMutation,
} from '@/features/vendor-order/vendor-order.api';

vi.mock('@/features/vendor-order/vendor-order.api', () => ({
  useGetVendorOrderQuery: vi.fn(),
  useStartProcessingMutation: vi.fn(),
  useShipSubOrderMutation: vi.fn(),
  useDeliverSubOrderMutation: vi.fn(),
}));

const mockedUseGetVendorOrderQuery = vi.mocked(useGetVendorOrderQuery);
const mockedUseStartProcessingMutation = vi.mocked(useStartProcessingMutation);
const mockedUseShipSubOrderMutation = vi.mocked(useShipSubOrderMutation);
const mockedUseDeliverSubOrderMutation = vi.mocked(useDeliverSubOrderMutation);

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

interface MutationState {
  readonly isLoading?: boolean;
  readonly error?: unknown;
}

/** Fills in the two fields every mocked mutation hook's tuple needs, defaulting both to "idle". */
const mutationTuple = (
  fn: ReturnType<typeof vi.fn>,
  state: MutationState = {},
): [ReturnType<typeof vi.fn>, { isLoading: boolean; error: unknown }] => [
  fn,
  { isLoading: state.isLoading ?? false, error: state.error },
];

interface RenderOrderPageOptions {
  readonly isLoading?: boolean;
  readonly isError?: boolean;
  readonly startProcessing?: ReturnType<typeof vi.fn>;
  readonly startState?: MutationState;
  readonly shipSubOrder?: ReturnType<typeof vi.fn>;
  readonly shipState?: MutationState;
  readonly deliverSubOrder?: ReturnType<typeof vi.fn>;
  readonly deliverState?: MutationState;
}

const renderOrderPage = (
  data: VendorSubOrderResponse | undefined,
  options: RenderOrderPageOptions = {},
): {
  startProcessing: ReturnType<typeof vi.fn>;
  shipSubOrder: ReturnType<typeof vi.fn>;
  deliverSubOrder: ReturnType<typeof vi.fn>;
} => {
  const startProcessing = options.startProcessing ?? vi.fn();
  const shipSubOrder = options.shipSubOrder ?? vi.fn();
  const deliverSubOrder = options.deliverSubOrder ?? vi.fn();
  mockedUseGetVendorOrderQuery.mockReturnValue({
    data,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetVendorOrderQuery>);
  mockedUseStartProcessingMutation.mockReturnValue(
    mutationTuple(startProcessing, options.startState) as unknown as ReturnType<
      typeof useStartProcessingMutation
    >,
  );
  mockedUseShipSubOrderMutation.mockReturnValue(
    mutationTuple(shipSubOrder, options.shipState) as unknown as ReturnType<
      typeof useShipSubOrderMutation
    >,
  );
  mockedUseDeliverSubOrderMutation.mockReturnValue(
    mutationTuple(deliverSubOrder, options.deliverState) as unknown as ReturnType<
      typeof useDeliverSubOrderMutation
    >,
  );

  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={['/orders/sub-order-1']}>
        <Routes>
          <Route path="/orders/:id" element={<VendorOrderDetailPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

  return { startProcessing, shipSubOrder, deliverSubOrder };
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
    const hiddenStatuses: OrderStatusDto[] = [
      'PENDING_PAYMENT',
      'PROCESSING',
      'SHIPPED',
      'DELIVERED',
      'CANCELLED',
    ];

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

// Top-level siblings, not nested under `describe('VendorOrderDetailPage', ...)`
// above — this file's own `max-lines-per-function` budget (120, the React
// preset's own override of the base test-file exemption) is a per-function
// count, and one outer describe covering every fulfilment action would blow
// well past it. Each action gets its own top-level describe instead,
// mirroring how `Start Processing` above already earned its place inside the
// (still comfortably small) outer one.
describe('Mark Shipped (S3-6)', () => {
  const visibleStatuses: OrderStatusDto[] = ['PROCESSING'];
  const hiddenStatuses: OrderStatusDto[] = [
    'PENDING_PAYMENT',
    'CONFIRMED',
    'SHIPPED',
    'DELIVERED',
    'CANCELLED',
  ];

  it.each(visibleStatuses)('shows Mark shipped while the order is %s', (status) => {
    renderOrderPage(order({ status }));

    expect(screen.getByRole('button', { name: 'Mark shipped' })).toBeInTheDocument();
  });

  it.each(hiddenStatuses)('hides Mark shipped once the order is %s', (status) => {
    renderOrderPage(order({ status }));

    expect(screen.queryByRole('button', { name: 'Mark shipped' })).not.toBeInTheDocument();
  });

  it('shows a loading state while marking shipped', () => {
    renderOrderPage(order({ status: 'PROCESSING' }), { shipState: { isLoading: true } });

    expect(screen.getByRole('button', { name: 'Marking shipped…' })).toBeDisabled();
  });

  it('calls the mutation with the sub-order id on click', () => {
    const { shipSubOrder } = renderOrderPage(order({ status: 'PROCESSING' }));
    shipSubOrder.mockReturnValue({
      unwrap: () => Promise.resolve(order({ status: 'SHIPPED' })),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mark shipped' }));

    expect(shipSubOrder).toHaveBeenCalledWith('sub-order-1');
  });

  it('surfaces an error without claiming the order was shipped', async () => {
    const { shipSubOrder } = renderOrderPage(order({ status: 'PROCESSING' }), {
      shipState: {
        error: {
          status: 422,
          data: {
            error: {
              code: 'ORDER_INVALID_STATUS_TRANSITION',
              message: 'Cannot ship this order.',
            },
          },
        },
      },
    });
    shipSubOrder.mockReturnValue({
      unwrap: () =>
        Promise.reject(
          Object.assign(new Error('rejected'), {
            status: 422,
            data: {
              error: {
                code: 'ORDER_INVALID_STATUS_TRANSITION',
                message: 'Cannot ship this order.',
              },
            },
          }),
        ),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mark shipped' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot ship this order.');
  });
});

describe('Mark Delivered (S3-6)', () => {
  const visibleStatuses: OrderStatusDto[] = ['SHIPPED'];
  const hiddenStatuses: OrderStatusDto[] = [
    'PENDING_PAYMENT',
    'CONFIRMED',
    'PROCESSING',
    'DELIVERED',
    'CANCELLED',
  ];

  it.each(visibleStatuses)('shows Mark delivered while the order is %s', (status) => {
    renderOrderPage(order({ status }));

    expect(screen.getByRole('button', { name: 'Mark delivered' })).toBeInTheDocument();
  });

  it.each(hiddenStatuses)('hides Mark delivered once the order is %s', (status) => {
    renderOrderPage(order({ status }));

    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument();
  });

  it('shows a loading state while marking delivered', () => {
    renderOrderPage(order({ status: 'SHIPPED' }), { deliverState: { isLoading: true } });

    expect(screen.getByRole('button', { name: 'Marking delivered…' })).toBeDisabled();
  });

  it('calls the mutation with the sub-order id on click', () => {
    const { deliverSubOrder } = renderOrderPage(order({ status: 'SHIPPED' }));
    deliverSubOrder.mockReturnValue({
      unwrap: () => Promise.resolve(order({ status: 'DELIVERED' })),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));

    expect(deliverSubOrder).toHaveBeenCalledWith('sub-order-1');
  });

  it('surfaces an error without claiming the order was delivered', async () => {
    const { deliverSubOrder } = renderOrderPage(order({ status: 'SHIPPED' }), {
      deliverState: {
        error: {
          status: 422,
          data: {
            error: {
              code: 'ORDER_INVALID_STATUS_TRANSITION',
              message: 'Cannot deliver this order.',
            },
          },
        },
      },
    });
    deliverSubOrder.mockReturnValue({
      unwrap: () =>
        Promise.reject(
          Object.assign(new Error('rejected'), {
            status: 422,
            data: {
              error: {
                code: 'ORDER_INVALID_STATUS_TRANSITION',
                message: 'Cannot deliver this order.',
              },
            },
          }),
        ),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Mark delivered' }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot deliver this order.');
  });
});

describe('DELIVERED (terminal state, S3-6 locked decision #4)', () => {
  it('shows no fulfilment action at all once DELIVERED', () => {
    renderOrderPage(order({ status: 'DELIVERED' }));

    expect(screen.queryByRole('button', { name: 'Start processing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark shipped' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark delivered' })).not.toBeInTheDocument();
  });
});
