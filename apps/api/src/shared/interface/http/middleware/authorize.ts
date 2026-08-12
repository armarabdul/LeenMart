import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UnauthorizedError } from '../../../../modules/identity/index.js';
import {
  authorize,
  type AccessLevel,
  type Permission,
} from '../../../../modules/authorization/index.js';

declare module 'express-serve-static-core' {
  interface Request {
    /**
     * The grant that let this request through, set by `requirePermission()`.
     *
     * Carried for SDD 7.4 **step 3**: `OWN` means the caller may act on their
     * own rows and `FULL` on anyone's, and the use case that loads the
     * resource is the only place that distinction can be applied. Surfacing it
     * here means step 3 reads the decision step 2 already made rather than
     * consulting the matrix a second time and risking a different answer.
     */
    accessLevel?: Exclude<AccessLevel, 'NONE'>;
  }
}

/**
 * SDD 7.4 **step 2**: "may this role perform this action at all?" —
 * declarative, checked in the interface layer.
 *
 * Deliberately narrow. It answers one question about a role and a permission,
 * and it does so without loading anything: no resource, no repository, no
 * Prisma, no tenant context. Step 1 (who is this?) is `authenticate()`'s job
 * and step 3 (may they act on *this* object?) belongs to the application
 * layer, which is the only layer that has the object. A middleware that
 * reached for the resource would be doing step 3 in the wrong place and would
 * make the repository tenant scoping behind it redundant rather than
 * defence-in-depth.
 *
 * Mount **after** `authenticate()`. A route that mounts it first has no
 * principal to judge, and that case denies rather than reading `undefined` —
 * an ordering mistake must fail closed, not crash or, worse, pass.
 *
 * Every refusal is the same `UnauthorizedError` (403, `UNAUTHORIZED`), and it
 * never says which permission was missing. A caller learning *which* grant
 * they lack learns the shape of the permission model, and the answer is the
 * same to them either way.
 *
 * **Not wired to any route yet, and that is deliberate.** No endpoint that
 * exists today corresponds to a permission in SDD 8.2's matrix — the 30
 * permissions name catalogue, order, payout, fraud, moderation and KYC-review
 * actions, none of which has been built. `SUBMIT_OR_EDIT_KYC` gets its route
 * with KYC submission and `APPROVE_OR_REJECT_VENDOR_KYC` with the admin review
 * queue; this is here, tested, ready for them.
 */
export const requirePermission = (permission: Permission): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const { principal } = req;

    // Fail closed on a missing principal. `authenticate()` should have run,
    // but "should have" is not a control.
    if (!principal) {
      next(new UnauthorizedError());
      return;
    }

    const decision = authorize(principal.role, permission);

    if (decision.outcome === 'DENY') {
      next(new UnauthorizedError());
      return;
    }

    // SDD 8.2's one annotated cell — VENDOR_OWNER's
    // `CHANGE_PAYOUT_BANK_DETAILS` grant is "◐ (MFA + step-up)" — reaches here
    // as `requiresStepUp`. SDD 7.5 requires step-up re-authentication for it,
    // and **no step-up mechanism exists yet**, so there is nothing that could
    // satisfy the condition this grant depends on.
    //
    // Denying is the only honest answer. Letting it through would treat a
    // conditional grant as an unconditional one and silently drop a control
    // the SDD requires; the policy reports the requirement precisely so this
    // layer cannot ignore it by accident. When step-up is built, this branch
    // becomes "has the caller re-authenticated recently enough?" instead of an
    // unconditional refusal.
    if (decision.requiresStepUp) {
      next(new UnauthorizedError());
      return;
    }

    if (decision.accessLevel) {
      req.accessLevel = decision.accessLevel;
    }
    next();
  };
};
