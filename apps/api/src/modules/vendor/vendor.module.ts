import { KMSClient } from '@aws-sdk/client-kms';
import { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { Env } from '../../shared/config/env.js';
import { AmbientAuditWriter, type AuditWriter } from '../audit/index.js';
import { PrismaAuditLogRepository } from '../audit/infrastructure/persistence/prisma-audit-log.repository.js';
import type { AccessTokenService, SessionDenylist, UserId, VendorId } from '../identity/index.js';
import { S3ObjectStore, type ObjectStore } from '../media/index.js';
import type { DataKeyCipher } from './application/ports/data-key-cipher.port.js';
import type { DocumentCipher } from './application/ports/document-cipher.port.js';
import { AccessKycDocumentUseCase } from './application/use-cases/access-kyc-document.use-case.js';
import { AesGcmDocumentCipher } from './infrastructure/crypto/aes-gcm-document-cipher.js';
import { PrismaKycDocumentAccessQuery } from './infrastructure/persistence/prisma-kyc-document-access-query.js';
import { DevDataKeyCipher } from './infrastructure/crypto/dev-data-key-cipher.js';
import { KmsDataKeyCipher } from './infrastructure/crypto/kms-data-key-cipher.js';
import { CreateKycUploadIntentUseCase } from './application/use-cases/create-kyc-upload-intent.use-case.js';
import { SubmitVendorKycUseCase } from './application/use-cases/submit-vendor-kyc.use-case.js';
import { PrismaVendorKycRepository } from './infrastructure/persistence/prisma-vendor-kyc.repository.js';
import { HmacIdentifierFingerprinter } from './infrastructure/security/hmac-identifier-fingerprinter.js';
import { PrismaVendorRepository } from './infrastructure/persistence/prisma-vendor.repository.js';
import { PrismaUserRepository } from '../identity/infrastructure/persistence/prisma-user.repository.js';
import { PrismaRefreshTokenRepository } from '../identity/infrastructure/persistence/prisma-refresh-token.repository.js';
import {
  AdminTransactionRunner,
  PrismaTransactionRunner,
} from '../../shared/infrastructure/persistence/tenant-prisma.js';
import { RegisterVendorUseCase } from './application/use-cases/register-vendor.use-case.js';
import { createVendorController } from './interface/http/vendor.controller.js';
import { createVendorRouter } from './interface/http/vendor.routes.js';
import { createAdminKycController } from './interface/http/admin-kyc.controller.js';
import { createAdminKycRouter } from './interface/http/admin-kyc.routes.js';
import { PrismaKycReviewQuery } from './infrastructure/persistence/prisma-kyc-review-query.js';
import { ListKycReviewQueueUseCase } from './application/use-cases/list-kyc-review-queue.use-case.js';
import { GetKycReviewSubmissionUseCase } from './application/use-cases/get-kyc-review-submission.use-case.js';
import { StartKycReviewUseCase } from './application/use-cases/start-kyc-review.use-case.js';
import { DecideVendorKycUseCase } from './application/use-cases/decide-vendor-kyc.use-case.js';

export interface VendorModuleDeps {
  readonly prisma: PrismaClient;
  /**
   * The elevated, non-tenant-scoped credential (KYC-2B-1), used by the admin
   * review queue and nothing else. Separate from `prisma` on purpose: that one
   * is bound by RLS to one vendor per request, and a cross-tenant queue cannot
   * be served through it.
   */
  readonly adminPrisma: PrismaClient;
  /**
   * Read here rather than pre-resolved into the container, so the AWS SDK
   * clients this module needs stay inside it. `Container` deliberately does
   * not know what an `S3Client` is — the same reason `identity` builds its own
   * argon2 and JWT adapters instead of the composition root doing it.
   */
  readonly env: Env;
  /**
   * Verifies the caller's access token. Injected rather than constructed
   * here: SDD 5 makes `identity` the sole owner of tokens, so this module
   * consumes the one instance the composition root already has instead of
   * minting a second signer.
   */
  readonly accessTokenService: AccessTokenService;
  /**
   * The one shared denylist (SDD 7.2). Injected for the same reason
   * `accessTokenService` is: a session revoked at logout must stop
   * authenticating on *this* module's routes too, which only holds if every
   * module consults the same instance.
   */
  readonly sessionDenylist: SessionDenylist;
  /** How long a denylist entry must live — the access-token lifetime (SDD 7.2). */
  readonly accessTokenTtlSeconds: number;
  readonly clock: Clock;
  readonly idGenerator: IdGenerator;
  readonly logger: Logger;
}

export interface VendorModule {
  readonly router: Router;
  /** Mounted separately at `/api/v1/admin/kyc` — a distinct surface (SDD 9.4). */
  readonly adminKycRouter: Router;
}

/**
 * One client for MinIO locally and R2 in production — the difference is
 * entirely endpoint and credentials, which is exactly what `S3ObjectStore`'s
 * own comment says it should be. No branch on environment.
 */
const createKycS3Client = (env: Env): S3Client =>
  new S3Client({
    region: env.KYC_S3_REGION,
    endpoint: env.KYC_S3_ENDPOINT,
    forcePathStyle: env.KYC_S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.KYC_S3_ACCESS_KEY_ID,
      secretAccessKey: env.KYC_S3_SECRET_ACCESS_KEY,
    },
  });

