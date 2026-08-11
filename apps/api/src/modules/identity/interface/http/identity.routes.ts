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
import type { AuthRateLimiters } from '../../../../shared/interface/http/middleware/auth-rate-limit.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService } from '../../application/ports/access-token.port.js';
import type { SessionDenylist } from '../../application/ports/session-denylist.port.js';
import type { IdentityController } from './identity.controller.js';

/**
 * Rate limiters run *before* `validate()` on every endpoint SDD 23.3 gives a
 * budget for. A limiter placed after validation only counts well-formed
 * requests, which an attacker avoids for free by sending malformed ones.
 */
export const createIdentityRouter = (
  controller: IdentityController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
  rateLimiters: AuthRateLimiters,
): Router => {
  const router = Router();

  router.post(
    '/register',
    validate({ body: registerCustomerRequestSchema }),
    asyncHandler(controller.register),
  );
  router.post(
    '/login',
    ...rateLimiters.login,
    validate({ body: loginRequestSchema }),
    asyncHandler(controller.login),
  );
  router.post(
    '/refresh',
    ...rateLimiters.refresh,
    validate({ body: refreshSessionRequestSchema }),
    asyncHandler(controller.refresh),
  );
  router.post('/logout', validate({ body: logoutRequestSchema }), asyncHandler(controller.logout));
  router.post(
    '/otp/request',
    ...rateLimiters.otpRequest,
    validate({ body: requestOtpRequestSchema }),
    asyncHandler(controller.requestOtp),
  );
  router.post(
    '/otp/verify',
    validate({ body: verifyOtpRequestSchema }),
    asyncHandler(controller.verifyOtp),
  );
  router.get('/me', authenticate(accessTokenService, sessionDenylist), controller.me);

  return router;
};
