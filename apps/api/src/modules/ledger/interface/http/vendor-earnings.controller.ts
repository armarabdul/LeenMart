import type { Request, Response } from 'express';
import type { VendorEarningsQuery, VendorEarningsResponse } from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type {
  GetVendorEarningsResult,
  GetVendorEarningsUseCase,
} from '../../application/use-cases/get-vendor-earnings.use-case.js';

export interface VendorEarningsController {
  readonly getEarnings: (req: Request, res: Response) => Promise<void>;
}

export interface VendorEarningsControllerDeps {
  readonly getVendorEarningsUseCase: GetVendorEarningsUseCase;
}

const toResponse = (result: GetVendorEarningsResult): VendorEarningsResponse => ({
  summary: {
    vendorId: result.summary.vendorId,
    grossAccrued: result.summary.grossAccrued.toJSON(),
    commission: result.summary.commission.toJSON(),
    netAccrued: result.summary.netAccrued.toJSON(),
  },
  lines: result.lines.items.map((line) => ({
    subOrderId: line.subOrderId,
    orderId: line.orderId,
    paymentAttemptId: line.paymentAttemptId,
    vendorId: line.vendorId,
    occurredAt: line.occurredAt.toISOString(),
    grossAmount: line.grossAmount.toJSON(),
    commissionAmount: line.commissionAmount.toJSON(),
    netAmount: line.netAmount.toJSON(),
  })),
});

/**
 * Thin HTTP adapter for the vendor earnings statement (S3-8). Parses
 * nothing, computes nothing — `validate()`, `GetVendorEarningsUseCase` and
 * the global error handler own those, mirroring `vendor-order.controller.ts`.
 */
export const createVendorEarningsController = (
  deps: VendorEarningsControllerDeps,
): VendorEarningsController => ({
  getEarnings: async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'GET /vendor/earnings reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { query } = validatedData<unknown, VendorEarningsQuery>(req);

    const result = await deps.getVendorEarningsUseCase.execute({
      principal: req.principal,
      limit: query.limit,
      cursor: query.cursor,
    });

    res.status(200).json({
      data: toResponse(result),
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: result.lines.nextCursor, hasMore: result.lines.hasMore },
      },
    });
  },
});
