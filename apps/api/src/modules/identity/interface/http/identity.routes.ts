import { Router } from 'express';
import {
  loginRequestSchema,
  logoutRequestSchema,
  refreshSessionRequestSchema,
  registerCustomerRequestSchema,
} from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { IdentityController } from './identity.controller.js';

export const createIdentityRouter = (controller: IdentityController): Router => {
  const router = Router();

  router.post(
    '/register',
    validate({ body: registerCustomerRequestSchema }),
    asyncHandler(controller.register),
  );
  router.post('/login', validate({ body: loginRequestSchema }), asyncHandler(controller.login));
  router.post(
    '/refresh',
    validate({ body: refreshSessionRequestSchema }),
    asyncHandler(controller.refresh),
  );
  router.post('/logout', validate({ body: logoutRequestSchema }), asyncHandler(controller.logout));

  return router;
};
