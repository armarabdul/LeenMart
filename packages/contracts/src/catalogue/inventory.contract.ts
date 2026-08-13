import { z } from 'zod';
import { isoDateTimeSchema, uuidSchema } from '../common/primitives.js';

/**
 * A stock figure. Whole, non-negative, and bounded by the column's `INTEGER`.
 *
 * The lower bound is the same rule `chk_inventory_available_non_negative`
 * enforces in PostgreSQL — SDD 14.4 is explicit that the database is what
 * makes overselling impossible, and this is the copy that gives a vendor a
 * field-level message instead of a constraint violation.
 */
export const stockCountSchema = z.number().int().min(0).max(2_147_483_647);

/**
 * The version the vendor read before editing (S2-4 D-B).
 *
 * Required rather than optional, and that is the point: an update that does
 * not say which state it was based on cannot be checked against anything, and
 * "last writer wins" on a stock figure means quietly wrong numbers rather than
 * a visible failure.
 */
export const setInventoryRequestSchema = z
  .object({
    available: stockCountSchema,
    version: z.number().int().positive(),
  })
  .strict();

/**
 * One variant's stock, as its owning vendor sees it.
 *
 * `version` is part of the response on purpose — it is what the next `PATCH`
 * sends back, and without it the optimistic guard has nothing to compare.
 *
 * `reserved` is exposed read-only: SDD 6.3 names it, Stage 3's reservation
 * flow will own it, and nothing in Stage 2 moves it. `vendorId` is absent for
 * the same reason it is absent from the product response — the caller is the
 * vendor and never needs telling.
 */
export const vendorInventorySchema = z
  .object({
    variantId: uuidSchema,
    available: z.number().int().min(0),
    reserved: z.number().int().min(0),
    version: z.number().int().positive(),
    updatedAt: isoDateTimeSchema,
  })
  .strict();

export type SetInventoryRequest = z.infer<typeof setInventoryRequestSchema>;
export type VendorInventory = z.infer<typeof vendorInventorySchema>;
