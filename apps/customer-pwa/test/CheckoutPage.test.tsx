import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  AddressResponse,
  AvailableSlotDto,
  CartItemResponse,
  CartResponse,
  OrderResponse,
  SlotAvailabilityResponse,
} from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { variantsObserved } from '@/shared/state/known-variants.slice';
import { CheckoutPage } from '@/pages/CheckoutPage';
import { useGetCartQuery } from '@/features/cart/cart.api';
import { useAddAddressMutation, useGetAddressesQuery } from '@/features/address/address.api';
import {
  useGetSlotAvailabilityQuery,
  usePlaceOrderMutation,
} from '@/features/checkout/checkout.api';

vi.mock('@/features/cart/cart.api', () => ({ useGetCartQuery: vi.fn() }));
vi.mock('@/features/address/address.api', () => ({
  useGetAddressesQuery: vi.fn(),
  useAddAddressMutation: vi.fn(),
}));
vi.mock('@/features/checkout/checkout.api', () => ({
  usePlaceOrderMutation: vi.fn(),
  useGetSlotAvailabilityQuery: vi.fn(),
}));

const mockedUseGetCartQuery = vi.mocked(useGetCartQuery);
const mockedUseGetAddressesQuery = vi.mocked(useGetAddressesQuery);
const mockedUseAddAddressMutation = vi.mocked(useAddAddressMutation);
const mockedUsePlaceOrderMutation = vi.mocked(usePlaceOrderMutation);
const mockedUseGetSlotAvailabilityQuery = vi.mocked(useGetSlotAvailabilityQuery);