/**
 * KMS in production, the AES-GCM stand-in outside it.
 *
 * The choice is `env.ts`'s, not this function's: `KYC_USE_DEV_DATA_KEY_CIPHER`
 * is refused in production by a `superRefine` guard, and `DevDataKeyCipher`'s
 * constructor refuses to build there as well. Two independent refusals, so
 * neither has to be the only one that works.
 */
const createDataKeyCipher = (env: Env): DataKeyCipher => {
  if (env.KYC_USE_DEV_DATA_KEY_CIPHER) {
    return new DevDataKeyCipher(Buffer.from(env.KYC_DEV_WRAPPING_KEY, 'hex'), env.NODE_ENV);
  }
  if (!env.KYC_KMS_KEY_ID) {
    throw new Error('KYC_KMS_KEY_ID must be set when the KMS data-key cipher is selected.');
  }
  return new KmsDataKeyCipher(new KMSClient({ region: env.KYC_KMS_REGION }), {
    keyId: env.KYC_KMS_KEY_ID,
  });
};

/**
 * The two KYC use cases and the adapters only they need. Split out of
 * `createVendorModule` for the same reason `mountBusinessModules` was split
 * out of `createApp`: to keep the composition root under its function-length
 * budget as the surface grows.
 */
const buildKycUseCases = (params: {
  prisma: PrismaClient;
  env: Env;
  vendorRepository: PrismaVendorRepository;
  objectStore: S3ObjectStore;
  dataKeyCipher: DataKeyCipher;
  transactionRunner: PrismaTransactionRunner;
  auditWriter: AuditWriter;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}): {
  createKycUploadIntentUseCase: CreateKycUploadIntentUseCase;
  submitVendorKycUseCase: SubmitVendorKycUseCase;
} => ({
  createKycUploadIntentUseCase: new CreateKycUploadIntentUseCase({
    vendorRepository: params.vendorRepository,
    objectStore: params.objectStore,
    dataKeyCipher: params.dataKeyCipher,
    idGenerator: params.idGenerator,
    clock: params.clock,
    logger: params.logger,
  }),
  submitVendorKycUseCase: new SubmitVendorKycUseCase({
    vendorRepository: params.vendorRepository,
    vendorKycRepository: new PrismaVendorKycRepository(params.prisma),
    objectStore: params.objectStore,
    fingerprinter: new HmacIdentifierFingerprinter(params.env.KYC_FINGERPRINT_PEPPER),
    transactionRunner: params.transactionRunner,
    auditWriter: params.auditWriter,
    idGenerator: params.idGenerator,
    clock: params.clock,
    logger: params.logger,
  }),
});

/**
 * The read-only admin review surface (KYC-5 Commit 2).
 *
 * Split out for the same reason `buildKycUseCases` was: to keep this module's
 * composition root under its function-length budget. Built on `adminPrisma`
 * because the queue reads across tenants — the vendor-facing client is bound
 * by RLS to one vendor per request and would return nothing here.
 */
/** Vendor registration's dependencies, split out to keep the composition root readable. */
const buildRegisterVendorUseCase = (params: {
  prisma: PrismaClient;
  vendorRepository: PrismaVendorRepository;
  sessionDenylist: SessionDenylist;
  transactionRunner: PrismaTransactionRunner;
  accessTokenTtlSeconds: number;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}): RegisterVendorUseCase =>
  new RegisterVendorUseCase({
    vendorRepository: params.vendorRepository,
    userRepository: new PrismaUserRepository(params.prisma),
    sessionRepository: new PrismaRefreshTokenRepository(params.prisma),
    sessionDenylist: params.sessionDenylist,
    transactionRunner: params.transactionRunner,
    accessTokenTtlSeconds: params.accessTokenTtlSeconds,
    idGenerator: params.idGenerator,
    clock: params.clock,
    logger: params.logger,
  });

