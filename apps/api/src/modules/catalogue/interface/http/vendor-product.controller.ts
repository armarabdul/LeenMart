import type { Request, Response } from 'express';
import { Money } from '@leen-mart/domain-kit';
import type {
  CreateProductRequest,
  MoneyDto,
  UpdateProductRequest,
  VendorProduct,
  VendorProductListQuery,
  VendorProductVariant,
} from '@leen-mart/contracts';
import { getTenantContext } from '../../../../shared/infrastructure/persistence/tenant-context.js';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { VendorId } from '../../../identity/index.js';
import type { Product } from '../../domain/entities/product.entity.js';
import type { ProductVariant } from '../../domain/entities/product-variant.entity.js';
import { toCategoryId } from '../../domain/value-objects/category-id.value-object.js';
import { toProductId } from '../../domain/value-objects/product-id.value-object.js';
import type { CreateProductUseCase } from '../../application/use-cases/create-product.use-case.js';
import type { DeleteProductUseCase } from '../../application/use-cases/delete-product.use-case.js';
import type { GetProductUseCase } from '../../application/use-cases/get-product.use-case.js';
import type { ListProductsUseCase } from '../../application/use-cases/list-products.use-case.js';
import type { SubmitProductForReviewUseCase } from '../../application/use-cases/submit-product-for-review.use-case.js';
import type { UpdateProductUseCase } from '../../application/use-cases/update-product.use-case.js';

export interface VendorProductController {
  readonly create: (req: Request, res: Response) => Promise<void>;
  readonly list: (req: Request, res: Response) => Promise<void>;
  readonly get: (req: Request, res: Response) => Promise<void>;
  readonly update: (req: Request, res: Response) => Promise<void>;
  readonly remove: (req: Request, res: Response) => Promise<void>;
  readonly submit: (req: Request, res: Response) => Promise<void>;
}

export interface VendorProductControllerDeps {
  readonly createProductUseCase: CreateProductUseCase;
  readonly updateProductUseCase: UpdateProductUseCase;
  readonly getProductUseCase: GetProductUseCase;
  readonly listProductsUseCase: ListProductsUseCase;
  readonly deleteProductUseCase: DeleteProductUseCase;
  readonly submitProductForReviewUseCase: SubmitProductForReviewUseCase;
}

/**
 * Mapped field by field, never spread — the same reason every other mapper in
 * this module gives. `deletedAt` and `vendorId` are the two fields this must
 * not publish: the first is internal lifecycle, the second is the tenant
 * anchor the caller never needs told back to them.
 */
export const toProductResponse = (product: Product): VendorProduct => ({
  id: product.id,
  categoryId: product.categoryId,
  name: product.name,
  brand: product.brand,
  description: product.description,
  hsnCode: product.hsnCode,
  countryOfOrigin: product.countryOfOrigin,
  netQuantity: product.netQuantity,
  attributeValues: product.attributeValues,
  status: product.status,
  rejectionReason: (product.rejectionReason?.name as VendorProduct['rejectionReason']) ?? null,
  rejectionNote: product.rejectionNote,
  createdAt: product.createdAt.toISOString(),
  updatedAt: product.updatedAt.toISOString(),
});

export const toVariantResponse = (variant: ProductVariant): VendorProductVariant => ({
  id: variant.id,
  productId: variant.productId,
  sku: variant.sku,
  name: variant.name,
  // Integer minor units on the wire (SDD 9.2), never a decimal string.
  price: { amount: variant.price.amountMinor.toString(), currency: variant.price.currency },
  unitOfMeasure: variant.unitOfMeasure,
  quantityStep: variant.quantityStep,
  createdAt: variant.createdAt.toISOString(),
  updatedAt: variant.updatedAt.toISOString(),
});

/** The wire's `{ amount, currency }` back into the domain's `Money`. */
export const toMoney = (dto: MoneyDto): Money => Money.fromMinor(BigInt(dto.amount), dto.currency);

/**
 * The verified caller and the vendor they are acting as.
 *
 * The vendor comes from the **same ambient tenant context the repositories
 * read** (`tenantContext` middleware upstream), not from the body and not
 * from a second lookup. That is what makes the id this handler writes and the
 * id RLS enforces the same id by construction rather than by agreement — and
 * it is why `catalogue` needs no dependency on the `vendor` module to know
 * whose product it is creating (S2-3 D-1).
 *
 * Either absence is a wiring bug rather than a request problem: `authenticate`
 * and `tenantContext` both sit ahead of every route here.
 */
const contextOf = (
  req: Request,
  route: string,
): { principal: NonNullable<Request['principal']>; vendorId: VendorId } => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  const tenant = getTenantContext();
  if (tenant?.kind !== 'authenticated' || !tenant.vendorId) {
    throw new Error(`${route} reached without a resolved vendor tenant context.`);
  }
  return { principal: req.principal, vendorId: tenant.vendorId };
};

