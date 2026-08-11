import { Router } from 'express';
import { z } from 'zod';
import {
  addAddressRequestSchema,
  updateAddressRequestSchema,
  uuidSchema,
} from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService } from '../../../identity/index.js';
import type { AddressController } from './address.controller.js';

const addressParamsSchema = z.object({ id: uuidSchema }).strict();

/**
 * Mounted at `/api/v1/me` (SDD 9.4: "Customer self-service | /api/v1/me/*
 * | customer") — every route here requires `authenticate()` and always
 * scopes to the resulting `principal.userId`, never a client-supplied one.
 */
export const createAddressRouter = (
  controller: AddressController,
  accessTokenService: AccessTokenService,
): Router => {
  const router = Router();
  const requireAuth = authenticate(accessTokenService);

  router.post(
    '/addresses',
    requireAuth,
    validate({ body: addAddressRequestSchema }),
    asyncHandler(controller.add),
  );
  router.get('/addresses', requireAuth, asyncHandler(controller.list));
  router.patch(
    '/addresses/:id',
    requireAuth,
    validate({ params: addressParamsSchema, body: updateAddressRequestSchema }),
    asyncHandler(controller.update),
  );
  router.delete(
    '/addresses/:id',
    requireAuth,
    validate({ params: addressParamsSchema }),
    asyncHandler(controller.remove),
  );
  router.post(
    '/addresses/:id/default',
    requireAuth,
    validate({ params: addressParamsSchema }),
    asyncHandler(controller.setDefault),
  );

  return router;
};
