import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Redis } from 'ioredis';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { Env } from '../../shared/config/env.js';
import {
  createAuthRateLimiters,
  type AuthRateLimiters,
} from '../../shared/interface/http/middleware/auth-rate-limit.js';
import type { AccessTokenService } from './application/ports/access-token.port.js';
import { AesGcmMfaSecretCipher } from './infrastructure/security/aes-gcm-mfa-secret-cipher.service.js';
import { Argon2OtpHasher } from './infrastructure/security/argon2-otp-hasher.js';
import { Argon2PasswordHasher } from './infrastructure/security/argon2-password-hasher.js';
import { CryptoOtpGenerator } from './infrastructure/security/crypto-otp-generator.js';
import { CryptoRefreshTokenHasher } from './infrastructure/security/crypto-refresh-token-hasher.js';
import { JsonWebTokenAccessTokenService } from './infrastructure/security/jsonwebtoken-access-token.service.js';
import { OtplibTotpService } from './infrastructure/security/otplib-totp.service.js';
import { PrismaMfaChallengeRepository } from './infrastructure/persistence/prisma-mfa-challenge.repository.js';
import { PrismaMfaSecretRepository } from './infrastructure/persistence/prisma-mfa-secret.repository.js';
import { PrismaOtpRepository } from './infrastructure/persistence/prisma-otp.repository.js';
import { PrismaRefreshTokenRepository } from './infrastructure/persistence/prisma-refresh-token.repository.js';
import { PrismaUserRepository } from './infrastructure/persistence/prisma-user.repository.js';
import { SessionIssuer } from './application/services/session-issuer.service.js';
import { AdminLoginStepOneUseCase } from './application/use-cases/admin-login-step-one.use-case.js';
import { AdminLoginStepTwoUseCase } from './application/use-cases/admin-login-step-two.use-case.js';
import { AdminMfaEnrollUseCase } from './application/use-cases/admin-mfa-enroll.use-case.js';
import { AdminMfaEnrollConfirmUseCase } from './application/use-cases/admin-mfa-enroll-confirm.use-case.js';
import { LoginUseCase } from './application/use-cases/login.use-case.js';
import { LogoutUseCase } from './application/use-cases/logout.use-case.js';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case.js';
import { RegisterCustomerUseCase } from './application/use-cases/register-customer.use-case.js';
import { RequestOtpUseCase } from './application/use-cases/request-otp.use-case.js';
import { VerifyOtpUseCase } from './application/use-cases/verify-otp.use-case.js';
import { createAdminAuthController } from './interface/http/admin-auth.controller.js';
import { createAdminAuthRouter } from './interface/http/admin-auth.routes.js';
import { createIdentityController } from './interface/http/identity.controller.js';
import { createIdentityRouter } from './interface/http/identity.routes.js';

export interface IdentityModuleDeps {
  readonly prisma: PrismaClient;
  /** Backs SDD 23.3's per-endpoint auth rate-limit budgets; shared with the global limiter. */
  readonly redis: Redis;
  readonly env: Env;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger: Logger;
}

