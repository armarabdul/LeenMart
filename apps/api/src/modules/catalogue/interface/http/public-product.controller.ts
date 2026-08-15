import type { Request, Response } from 'express';
import type { PublicProductDetail, PublicProductVariant } from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { Product } from '../../domain/entities/product.entity.js';
import { toProductId } from '../../domain/value-objects/product-id.value-object.js';
import type {
  GetPublicProductDetailUseCase,
  PublicProductVariantWithAvailability,
} from '../../application/use-cases/get-public-product-detail.use-case.js';

export interface PublicProductController {
  readonly get: (req: Request, res: Response) => Promise<void>;
}

export interface PublicProductControllerDeps {
  readonly getPublicProductDetailUseCase: GetPublicProductDetailUseCase;
}

/**
 * Mapped field by field, never spread — the same reason every other
 * `toResponse` in this module gives. `id`/`name`/`price`/`unitOfMeasure`/
 * `quantityStep`/`available` are the only variant fields on the wire; `sku`
 * and the entity's own timestamps do not cross this boundary.
 */
const toVariantDto = (item: PublicProductVariantWithAvailability): PublicProductVariant => ({
  id: item.variant.id,
  name: item.variant.name,
  // Integer minor units on the wire (SDD 9.2), the vendor's own stored price
  // echoed as-is — no tax/commission calculation happens here.
  price: {
    amount: item.variant.price.amountMinor.toString(),
    currency: item.variant.price.currency,
  },
  unitOfMeasure: item.variant.unitOfMeasure,
  quantityStep: item.variant.quantityStep,
  available: item.available,
});

/** Mirrors `toResultDto` in `public-search.controller.ts` field for field, plus `variants`. */
const toDetailDto = (
  product: Product,
  mediaCount: number,
  variants: readonly PublicProductVariantWithAvailability[],
): PublicProductDetail => ({
  id: product.id,
  categoryId: product.categoryId,
  name: product.name,
  brand: product.brand,
  description: product.description,
  hsnCode: product.hsnCode,
  countryOfOrigin: product.countryOfOrigin,
  netQuantity: product.netQuantity,
  attributeValues: product.attributeValues,
  mediaCount,
  variants: variants.map(toVariantDto),
  createdAt: product.createdAt.toISOString(),
  updatedAt: product.updatedAt.toISOString(),
});

const getHandler =
  (useCase: GetPublicProductDetailUseCase): PublicProductController['get'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, { id: string }>(req);

    const { product, mediaCount, variants } = await useCase.execute({
      productId: toProductId(params.id),
    });

    res.status(200).json({
      data: toDetailDto(product, mediaCount, variants),
      meta: { requestId: getRequestId() },
    });
  };

/**
 * Thin HTTP adapter for the public product-detail surface (S3-3 discovery
 * milestone). Parses nothing itself, decides nothing, translates no errors —
 * `validate()` and the global error handler own those, the same as every
 * other controller in this module.
 */
export const createPublicProductController = (
  deps: PublicProductControllerDeps,
): PublicProductController => ({
  get: getHandler(deps.getPublicProductDetailUseCase),
});
