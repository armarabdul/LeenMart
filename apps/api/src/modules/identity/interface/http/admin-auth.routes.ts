import { Router } from 'express';
import { adminLoginStepOneRequestSchema, adminMfaVerifyRequestSchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AdminAuthController } from './admin-auth.controller.js';

/**
 * Mounted at `/api/v1/admin` (SDD 9.4: a separate surface from
 * `/api/v1/identity`), not merged into `identity.routes.ts` — the admin
 * console is a distinct origin with its own auth flow, even though it's
 * still the identity module's own bounded context (SDD 5).
 */
export const createAdminAuthRouter = (controller: AdminAuthController): Router => {
  const router = Router();

  router.post(
    '/login',
    validate({ body: adminLoginStepOneRequestSchema }),
    asyncHandler(controller.login),
  );
  router.post(
    '/mfa/verify',
    validate({ body: adminMfaVerifyRequestSchema }),
    asyncHandler(controller.verifyMfa),
  );

  return router;
};
