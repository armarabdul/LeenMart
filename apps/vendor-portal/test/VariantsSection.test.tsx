import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import type { VendorProductVariant } from '@leen-mart/contracts';
import { createStore } from '@/app/store';
import { VariantsSection } from '@/features/vendor-product/components/VariantsSection';
import {
  useAddVariantMutation,
  useDeleteVariantMutation,
  useListVariantsQuery,
  useUpdateVariantMutation,
} from '@/features/vendor-product/vendor-product-variant.api';
import {
  useGetInventoryQuery,
  useSetInventoryMutation,
} from '@/features/vendor-product/vendor-inventory.api';

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

const mockedUseListVariantsQuery = vi.mocked(useListVariantsQuery);
const mockedUseAddVariantMutation = vi.mocked(useAddVariantMutation);
const mockedUseUpdateVariantMutation = vi.mocked(useUpdateVariantMutation);
const mockedUseDeleteVariantMutation = vi.mocked(useDeleteVariantMutation);
const mockedUseGetInventoryQuery = vi.mocked(useGetInventoryQuery);
const mockedUseSetInventoryMutation = vi.mocked(useSetInventoryMutation);

const mockAddVariant = vi.fn();
const mockUpdateVariant = vi.fn();
const mockDeleteVariant = vi.fn();
const mockSetInventory = vi.fn();

