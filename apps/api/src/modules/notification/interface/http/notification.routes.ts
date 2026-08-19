import { Router } from 'express';
import {
  notificationInboxQuerySchema,
  notificationListQuerySchema,
  notificationParamsSchema,
} from '@leen-mart/contracts';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { authenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import {
  tenantContext,
  type VendorTenantResolver,
} from '../../../../shared/interface/http/middleware/tenant-context.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { NotificationController } from './notification.controller.js';

/**
 * Mounted at `/api/v1/me` (S6-NOTIFY-INAPP), beside `addresses` and `cart`.
 *
 * **One route family for both audiences.** A vendor owner is a `users` row that
 * also sells, so the customer PWA and the vendor portal call the same endpoints
 * and pass a different `kind`; `recipient_kind` is the only thing that differs,
 * and RLS confines both to the same person's rows either way. A separate
 * `/vendor/notifications` tree would duplicate the infrastructure to express a
 * filter.
 *
 * **No new permission.** SDD 8.2 has no notification row, and these are
 * self-scoped reads of the caller's own data — the same shape `GET /me/cart`
 * and `GET /me/addresses` already have, neither of which carries one. Inventing
 * a permission would be inventing a matrix entry.
 *
 * `tenantContext` is mounted here even though nothing vendor-scoped is read: it
 * is what sets `app.user_id` on the connection, which is what the
 * `notifications_recipient_*` policies are written against. Without it every
 * query would return zero rows — failing closed, but for the wrong reason.
 */
export const createNotificationRouter = (
  controller: NotificationController,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
  resolveVendorTenant: VendorTenantResolver,
): Router => {
  const router = Router();

  router.get(
    '/notifications',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    validate({ query: notificationListQuerySchema }),
    asyncHandler(controller.list),
  );

  // Registered before `/:id/read` for readability; Express treats the literal
  // and the parameterised path as distinct patterns either way.
  router.get(
    '/notifications/unread-count',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    validate({ query: notificationInboxQuerySchema }),
    asyncHandler(controller.unreadCount),
  );

  // POST, not PATCH: this is an action ("I have seen this"), not a partial
  // update of a resource the client may shape — `read_at` is the server's to
  // set, and the body is empty.
  router.post(
    '/notifications/read-all',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    validate({ query: notificationInboxQuerySchema }),
    asyncHandler(controller.markAllRead),
  );

  router.post(
    '/notifications/:id/read',
    authenticate(accessTokenService, sessionDenylist),
    tenantContext(resolveVendorTenant),
    validate({ params: notificationParamsSchema }),
    asyncHandler(controller.markRead),
  );

  return router;
};
