import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { Env } from '../../shared/config/env.js';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher.js';
import { CryptoRefreshTokenHasher } from './infrastructure/security/crypto-refresh-token-hasher.js';
import { JsonWebTokenAccessTokenService } from './infrastructure/security/jsonwebtoken-access-token.service.js';
import { PrismaRefreshTokenRepository } from './infrastructure/persistence/prisma-refresh-token.repository.js';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository.js';
import { SessionIssuer } from './application/services/session-issuer.service.js';
import { LoginUseCase } from './application/use-cases/login.use-case.js';
import { LogoutUseCase } from './application/use-cases/logout.use-case.js';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case.js';
import { RegisterCustomerUseCase } from './application/use-cases/register-customer.use-case.js';
import { createIdentityController } from './interface/http/identity.controller.js';
import { createIdentityRouter } from './interface/http/identity.routes.js';

export interface IdentityModuleDeps {
  readonly prisma: PrismaClient;
  readonly env: Env;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger: Logger;
}

export interface IdentityModule {
  readonly router: Router;
}

/**
 * This module's own composition root (SDD 2.3). `app.ts` knows nothing about
 * argon2, JWTs or Prisma — it hands over the shared container's ports and
 * gets back a router.
 */
export const createIdentityModule = (deps: IdentityModuleDeps): IdentityModule => {
  const { prisma, env, clock, idGenerator, logger } = deps;
  const moduleLogger = logger.child({ module: 'identity' });

  const userRepository = new PrismaUserRepository(prisma);
  const refreshTokenRepository = new PrismaRefreshTokenRepository(prisma);
  const passwordHasher = new Argon2PasswordHasher();
  const refreshTokenHasher = new CryptoRefreshTokenHasher();
  const accessTokenService = new JsonWebTokenAccessTokenService(
    { secret: env.JWT_ACCESS_SECRET, issuer: env.SERVICE_NAME, ttlSeconds: env.JWT_ACCESS_TTL_SECONDS },
    clock,
  );

  const sessionIssuer = new SessionIssuer({
    accessTokenService,
    refreshTokenHasher,
    refreshTokenRepository,
    idGenerator,
    clock,
    refreshTtlDays: env.JWT_REFRESH_TTL_DAYS,
  });

  const registerCustomerUseCase = new RegisterCustomerUseCase({
    userRepository,
    passwordHasher,
    sessionIssuer,
    idGenerator,
    clock,
    logger: moduleLogger,
  });
  const loginUseCase = new LoginUseCase({ userRepository, passwordHasher, sessionIssuer, logger: moduleLogger });
  const refreshSessionUseCase = new RefreshSessionUseCase({
    userRepository,
    refreshTokenRepository,
    refreshTokenHasher,
    sessionIssuer,
    clock,
    logger: moduleLogger,
  });
  const logoutUseCase = new LogoutUseCase({
    refreshTokenRepository,
    refreshTokenHasher,
    clock,
    logger: moduleLogger,
  });

  const controller = createIdentityController({
    registerCustomerUseCase,
    loginUseCase,
    refreshSessionUseCase,
    logoutUseCase,
  });

  return { router: createIdentityRouter(controller) };
};
