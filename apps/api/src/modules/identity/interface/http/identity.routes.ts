import { Router } from 'express';
import {
  loginRequestSchema,
  logoutRequestSchema,
  refreshSessionRequestSchema,
  registerCustomerRequestSchema,
  requestOtpRequestSchema,
  verifyOtpRequestSchema,
} from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService } from '../../application/ports/access-token.port.js';
import type { IdentityController } from './identity.controller.js';

export const createIdentityRouter = (
  controller: IdentityController,
  accessTokenService: AccessTokenService,
): Router => {
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
  router.post(
    '/otp/request',
    validate({ body: requestOtpRequestSchema }),
    asyncHandler(controller.requestOtp),
  );
  router.post(
    '/otp/verify',
    validate({ body: verifyOtpRequestSchema }),
    asyncHandler(controller.verifyOtp),
  );
  router.get('/me', authenticate(accessTokenService), controller.me);

  return router;
};
