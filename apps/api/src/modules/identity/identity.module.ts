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
import type { SessionDenylist } from './application/ports/session-denylist.port.js';
import { AmbientAuditWriter, type AuditWriter } from '../audit/index.js';
import { PrismaAuditLogRepository } from '../audit/infrastructure/persistence/prisma-audit-log.repository.js';
import { IdentityTransactionRunner } from '../../shared/infrastructure/persistence/tenant-prisma.js';
import { RedisSessionDenylist } from './infrastructure/cache/redis-session-denylist.js';
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
import { CreateAdminUserUseCase } from './application/use-cases/create-admin-user.use-case.js';
import { ListAdminUsersUseCase } from './application/use-cases/list-admin-users.use-case.js';
import { LoginUseCase } from './application/use-cases/login.use-case.js';
import { LogoutUseCase } from './application/use-cases/logout.use-case.js';
import { RefreshSessionUseCase } from './application/use-cases/refresh-session.use-case.js';
import { RegisterCustomerUseCase } from './application/use-cases/register-customer.use-case.js';
import { RequestOtpUseCase } from './application/use-cases/request-otp.use-case.js';
import { VerifyOtpUseCase } from './application/use-cases/verify-otp.use-case.js';
import { createAdminAuthController } from './interface/http/admin-auth.controller.js';
import { createAdminAuthRouter } from './interface/http/admin-auth.routes.js';
import { createAdminUserManagementController } from './interface/http/admin-user-management.controller.js';
import { createAdminUserManagementRouter } from './interface/http/admin-user-management.routes.js';
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
  /** Mounted at `/api/v1/admin/users` (SDD 9.4, Phase L.2) — SUPER_ADMIN-gated management of subordinate administrator accounts. */
  readonly adminUserManagementRouter: Router;
  readonly requestOtpUseCase: RequestOtpUseCase;
  readonly verifyOtpUseCase: VerifyOtpUseCase;
  /**
   * Published so the composition root can give other modules' authenticated
   * routes the *same* verifier rather than minting a second one — SDD 5
   * makes this module the sole owner of tokens.
   */
  readonly accessTokenService: AccessTokenService;
  /**
   * Published alongside `accessTokenService` for the same reason: every
   * authenticated route in every module must consult the *same* denylist, or
   * a session revoked here would keep authenticating there (SDD 7.2).
   */
  readonly sessionDenylist: SessionDenylist;
}

