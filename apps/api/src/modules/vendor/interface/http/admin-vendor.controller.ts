import type { Request, Response } from 'express';
import type {
  ReinstateVendorRequest,
  SuspendVendorRequest,
  VendorStatusChangeResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import { toVendorId } from '../../../identity/index.js';
import type { VendorProfile } from '../../domain/entities/vendor-profile.entity.js';
import type { SuspendVendorUseCase } from '../../application/use-cases/suspend-vendor.use-case.js';
import type { ReinstateVendorUseCase } from '../../application/use-cases/reinstate-vendor.use-case.js';

export interface AdminVendorController {
  readonly suspend: (req: Request, res: Response) => Promise<void>;
  readonly reinstate: (req: Request, res: Response) => Promise<void>;
}

export interface AdminVendorControllerDeps {
  readonly suspendVendorUseCase: SuspendVendorUseCase;
  readonly reinstateVendorUseCase: ReinstateVendorUseCase;
}

/** Mapped field by field, never spread — the same reason every other admin lifecycle-transition mapper in this codebase gives. */
const toVendorStatusChangeResponse = (vendor: VendorProfile): VendorStatusChangeResponse => ({
  id: vendor.id,
  status: vendor.status.name,
});

/** A route reaching a writing handler without a principal is a wiring bug, not a request problem — same shape `admin-user-management.controller.ts`'s own `principalOf` gives. */
const principalOf = (req: Request, route: string): NonNullable<Request['principal']> => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  return req.principal;
};

/**
 * Thin HTTP adapter for the `SUSPEND_VENDOR_OR_USER`-gated vendor
 * suspend/reinstate surface (Phase L.4). Parses nothing itself, decides
 * nothing, translates no errors — `validate()` and the global error handler
 * own those (SDD 17.1).
 */
export const createAdminVendorController = (
  deps: AdminVendorControllerDeps,
): AdminVendorController => ({
  suspend: async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'POST /admin/vendors/:vendorId/suspend');
    const { params, body } = validatedData<SuspendVendorRequest, unknown, { vendorId: string }>(
      req,
    );

    const vendor = await deps.suspendVendorUseCase.execute({
      principal,
      vendorId: toVendorId(params.vendorId),
      reason: body.reason,
    });

    res
      .status(200)
      .json({ data: toVendorStatusChangeResponse(vendor), meta: { requestId: getRequestId() } });
  },

  reinstate: async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'POST /admin/vendors/:vendorId/reinstate');
    const { params, body } = validatedData<ReinstateVendorRequest, unknown, { vendorId: string }>(
      req,
    );

    const vendor = await deps.reinstateVendorUseCase.execute({
      principal,
      vendorId: toVendorId(params.vendorId),
      reason: body.reason,
    });

    res
      .status(200)
      .json({ data: toVendorStatusChangeResponse(vendor), meta: { requestId: getRequestId() } });
  },
});
