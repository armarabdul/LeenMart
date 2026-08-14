import { Router } from 'express';
import type { Redis } from 'ioredis';
import { publicProductSearchQuerySchema } from '@leen-mart/contracts';
import type { Env } from '../../../../shared/config/env.js';
import { asyncHandler } from '../../../../shared/interface/http/middleware/async-handler.js';
import { optionalAuthenticate } from '../../../../shared/interface/http/middleware/authenticate.js';
import { createSearchRateLimiter } from '../../../../shared/interface/http/middleware/search-rate-limit.js';
import { validate } from '../../../../shared/interface/http/middleware/validate.js';
import type { AccessTokenService, SessionDenylist } from '../../../identity/index.js';
import type { PublicSearchController } from './public-search.controller.js';

export interface PublicSearchRouterDeps {
  readonly controller: PublicSearchController;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  readonly redis: Redis;
  readonly env: Env;
}

/**
 * Mounted at `/api/v1/search` — a standalone public path, sibling to
 * `/api/v1/catalogue/*`, not nested under it (SDD 9.4: auth "optional").
 *
 * `optionalAuthenticate` runs before the rate limiter, not after: the
 * limiter reads `req.principal` to pick which of its two budgets a request
 * draws from (`createSearchRateLimiter`'s own comment), so authentication has
 * to resolve first. This is opt-in identity, not opt-out authentication — a
 * missing token is anonymous, but a present, invalid one still 401s here
 * exactly as it would on any authenticated route (S2-7 final approval,
 * correction 1).
 */
export const createPublicSearchRouter = (deps: PublicSearchRouterDeps): Router => {
  const router = Router();

  router.get(
    '/',
    optionalAuthenticate(deps.accessTokenService, deps.sessionDenylist),
    createSearchRateLimiter(deps.redis, deps.env),
    validate({ query: publicProductSearchQuerySchema }),
    asyncHandler(deps.controller.search),
  );

  return router;
};