interface AuthUseCaseDeps {
  readonly userRepository: PrismaUserRepository;
  readonly refreshTokenRepository: PrismaRefreshTokenRepository;
  readonly passwordHasher: Argon2PasswordHasher;
  readonly refreshTokenHasher: CryptoRefreshTokenHasher;
  readonly sessionIssuer: SessionIssuer;
  readonly sessionDenylist: SessionDenylist;
  readonly auditWriter: AuditWriter;
  readonly accessTokenTtlSeconds: number;
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
    sessionDenylist,
    auditWriter,
    accessTokenTtlSeconds,
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
    sessionDenylist,
    accessTokenTtlSeconds,
    clock,
    logger,
  });
  const logoutUseCase = new LogoutUseCase({
    userRepository,
    refreshTokenRepository,
    refreshTokenHasher,
    sessionDenylist,
    auditWriter,
    accessTokenTtlSeconds,
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
  readonly auditWriter: AuditWriter;
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

interface AdminUserManagementUseCaseDeps {
  readonly userRepository: PrismaUserRepository;
  readonly passwordHasher: Argon2PasswordHasher;
  readonly transactionRunner: IdentityTransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

interface AdminUserManagementUseCases {
  readonly createAdminUserUseCase: CreateAdminUserUseCase;
  readonly listAdminUsersUseCase: ListAdminUsersUseCase;
}

/** Split out of `createIdentityModule` purely to stay under this file's max-lines-per-function budget, the same reason its siblings above are. */
const buildAdminUserManagementUseCases = (
  deps: AdminUserManagementUseCaseDeps,
): AdminUserManagementUseCases => ({
  createAdminUserUseCase: new CreateAdminUserUseCase(deps),
  listAdminUsersUseCase: new ListAdminUsersUseCase({ userRepository: deps.userRepository }),
});

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
  readonly sessionDenylist: RedisSessionDenylist;
  readonly auditWriter: AmbientAuditWriter;
  readonly sessionIssuer: SessionIssuer;
  readonly transactionRunner: IdentityTransactionRunner;
}

/**
 * SDD 5.1 lets any module call `audit` directly through its published
 * interface, and SDD 5 gives `audit` no events — so a direct call is the shape
 * the design intends rather than an event subscription. Split out for the same
 * reason the builders around it are: this file's max-lines-per-function budget.
 */
const buildAuditWriter = (deps: {
  prisma: PrismaClient;
  idGenerator: IdGenerator;
  clock: Clock;
}): AmbientAuditWriter =>
  new AmbientAuditWriter({
    auditLogRepository: new PrismaAuditLogRepository(deps.prisma),
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  });

interface SecurityPrimitives {
  readonly passwordHasher: Argon2PasswordHasher;
  readonly refreshTokenHasher: CryptoRefreshTokenHasher;
  readonly challengeTokenHasher: CryptoRefreshTokenHasher;
  readonly otpHasher: Argon2OtpHasher;
  readonly otpGenerator: CryptoOtpGenerator;
  readonly totpService: OtplibTotpService;
  readonly mfaSecretCipher: AesGcmMfaSecretCipher;
  readonly accessTokenService: JsonWebTokenAccessTokenService;
}

/** Split out of `buildInfrastructure` purely to stay under this file's max-lines-per-function budget. */
const buildSecurityPrimitives = (deps: {
  env: Env;
  clock: Clock;
  idGenerator: IdGenerator;
}): SecurityPrimitives => ({
  passwordHasher: new Argon2PasswordHasher(),
  refreshTokenHasher: new CryptoRefreshTokenHasher(),
  // Same primitive as `refreshTokenHasher`, a separate instance purely to
  // keep the DI wiring's intent readable — an MFA challenge token is the
  // same shape of thing (opaque, 256-bit, SHA-256 at rest), not the same
  // token.
  challengeTokenHasher: new CryptoRefreshTokenHasher(),
  otpHasher: new Argon2OtpHasher(),
  otpGenerator: new CryptoOtpGenerator(),
  totpService: new OtplibTotpService(),
  mfaSecretCipher: new AesGcmMfaSecretCipher(Buffer.from(deps.env.MFA_ENCRYPTION_KEY, 'hex')),
  accessTokenService: new JsonWebTokenAccessTokenService(
    {
      secret: deps.env.JWT_ACCESS_SECRET,
      issuer: deps.env.SERVICE_NAME,
      audience: deps.env.JWT_AUDIENCE,
      ttlSeconds: deps.env.JWT_ACCESS_TTL_SECONDS,
    },
    deps.clock,
    deps.idGenerator,
  ),
});

/** Split out of `createIdentityModule` purely to stay under this file's max-lines-per-function budget. */
const buildInfrastructure = (deps: {
  prisma: PrismaClient;
  redis: Redis;
  env: Env;
  clock: Clock;
  idGenerator: IdGenerator;
}): IdentityInfrastructure => {
  const { prisma, redis, env, clock, idGenerator } = deps;

  const userRepository = new PrismaUserRepository(prisma);
  const refreshTokenRepository = new PrismaRefreshTokenRepository(prisma);
  const otpRepository = new PrismaOtpRepository(prisma);
  const mfaSecretRepository = new PrismaMfaSecretRepository(prisma);
  const mfaChallengeRepository = new PrismaMfaChallengeRepository(prisma);
  const {
    passwordHasher,
    refreshTokenHasher,
    challengeTokenHasher,
    otpHasher,
    otpGenerator,
    totpService,
    mfaSecretCipher,
    accessTokenService,
  } = buildSecurityPrimitives({ env, clock, idGenerator });
  const sessionDenylist = new RedisSessionDenylist(redis);
  const auditWriter = buildAuditWriter({ prisma, idGenerator, clock });
  const transactionRunner = new IdentityTransactionRunner(prisma);
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
    sessionDenylist,
    auditWriter,
    sessionIssuer,
    transactionRunner,
  };
};

interface IdentityRouters {
  readonly router: Router;
  readonly adminAuthRouter: Router;
  readonly adminUserManagementRouter: Router;
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
  createAdminUserUseCase: CreateAdminUserUseCase;
  listAdminUsersUseCase: ListAdminUsersUseCase;
  accessTokenService: AccessTokenService;
  sessionDenylist: SessionDenylist;
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
  const adminUserManagementController = createAdminUserManagementController({
    createAdminUserUseCase: params.createAdminUserUseCase,
    listAdminUsersUseCase: params.listAdminUsersUseCase,
  });

  return {
    router: createIdentityRouter(
      controller,
      params.accessTokenService,
      params.sessionDenylist,
      params.rateLimiters,
    ),
    adminAuthRouter: createAdminAuthRouter(adminAuthController),
    adminUserManagementRouter: createAdminUserManagementRouter(
      adminUserManagementController,
      params.accessTokenService,
      params.sessionDenylist,
    ),
  };
};

/**
 * This module's own composition root (SDD 2.3). `app.ts` knows nothing about
 * argon2, JWTs or Prisma — it hands over the shared container's ports and
 * gets back a router.
 */
interface OtpUseCases {
  readonly requestOtpUseCase: RequestOtpUseCase;
  readonly verifyOtpUseCase: VerifyOtpUseCase;
}

interface AllUseCases
  extends AuthUseCases,
    OtpUseCases,
    AdminAuthUseCases,
    AdminUserManagementUseCases {}

/**
 * Every use case this module builds, in one call — split out of
 * `createIdentityModule` purely to stay under this file's
 * max-lines-per-function budget, the same reason its siblings above are.
 */
const buildAllUseCases = (
  infra: IdentityInfrastructure,
  params: { env: Env; clock: Clock; idGenerator: IdGenerator; logger: Logger },
): AllUseCases => {
  const { env, clock, idGenerator, logger } = params;
  const shared = { ...infra, idGenerator, clock, logger };

  return {
    ...buildAuthUseCases({ ...shared, accessTokenTtlSeconds: env.JWT_ACCESS_TTL_SECONDS }),
    ...buildOtpUseCases(shared),
    ...buildAdminAuthUseCases({ ...shared, issuer: env.SERVICE_NAME }),
    ...buildAdminUserManagementUseCases(shared),
  };
};

export const createIdentityModule = (deps: IdentityModuleDeps): IdentityModule => {
  const { prisma, redis, env, clock, idGenerator, logger } = deps;
  const moduleLogger = logger.child({ module: 'identity' });

  const infra = buildInfrastructure({ prisma, redis, env, clock, idGenerator });
  const useCases = buildAllUseCases(infra, { env, clock, idGenerator, logger: moduleLogger });

  const { router, adminAuthRouter, adminUserManagementRouter } = buildRouters({
    ...useCases,
    accessTokenService: infra.accessTokenService,
    sessionDenylist: infra.sessionDenylist,
    rateLimiters: createAuthRateLimiters(redis, env),
  });
  return {
    router,
    adminAuthRouter,
    adminUserManagementRouter,
    requestOtpUseCase: useCases.requestOtpUseCase,
    verifyOtpUseCase: useCases.verifyOtpUseCase,
    accessTokenService: infra.accessTokenService,
    sessionDenylist: infra.sessionDenylist,
  };
};
