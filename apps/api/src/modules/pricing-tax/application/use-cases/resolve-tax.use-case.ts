import type { Clock, Money } from '@leen-mart/domain-kit';
import type { TaxRate } from '../../domain/entities/tax-rate.entity.js';
import type { TaxRateRepository } from '../../domain/repositories/tax-rate.repository.js';

export interface ResolveTaxInput {
  /** `Product.hsnCode` (S2-3, nullable) — `null` means the product itself carries no HSN classification yet. */
  readonly hsnCode: string | null;
  readonly amount: Money;
  /** Defaults to `clock.now()` — pass explicitly to resolve the rate that applied at a past instant. */
  readonly asOf?: Date;
}

export interface TaxResolved {
  readonly resolved: true;
  readonly rate: TaxRate;
  readonly taxAmount: Money;
}

export interface TaxUnresolved {
  readonly resolved: false;
  /** Carried through so a caller can explain *why* — no HSN at all, vs. an HSN with no CA-approved rate yet. */
  readonly hsnCode: string | null;
}

export type TaxResolution = TaxResolved | TaxUnresolved;

export interface ResolveTaxDeps {
  readonly taxRateRepository: TaxRateRepository;
  readonly clock: Clock;
}

/**
 * Resolves the tax owed on `amount` for a given HSN classification, as of a
 * point in time (D-S3-05).
 *
 * Deliberately never throws for "no rate configured" — a missing HSN
 * classification or a missing CA-approved rate are both *expected* V1
 * states (D-S3-05 explicitly forbids populating invented GST rates, so
 * `tax_rates` starts empty), not exceptional ones. A discriminated
 * `TaxResolution` return, not `Result<T, E>` (unused elsewhere in this
 * codebase — every existing use case either throws or returns a plain
 * nullable/shaped value, e.g. `GetCartUseCase`'s `{ cart: Cart | null }`),
 * forces the caller to handle both branches without introducing a pattern
 * nothing else here follows yet. Contrast `ResolveCommissionUseCase`, which
 * throws — that asymmetry is intentional (D-S3-01 vs D-S3-05).
 */
export class ResolveTaxUseCase {
  constructor(private readonly deps: ResolveTaxDeps) {}

  async execute(input: ResolveTaxInput): Promise<TaxResolution> {
    const { taxRateRepository, clock } = this.deps;

    if (!input.hsnCode) {
      return { resolved: false, hsnCode: null };
    }

    const asOf = input.asOf ?? clock.now();
    const rate = await taxRateRepository.findEffectiveForHsnCode(input.hsnCode, asOf);
    if (!rate) {
      return { resolved: false, hsnCode: input.hsnCode };
    }

    const taxAmount = input.amount.percentageOf(rate.rateBasisPoints / 100);
    return { resolved: true, rate, taxAmount };
  }
}
