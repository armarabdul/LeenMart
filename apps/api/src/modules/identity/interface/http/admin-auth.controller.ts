import type { Request, Response } from 'express';
import type {
  AdminLoginStepOneRequest,
  AdminLoginStepOneResponse,
  AdminMfaEnrollConfirmRequest,
  AdminMfaEnrollRequest,
  AdminMfaEnrollResponse,
  AdminMfaVerifyRequest,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type {
  AdminLoginStepOneResult,
  AdminLoginStepOneUseCase,
} from '../../application/use-cases/admin-login-step-one.use-case.js';
import type { AdminLoginStepTwoUseCase } from '../../application/use-cases/admin-login-step-two.use-case.js';
import type {
  AdminMfaEnrollResult,
  AdminMfaEnrollUseCase,
} from '../../application/use-cases/admin-mfa-enroll.use-case.js';
import type { AdminMfaEnrollConfirmUseCase } from '../../application/use-cases/admin-mfa-enroll-confirm.use-case.js';
import { toSessionResponse } from './identity.controller.js';

export interface AdminAuthController {
  readonly login: (req: Request, res: Response) => Promise<void>;
  readonly verifyMfa: (req: Request, res: Response) => Promise<void>;
  readonly enrollMfa: (req: Request, res: Response) => Promise<void>;
  readonly confirmMfaEnrollment: (req: Request, res: Response) => Promise<void>;
}

export interface AdminAuthControllerDeps {
  readonly adminLoginStepOneUseCase: AdminLoginStepOneUseCase;
  readonly adminLoginStepTwoUseCase: AdminLoginStepTwoUseCase;
  readonly adminMfaEnrollUseCase: AdminMfaEnrollUseCase;
  readonly adminMfaEnrollConfirmUseCase: AdminMfaEnrollConfirmUseCase;
}

const toStepOneResponse = (result: AdminLoginStepOneResult): AdminLoginStepOneResponse => ({
  mfaChallengeToken: result.mfaChallengeToken,
  mfaChallengeTokenExpiresAt: result.mfaChallengeTokenExpiresAt.toISOString(),
});

const toEnrollResponse = (result: AdminMfaEnrollResult): AdminMfaEnrollResponse => ({
  secret: result.secret,
  otpauthUri: result.otpauthUri,
});

/**
 * Thin HTTP adapter, same shape as `identity.controller.ts`: parses nothing
 * itself, translates use-case output to the wire envelope, never translates
 * errors (the global error handler owns that, SDD 17.1). `verifyMfa` and
 * `confirmMfaEnrollment` both reuse `identity.controller.ts`'s own session
 * mapping — a successful step 2 or a successful enrollment confirmation is
 * a session in exactly the same wire shape as any other login.
 */
export const createAdminAuthController = (deps: AdminAuthControllerDeps): AdminAuthController => ({
  login: async (req: Request, res: Response): Promise<void> => {
    const { body } = validatedData<AdminLoginStepOneRequest>(req);
    const result = await deps.adminLoginStepOneUseCase.execute(body);
    res.status(200).json({ data: toStepOneResponse(result), meta: { requestId: getRequestId() } });
  },

  verifyMfa: async (req: Request, res: Response): Promise<void> => {
    const { body } = validatedData<AdminMfaVerifyRequest>(req);
    const session = await deps.adminLoginStepTwoUseCase.execute(body);
    res.status(200).json({ data: toSessionResponse(session), meta: { requestId: getRequestId() } });
  },

  enrollMfa: async (req: Request, res: Response): Promise<void> => {
    const { body } = validatedData<AdminMfaEnrollRequest>(req);
    const result = await deps.adminMfaEnrollUseCase.execute(body);
    res.status(200).json({ data: toEnrollResponse(result), meta: { requestId: getRequestId() } });
  },

  confirmMfaEnrollment: async (req: Request, res: Response): Promise<void> => {
    const { body } = validatedData<AdminMfaEnrollConfirmRequest>(req);
    const session = await deps.adminMfaEnrollConfirmUseCase.execute(body);
    res.status(200).json({ data: toSessionResponse(session), meta: { requestId: getRequestId() } });
  },
});
