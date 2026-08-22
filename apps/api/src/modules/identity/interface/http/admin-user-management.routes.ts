import { Router } from 'express';
import { createAdminUserRequestSchema, listAdminUsersQuerySchema } from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import {
  requireFullAccess,
  requirePermission,
} from '../../../../shared/interface/http/middleware/authorize.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService } from '../../application/ports/access-token.port.js';
import type { SessionDenylist } from '../../application/ports/session-denylist.port.js';
import type { AdminUserManagementController } from './admin-user-management.controller.js';

/**
 * Mounted at `/api/v1/admin/users` (SDD 9.4) — SUPER_ADMIN-gated management
 * of subordinate administrator accounts (SDD 8.1/8.2, Phase L.2), the flow
 * `BootstrapAdminUseCase`'s own doc comment names as what a second and
 * later admin account must come from.
 *
 * `MANAGE_ADMIN_USERS_OR_ROLES` is `FULL` only for SUPER_ADMIN in
 * `PERMISSION_MATRIX` — no role holds a `READ_ONLY` grant on it — so
 * `requireFullAccess` on both routes, including the list, is not a
 * narrower rule than the permission itself grants anyone; it is what makes
 * a same-permission-different-access-level bug (the kind
 * `admin-category.routes.ts` warns about) impossible to introduce here by
 * omission.
 *
 * No tenant context, the same reasoning `admin-category.routes.ts` and
 * `admin-auth.routes.ts` both give: `users` is platform-owned, carries no
 * vendor column, and every identity route already runs on the plain
 * `leenmart_app` credential with no tenant established.
 */
export const createAdminUserManagementRouter = (
  controller: AdminUserManagementController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
): Router => {
  const router = Router();
  const authenticated = [
    authenticate(accessTokenService, sessionDenylist),
    requirePermission('MANAGE_ADMIN_USERS_OR_ROLES'),
    requireFullAccess,
  ];

  router.post(
    '/',
    ...authenticated,
    validate({ body: createAdminUserRequestSchema }),
    asyncHandler(controller.create),
  );
  router.get(
    '/',
    ...authenticated,
    validate({ query: listAdminUsersQuerySchema }),
    asyncHandler(controller.list),
  );

  return router;
};
