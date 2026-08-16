import type { PrismaClient } from '@prisma/client';
import type { Router } from 'express';
import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import type { VendorTenantResolver } from '../../shared/interface/http/middleware/tenant-context.js';
import type { AccessTokenService, SessionDenylist } from '../identity/index.js';
import { PrismaVendorRepository } from '../vendor/infrastructure/persistence/prisma-vendor.repository.js';
import { PostOrderPaymentJournalsUseCase } from './application/use-cases/post-order-payment-journals.use-case.js';
import { GetVendorEarningsUseCase } from './application/use-cases/get-vendor-earnings.use-case.js';
import { PrismaLedgerRepository } from './infrastructure/persistence/prisma-ledger.repository.js';
import { PrismaVendorEarningsQuery } from './infrastructure/persistence/prisma-vendor-earnings-query.js';
import { createVendorEarningsController } from './interface/http/vendor-earnings.controller.js';
import { createVendorEarningsRouter } from './interface/http/vendor-earnings.routes.js';

export interface LedgerModuleDeps {
  /**
   * The checkout client (`leenmart_checkout`) — the only role granted INSERT
   * on the ledger tables, and the credential payment confirmation already
   * runs on. A vendor or admin client here would be refused by the database.
   */
  readonly checkoutPrisma: PrismaClient;
  /**
   * The tenant-scoped client (`leenmart_app`, S3-8) — every vendor earnings
   * read runs on this, never `checkoutPrisma`: `leenmart_checkout`'s own
   * ledger SELECT policy is `USING (true)` (a checkout transaction
   * legitimately spans every vendor in a multi-vendor order), so it carries
   * no per-request vendor scoping at all. `leenmart_app`'s
   * `ledger_journals_vendor_select`/`ledger_entries_vendor_select` policies
   * are the ones actually keyed on `app.vendor_id`.
   */
  readonly prisma: PrismaClient;
  readonly accessTokenService: AccessTokenService;
  readonly sessionDenylist: SessionDenylist;
  /** Resolves the caller's own vendor for `tenantContext` (S3-8) — same pattern `order.module.ts` receives from the composition root. */
  readonly resolveVendorTenant: VendorTenantResolver;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface LedgerModule {
  readonly postOrderPaymentJournalsUseCase: PostOrderPaymentJournalsUseCase;
  /** Mounted at `/api/v1/vendor/earnings` (S3-8) — the ledger's first API surface; S3-7 itself exposed none. */
  readonly vendorRouter: Router;
}

/**
 * The ledger module (SDD 10.3, S3-7; read surface added S3-8).
 *
 * Two independent collaborators, deliberately built from different
 * credentials: `postOrderPaymentJournalsUseCase` posts on `checkoutPrisma`
 * (the only writer), while `vendorRouter` reads on the tenant-scoped
 * `prisma` (the only reach that is actually vendor-scoped). Neither can
 * stand in for the other.
 */
export const createLedgerModule = (deps: LedgerModuleDeps): LedgerModule => {
  const {
    checkoutPrisma,
    prisma,
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
    idGenerator,
  } = deps;

  const postOrderPaymentJournalsUseCase = new PostOrderPaymentJournalsUseCase({
    ledgerRepository: new PrismaLedgerRepository(checkoutPrisma),
    idGenerator,
  });

  const getVendorEarningsUseCase = new GetVendorEarningsUseCase({
    vendorRepository: new PrismaVendorRepository(prisma),
    vendorEarningsQuery: new PrismaVendorEarningsQuery(prisma),
  });
  const controller = createVendorEarningsController({ getVendorEarningsUseCase });
  const vendorRouter = createVendorEarningsRouter(controller, {
    accessTokenService,
    sessionDenylist,
    resolveVendorTenant,
  });

  return { postOrderPaymentJournalsUseCase, vendorRouter };
};
