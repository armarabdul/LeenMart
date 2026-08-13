import type { Request, Response } from 'express';
import type { AddProductVariantRequest, UpdateProductVariantRequest } from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import { toProductId } from '../../domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../domain/value-objects/product-variant-id.value-object.js';
import type { AddProductVariantUseCase } from '../../application/use-cases/add-product-variant.use-case.js';
import type { GetProductVariantUseCase } from '../../application/use-cases/get-product-variant.use-case.js';
import type { ListProductVariantsUseCase } from '../../application/use-cases/list-product-variants.use-case.js';
import type { RemoveProductVariantUseCase } from '../../application/use-cases/remove-product-variant.use-case.js';
import type { UpdateProductVariantUseCase } from '../../application/use-cases/update-product-variant.use-case.js';
import { toMoney, toVariantResponse } from './vendor-product.controller.js';

export interface VendorProductVariantController {
  readonly add: (req: Request, res: Response) => Promise<void>;
  readonly list: (req: Request, res: Response) => Promise<void>;
  readonly get: (req: Request, res: Response) => Promise<void>;
  readonly update: (req: Request, res: Response) => Promise<void>;
  readonly remove: (req: Request, res: Response) => Promise<void>;
}

export interface VendorProductVariantControllerDeps {
  readonly addProductVariantUseCase: AddProductVariantUseCase;
  readonly updateProductVariantUseCase: UpdateProductVariantUseCase;
  readonly getProductVariantUseCase: GetProductVariantUseCase;
  readonly listProductVariantsUseCase: ListProductVariantsUseCase;
  readonly removeProductVariantUseCase: RemoveProductVariantUseCase;
}

/** Every variant route carries both ids: a variant is only ever addressed under its product. */
interface VariantParams {
  productId: string;
  variantId: string;
}

/** A route reaching a writing handler without a principal is a wiring bug, not a request problem. */
const principalOf = (req: Request, route: string): NonNullable<Request['principal']> => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  return req.principal;
};

const addHandler =
  (useCase: AddProductVariantUseCase): VendorProductVariantController['add'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'POST /vendor/products/:productId/variants');
    const { body, params } = validatedData<
      AddProductVariantRequest,
      unknown,
      { productId: string }
    >(req);

    const { variant } = await useCase.execute({
      principal,
      productId: toProductId(params.productId),
      sku: body.sku,
      name: body.name,
      price: toMoney(body.price),
      unitOfMeasure: body.unitOfMeasure,
      quantityStep: body.quantityStep,
    });

    res.status(201).json({ data: toVariantResponse(variant), meta: { requestId: getRequestId() } });
  };

const listHandler =
  (useCase: ListProductVariantsUseCase): VendorProductVariantController['list'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, { productId: string }>(req);

    const variants = await useCase.execute({ productId: toProductId(params.productId) });

    // No pagination envelope: a product's variant set is small and only useful
    // whole, the same call `ListCategoryAttributesUseCase` makes.
    res
      .status(200)
      .json({ data: variants.map(toVariantResponse), meta: { requestId: getRequestId() } });
  };

const getHandler =
  (useCase: GetProductVariantUseCase): VendorProductVariantController['get'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, VariantParams>(req);

    const variant = await useCase.execute({
      productId: toProductId(params.productId),
      variantId: toProductVariantId(params.variantId),
    });

    res.status(200).json({ data: toVariantResponse(variant), meta: { requestId: getRequestId() } });
  };

const updateHandler =
  (useCase: UpdateProductVariantUseCase): VendorProductVariantController['update'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'PATCH /vendor/products/:productId/variants/:variantId');
    const { body, params } = validatedData<UpdateProductVariantRequest, unknown, VariantParams>(
      req,
    );

    const { variant } = await useCase.execute({
      principal,
      productId: toProductId(params.productId),
      variantId: toProductVariantId(params.variantId),
      changes: {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.price === undefined ? {} : { price: toMoney(body.price) }),
        ...(body.unitOfMeasure === undefined ? {} : { unitOfMeasure: body.unitOfMeasure }),
        ...(body.quantityStep === undefined ? {} : { quantityStep: body.quantityStep }),
      },
    });

    res.status(200).json({ data: toVariantResponse(variant), meta: { requestId: getRequestId() } });
  };

const removeHandler =
  (useCase: RemoveProductVariantUseCase): VendorProductVariantController['remove'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'DELETE /vendor/products/:productId/variants/:variantId');
    const { params } = validatedData<unknown, unknown, VariantParams>(req);

    const { variant } = await useCase.execute({
      principal,
      productId: toProductId(params.productId),
      variantId: toProductVariantId(params.variantId),
    });

    res.status(200).json({ data: toVariantResponse(variant), meta: { requestId: getRequestId() } });
  };

/**
 * Thin HTTP adapter for the per-product variant surface (S2-3b).
 *
 * A file of its own rather than five more handlers on the product controller
 * — they address a different resource under the same router, the same split
 * `admin-category-attribute.controller.ts` already makes.
 */
export const createVendorProductVariantController = (
  deps: VendorProductVariantControllerDeps,
): VendorProductVariantController => ({
  add: addHandler(deps.addProductVariantUseCase),
  list: listHandler(deps.listProductVariantsUseCase),
  get: getHandler(deps.getProductVariantUseCase),
  update: updateHandler(deps.updateProductVariantUseCase),
  remove: removeHandler(deps.removeProductVariantUseCase),
});
