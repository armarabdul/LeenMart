import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import type { CartItemResponse, CartResponse } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { variantsObserved } from '@/shared/state/known-variants.slice';
import { CartPage } from '@/pages/CartPage';
import {
  useClearCartMutation,
  useGetCartQuery,
  useRemoveCartItemMutation,
  useUpdateCartItemMutation,
} from '@/features/cart/cart.api';

vi.mock('@/features/cart/cart.api', () => ({
  useGetCartQuery: vi.fn(),
  useClearCartMutation: vi.fn(),
  useUpdateCartItemMutation: vi.fn(),
  useRemoveCartItemMutation: vi.fn(),
}));

const mockedUseGetCartQuery = vi.mocked(useGetCartQuery);
const mockedUseClearCartMutation = vi.mocked(useClearCartMutation);
const mockedUseUpdateCartItemMutation = vi.mocked(useUpdateCartItemMutation);
const mockedUseRemoveCartItemMutation = vi.mocked(useRemoveCartItemMutation);

const cartItem = (overrides: Partial<CartItemResponse> = {}): CartItemResponse => ({
  id: 'item-1',
  variantId: 'variant-1',
  quantity: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderCartPage = (
  cart: CartResponse | undefined,
  options: { isLoading?: boolean; isError?: boolean; knownVariant?: boolean } = {},
): {
  updateCartItem: ReturnType<typeof vi.fn>;
  removeCartItem: ReturnType<typeof vi.fn>;
  clearCart: ReturnType<typeof vi.fn>;
} => {
  const updateCartItem = vi.fn();
  const removeCartItem = vi.fn();
  const clearCart = vi.fn();

  mockedUseGetCartQuery.mockReturnValue({
    data: cart,
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
  } as unknown as ReturnType<typeof useGetCartQuery>);
  mockedUseClearCartMutation.mockReturnValue([
    clearCart,
    { isLoading: false },
  ] as unknown as ReturnType<typeof useClearCartMutation>);
  mockedUseUpdateCartItemMutation.mockReturnValue([
    updateCartItem,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useUpdateCartItemMutation>);
  mockedUseRemoveCartItemMutation.mockReturnValue([
    removeCartItem,
    { isLoading: false, error: undefined },
  ] as unknown as ReturnType<typeof useRemoveCartItemMutation>);

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
      <MemoryRouter>
        <CartPage />
      </MemoryRouter>
    </Provider>,
  );

  return { updateCartItem, removeCartItem, clearCart };
};

describe('CartPage', () => {
  it('shows an empty-cart state with a link back to the catalogue', () => {
    renderCartPage({ id: null, items: [] });

    expect(screen.getByText('Your cart is empty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to catalogue' })).toHaveAttribute(
      'href',
      '/catalogue',
    );
  });

  it('shows an error state when the cart cannot be loaded', () => {
    renderCartPage(undefined, { isError: true });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows product and variant name when the variant was observed this session', () => {
    renderCartPage({ id: 'cart-1', items: [cartItem()] }, { knownVariant: true });

    expect(screen.getByText('Alphonso Mango')).toBeInTheDocument();
    expect(screen.getByText('500 g pack')).toBeInTheDocument();
    expect(screen.getByText('₹99.00', { exact: false })).toBeInTheDocument();
  });

  it('shows an honest fallback, never a fabricated name or price, for an unresolved item', () => {
    renderCartPage({ id: 'cart-1', items: [cartItem()] }, { knownVariant: false });

    expect(screen.getByText('Product information unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Alphonso Mango')).not.toBeInTheDocument();
  });

  it('still allows quantity update and removal for an unresolved item', () => {
    const { updateCartItem, removeCartItem } = renderCartPage(
      { id: 'cart-1', items: [cartItem({ quantity: 3 })] },
      { knownVariant: false },
    );

    fireEvent.click(screen.getByLabelText('Increase quantity'));
    expect(updateCartItem).toHaveBeenCalledWith({ itemId: 'item-1', quantity: 4 });

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(removeCartItem).toHaveBeenCalledWith('item-1');
  });

  it('calls clearCart when "Clear cart" is clicked', () => {
    const { clearCart } = renderCartPage({ id: 'cart-1', items: [cartItem()] });

    fireEvent.click(screen.getByRole('button', { name: /clear cart/i }));
    expect(clearCart).toHaveBeenCalled();
  });

  it('shows a total only once every item has resolved', () => {
    renderCartPage({ id: 'cart-1', items: [cartItem({ quantity: 2 })] }, { knownVariant: true });

    // 9900 minor units * quantity 2 = 19800 -> ₹198.00
    expect(screen.getByText(/Total: ₹198\.00/)).toBeInTheDocument();
  });

  it('withholds the total rather than showing a partial/misleading amount when any item is unresolved', () => {
    renderCartPage(
      {
        id: 'cart-1',
        items: [
          cartItem({ id: 'item-1', variantId: 'variant-1' }),
          cartItem({ id: 'item-2', variantId: 'variant-unknown' }),
        ],
      },
      { knownVariant: true },
    );

    expect(screen.getByText(/Cart total unavailable/)).toBeInTheDocument();
  });
});
