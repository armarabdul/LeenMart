import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

const cartQuantitySchema = z.number().int().positive();

/** POST /api/v1/me/cart/items */
export const addCartItemRequestSchema = z
  .object({
    variantId: uuidSchema,
    quantity: cartQuantitySchema,
  })
  .strict();

/** PATCH /api/v1/me/cart/items/:itemId */
export const updateCartItemRequestSchema = z
  .object({
    quantity: cartQuantitySchema,
  })
  .strict();

/**
 * `vendorId`/`vendorShopName`/`supportsPickup` (S4-QR): the minimum checkout
 * needs to offer a per-vendor DELIVERY/PICKUP choice. A cart line carries
 * only a `variantId`, and the public product-detail contract deliberately
 * withholds `vendorId` — so without these three fields the customer app has
 * no supported way to build `pickupVendorIds`.
 *
 * They are resolved server-side from the variant's own `vendor_id` and that
 * vendor's profile, never accepted from the client. `supportsPickup` is a
 * *display* hint only: `PlaceOrderUseCase` re-checks it against
 * `VendorProfile.supportsPickup` and refuses an unsupported pickup outright
 * rather than downgrading it (locked decision #25).
 *
 * This is the customer's own cart, and they already see `vendorShopName` on
 * the resulting order's sub-orders, so nothing is exposed here that the
 * order response does not already carry.
 */
export const cartItemResponseSchema = z.object({
  id: uuidSchema,
  variantId: uuidSchema,
  quantity: z.number().int(),
  vendorId: uuidSchema,
  vendorShopName: z.string(),
  supportsPickup: z.boolean(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

/** `id` is `null` when the caller has no cart yet (GET never creates one — see `GetCartUseCase`). */
export const cartResponseSchema = z.object({
  id: uuidSchema.nullable(),
  items: z.array(cartItemResponseSchema),
});

/**
 * Shared by both DELETE endpoints (`/cart/items/:itemId` and `/cart`) —
 * neither returns the (now-gone) item(s), same uniform shape as
 * `removeAddressResponseSchema`.
 */
export const cartActionSuccessResponseSchema = z.object({
  success: z.literal(true),
});

export type AddCartItemRequest = z.infer<typeof addCartItemRequestSchema>;
export type UpdateCartItemRequest = z.infer<typeof updateCartItemRequestSchema>;
export type CartItemResponse = z.infer<typeof cartItemResponseSchema>;
export type CartResponse = z.infer<typeof cartResponseSchema>;
export type CartActionSuccessResponse = z.infer<typeof cartActionSuccessResponseSchema>;
