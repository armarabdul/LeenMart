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
import type {
  CartLineVendor,
  CartLineVendorResolver,
} from '../../application/services/cart-line-vendor-resolver.js';

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
  /**
   * S4-QR. Resolved here rather than inside each of the five use cases
   * because all five return the same `CartView` and all five render it
   * through `toCartResponse` — one enrichment point instead of five
   * identical ones. The data is still entirely server-derived; see
   * `CartLineVendorResolver`.
   */
  readonly cartLineVendorResolver: CartLineVendorResolver;
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

const toCartItemResponse = (item: CartItem, vendor: CartLineVendor): CartItemResponse => ({
  id: item.id,
  variantId: item.variantId,
  quantity: item.quantity,
  vendorId: vendor.vendorId,
  vendorShopName: vendor.vendorShopName,
  supportsPickup: vendor.supportsPickup,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
});

/**
 * A line whose vendor could not be resolved is omitted rather than rendered
 * with a placeholder — see `CartLineVendorResolver`. In practice this only
 * happens for a variant whose product or vendor has since become
 * unreadable, which the add-to-cart and checkout eligibility checks already
 * treat as unbuyable.
 */
const toCartResponse = (
  view: CartView,
  vendors: ReadonlyMap<string, CartLineVendor>,
): CartResponse => ({
  id: view.cart?.id ?? null,
  items: view.items.flatMap((item) => {
    const vendor = vendors.get(item.variantId);
    return vendor ? [toCartItemResponse(item, vendor)] : [];
  }),
});

/**
 * Thin HTTP adapter: parses nothing itself (that is `validate()`'s job),
 * translates use-case output to the wire envelope, and never translates
 * errors — the global error handler owns that (SDD 17.1).
 */
export const createCartController = (deps: CartControllerDeps): CartController => {
  const render = async (view: CartView): Promise<CartResponse> =>
    toCartResponse(view, await deps.cartLineVendorResolver.resolve(view.items));

  return {
    getCart: async (req: Request, res: Response): Promise<void> => {
      const principal = requirePrincipal(req, 'GET /me/cart');
      const view = await deps.getCartUseCase.execute({ principal });
      res.status(200).json({ data: await render(view), meta: { requestId: getRequestId() } });
    },

    addItem: async (req: Request, res: Response): Promise<void> => {
      const principal = requirePrincipal(req, 'POST /me/cart/items');
      const { body } = validatedData<AddCartItemRequest>(req);
      const view = await deps.addCartItemUseCase.execute({
        principal,
        variantId: toProductVariantId(body.variantId),
        quantity: body.quantity,
      });
      res.status(201).json({ data: await render(view), meta: { requestId: getRequestId() } });
    },

    updateItemQuantity: async (req: Request, res: Response): Promise<void> => {
      const principal = requirePrincipal(req, 'PATCH /me/cart/items/:itemId');
      const { body, params } = validatedData<UpdateCartItemRequest, unknown, { itemId: string }>(
        req,
      );
      const view = await deps.updateCartItemQuantityUseCase.execute({
        principal,
        itemId: toCartItemId(params.itemId),
        quantity: body.quantity,
      });
      res.status(200).json({ data: await render(view), meta: { requestId: getRequestId() } });
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
  };
};
