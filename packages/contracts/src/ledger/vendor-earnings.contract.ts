import { z } from 'zod';
import {
  cursorPaginationSchema,
  isoDateTimeSchema,
  moneySchema,
  uuidSchema,
} from '../common/primitives.js';

/**
 * The vendor earnings statement (S3-8) — a read-only view over the S3-7
 * ledger. Deliberately named "accrued"/"gross"/"commission"/"net accrued"
 * throughout, never "payable" or "payout": locked decision #1 draws a hard
 * line between "earned so far" (this) and "paid out" (BR-04, unresolved,
 * out of scope). No field here can be read as a payout promise.
 */
export const vendorEarningsSummarySchema = z
  .object({
    vendorId: uuidSchema,
    grossAccrued: moneySchema,
    commission: moneySchema,
    netAccrued: moneySchema,
  })
  .strict();

/** One accrual event — a sub-order's captured payment paired with its (possibly zero) commission. */
export const vendorEarningsLineSchema = z
  .object({
    subOrderId: uuidSchema,
    orderId: uuidSchema,
    paymentAttemptId: uuidSchema,
    vendorId: uuidSchema,
    occurredAt: isoDateTimeSchema,
    grossAmount: moneySchema,
    commissionAmount: moneySchema,
    netAmount: moneySchema,
  })
  .strict();

/** `GET /api/v1/vendor/earnings` query — the platform's existing cursor convention (SDD 9.2), nothing else. */
export const vendorEarningsQuerySchema = cursorPaginationSchema.strict();

/** One endpoint, summary + one page of lines (locked decision #4) — no separate lines endpoint. */
export const vendorEarningsResponseSchema = z
  .object({
    summary: vendorEarningsSummarySchema,
    lines: z.array(vendorEarningsLineSchema),
  })
  .strict();

export type VendorEarningsSummaryResponse = z.infer<typeof vendorEarningsSummarySchema>;
export type VendorEarningsLineResponse = z.infer<typeof vendorEarningsLineSchema>;
export type VendorEarningsQuery = z.infer<typeof vendorEarningsQuerySchema>;
export type VendorEarningsResponse = z.infer<typeof vendorEarningsResponseSchema>;
