import { describe, expect, it, vi } from 'vitest';
import { NullLogger, UuidV7Generator, ValidationError } from '@leen-mart/domain-kit';
import { SearchProductsUseCase } from '../../../../../src/modules/catalogue/application/use-cases/search-products.use-case.js';
import type {
  ProductSearchCursor,
  ProductSearchPage,
  ProductSearchQueryPort,
  ProductSearchResultItem,
} from '../../../../../src/modules/catalogue/application/ports/product-search-query.port.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const ids = new UuidV7Generator();

const resultItem = (overrides: Partial<ProductSearchResultItem> = {}): ProductSearchResultItem => ({
  id: toProductId(ids.generate()),
  categoryId: toCategoryId(ids.generate()),
  name: 'Fresh Rohu Fish',
  brand: null,
  description: null,
  hsnCode: null,
  countryOfOrigin: null,
  netQuantity: null,
  attributeValues: {},
  mediaCount: 0,
  createdAt: new Date('2026-03-01T00:00:00.000Z'),
  updatedAt: new Date('2026-03-01T00:00:00.000Z'),
  ...overrides,
});

const queryPort = (
  page: ProductSearchPage = { items: [], nextCursor: null, hasMore: false },
): { port: ProductSearchQueryPort; search: ReturnType<typeof vi.fn> } => {
  const search = vi.fn().mockResolvedValue(page);
  return { port: { search }, search };
};

const build = (port: ProductSearchQueryPort): SearchProductsUseCase =>
  new SearchProductsUseCase({ productSearchQuery: port, logger: new NullLogger() });

describe('SearchProductsUseCase', () => {
  describe('cursor handling', () => {
    it('passes no cursor through when none is supplied', async () => {
      const { port, search } = queryPort();

      await build(port).execute({ limit: 20 });

      expect(search).toHaveBeenCalledWith(expect.objectContaining({ cursor: undefined }));
    });

    it('round-trips an opaque cursor: encodes the port’s nextCursor, and the decoded value fed back matches it exactly', async () => {
      const returnedCursor: ProductSearchCursor = { name: 'Widget', id: ids.generate() };
      const { port, search } = queryPort({
        items: [resultItem()],
        nextCursor: returnedCursor,
        hasMore: true,
      });

      const page = await build(port).execute({ limit: 20 });

      expect(page.nextCursor).not.toBeNull();
      expect(page.nextCursor).not.toEqual(returnedCursor); // opaque, not the raw shape

      // Feeding the opaque token back in decodes to exactly what the port returned.
      await build(port).execute({ limit: 20, cursor: page.nextCursor ?? undefined });

      expect(search).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ cursor: returnedCursor }),
      );
    });

    it('rejects a cursor that is not valid base64url JSON', async () => {
      const { port } = queryPort();

      await expect(
        build(port).execute({ limit: 20, cursor: 'not-a-valid-cursor-!!!' }),
      ).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    });

    it('rejects a cursor that decodes to JSON but not the expected {name, id} shape', async () => {
      const { port } = queryPort();
      const wrongShape = Buffer.from(JSON.stringify({ foo: 'bar' }), 'utf8').toString('base64url');

      await expect(build(port).execute({ limit: 20, cursor: wrongShape })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('rejects a cursor that decodes to a JSON primitive rather than an object', async () => {
      const { port } = queryPort();
      const primitive = Buffer.from('"just-a-string"', 'utf8').toString('base64url');

      await expect(build(port).execute({ limit: 20, cursor: primitive })).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it('answers null nextCursor when the port reports no more pages', async () => {
      const { port } = queryPort({ items: [resultItem()], nextCursor: null, hasMore: false });

      const page = await build(port).execute({ limit: 20 });

      expect(page.nextCursor).toBeNull();
      expect(page.hasMore).toBe(false);
    });
  });

  describe('limit clamping', () => {
    it('defaults to 20 when no limit is supplied', async () => {
      const { port, search } = queryPort();

      await build(port).execute({});

      expect(search).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
    });

    it('clamps a limit below 1 up to 1', async () => {
      const { port, search } = queryPort();

      await build(port).execute({ limit: 0 });

      expect(search).toHaveBeenCalledWith(expect.objectContaining({ limit: 1 }));
    });

    it('clamps a limit above 100 down to 100', async () => {
      const { port, search } = queryPort();

      await build(port).execute({ limit: 5000 });

      expect(search).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    });

    it('truncates a fractional limit', async () => {
      const { port, search } = queryPort();

      await build(port).execute({ limit: 47.9 });

      expect(search).toHaveBeenCalledWith(expect.objectContaining({ limit: 47 }));
    });

    it('falls back to the default for a non-finite limit', async () => {
      const { port, search } = queryPort();

      await build(port).execute({ limit: Number.NaN });

      expect(search).toHaveBeenCalledWith(expect.objectContaining({ limit: 20 }));
    });
  });

  describe('filters', () => {
    it('trims a search term and drops it entirely when it is blank', async () => {
      const { port, search } = queryPort();

      await build(port).execute({ q: '   ', limit: 20 });

      expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: undefined }));
    });

    it('trims surrounding whitespace off a non-blank search term', async () => {
      const { port, search } = queryPort();

      await build(port).execute({ q: '  rohu fish  ', limit: 20 });

      expect(search).toHaveBeenCalledWith(expect.objectContaining({ q: 'rohu fish' }));
    });

    it('passes categoryId and vendorId through unchanged', async () => {
      const { port, search } = queryPort();
      const categoryId = toCategoryId(ids.generate());
      const vendorId = toVendorId(ids.generate());

      await build(port).execute({ categoryId, vendorId, limit: 20 });

      expect(search).toHaveBeenCalledWith(expect.objectContaining({ categoryId, vendorId }));
    });
  });

  it('returns the port’s items unchanged', async () => {
    const item = resultItem({ name: 'Alphonso Mango' });
    const { port } = queryPort({ items: [item], nextCursor: null, hasMore: false });

    const page = await build(port).execute({ limit: 20 });

    expect(page.items).toEqual([item]);
  });
});