/** The two read use cases, split out to keep the router builder under its line budget. */
const buildAdminKycReadUseCases = (
  kycReviewQuery: PrismaKycReviewQuery,
  logger: Logger,
): {
  listKycReviewQueueUseCase: ListKycReviewQueueUseCase;
  getKycReviewSubmissionUseCase: GetKycReviewSubmissionUseCase;
} => ({
  listKycReviewQueueUseCase: new ListKycReviewQueueUseCase({ kycReviewQuery, logger }),
  getKycReviewSubmissionUseCase: new GetKycReviewSubmissionUseCase({ kycReviewQuery, logger }),
});

/** The claim and decision use cases, split out for the same reason as the reads above. */
const buildAdminKycDecisionUseCases = (params: {
  vendorKycRepository: PrismaVendorKycRepository;
  vendorRepository: PrismaVendorRepository;
  transactionRunner: AdminTransactionRunner;
  auditWriter: AuditWriter;
  clock: Clock;
  logger: Logger;
}): {
  startKycReviewUseCase: StartKycReviewUseCase;
  decideVendorKycUseCase: DecideVendorKycUseCase;
} => ({
  startKycReviewUseCase: new StartKycReviewUseCase(params),
  decideVendorKycUseCase: new DecideVendorKycUseCase(params),
});

/** The document-access use case (KYC-7), split out for the same reason as the groups above. */
const buildAdminKycDocumentAccessUseCase = (params: {
  adminPrisma: PrismaClient;
  objectStore: ObjectStore;
  dataKeyCipher: DataKeyCipher;
  documentCipher: DocumentCipher;
  auditWriter: AuditWriter;
  logger: Logger;
}): { accessKycDocumentUseCase: AccessKycDocumentUseCase } => ({
  accessKycDocumentUseCase: new AccessKycDocumentUseCase({
    documentAccessQuery: new PrismaKycDocumentAccessQuery(params.adminPrisma),
    objectStore: params.objectStore,
    dataKeyCipher: params.dataKeyCipher,
    documentCipher: params.documentCipher,
    auditWriter: params.auditWriter,
    logger: params.logger,
  }),
});

/**
 * SDD 5.1 lets any module call `audit` directly through its published
 * interface. Mirrors `identity.module.ts`'s `buildAuditWriter` exactly — one
 * instance per Prisma client, since this module, unlike identity, writes
 * across two: the tenant-scoped client for the vendor-facing submission path,
 * and `adminPrisma` for the admin claim/decision path.
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

/**
 * Everything the vendor-facing router needs: registration and the two KYC use
 * cases, all built on the tenant-scoped client. Split out of
 * `createVendorModule` for the same reason the builders above it were — to
 * keep the composition root under this file's function-length budget.
 */
const buildVendorFacingUseCases = (params: {
  prisma: PrismaClient;
  env: Env;
  objectStore: S3ObjectStore;
  dataKeyCipher: DataKeyCipher;
  sessionDenylist: SessionDenylist;
  accessTokenTtlSeconds: number;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}): {
  vendorRepository: PrismaVendorRepository;
  registerVendorUseCase: RegisterVendorUseCase;
  createKycUploadIntentUseCase: CreateKycUploadIntentUseCase;
  submitVendorKycUseCase: SubmitVendorKycUseCase;
} => {
  const {
    prisma,
    env,
    objectStore,
    dataKeyCipher,
    sessionDenylist,
    accessTokenTtlSeconds,
    idGenerator,
    clock,
    logger,
  } = params;
  const vendorRepository = new PrismaVendorRepository(prisma);
  const transactionRunner = new PrismaTransactionRunner(prisma);
  const auditWriter = buildAuditWriter({ prisma, idGenerator, clock });

  const registerVendorUseCase = buildRegisterVendorUseCase({
    prisma,
    vendorRepository,
    sessionDenylist,
    transactionRunner,
    accessTokenTtlSeconds,
    idGenerator,
    clock,
    logger,
  });
  const { createKycUploadIntentUseCase, submitVendorKycUseCase } = buildKycUseCases({
    prisma,
    env,
    vendorRepository,
    objectStore,
    dataKeyCipher,
    transactionRunner,
    auditWriter,
    idGenerator,
    clock,
    logger,
  });

  return {
    vendorRepository,
    registerVendorUseCase,
    createKycUploadIntentUseCase,
    submitVendorKycUseCase,
  };
};

