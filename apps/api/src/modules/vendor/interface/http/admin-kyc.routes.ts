import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  adminKycQueueQuerySchema,
  decideVendorKycRequestSchema,
  startKycReviewRequestSchema,
} from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { requirePermission } from '../../../../shared/interface/http/middleware/authorize.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import {
  UnauthorizedError,
  type AccessTokenService,
  type SessionDenylist,
} from '../../../identity/index.js';
import type { AdminKycController } from './admin-kyc.controller.js';

const kycIdParamsSchema = z.object({ kycId: z.string().uuid() }).strict();

const kycDocumentParamsSchema = z
  .object({ kycId: z.string().uuid(), documentId: z.string().uuid() })
  .strict();

/**
 * Refuses a grant the matrix marks `READ_ONLY`.
 *
 * Not a second authorisation mechanism and not a role check: it reads the
 * `accessLevel` `requirePermission` already derived from `PERMISSION_MATRIX`,
 * so the matrix stays the only place roles are named. SDD 7.4 step 2 asks "may
 * this role perform this action at all?", and for a writing route the honest
 * answer for a READ_ONLY grant is no — the same 403, since a caller learning
 * *which* half of the grant they lack learns the shape of the model.
 */
const requireFullAccess: RequestHandler = (req, _res, next) => {
  next(req.accessLevel === 'FULL' ? undefined : new UnauthorizedError());
};

/**
 * Mounted at `/api/v1/admin/kyc` — the admin surface (SDD 9.4), separate from
 * the vendor-facing `/api/v1/vendors` router even though both belong to the
 * `vendor` module's bounded context.
 *
 * **`tenantContext` is deliberately absent.** Every other authenticated route
 * establishes it; these must not. A tenant context binds the database session
 * to one vendor, and this queue is cross-tenant by definition — establishing
 * one would either scope an administrator to a vendor they do not have, or
 * require inventing a fake one. The authority here is instead the
 * `leenmart_admin` credential's `SELECT` policies plus `requirePermission`,
 * which is why the handlers reach `adminPrisma` and never the tenant-scoped
 * client.
 *
 * Ordering is SDD 7.4's questions in sequence: `authenticate` ("who is
 * this?"), then `requirePermission` ("may this role do this at all?"), then
 * validation. Validation runs last on purpose — an unauthorised caller is
 * refused before their query string is parsed.
 *
 * `APPROVE_OR_REJECT_VENDOR_KYC` is the permission for both routes. The matrix
 * grants it `FULL` to RISK_ANALYST and SUPER_ADMIN and `READ_ONLY` to
 * CATALOGUE_MODERATOR and FINANCE_ADMIN — all four may therefore read, which
 * is exactly the intent, and the read/write distinction those levels draw
 * becomes load-bearing only when Commit 3 adds the decision routes.
 */
export const createAdminKycRouter = (
  controller: AdminKycController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
): Router => {
  const router = Router();

  router.get(
    '/submissions',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('APPROVE_OR_REJECT_VENDOR_KYC'),
    validate({ query: adminKycQueueQuerySchema }),
    asyncHandler(controller.listQueue),
  );

  router.get(
    '/submissions/:kycId',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('APPROVE_OR_REJECT_VENDOR_KYC'),
    validate({ params: kycIdParamsSchema }),
    asyncHandler(controller.getSubmission),
  );

  // The decision routes carry the same permission as the reads above. SDD
  // 8.2's matrix already draws the line this commit needs: RISK_ANALYST and
  // SUPER_ADMIN hold `APPROVE_OR_REJECT_VENDOR_KYC` as FULL, CATALOGUE_MODERATOR
  // and FINANCE_ADMIN as READ_ONLY. `requirePermission` surfaces that as
  // `req.accessLevel`, and `requireFullAccess` below is what turns a READ_ONLY
  // grant into a refusal — the read/write distinction the matrix has always
  // encoded, enforced at the first route that can write.
  router.post(
    '/submissions/:kycId/review',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('APPROVE_OR_REJECT_VENDOR_KYC'),
    requireFullAccess,
    validate({ params: kycIdParamsSchema, body: startKycReviewRequestSchema }),
    asyncHandler(controller.startReview),
  );

  router.post(
    '/submissions/:kycId/decision',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('APPROVE_OR_REJECT_VENDOR_KYC'),
    requireFullAccess,
    validate({ params: kycIdParamsSchema, body: decideVendorKycRequestSchema }),
    asyncHandler(controller.decide),
  );

  // KYC-7 (SDD 12.1/12.3): document access is FULL-admin only, the same line
  // `requireFullAccess` already draws for claim and decision — a READ_ONLY
  // grant may see that a document exists (the queue/detail routes above) but
  // not reach its evidence.
  router.get(
    '/submissions/:kycId/documents/:documentId',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('APPROVE_OR_REJECT_VENDOR_KYC'),
    requireFullAccess,
    validate({ params: kycDocumentParamsSchema }),
    asyncHandler(controller.accessDocument),
  );

  return router;
};
