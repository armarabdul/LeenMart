import type { Request, Response } from 'express';
import type { AdminLoginStepOneRequest, AdminLoginStepOneResponse } from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type {
  AdminLoginStepOneResult,
  AdminLoginStepOneUseCase,
} from '../../application/use-cases/admin-login-step-one.use-case.js';

export interface AdminAuthController {
  readonly login: (req: Request, res: Response) => Promise<void>;
}

export interface AdminAuthControllerDeps {
  readonly adminLoginStepOneUseCase: AdminLoginStepOneUseCase;
}

const toStepOneResponse = (result: AdminLoginStepOneResult): AdminLoginStepOneResponse => ({
  mfaChallengeToken: result.mfaChallengeToken,
  mfaChallengeTokenExpiresAt: result.mfaChallengeTokenExpiresAt.toISOString(),
});

/**
 * Thin HTTP adapter, same shape as `identity.controller.ts`: parses nothing
 * itself, translates use-case output to the wire envelope, never translates
 * errors (the global error handler owns that, SDD 17.1).
 */
export const createAdminAuthController = (deps: AdminAuthControllerDeps): AdminAuthController => ({
  login: async (req: Request, res: Response): Promise<void> => {
    const { body } = validatedData<AdminLoginStepOneRequest>(req);
    const result = await deps.adminLoginStepOneUseCase.execute(body);
    res.status(200).json({ data: toStepOneResponse(result), meta: { requestId: getRequestId() } });
  },
});
