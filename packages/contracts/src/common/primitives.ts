import { z } from 'zod';

/**
 * Reusable field-level schemas.
 *
 * Business modules compose these rather than re-declaring a phone or money
 * shape, so a change to the phone format propagates everywhere at once.
 */
export const uuidSchema = z.string().uuid();

/** E.164, India-first (ASM-01). */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+91[6-9]\d{9}$/, 'Must be a valid Indian mobile number in E.164 format (+91XXXXXXXXXX)');

export const emailSchema = z.string().trim().toLowerCase().email().max(254);

export const pincodeSchema = z.string().regex(/^[1-9]\d{5}$/, 'Must be a valid 6-digit PIN code');

/** Money on the wire: integer minor units as a string (SDD 9.2). */
export const moneySchema = z.object({
  amount: z.string().regex(/^-?\d+$/, 'Amount must be an integer number of minor units'),
  currency: z.literal('INR'),
});

export const isoDateTimeSchema = z.string().datetime({ offset: true });

/** Cursor pagination (SDD 9.2): offset pagination skips rows under concurrent inserts. */
export const cursorPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export type MoneyDto = z.infer<typeof moneySchema>;
export type CursorPagination = z.infer<typeof cursorPaginationSchema>;
