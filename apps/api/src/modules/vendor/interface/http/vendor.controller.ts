import type { Request, Response } from 'express';
import type { RegisterVendorResponse } from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import type { RegisterVendorUseCase } from '../../application/use-cases/register-vendor.use-case.js';

export interface VendorController {
  readonly register: (req: Request, res: Response) => Promise<void>;
}

export interface VendorControllerDeps {
  readonly registerVendorUseCase: RegisterVendorUseCase;
}

/**
 * Thin HTTP adapter: parses nothing itself (that is `validate()`'s job),
 * translates use-case output to the wire envelope, and never translates
 * errors — the global error handler owns that (SDD 17.1).
 */
export const createVendorController = (deps: VendorControllerDeps): VendorController => ({
  register: async (req: Request, res: Response): Promise<void> => {
    // `authenticate()` guarantees `req.principal` is set before this handler
    // runs — reachability without it means the route was wired without the
    // middleware, a programming error, not a client-facing 401 case.
    if (!req.principal) {
      throw new Error(
        'POST /vendors reached without authenticate() middleware — req.principal is unset.',
      );
    }

    const vendor = await deps.registerVendorUseCase.execute({ principal: req.principal });
    const data: RegisterVendorResponse = { id: vendor.id, status: vendor.status.name };
    res.status(201).json({ data, meta: { requestId: getRequestId() } });
  },
});
