import type { Request, Response } from 'express';
import type { SetInventoryRequest, VendorInventory } from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { Inventory } from '../../domain/entities/inventory.entity.js';
import { toProductId } from '../../domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../domain/value-objects/product-variant-id.value-object.js';
import type { GetInventoryUseCase } from '../../application/use-cases/get-inventory.use-case.js';
import type { SetInventoryUseCase } from '../../application/use-cases/set-inventory.use-case.js';

export interface VendorInventoryController {
  readonly get: (req: Request, res: Response) => Promise<void>;
  readonly set: (req: Request, res: Response) => Promise<void>;
}

export interface VendorInventoryControllerDeps {
  readonly getInventoryUseCase: GetInventoryUseCase;
  readonly setInventoryUseCase: SetInventoryUseCase;
}

/** Both routes carry both ids: a variant is only ever addressed under its product. */
interface InventoryParams {
  productId: string;
  variantId: string;
}

/**
 * Mapped field by field, never spread — the same reason every other mapper in
 * this module gives. `vendorId` and the creation timestamp are what this must
 * not publish; `version` is what it must.
 */
const toResponse = (inventory: Inventory): VendorInventory => ({
  variantId: inventory.variantId,
  available: inventory.available,
  reserved: inventory.reserved,
  version: inventory.version,
  updatedAt: inventory.updatedAt.toISOString(),
});

/** A route reaching a writing handler without a principal is a wiring bug, not a request problem. */
const principalOf = (req: Request, route: string): NonNullable<Request['principal']> => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  return req.principal;
};

const getHandler =
  (useCase: GetInventoryUseCase): VendorInventoryController['get'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, InventoryParams>(req);

    const inventory = await useCase.execute({
      productId: toProductId(params.productId),
      variantId: toProductVariantId(params.variantId),
    });

    res.status(200).json({ data: toResponse(inventory), meta: { requestId: getRequestId() } });
  };

const setHandler =
  (useCase: SetInventoryUseCase): VendorInventoryController['set'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(
      req,
      'PATCH /vendor/products/:productId/variants/:variantId/inventory',
    );
    const { body, params } = validatedData<SetInventoryRequest, unknown, InventoryParams>(req);

    const { inventory } = await useCase.execute({
      principal,
      productId: toProductId(params.productId),
      variantId: toProductVariantId(params.variantId),
      available: body.available,
      expectedVersion: body.version,
    });

    res.status(200).json({ data: toResponse(inventory), meta: { requestId: getRequestId() } });
  };

/**
 * Thin HTTP adapter for the per-variant stock surface (S2-4). Parses nothing
 * itself, decides nothing, translates no errors — `validate()` and the global
 * error handler own those (SDD 17.1).
 */
export const createVendorInventoryController = (
  deps: VendorInventoryControllerDeps,
): VendorInventoryController => ({
  get: getHandler(deps.getInventoryUseCase),
  set: setHandler(deps.setInventoryUseCase),
});