const buildAdminKycRouter = (params: {
  adminPrisma: PrismaClient;
  objectStore: ObjectStore;
  dataKeyCipher: DataKeyCipher;
  documentCipher: DocumentCipher;
  accessTokenService: AccessTokenService;
  sessionDenylist: SessionDenylist;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
}): Router => {
  const kycReviewQuery = new PrismaKycReviewQuery(params.adminPrisma);
  // Decisions write across tenants too, so their repositories and transaction
  // runner are built on `adminPrisma` — the same credential the reads use, and
  // the one KYC-5 Commit 1's UPDATE policies were written for.
  const vendorKycRepository = new PrismaVendorKycRepository(params.adminPrisma);
  const vendorRepository = new PrismaVendorRepository(params.adminPrisma);
  // The admin runner, not `PrismaTransactionRunner`: that one opens a tenant
  // transaction and refuses without a tenant context, which these routes
  // deliberately never establish.
  const transactionRunner = new AdminTransactionRunner(params.adminPrisma);
  // Built on `adminPrisma` too, so the audit write joins the same transaction
  // as the decision it records rather than crossing to a different client.
  const auditWriter = buildAuditWriter({
    prisma: params.adminPrisma,
    idGenerator: params.idGenerator,
    clock: params.clock,
  });

  return createAdminKycRouter(
    createAdminKycController({
      ...buildAdminKycReadUseCases(kycReviewQuery, params.logger),
      ...buildAdminKycDecisionUseCases({
        vendorKycRepository,
        vendorRepository,
        transactionRunner,
        auditWriter,
        clock: params.clock,
        logger: params.logger,
      }),
      ...buildAdminKycDocumentAccessUseCase({
        adminPrisma: params.adminPrisma,
        objectStore: params.objectStore,
        dataKeyCipher: params.dataKeyCipher,
        documentCipher: params.documentCipher,
        auditWriter,
        logger: params.logger,
      }),
    }),
    params.accessTokenService,
    params.sessionDenylist,
  );
};

/**
 * This module's own composition root (SDD 2.3), mirroring
 * `createIdentityModule`: `app.ts` knows nothing about Prisma or the vendor
 * lifecycle — it hands over the shared container's ports and gets a router.
 */
export const createVendorModule = (deps: VendorModuleDeps): VendorModule => {
  const {
    prisma,
    adminPrisma,
    env,
    accessTokenService,
    sessionDenylist,
    accessTokenTtlSeconds,
    clock,
    idGenerator,
    logger,
  } = deps;
  const moduleLogger = logger.child({ module: 'vendor' });
  // One instance each, shared by the vendor-facing and admin paths: neither
  // object storage nor the data-key cipher carries a tenant credential the
  // way Postgres does, so there is exactly one of each to build.
  const objectStore = new S3ObjectStore(createKycS3Client(env), { bucket: env.KYC_S3_BUCKET });
  const dataKeyCipher = createDataKeyCipher(env);
  // Stateless — no KMS/network dependency, unlike `dataKeyCipher` — so one
  // instance needs no construction parameters at all.
  const documentCipher = new AesGcmDocumentCipher();

  const {
    vendorRepository,
    registerVendorUseCase,
    createKycUploadIntentUseCase,
    submitVendorKycUseCase,
  } = buildVendorFacingUseCases({
    prisma,
    env,
    objectStore,
    dataKeyCipher,
    sessionDenylist,
    accessTokenTtlSeconds,
    idGenerator,
    clock,
    logger: moduleLogger,
  });

  const controller = createVendorController({
    registerVendorUseCase,
    createKycUploadIntentUseCase,
    submitVendorKycUseCase,
  });
  const resolveVendorTenant = async (userId: UserId): Promise<VendorId | null> =>
    (await vendorRepository.findByUserId(userId))?.id ?? null;
  const router = createVendorRouter(
    controller,
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
  );

  const adminKycRouter = buildAdminKycRouter({
    adminPrisma,
    objectStore,
    dataKeyCipher,
    documentCipher,
    accessTokenService,
    sessionDenylist,
    idGenerator,
    clock,
    logger: moduleLogger,
  });

  return { router, adminKycRouter };
};
