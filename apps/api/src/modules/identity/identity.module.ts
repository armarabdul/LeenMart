import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { Env } from '../../shared/config/env.js';
import { Argon2OtpHasher } from './infrastructure/security/argon2-otp-hasher.js';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher.js';
import { CryptoOtpGenerator } from './infrastructure/security/crypto-otp-generator.js';
import { CryptoRefreshTokenHasher } from './infrastructure/security/crypto-refresh-token-hasher.js';
import { JsonWebTokenAccessTokenService } from './infrastructure/security/jsonwebtoken-access-token.service.js';
import { PrismaOtpRepository } from './infrastructure/persistence/prisma-otp.repository.js';
import { PrismaRefreshTokenRepository } from './infrastructure/persistence/prisma-refresh-token.repository.js';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository.js';
import { SessionIssuer } from './application/services/session-issuer.service.js';
import { LoginUseCase } from './application/use-cases/login.use-case.js';
import { LogoutUseCase } from './application/use-cases/logout.use-case.js';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case.js';
import { RegisterCustomerUseCase } from './application/use-cases/register-customer.use-case.js';
import { RequestOtpUseCase } from './application/use-cases/request-otp.use-case.js';
import { VerifyOtpUseCase } from './application/use-cases/verify-otp.use-case.js';
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
  readonly requestOtpUseCase: RequestOtpUseCase;
  readonly verifyOtpUseCase: VerifyOtpUseCase;
}

interface AuthUseCaseDeps {
  readonly userRepository: PrismaUserRepository;
  readonly refreshTokenRepository: PrismaRefreshTokenRepository;
  readonly passwordHasher: Argon2PasswordHasher;
  readonly refreshTokenHasher: CryptoRefreshTokenHasher;
  readonly sessionIssuer: SessionIssuer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

interface AuthUseCases {
  readonly registerCustomerUseCase: RegisterCustomerUseCase;
  readonly loginUseCase: LoginUseCase;
  readonly refreshSessionUseCase: RefreshSessionUseCase;
  readonly logoutUseCase: LogoutUseCase;
}

/** Split out of `createIdentityModule` purely to stay under this file's max-lines-per-function budget. */
const buildAuthUseCases = (deps: AuthUseCaseDeps): AuthUseCases => {
  const {
    userRepository,
    refreshTokenRepository,
    passwordHasher,
    refreshTokenHasher,
    sessionIssuer,
    idGenerator,
    clock,
    logger,
  } = deps;

  const registerCustomerUseCase = new RegisterCustomerUseCase({
    userRepository,
    passwordHasher,
    sessionIssuer,
    idGenerator,
    clock,
    logger,
  });
  const loginUseCase = new LoginUseCase({ userRepository, passwordHasher, sessionIssuer, logger });
  const refreshSessionUseCase = new RefreshSessionUseCase({
    userRepository,
    refreshTokenRepository,
    refreshTokenHasher,
    sessionIssuer,
    clock,
    logger,
  });
  const logoutUseCase = new LogoutUseCase({
    refreshTokenRepository,
    refreshTokenHasher,
    clock,
    logger,
  });

  return { registerCustomerUseCase, loginUseCase, refreshSessionUseCase, logoutUseCase };
};

interface OtpUseCaseDeps {
  readonly userRepository: PrismaUserRepository;
  readonly otpRepository: PrismaOtpRepository;
  readonly otpGenerator: CryptoOtpGenerator;
  readonly otpHasher: Argon2OtpHasher;
  readonly sessionIssuer: SessionIssuer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/** Split out of `createIdentityModule` purely to stay under this file's max-lines-per-function budget. */
const buildOtpUseCases = (
  deps: OtpUseCaseDeps,
): { requestOtpUseCase: RequestOtpUseCase; verifyOtpUseCase: VerifyOtpUseCase } => {
  const {
    userRepository,
    otpRepository,
    otpGenerator,
    otpHasher,
    sessionIssuer,
    idGenerator,
    clock,
    logger,
  } = deps;

  const requestOtpUseCase = new RequestOtpUseCase({
    userRepository,
    otpGenerator,
    otpHasher,
    otpRepository,
    idGenerator,
    clock,
    logger,
  });
  const verifyOtpUseCase = new VerifyOtpUseCase({
    userRepository,
    otpHasher,
    otpRepository,
    sessionIssuer,
    clock,
    logger,
  });

  return { requestOtpUseCase, verifyOtpUseCase };
};

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
  const otpRepository = new PrismaOtpRepository(prisma);
  const passwordHasher = new Argon2PasswordHasher();
  const refreshTokenHasher = new CryptoRefreshTokenHasher();
  const otpHasher = new Argon2OtpHasher();
  const otpGenerator = new CryptoOtpGenerator();
  const accessTokenService = new JsonWebTokenAccessTokenService(
    {
      secret: env.JWT_ACCESS_SECRET,
      issuer: env.SERVICE_NAME,
      ttlSeconds: env.JWT_ACCESS_TTL_SECONDS,
    },
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

  const { registerCustomerUseCase, loginUseCase, refreshSessionUseCase, logoutUseCase } =
    buildAuthUseCases({
      userRepository,
      refreshTokenRepository,
      passwordHasher,
      refreshTokenHasher,
      sessionIssuer,
      idGenerator,
      clock,
      logger: moduleLogger,
    });
  const { requestOtpUseCase, verifyOtpUseCase } = buildOtpUseCases({
    userRepository,
    otpRepository,
    otpGenerator,
    otpHasher,
    sessionIssuer,
    idGenerator,
    clock,
    logger: moduleLogger,
  });

  const controller = createIdentityController({
    registerCustomerUseCase,
    loginUseCase,
    refreshSessionUseCase,
    logoutUseCase,
    requestOtpUseCase,
    verifyOtpUseCase,
  });

  return { router: createIdentityRouter(controller), requestOtpUseCase, verifyOtpUseCase };
};