const cartItem = (overrides: Partial<CartItemResponse> = {}): CartItemResponse => ({
  id: 'item-1',
  variantId: 'variant-1',
  quantity: 2,
  vendorId: 'vendor-1',
  vendorShopName: 'Test Shop',
  supportsPickup: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const address: AddressResponse = {
  id: 'address-1',
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  line2: null,
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  landmark: null,
  label: 'Home',
  isDefault: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const orderResponse: OrderResponse = {
  id: 'order-1',
  status: 'PENDING_PAYMENT',
  totalAmount: { amount: '19800', currency: 'INR' },
  address: {
    recipientName: address.recipientName,
    phone: address.phone,
    line1: address.line1,
    line2: address.line2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    landmark: address.landmark,
    label: address.label,
  },
  subOrders: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const renderCheckout = (
  cart: CartResponse | undefined,
  options: {
    isCartLoading?: boolean;
    isCartError?: boolean;
    knownVariant?: boolean;
    placeOrderError?: unknown;
    /** S4-SLOTS. Omitted means no vendor in the cart offers windows. */
    slotVendors?: {
      vendorId: string;
      shopName: string | null;
      slots: {
        date: string;
        startMinute: number;
        endMinute: number;
        capacity: number;
        booked: number;
        remaining: number;
      }[];
    }[];
  } = {},
): { placeOrder: ReturnType<typeof vi.fn> } => {
  const placeOrder = vi.fn();
  const addAddress = vi.fn();

  mockedUseGetCartQuery.mockReturnValue({
    data: cart,
    isLoading: options.isCartLoading ?? false,
    isError: options.isCartError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetCartQuery>);
  mockedUseGetAddressesQuery.mockReturnValue({
    data: [address],
    isLoading: false,
    isError: false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetAddressesQuery>);
  mockedUseAddAddressMutation.mockReturnValue([
    addAddress,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useAddAddressMutation>);
  // S4-SLOTS. No vendor in these carts offers windows, so the selector renders
  // nothing and every expectation written before this milestone still holds.
  mockedUseGetSlotAvailabilityQuery.mockReturnValue({
    data: { vendors: options.slotVendors ?? [] },
    isLoading: false,
    isError: false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetSlotAvailabilityQuery>);
  mockedUsePlaceOrderMutation.mockReturnValue([
    placeOrder,
    { isLoading: false, error: options.placeOrderError },
  ] as unknown as ReturnType<typeof usePlaceOrderMutation>);

  const store = createStore();
  if (options.knownVariant) {
    store.dispatch(
      variantsObserved([
        {
          variantId: 'variant-1',
          productId: 'product-1',
          productName: 'Alphonso Mango',
          variantName: '500 g pack',
          price: { amount: '9900', currency: 'INR' },
          unitOfMeasure: 'g',
          quantityStep: 1,
          available: 10,
        },
      ]),
    );
  }

  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={['/checkout']}>
        <Routes>
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/orders/:id" element={<p>Order confirmation page</p>} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

  return { placeOrder };
};

describe('CheckoutPage', () => {
  it('shows an empty-cart state with a link back to the catalogue', () => {
    renderCheckout({ id: null, items: [] });

    expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to catalogue' })).toHaveAttribute(
      'href',
      '/catalogue',
    );
  });

  it('shows an error state when the cart cannot be loaded', () => {
    renderCheckout(undefined, { isCartError: true });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders resolved items with name and price in the order review', () => {
    renderCheckout({ id: 'cart-1', items: [cartItem()] }, { knownVariant: true });

    expect(screen.getByText(/Alphonso Mango — 500 g pack/)).toBeInTheDocument();
    // Phase E moves the subtotal into an order-summary card, so the label and
    // the amount are separate elements rather than one 'Subtotal: …' string.
    expect(screen.getByText('Subtotal (1 item)')).toBeInTheDocument();
    expect(screen.getAllByText('₹198.00').length).toBeGreaterThan(0);
  });

  it('shows an honest fallback for an unresolved item, never a fabricated name', () => {
    renderCheckout({ id: 'cart-1', items: [cartItem()] }, { knownVariant: false });

    expect(screen.getByText('Item unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Subtotal unavailable/)).toBeInTheDocument();
  });

  it('never fabricates a tax figure before the order is placed', () => {
    renderCheckout({ id: 'cart-1', items: [cartItem()] }, { knownVariant: true });

    expect(screen.getByText(/GST to be confirmed/)).toBeInTheDocument();
  });

  it('honestly labels the payment step as test mode, with no real gateway branding', () => {
    renderCheckout({ id: 'cart-1', items: [cartItem()] }, { knownVariant: true });

    expect(screen.getByText('Payment — TEST / DEMO mode')).toBeInTheDocument();
    expect(screen.queryByText(/razorpay/i)).not.toBeInTheDocument();
  });

  it('disables "Place order" until a delivery address is selected', () => {
    renderCheckout({ id: 'cart-1', items: [cartItem()] }, { knownVariant: true });

    expect(screen.getByRole('button', { name: /place order/i })).toBeDisabled();
  });

  it('places an order for ONLINE payment only, and navigates to the confirmation page', async () => {
    const { placeOrder } = renderCheckout(
      { id: 'cart-1', items: [cartItem()] },
      { knownVariant: true },
    );
    placeOrder.mockReturnValue({ unwrap: () => Promise.resolve(orderResponse) });

    fireEvent.click(screen.getByRole('radio'));
    fireEvent.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(screen.getByText('Order confirmation page')).toBeInTheDocument());

    expect(placeOrder).toHaveBeenCalledTimes(1);
    const call = placeOrder.mock.calls[0]?.[0] as {
      addressId: string;
      paymentMethod: string;
      idempotencyKey: string;
    };
    expect(call.addressId).toBe('address-1');
    expect(call.paymentMethod).toBe('ONLINE');
    expect(typeof call.idempotencyKey).toBe('string');
    expect(call.idempotencyKey.length).toBeGreaterThan(0);
  });

  it('surfaces a failure to place the order without navigating away', () => {
    renderCheckout(
      { id: 'cart-1', items: [cartItem()] },
      {
        knownVariant: true,
        placeOrderError: {
          status: 422,
          data: { error: { code: 'ORDER_INSUFFICIENT_STOCK', message: 'Not enough stock.' } },
        },
      },
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Not enough stock.');
    expect(screen.queryByText('Order confirmation page')).not.toBeInTheDocument();
  });
});

describe('CheckoutPage — time slots (S4-SLOTS)', () => {
  /** A two-hour window; the end follows the start so the rendered label is coherent. */
  const window = (
    overrides: Partial<{ startMinute: number; remaining: number }> = {},
  ): AvailableSlotDto => {
    const startMinute = overrides.startMinute ?? 540;
    const remaining = overrides.remaining ?? 5;
    return {
      date: '2026-08-18',
      startMinute,
      endMinute: startMinute + 120,
      capacity: 5,
      booked: 5 - remaining,
      remaining,
    };
  };

  const vendorWithSlots = (
    slots: AvailableSlotDto[] = [window()],
  ): SlotAvailabilityResponse['vendors'] => [
    { vendorId: 'vendor-1', shopName: 'Ratnagiri Orchards', slots },
  ];

  it('renders nothing when no seller in the cart offers windows', () => {
    renderCheckout({ id: 'cart-1', items: [cartItem()] }, { knownVariant: true });

    expect(screen.queryByRole('heading', { name: 'Time slot' })).not.toBeInTheDocument();
  });

  it('lists a seller’s windows with how much room is left', () => {
    renderCheckout(
      { id: 'cart-1', items: [cartItem()] },
      { knownVariant: true, slotVendors: vendorWithSlots() },
    );

    expect(screen.getByRole('heading', { name: 'Time slot' })).toBeInTheDocument();
    expect(screen.getByText('Ratnagiri Orchards')).toBeInTheDocument();
    expect(screen.getByText(/09:00–11:00/)).toBeInTheDocument();
    expect(screen.getByText('5 left')).toBeInTheDocument();
  });

  it('shows a full window as full, and refuses to let it be chosen', () => {
    // Hidden would read as "this seller stopped offering mornings", which is
    // a different fact entirely.
    renderCheckout(
      { id: 'cart-1', items: [cartItem()] },
      { knownVariant: true, slotVendors: vendorWithSlots([window({ remaining: 0 })]) },
    );

    expect(screen.getByText('Full')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /09:00–11:00/ })).toBeDisabled();
  });

  it('sends the chosen window with the order', async () => {
    const { placeOrder } = renderCheckout(
      { id: 'cart-1', items: [cartItem()] },
      { knownVariant: true, slotVendors: vendorWithSlots() },
    );
    placeOrder.mockReturnValue({ unwrap: () => Promise.resolve(orderResponse) });

    fireEvent.click(screen.getByRole('radio', { name: /Delivery address|Asha/ }));
    fireEvent.click(screen.getByRole('radio', { name: /09:00–11:00/ }));
    fireEvent.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    const call = placeOrder.mock.calls[0]?.[0] as { slotSelections?: unknown };
    // Only the date and the start minute: the window's end and its capacity
    // are the server's to read from the vendor's own template.
    expect(call.slotSelections).toEqual([
      { vendorId: 'vendor-1', date: '2026-08-18', startMinute: 540 },
    ]);
  });

  it('keeps one choice per seller when the customer changes their mind', async () => {
    const { placeOrder } = renderCheckout(
      { id: 'cart-1', items: [cartItem()] },
      {
        knownVariant: true,
        slotVendors: vendorWithSlots([window(), window({ startMinute: 960 })]),
      },
    );
    placeOrder.mockReturnValue({ unwrap: () => Promise.resolve(orderResponse) });

    fireEvent.click(screen.getByRole('radio', { name: /Delivery address|Asha/ }));
    fireEvent.click(screen.getByRole('radio', { name: /09:00–11:00/ }));
    fireEvent.click(screen.getByRole('radio', { name: /16:00–18:00/ }));
    fireEvent.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(placeOrder).toHaveBeenCalledTimes(1));
    const call = placeOrder.mock.calls[0]?.[0] as {
      slotSelections?: { startMinute: number }[];
    };
    expect(call.slotSelections).toHaveLength(1);
    expect(call.slotSelections?.[0]?.startMinute).toBe(960);
  });

  it('tells the customer to pick another window when the server refuses theirs', () => {
    renderCheckout(
      { id: 'cart-1', items: [cartItem()] },
      {
        knownVariant: true,
        slotVendors: vendorWithSlots(),
        placeOrderError: {
          status: 422,
          data: {
            error: {
              code: 'ORDER_SLOT_UNAVAILABLE',
              message: 'That time slot has just been taken.',
            },
          },
        },
      },
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/choose an available time slot/i);
  });
});
