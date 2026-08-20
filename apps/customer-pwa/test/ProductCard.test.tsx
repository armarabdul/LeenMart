import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PublicProductSearchResult } from '@leen-mart/contracts';
import { ProductCard } from '@/features/catalogue/components/ProductCard';
import { ProductGrid } from '@/features/catalogue/components/ProductGrid';

const PRODUCT_ID = '01a01111-1111-7111-8111-111111111111';

const product = (overrides: Partial<PublicProductSearchResult> = {}): PublicProductSearchResult =>
  ({
    id: PRODUCT_ID,
    categoryId: '01a02222-2222-7222-8222-222222222222',
    name: 'Alphonso Mango',
    brand: 'FarmFresh',
    description: 'Sweet, ripe Alphonso mangoes.',
    hsnCode: null,
    countryOfOrigin: 'IN',
    netQuantity: '1 kg',
    attributeValues: {},
    mediaCount: 2,
    createdAt: '2026-08-20T06:00:00.000Z',
    updatedAt: '2026-08-20T06:00:00.000Z',
    ...overrides,
  }) as PublicProductSearchResult;

const renderCard = (overrides: Partial<PublicProductSearchResult> = {}): void => {
  render(
    <MemoryRouter>
      <ProductCard product={product(overrides)} />
    </MemoryRouter>,
  );
};

describe('ProductCard (Phase D)', () => {
  it('is a single link to the product detail route', () => {
    renderCard();

    // One link, not several: a card on a phone should be hittable anywhere.
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', `/products/${PRODUCT_ID}`);
  });

  it('shows the name, the brand and the net quantity', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'Alphonso Mango' })).toBeInTheDocument();
    expect(screen.getByText('FarmFresh')).toBeInTheDocument();
    expect(screen.getByText('1 kg')).toBeInTheDocument();
  });

  it('omits the brand and net quantity when the product has none', () => {
    renderCard({ brand: null, netQuantity: null });

    expect(screen.queryByText('FarmFresh')).not.toBeInTheDocument();
    expect(screen.queryByText('1 kg')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Alphonso Mango' })).toBeInTheDocument();
  });

  it('states the photo count rather than showing a stand-in image', () => {
    // The search contract carries `mediaCount` and no URL — there is no image
    // to render, and a decorative one would read as the product's own photo.
    renderCard({ mediaCount: 2 });

    expect(screen.getByText('2 photos')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('says "1 photo", not "1 photos"', () => {
    renderCard({ mediaCount: 1 });

    expect(screen.getByText('1 photo')).toBeInTheDocument();
  });

  it('says "No photo" when the product has none', () => {
    renderCard({ mediaCount: 0 });

    expect(screen.getByText('No photo')).toBeInTheDocument();
  });

  it('never invents a price, a rating or a shop name', () => {
    // None of the three exists in `publicProductSearchResultSchema`; showing
    // any of them would be fabricated commercial information.
    renderCard();

    expect(document.body.textContent).not.toMatch(/₹|\bfrom\b|★|rating|sold by|shop/i);
  });
});

describe('ProductGrid (Phase D)', () => {
  const renderGrid = (props: Partial<Parameters<typeof ProductGrid>[0]> = {}): void => {
    render(
      <MemoryRouter>
        <ProductGrid items={[]} isLoading={false} isError={false} {...props} />
      </MemoryRouter>,
    );
  };

  it('announces itself while loading instead of rendering silence', () => {
    renderGrid({ isLoading: true });

    expect(screen.getByLabelText('Loading products')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows an error state a screen reader will announce', () => {
    renderGrid({ isError: true });

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows a tailored empty state when a page supplies one', () => {
    renderGrid({ emptyTitle: 'No products match “kiwi”' });

    expect(screen.getByText('No products match “kiwi”')).toBeInTheDocument();
  });

  it('renders one card per product', () => {
    renderGrid({ items: [product(), product({ id: 'other-id', name: 'Banana' })] });

    expect(screen.getByRole('heading', { name: 'Alphonso Mango' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Banana' })).toBeInTheDocument();
  });

  it('waits until `lg` for a third column, so the catalogue rail cannot squeeze it', () => {
    // Measured at 768px, `md:grid-cols-3` plus the sticky rail left each card
    // 139px — narrower than the same card at 320px.
    renderGrid({ items: [product()] });

    const grid = screen.getByRole('heading', { name: 'Alphonso Mango' }).closest('div.grid');
    expect(grid).toHaveClass('lg:grid-cols-3');
    expect(grid).not.toHaveClass('md:grid-cols-3');
  });

  it('offers "Load more" only when the server says there is more', () => {
    renderGrid({ items: [product()], hasMore: true, onLoadMore: () => undefined });
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();

    renderGrid({ items: [product()], hasMore: false, onLoadMore: () => undefined });
    expect(screen.getAllByRole('button', { name: 'Load more' })).toHaveLength(1);
  });
});
