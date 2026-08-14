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

export const cartItemResponseSchema = z.object({
  id: uuidSchema,
  variantId: uuidSchema,
  quantity: z.number().int(),
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
