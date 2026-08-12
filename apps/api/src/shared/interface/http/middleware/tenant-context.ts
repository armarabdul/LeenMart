import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Principal, UserId, VendorId } from '../../../../modules/identity/index.js';
import { runWithTenant } from '../../../infrastructure/persistence/tenant-context.js';

/** Resolves the vendor a user acts for, or `null` if they act for none. */
export type VendorTenantResolver = (userId: UserId) => Promise<VendorId | null>;

const VENDOR_ROLES = new Set(['VENDOR_OWNER', 'VENDOR_MANAGER', 'VENDOR_STAFF']);

/**
 * Establishes the vendor tenant context for the rest of the request
 * (KYC-2B-2).
 *
 * Mounted **after** `authenticate()` and never before it: resolving a tenant
 * from an unverified token would be taking the caller's word for who they are,
 * which is the one thing this whole mechanism exists to avoid. A request with
 * no principal runs with no context at all, and any tenant-scoped query it
 * reaches fails closed.
 *
 * The lookup happens here rather than in each use case for the same reason
 * `requestId` is ambient: threading `vendorId` through every signature from
 * controller to repository would be a persistence concern spread across the
 * whole application, and the one place it would eventually be forgotten is the
 * one that matters.
 *
 * Only vendor roles are resolved. A customer or an administrator has no vendor
 * tenancy, and inventing one for them would be inventing an authorisation
 * decision — `null` here means "no vendor context", not "denied": whether a
 * given operation *requires* one stays with the operation, so existing domain
 * and application error semantics are untouched.
 *
 * The resolved id is not logged. It is a stable tenant identifier, and a log
 * line carrying it on every request is a correlation key with no reader.
 */
export const tenantContext =
  (resolveVendor: VendorTenantResolver): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const principal: Principal | undefined = req.principal;

    // No principal means no verified identity, so no context at all and every
    // tenant-scoped query below fails closed.
    if (!principal) {
      next();
      return;
    }

    void (async (): Promise<void> => {
      // Every authenticated caller gets `app.user_id`; only vendor roles are
      // looked up for a vendor. A customer registering a vendor needs the
      // former and cannot yet have the latter — which is exactly what the
      // tenant-root INSERT policy is written against.
      const vendorId = VENDOR_ROLES.has(principal.role)
        ? await resolveVendor(principal.userId)
        : null;

      // `next()` runs *inside* the scope, so every downstream handler, use
      // case and repository call inherits it. The returned promise settles
      // when the request finishes rather than when this middleware does, so it
      // is deliberately not awaited — the chain continues on the Express
      // callback as usual.
      void runWithTenant({ userId: principal.userId, vendorId }, () => {
        next();
      });
    })().catch(next);
  };
