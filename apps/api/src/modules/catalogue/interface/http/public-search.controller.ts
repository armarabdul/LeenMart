import type { Request, Response } from 'express';
import type { PublicProductSearchQuery, PublicProductSearchResult } from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import { toVendorId } from '../../../identity/index.js';
import { toCategoryId } from '../../domain/value-objects/category-id.value-object.js';
import type { ProductSearchResultItem } from '../../application/ports/product-search-query.port.js';
import type { SearchProductsUseCase } from '../../application/use-cases/search-products.use-case.js';

export interface PublicSearchController {
  readonly search: (req: Request, res: Response) => Promise<void>;
}

export interface PublicSearchControllerDeps {
  readonly searchProductsUseCase: SearchProductsUseCase;
}

/**
 * Mapped field by field, never spread — the same reason every other
 * `toResponse` in this module gives. `mediaCount` is the only media signal
 * (decision I); no vendor id, status, rejection detail, variant, price, or
 * inventory data crosses this boundary (decision L, product-level only) —
 * see `publicProductSearchResultSchema`'s own comment for the full list.
 */
const toResultDto = (item: ProductSearchResultItem): PublicProductSearchResult => ({
  id: item.id,
  categoryId: item.categoryId,
  name: item.name,
  brand: item.brand,
  description: item.description,
  hsnCode: item.hsnCode,
  countryOfOrigin: item.countryOfOrigin,
  netQuantity: item.netQuantity,
  attributeValues: item.attributeValues,
  mediaCount: item.mediaCount,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

const searchHandler =
  (useCase: SearchProductsUseCase): PublicSearchController['search'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { query } = validatedData<unknown, PublicProductSearchQuery>(req);

    const page = await useCase.execute({
      q: query.q,
      categoryId: query.categoryId ? toCategoryId(query.categoryId) : undefined,
      vendorId: query.vendorId ? toVendorId(query.vendorId) : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });

    res.status(200).json({
      data: page.items.map(toResultDto),
      // The platform's existing pagination envelope (SDD 9.3).
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      },
    });
  };

/**
 * Thin HTTP adapter for the public search surface (S2-7). Parses nothing
 * itself, decides nothing, translates no errors — `validate()`,
 * `optionalAuthenticate()`, and the global error handler own those, the same
 * as every other controller in this module.
 */
export const createPublicSearchController = (
  deps: PublicSearchControllerDeps,
): PublicSearchController => ({
  search: searchHandler(deps.searchProductsUseCase),
});
