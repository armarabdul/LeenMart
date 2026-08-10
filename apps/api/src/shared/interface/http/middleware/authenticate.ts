import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { UnauthenticatedError } from '@leen-mart/domain-kit';
import type { AccessTokenService, Principal } from '../../../../modules/identity/index.js';

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
 * Verifies the bearer access token via the already-built `AccessTokenService`
 * and attaches the resulting `Principal` to the request, mirroring how
 * `validate()` attaches `req.validated`. This is authentication only — it
 * never checks *what* the caller may do (SDD 7.4 step 2, the `authorization`
 * module's `authorize()`) or resource ownership (step 3); both are separate,
 * later concerns and are deliberately not invoked here.
 *
 * Every failure path — missing header, wrong scheme, empty token, or a token
 * `AccessTokenService.verify()` itself rejects (invalid, malformed, expired)
 * — produces the identical `UnauthenticatedError`/`INVALID_ACCESS_TOKEN`
 * response, so a caller cannot distinguish *why* authentication failed
 * (mirrors this codebase's existing SEC-15 uniform-response precedent for
 * login/OTP).
 */
export const authenticate =
  (accessTokenService: AccessTokenService): RequestHandler =>
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

    try {
      const claims = accessTokenService.verify(token);
      req.principal = { userId: claims.sub, role: claims.role };
      next();
    } catch (cause) {
      next(cause);
    }
  };
