import { Router } from 'express';
import { listAuditLogEntriesQuerySchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { requirePermission } from '../../../../shared/interface/http/middleware/authorize.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { AdminAuditLogController } from './admin-audit-log.controller.js';

/**
 * Mounted at `/api/v1/admin/audit-logs` (Phase L.3) — the read-only surface
 * over the platform's audit trail (SDD 18.4).
 *
 * `VIEW_AUDIT_LOG` is `READ_ONLY` for FINANCE_ADMIN and RISK_ANALYST and
 * `FULL` for SUPER_ADMIN in `PERMISSION_MATRIX` — everyone else `NONE`.
 * **Deliberately no `requireFullAccess`**, unlike
 * `admin-user-management.routes.ts`: this route only ever reads, so there is
 * no write action for the READ_ONLY/FULL distinction to gate, and adding the
 * guard would silently exclude FINANCE_ADMIN and RISK_ANALYST from a grant
 * the matrix already gives them — the same reasoning
 * `admin-kyc.routes.ts` states for its own queue/detail reads.
 *
 * No tenant context, the same reasoning `admin-category.routes.ts` and
 * `admin-kyc.routes.ts` both give: `audit_logs` is platform-owned, carries no
 * vendor column, and reads on the plain `leenmart_app` credential — the same
 * client `AmbientAuditWriter` already writes through (SDD 5.1: no elevated
 * `adminPrisma` needed for a table with no RLS policy at all).
 */
export const createAdminAuditLogRouter = (
  controller: AdminAuditLogController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
): Router => {
  const router = Router();

  router.get(
    '/',
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('VIEW_AUDIT_LOG'),
    validate({ query: listAuditLogEntriesQuerySchema }),
    asyncHandler(controller.list),
  );

  return router;
};