const variant = (overrides: Partial<VendorProductVariant> = {}): VendorProductVariant => ({
  id: 'variant-1',
  productId: 'product-1',
  sku: 'SKU-001',
  name: '1 kg pack',
  price: { amount: '9900', currency: 'INR' },
  unitOfMeasure: 'kg',
  quantityStep: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

interface StubOptions {
  readonly variants?: readonly VendorProductVariant[];
  readonly isLoading?: boolean;
  readonly isError?: boolean;
  readonly addRejects?: boolean;
  readonly updateRejects?: boolean;
  readonly deleteRejects?: boolean;
  readonly inventoryError?: unknown;
}

const stub = (options: StubOptions = {}): void => {
  mockAddVariant.mockReset();
  mockUpdateVariant.mockReset();
  mockDeleteVariant.mockReset();
  mockSetInventory.mockReset();

  mockedUseListVariantsQuery.mockReturnValue({
    data: options.isLoading === true ? undefined : (options.variants ?? [variant()]),
    isLoading: options.isLoading ?? false,
    isError: options.isError ?? false,
    error: undefined,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useListVariantsQuery>);

  const apiError = {
    status: 400,
    data: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'boom',
        requestId: 'req-1',
        timestamp: '2026-01-01T00:00:00.000Z',
      },
    },
  };

  mockAddVariant.mockReturnValue({ unwrap: () => Promise.resolve(variant()) });
  mockedUseAddVariantMutation.mockReturnValue([
    mockAddVariant,
    { isLoading: false, error: options.addRejects === true ? apiError : undefined },
  ] as unknown as ReturnType<typeof useAddVariantMutation>);

  mockUpdateVariant.mockReturnValue({ unwrap: () => Promise.resolve(variant()) });
  mockedUseUpdateVariantMutation.mockReturnValue([
    mockUpdateVariant,
    { isLoading: false, error: options.updateRejects === true ? apiError : undefined },
  ] as unknown as ReturnType<typeof useUpdateVariantMutation>);

  mockDeleteVariant.mockReturnValue({ unwrap: () => Promise.resolve(variant()) });
  mockedUseDeleteVariantMutation.mockReturnValue([
    mockDeleteVariant,
    { isLoading: false, error: options.deleteRejects === true ? apiError : undefined },
  ] as unknown as ReturnType<typeof useDeleteVariantMutation>);

  mockedUseGetInventoryQuery.mockReturnValue({
    data: {
      variantId: 'variant-1',
      available: 10,
      reserved: 2,
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    isLoading: false,
    isError: false,
    error: undefined,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useGetInventoryQuery>);
  mockSetInventory.mockReturnValue({ unwrap: () => Promise.resolve({}) });
  mockedUseSetInventoryMutation.mockReturnValue([
    mockSetInventory,
    { isLoading: false, error: options.inventoryError },
  ] as unknown as ReturnType<typeof useSetInventoryMutation>);
};

const renderSection = (): void => {
  render(
    <Provider store={createStore()}>
      <VariantsSection productId="product-1" />
    </Provider>,
  );
};

describe('VariantsSection — list', () => {
  it('shows a loading state while fetching', () => {
    stub({ isLoading: true });
    renderSection();

    expect(screen.getByText('Loading variants…')).toBeInTheDocument();
  });

  it('shows an error state with a retry action', () => {
    stub({ isError: true });
    renderSection();

    expect(screen.getByRole('alert')).toHaveTextContent('Variants could not be loaded.');
  });

  it('lists each variant with its SKU, price and unit', () => {
    stub({ variants: [variant({ name: '1 kg pack', sku: 'SKU-001' })] });
    renderSection();

    expect(screen.getByText('1 kg pack')).toBeInTheDocument();
    expect(screen.getByText(/SKU SKU-001/)).toBeInTheDocument();
  });
});

describe('VariantsSection — add', () => {
  it('adds a new variant with the entered fields', async () => {
    stub();
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));
    fireEvent.change(screen.getByLabelText('SKU'), { target: { value: 'SKU-002' } });
    fireEvent.change(screen.getByLabelText('Variant name'), { target: { value: '500 g pack' } });
    fireEvent.change(screen.getByLabelText('Price (₹)'), { target: { value: '49.50' } });
    fireEvent.change(screen.getByLabelText('Unit of measure'), { target: { value: 'g' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));

    await waitFor(() => expect(mockAddVariant).toHaveBeenCalled());
    const call = mockAddVariant.mock.calls[0]?.[0] as { productId: string; body: { sku: string } };
    expect(call.productId).toBe('product-1');
    expect(call.body.sku).toBe('SKU-002');
  });

  it('surfaces a server error when adding fails', () => {
    stub({ addRejects: true });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Add variant' }));

    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});

describe('VariantsSection — edit and delete', () => {
  it('populates the edit form from the existing variant', () => {
    stub({ variants: [variant({ name: '1 kg pack', unitOfMeasure: 'kg' })] });
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText('Variant name')).toHaveValue('1 kg pack');
    expect(screen.getByLabelText('Price (₹)')).toHaveValue('99.00');
  });

  it('saves an edited variant', async () => {
    stub();
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Variant name'), { target: { value: 'Updated name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save variant' }));

    await waitFor(() =>
      expect(mockUpdateVariant).toHaveBeenCalledWith(
        expect.objectContaining({ productId: 'product-1', variantId: 'variant-1' }),
      ),
    );
  });

  it('deletes a variant', async () => {
    stub();
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(mockDeleteVariant).toHaveBeenCalledWith({
        productId: 'product-1',
        variantId: 'variant-1',
      }),
    );
  });

  it('surfaces a server error when deleting fails', () => {
    stub({ deleteRejects: true });
    renderSection();

    expect(screen.getByRole('alert')).toHaveTextContent('boom');
  });
});

describe('VariantsSection — inventory', () => {
  it('shows the current available and reserved stock', () => {
    stub();
    renderSection();

    expect(screen.getByLabelText('Available stock')).toHaveValue(10);
    expect(screen.getByText('2 reserved')).toBeInTheDocument();
  });

  it('submits an inventory update with the current version', async () => {
    stub();
    renderSection();

    fireEvent.change(screen.getByLabelText('Available stock'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update stock' }));

    await waitFor(() =>
      expect(mockSetInventory).toHaveBeenCalledWith({
        productId: 'product-1',
        variantId: 'variant-1',
        body: { available: 25, version: 1 },
      }),
    );
  });

  it('confirms a successful stock update', async () => {
    stub();
    renderSection();

    fireEvent.click(screen.getByRole('button', { name: 'Update stock' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Stock updated.'));
  });

  it('offers a refresh action on a version conflict', () => {
    stub({
      inventoryError: {
        status: 409,
        data: {
          error: {
            code: 'INVENTORY_VERSION_CONFLICT',
            message: 'Stock changed since you loaded this page.',
            requestId: 'req-1',
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        },
      },
    });
    renderSection();

    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This stock figure changed since it was loaded. Refresh to see the latest value.',
    );
  });
});