export interface IdentityModule {
  readonly router: Router;
  /** Mounted separately at `/api/v1/admin` (SDD 9.4) — a distinct surface from `router`, even though both come from this module. */
  readonly adminAuthRouter: Router;
  readonly requestOtpUseCase: RequestOtpUseCase;
  readonly verifyOtpUseCase: VerifyOtpUseCase;
  /**
   * Published so the composition root can give other modules' authenticated
   * routes the *same* verifier rather than minting a second one — SDD 5
   * makes this module the sole owner of tokens.
   */
  readonly accessTokenService: AccessTokenService;
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

interface AdminAuthUseCaseDeps {
  readonly userRepository: PrismaUserRepository;
  readonly passwordHasher: Argon2PasswordHasher;
  readonly mfaSecretRepository: PrismaMfaSecretRepository;
  readonly mfaChallengeRepository: PrismaMfaChallengeRepository;
  readonly challengeTokenHasher: CryptoRefreshTokenHasher;
  readonly totpService: OtplibTotpService;
  readonly mfaSecretCipher: AesGcmMfaSecretCipher;
  readonly sessionIssuer: SessionIssuer;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  /** The `otpauth://` URI's issuer label — same value as the JWT issuer. */
  readonly issuer: string;
  readonly logger: Logger;
}

interface AdminAuthUseCases {
  readonly adminLoginStepOneUseCase: AdminLoginStepOneUseCase;
  readonly adminLoginStepTwoUseCase: AdminLoginStepTwoUseCase;
  readonly adminMfaEnrollUseCase: AdminMfaEnrollUseCase;
  readonly adminMfaEnrollConfirmUseCase: AdminMfaEnrollConfirmUseCase;
}

/** Split out of `createIdentityModule` purely to stay under this file's max-lines-per-function budget. */
const buildAdminAuthUseCases = (deps: AdminAuthUseCaseDeps): AdminAuthUseCases => {
  const adminLoginStepOneUseCase = new AdminLoginStepOneUseCase({
    ...deps,
    // Same generator/hasher pair refresh tokens use — a challenge token is
    // the same shape of thing (opaque, 256-bit, SHA-256 at rest), so this
    // reuses the existing primitive rather than inventing a second one.
    challengeTokenGenerator: deps.challengeTokenHasher,
  });
  const adminLoginStepTwoUseCase = new AdminLoginStepTwoUseCase({ ...deps });
  const adminMfaEnrollUseCase = new AdminMfaEnrollUseCase({ ...deps });
  const adminMfaEnrollConfirmUseCase = new AdminMfaEnrollConfirmUseCase({ ...deps });

  return {
    adminLoginStepOneUseCase,
    adminLoginStepTwoUseCase,
    adminMfaEnrollUseCase,
    adminMfaEnrollConfirmUseCase,
  };
};

interface IdentityInfrastructure {
  readonly userRepository: PrismaUserRepository;
  readonly refreshTokenRepository: PrismaRefreshTokenRepository;
  readonly otpRepository: PrismaOtpRepository;
  readonly mfaSecretRepository: PrismaMfaSecretRepository;
  readonly mfaChallengeRepository: PrismaMfaChallengeRepository;
  readonly passwordHasher: Argon2PasswordHasher;
  readonly refreshTokenHasher: CryptoRefreshTokenHasher;
  readonly challengeTokenHasher: CryptoRefreshTokenHasher;
  readonly otpHasher: Argon2OtpHasher;
  readonly otpGenerator: CryptoOtpGenerator;
  readonly totpService: OtplibTotpService;
  readonly mfaSecretCipher: AesGcmMfaSecretCipher;
  readonly accessTokenService: JsonWebTokenAccessTokenService;
  readonly sessionIssuer: SessionIssuer;
}

/** Split out of `createIdentityModule` purely to stay under this file's max-lines-per-function budget. */
const buildInfrastructure = (deps: {
  prisma: PrismaClient;
  env: Env;
  clock: Clock;
  idGenerator: IdGenerator;
}): IdentityInfrastructure => {
  const { prisma, env, clock, idGenerator } = deps;

  const userRepository = new PrismaUserRepository(prisma);
  const refreshTokenRepository = new PrismaRefreshTokenRepository(prisma);
  const otpRepository = new PrismaOtpRepository(prisma);
  const mfaSecretRepository = new PrismaMfaSecretRepository(prisma);
  const mfaChallengeRepository = new PrismaMfaChallengeRepository(prisma);
  const passwordHasher = new Argon2PasswordHasher();
  const refreshTokenHasher = new CryptoRefreshTokenHasher();
  // Same primitive as `refreshTokenHasher`, a separate instance purely to
  // keep the DI wiring's intent readable — an MFA challenge token is the
  // same shape of thing (opaque, 256-bit, SHA-256 at rest), not the same
  // token.
  const challengeTokenHasher = new CryptoRefreshTokenHasher();
  const otpHasher = new Argon2OtpHasher();
  const otpGenerator = new CryptoOtpGenerator();
  const totpService = new OtplibTotpService();
  const mfaSecretCipher = new AesGcmMfaSecretCipher(Buffer.from(env.MFA_ENCRYPTION_KEY, 'hex'));
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
    adminIdleTimeoutMinutes: env.ADMIN_SESSION_IDLE_TIMEOUT_MINUTES,
  });

  return {
    userRepository,
    refreshTokenRepository,
    otpRepository,
    mfaSecretRepository,
    mfaChallengeRepository,
    passwordHasher,
    refreshTokenHasher,
    challengeTokenHasher,
    otpHasher,
    otpGenerator,
    totpService,
    mfaSecretCipher,
    accessTokenService,
    sessionIssuer,
  };
};

