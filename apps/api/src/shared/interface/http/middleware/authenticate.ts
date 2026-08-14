import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UnauthenticatedError } from '@leen-mart/domain-kit';
import type {
  AccessTokenService,
  Principal,
  SessionDenylist,
} from '../../../../modules/identity/index.js';

declare module 'express-serve-static-core' {
  interface Request {
    /** Populated by `authenticate()`/`optionalAuthenticate()`. Handlers read this, never re-verify the token. */
    principal?: Principal;
  }
}

const BEARER_PREFIX = 'Bearer ';

const authenticationRequired = (): UnauthenticatedError =>
  new UnauthenticatedError('Authentication is required.', { code: 'INVALID_ACCESS_TOKEN' });

/**
 * The shared verify step both `authenticate` and `optionalAuthenticate` run
 * once a `Bearer` token is on the table — token signature/issuer/audience/
 * expiry, then the denylist. Factored out so the two middlewares cannot drift
 * on what "invalid" means; they differ only in what happens when there is no
 * token to verify at all.
 */
const verifyBearerToken = async (
  token: string,
  accessTokenService: AccessTokenService,
  sessionDenylist: SessionDenylist,
): Promise<Principal> => {
  const claims = accessTokenService.verify(token);
  if (await sessionDenylist.isDenied(claims.sid)) {
    throw authenticationRequired();
  }
  return { userId: claims.sub, sessionId: claims.sid, role: claims.role };
};

/** `header`'s token, or `undefined` if the header itself is absent — distinct from a present-but-invalid one. */
const bearerTokenFrom = (header: string | undefined): string | null | undefined => {
  if (header === undefined) return undefined;
  if (!header.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length).trim();
  return token ? token : null;
};

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
    const token = bearerTokenFrom(req.header('authorization'));
    if (!token) {
      next(authenticationRequired());
      return;
    }

    // Verification is synchronous but the denylist lookup is not, so the
    // whole check runs in a promise chain and every rejection is handed to
    // `next` — an unhandled rejection here would fail open, admitting the
    // request instead of refusing it.
    void verifyBearerToken(token, accessTokenService, sessionDenylist)
      .then((principal) => {
        req.principal = principal;
      })
      .then(next, next);
  };

/**
 * Optional-authentication variant (S2-7, SDD 9.4's "auth optional" surfaces
 * — today, `GET /api/v1/search`).
 *
 * **Absence and invalidity are not the same thing, and this middleware exists
 * to keep them that way.** No `Authorization` header at all means the caller
 * is not claiming to be anyone — `req.principal` stays unset and the request
 * proceeds as anonymous. A header that *is* present but names a malformed,
 * expired, or denied credential is a caller who tried to authenticate and
 * failed; that is a 401, identical to `authenticate()`'s own, **never**
 * silently downgraded to anonymous. Treating a bad credential as no
 * credential would let a caller probe whether a token is merely expired
 * versus outright invalid by comparing an "anonymous but succeeded" response
 * against a hard failure — the same distinguishability `authenticate()`'s own
 * single error shape (SEC-15) already refuses to leak on the mandatory path.
 */
export const optionalAuthenticate =
  (accessTokenService: AccessTokenService, sessionDenylist: SessionDenylist): RequestHandler =>
  (req: Request, _res: Response, next: NextFunction): void => {
    const token = bearerTokenFrom(req.header('authorization'));
    if (token === undefined) {
      next();
      return;
    }
    if (token === null) {
      next(authenticationRequired());
      return;
    }

    void verifyBearerToken(token, accessTokenService, sessionDenylist)
      .then((principal) => {
        req.principal = principal;
      })
      .then(next, next);
  };