const createHandler =
  (useCase: CreateProductUseCase): VendorProductController['create'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { principal, vendorId } = contextOf(req, 'POST /vendor/products');
    const { body } = validatedData<CreateProductRequest>(req);

    const { product, variant } = await useCase.execute({
      principal,
      // From the tenant context, never the body — the request cannot name a
      // vendor and `.strict()` refuses one if it tries.
      vendorId,
      categoryId: toCategoryId(body.categoryId),
      name: body.name,
      brand: body.brand ?? null,
      description: body.description ?? null,
      hsnCode: body.hsnCode ?? null,
      countryOfOrigin: body.countryOfOrigin ?? null,
      netQuantity: body.netQuantity ?? null,
      attributeValues: body.attributeValues ?? {},
      variant: {
        sku: body.variant.sku,
        name: body.variant.name,
        price: toMoney(body.variant.price),
        unitOfMeasure: body.variant.unitOfMeasure,
        quantityStep: body.variant.quantityStep,
      },
    });

    res.status(201).json({
      data: { product: toProductResponse(product), variant: toVariantResponse(variant) },
      meta: { requestId: getRequestId() },
    });
  };

const listHandler =
  (useCase: ListProductsUseCase): VendorProductController['list'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { query } = validatedData<unknown, VendorProductListQuery>(req);

    const page = await useCase.execute({ limit: query.limit, cursor: query.cursor });

    res.status(200).json({
      data: page.items.map(toProductResponse),
      // The platform's existing pagination envelope (SDD 9.3).
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      },
    });
  };

const getHandler =
  (useCase: GetProductUseCase): VendorProductController['get'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, { productId: string }>(req);

    const product = await useCase.execute({ productId: toProductId(params.productId) });

    res.status(200).json({ data: toProductResponse(product), meta: { requestId: getRequestId() } });
  };

const updateHandler =
  (useCase: UpdateProductUseCase): VendorProductController['update'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { principal } = contextOf(req, 'PATCH /vendor/products/:productId');
    const { body, params } = validatedData<UpdateProductRequest, unknown, { productId: string }>(
      req,
    );

    const { product } = await useCase.execute({
      principal,
      productId: toProductId(params.productId),
      changes: {
        ...(body.categoryId === undefined ? {} : { categoryId: toCategoryId(body.categoryId) }),
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.brand === undefined ? {} : { brand: body.brand }),
        ...(body.description === undefined ? {} : { description: body.description }),
        ...(body.hsnCode === undefined ? {} : { hsnCode: body.hsnCode }),
        ...(body.countryOfOrigin === undefined ? {} : { countryOfOrigin: body.countryOfOrigin }),
        ...(body.netQuantity === undefined ? {} : { netQuantity: body.netQuantity }),
        ...(body.attributeValues === undefined ? {} : { attributeValues: body.attributeValues }),
      },
    });

    res.status(200).json({ data: toProductResponse(product), meta: { requestId: getRequestId() } });
  };

const removeHandler =
  (useCase: DeleteProductUseCase): VendorProductController['remove'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { principal } = contextOf(req, 'DELETE /vendor/products/:productId');
    const { params } = validatedData<unknown, unknown, { productId: string }>(req);

    const { product } = await useCase.execute({
      principal,
      productId: toProductId(params.productId),
    });

    res.status(200).json({ data: toProductResponse(product), meta: { requestId: getRequestId() } });
  };

const submitHandler =
  (useCase: SubmitProductForReviewUseCase): VendorProductController['submit'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { principal } = contextOf(req, 'POST /vendor/products/:productId/submit');
    const { params } = validatedData<unknown, unknown, { productId: string }>(req);

    const { product } = await useCase.execute({
      principal,
      productId: toProductId(params.productId),
    });

    res.status(200).json({ data: toProductResponse(product), meta: { requestId: getRequestId() } });
  };

/**
 * Thin HTTP adapter for the vendor product surface (S2-3b/S2-5). Parses
 * nothing itself, decides nothing, translates no errors — `validate()` and
 * the global error handler own those (SDD 17.1).
 */
export const createVendorProductController = (
  deps: VendorProductControllerDeps,
): VendorProductController => ({
  create: createHandler(deps.createProductUseCase),
  list: listHandler(deps.listProductsUseCase),
  get: getHandler(deps.getProductUseCase),
  update: updateHandler(deps.updateProductUseCase),
  remove: removeHandler(deps.deleteProductUseCase),
  submit: submitHandler(deps.submitProductForReviewUseCase),
});