interface IdentityRouters {
  readonly router: Router;
  readonly adminAuthRouter: Router;
}

/** Split out of `createIdentityModule` purely to stay under this file's max-lines-per-function budget. */
const buildRouters = (params: {
  registerCustomerUseCase: RegisterCustomerUseCase;
  loginUseCase: LoginUseCase;
  refreshSessionUseCase: RefreshSessionUseCase;
  logoutUseCase: LogoutUseCase;
  requestOtpUseCase: RequestOtpUseCase;
  verifyOtpUseCase: VerifyOtpUseCase;
  adminLoginStepOneUseCase: AdminLoginStepOneUseCase;
  adminLoginStepTwoUseCase: AdminLoginStepTwoUseCase;
  adminMfaEnrollUseCase: AdminMfaEnrollUseCase;
  adminMfaEnrollConfirmUseCase: AdminMfaEnrollConfirmUseCase;
  accessTokenService: AccessTokenService;
  rateLimiters: AuthRateLimiters;
}): IdentityRouters => {
  const controller = createIdentityController({
    registerCustomerUseCase: params.registerCustomerUseCase,
    loginUseCase: params.loginUseCase,
    refreshSessionUseCase: params.refreshSessionUseCase,
    logoutUseCase: params.logoutUseCase,
    requestOtpUseCase: params.requestOtpUseCase,
    verifyOtpUseCase: params.verifyOtpUseCase,
  });
  const adminAuthController = createAdminAuthController({
    adminLoginStepOneUseCase: params.adminLoginStepOneUseCase,
    adminLoginStepTwoUseCase: params.adminLoginStepTwoUseCase,
    adminMfaEnrollUseCase: params.adminMfaEnrollUseCase,
    adminMfaEnrollConfirmUseCase: params.adminMfaEnrollConfirmUseCase,
  });

  return {
    router: createIdentityRouter(controller, params.accessTokenService, params.rateLimiters),
    adminAuthRouter: createAdminAuthRouter(adminAuthController),
  };
};

/**
 * This module's own composition root (SDD 2.3). `app.ts` knows nothing about
 * argon2, JWTs or Prisma — it hands over the shared container's ports and
 * gets back a router.
 */
export const createIdentityModule = (deps: IdentityModuleDeps): IdentityModule => {
  const { prisma, redis, env, clock, idGenerator, logger } = deps;
  const moduleLogger = logger.child({ module: 'identity' });

  const infra = buildInfrastructure({ prisma, env, clock, idGenerator });

  const { registerCustomerUseCase, loginUseCase, refreshSessionUseCase, logoutUseCase } =
    buildAuthUseCases({ ...infra, idGenerator, clock, logger: moduleLogger });
  const { requestOtpUseCase, verifyOtpUseCase } = buildOtpUseCases({
    ...infra,
    idGenerator,
    clock,
    logger: moduleLogger,
  });
  const {
    adminLoginStepOneUseCase,
    adminLoginStepTwoUseCase,
    adminMfaEnrollUseCase,
    adminMfaEnrollConfirmUseCase,
  } = buildAdminAuthUseCases({
    ...infra,
    idGenerator,
    clock,
    issuer: env.SERVICE_NAME,
    logger: moduleLogger,
  });
  const { router, adminAuthRouter } = buildRouters({
    registerCustomerUseCase,
    loginUseCase,
    refreshSessionUseCase,
    logoutUseCase,
    requestOtpUseCase,
    verifyOtpUseCase,
    adminLoginStepOneUseCase,
    adminLoginStepTwoUseCase,
    adminMfaEnrollUseCase,
    adminMfaEnrollConfirmUseCase,
    accessTokenService: infra.accessTokenService,
    rateLimiters: createAuthRateLimiters(redis, env),
  });
  return {
    router,
    adminAuthRouter,
    requestOtpUseCase,
    verifyOtpUseCase,
    accessTokenService: infra.accessTokenService,
  };
};
