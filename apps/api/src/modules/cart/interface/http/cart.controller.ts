import type { Request, Response } from 'express';
import type {
  AddCartItemRequest,
  CartActionSuccessResponse,
  CartItemResponse,
  CartResponse,
  UpdateCartItemRequest,
} from '@leen-mart/contracts';
import { toProductVariantId } from '../../../catalogue/index.js';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { CartItem } from '../../domain/entities/cart-item.entity.js';
import { toCartItemId } from '../../domain/value-objects/cart-item-id.value-object.js';
import type { AddCartItemUseCase } from '../../application/use-cases/add-cart-item.use-case.js';
import type { CartView } from '../../application/use-cases/get-cart.use-case.js';
import type { ClearCartUseCase } from '../../application/use-cases/clear-cart.use-case.js';
import type { GetCartUseCase } from '../../application/use-cases/get-cart.use-case.js';
import type { RemoveCartItemUseCase } from '../../application/use-cases/remove-cart-item.use-case.js';
import type { UpdateCartItemQuantityUseCase } from '../../application/use-cases/update-cart-item-quantity.use-case.js';

export interface CartController {
  readonly getCart: (req: Request, res: Response) => Promise<void>;
  readonly addItem: (req: Request, res: Response) => Promise<void>;
  readonly updateItemQuantity: (req: Request, res: Response) => Promise<void>;
  readonly removeItem: (req: Request, res: Response) => Promise<void>;
  readonly clearCart: (req: Request, res: Response) => Promise<void>;
}

export interface CartControllerDeps {
  readonly getCartUseCase: GetCartUseCase;
  readonly addCartItemUseCase: AddCartItemUseCase;
  readonly updateCartItemQuantityUseCase: UpdateCartItemQuantityUseCase;
  readonly removeCartItemUseCase: RemoveCartItemUseCase;
  readonly clearCartUseCase: ClearCartUseCase;
}

const requirePrincipal = (req: Request, route: string): NonNullable<Request['principal']> => {
  // `authenticate()` guarantees `req.principal` is set before any handler
  // here runs — reachability without it means the route was wired without
  // the middleware, a programming error, not a client-facing 401 case.
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  return req.principal;
};

const toCartItemResponse = (item: CartItem): CartItemResponse => ({
  id: item.id,
  variantId: item.variantId,
  quantity: item.quantity,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

const toCartResponse = (view: CartView): CartResponse => ({
  id: view.cart?.id ?? null,
  items: view.items.map(toCartItemResponse),
});

/**
 * Thin HTTP adapter: parses nothing itself (that is `validate()`'s job),
 * translates use-case output to the wire envelope, and never translates
 * errors — the global error handler owns that (SDD 17.1).
 */
export const createCartController = (deps: CartControllerDeps): CartController => ({
  getCart: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'GET /me/cart');
    const view = await deps.getCartUseCase.execute({ principal });
    res.status(200).json({ data: toCartResponse(view), meta: { requestId: getRequestId() } });
  },

  addItem: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'POST /me/cart/items');
    const { body } = validatedData<AddCartItemRequest>(req);
    const view = await deps.addCartItemUseCase.execute({
      principal,
      variantId: toProductVariantId(body.variantId),
      quantity: body.quantity,
    });
    res.status(201).json({ data: toCartResponse(view), meta: { requestId: getRequestId() } });
  },

  updateItemQuantity: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'PATCH /me/cart/items/:itemId');
    const { body, params } = validatedData<UpdateCartItemRequest, unknown, { itemId: string }>(req);
    const view = await deps.updateCartItemQuantityUseCase.execute({
      principal,
      itemId: toCartItemId(params.itemId),
      quantity: body.quantity,
    });
    res.status(200).json({ data: toCartResponse(view), meta: { requestId: getRequestId() } });
  },

  removeItem: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'DELETE /me/cart/items/:itemId');
    const { params } = validatedData<unknown, unknown, { itemId: string }>(req);
    await deps.removeCartItemUseCase.execute({ principal, itemId: toCartItemId(params.itemId) });
    const data: CartActionSuccessResponse = { success: true };
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },

  clearCart: async (req: Request, res: Response): Promise<void> => {
    const principal = requirePrincipal(req, 'DELETE /me/cart');
    await deps.clearCartUseCase.execute({ principal });
    const data: CartActionSuccessResponse = { success: true };
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },
});
