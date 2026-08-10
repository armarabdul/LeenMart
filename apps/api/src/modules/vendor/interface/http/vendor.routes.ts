import { Router } from 'express';
import { registerVendorRequestSchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService } from '../../../identity/index.js';
import type { VendorController } from './vendor.controller.js';

/**
 * Mounted at `/api/v1/vendors`, so this router's `/` is `POST /api/v1/vendors`
 * — a plural resource created with POST, per SDD 9.2's naming and method
 * conventions. Registration is authenticated: `authenticate()` runs before
 * validation so an anonymous caller is rejected without the body being read.
 * Whether the caller *may* register (CUSTOMER only) is the use case's
 * decision, not this layer's.
 */
export const createVendorRouter = (
  controller: VendorController,
  accessTokenService: AccessTokenService,
): Router => {
  const router = Router();

  router.post(
    '/',
    authenticate(accessTokenService),
    validate({ body: registerVendorRequestSchema }),
    asyncHandler(controller.register),
  );

  return router;
};
