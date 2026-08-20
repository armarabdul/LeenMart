import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../../../identity/index.js';
import { getTenantContext } from '../../../../shared/infrastructure/persistence/tenant-context.js';
import type { VendorStreamRegistry } from '../../infrastructure/realtime/vendor-stream-registry.js';

export interface VendorStreamController {
  readonly stream: (req: Request, res: Response, next: NextFunction) => Promise<void>;
}

/**
 * `GET /api/v1/vendor/stream` (S4-SSE, FR-64, SDD §11.5).
 *
 * **Vendor identity comes exclusively from the tenant context** — never a
 * request parameter, query string, or body (locked decision N-2/#13). After
 * `authenticate` → `tenantContext` → `requirePermission('VIEW_VENDOR_ORDERS')`
 * have all run, `getTenantContext()` carries the `VendorId` `tenantContext`
 * already resolved from the verified `principal.userId`. A role that holds
 * `VIEW_VENDOR_ORDERS` but resolves no vendor tenant — `SUPPORT_AGENT`,
 * `FINANCE_ADMIN`, `RISK_ANALYST`, `SUPER_ADMIN`, all `READ_ONLY`/`FULL` in
 * the matrix — is refused here, the same "fail closed on no resolved
 * context" the existing vendor-order routes already rely on RLS for; this
 * route has no RLS to fall back on, so the refusal is explicit instead of
 * silent.
 *
 * **The 403 is sent before any SSE header.** `res.writeHead`/`flushHeaders`
 * happen only after this check passes, so a refusal is an ordinary JSON
 * error response through the existing global error handler — no special
 * casing needed there.
 */
export const createVendorStreamController = (
  registry: VendorStreamRegistry,
): VendorStreamController => ({
  stream: (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const context = getTenantContext();
    const vendorId = context?.kind === 'authenticated' ? context.vendorId : null;

    if (!vendorId) {
      next(new UnauthorizedError());
      return Promise.resolve();
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    const unregister = registry.register(vendorId, res);

    req.on('close', () => {
      unregister();
    });

    return Promise.resolve();
  },
});
