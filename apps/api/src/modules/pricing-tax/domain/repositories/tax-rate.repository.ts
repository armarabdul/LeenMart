import type { TransactionScope } from '@leen-mart/domain-kit';
import type { TaxRate } from '../entities/tax-rate.entity.js';

export interface TaxRateRepository {
  /** Re-binds to a transaction the caller already opened. Same shape every other repository in this codebase publishes. */
  withTransaction(scope: TransactionScope): TaxRateRepository;

  create(rate: TaxRate): Promise<void>;

  /**
   * The rate in effect for `hsnCode` at `asOf` — the most recent row with
   * `effectiveFrom <= asOf`. `null` means no CA-approved rate exists for
   * this HSN code as of that instant — the expected V1 state for most or
   * all HSN codes, not an error (see `ResolveTaxUseCase`).
   */
  findEffectiveForHsnCode(hsnCode: string, asOf: Date): Promise<TaxRate | null>;
}
