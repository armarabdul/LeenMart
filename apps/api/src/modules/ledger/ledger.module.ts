import type { PrismaClient } from '@prisma/client';
import type { IdGenerator } from '@leen-mart/domain-kit';
import { PostOrderPaymentJournalsUseCase } from './application/use-cases/post-order-payment-journals.use-case.js';
import { PrismaLedgerRepository } from './infrastructure/persistence/prisma-ledger.repository.js';

export interface LedgerModuleDeps {
  /**
   * The checkout client (`leenmart_checkout`) — the only role granted INSERT
   * on the ledger tables, and the credential payment confirmation already
   * runs on. A vendor or admin client here would be refused by the database.
   */
  readonly checkoutPrisma: PrismaClient;
  readonly idGenerator: IdGenerator;
}

export interface LedgerModule {
  readonly postOrderPaymentJournalsUseCase: PostOrderPaymentJournalsUseCase;
}

/**
 * The ledger module (SDD 10.3, S3-7). Backend-only: it exposes no router and
 * mounts no route — the ledger is driven entirely by payment confirmation,
 * and S3-7 adds no API surface for it.
 */
export const createLedgerModule = (deps: LedgerModuleDeps): LedgerModule => ({
  postOrderPaymentJournalsUseCase: new PostOrderPaymentJournalsUseCase({
    ledgerRepository: new PrismaLedgerRepository(deps.checkoutPrisma),
    idGenerator: deps.idGenerator,
  }),
});
