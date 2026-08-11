import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UnauthenticatedError } from '@leen-mart/domain-kit';
import type {
  AccessTokenService,
  Principal,
  SessionDenylist,
} from '../../../../modules/identity/index.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Populated by `authenticate()`. Handlers read this, never re-verify the token. */
    principal?: Principal;
  }
}

const BEARER_PREFIX = 'Bearer ';

const authenticationRequired = (): UnauthenticatedError =>
  new UnauthenticatedError('Authentication is required.', { code: 'INVALID_ACCESS_TOKEN' });

/**
 * Authentication middleware (SDD 7.4 step 1: "who is this?").
 *
 * Two questions, both of which must pass. The token has to be *valid*
 * (signature, issuer, audience, expiry — `AccessTokenService.verify`), and
 * the session behind it has to still be *alive* (`SessionDenylist`). The
 * second is not redundant: an access token is a bearer credential that stays
 * signature-valid until `exp`, so without the denylist check a logged-out or
 * reuse-revoked session keeps authenticating for the remainder of the token's
 * life — the exact gap SDD 7.2's revocation design exists to close.
 *
 * This is authentication only — it never checks *what* the caller may do (SDD
 * 7.4 step 2, the `authorization` module's `authorize()`) or resource
 * ownership (step 3); both are separate, later concerns and are deliberately
 * not invoked here.
 *
 * Every failure path — missing header, wrong scheme, empty token, a token
 * `verify()` rejects, or a denied session — produces the identical
 * `UnauthenticatedError`/`INVALID_ACCESS_TOKEN` response, so a caller cannot
 * distinguish *why* authentication failed, and in particular cannot use the
 * response to discover that a session was revoked (SEC-15).
 */
export const authenticate =
  (accessTokenService: AccessTokenService, sessionDenylist: SessionDenylist): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header('authorization');
    if (!header?.startsWith(BEARER_PREFIX)) {
      next(authenticationRequired());
      return;
    }

    const token = header.slice(BEARER_PREFIX.length).trim();
    if (!token) {
      next(authenticationRequired());
      return;
    }

    // Verification is synchronous but the denylist lookup is not, so the
    // whole check runs in a promise chain and every rejection is handed to
    // `next` — an unhandled rejection here would fail open, admitting the
    // request instead of refusing it.
    void (async (): Promise<void> => {
      const claims = accessTokenService.verify(token);
      if (await sessionDenylist.isDenied(claims.sid)) {
        throw authenticationRequired();
      }
      req.principal = { userId: claims.sub, sessionId: claims.sid, role: claims.role };
    })().then(next, next);
  };
