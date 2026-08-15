import { describe, expect, it, vi } from 'vitest';
import { FixedClock, Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { ResolveTaxUseCase } from '../../../../../src/modules/pricing-tax/application/use-cases/resolve-tax.use-case.js';
import { TaxRate } from '../../../../../src/modules/pricing-tax/domain/entities/tax-rate.entity.js';
import type { TaxRateRepository } from '../../../../../src/modules/pricing-tax/domain/repositories/tax-rate.repository.js';
import { toTaxRateId } from '../../../../../src/modules/pricing-tax/domain/value-objects/tax-rate-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-15T00:00:00.000Z');
const clock = new FixedClock(NOW);

const taxRate = (hsnCode: string, rateBasisPoints: number): TaxRate =>
  TaxRate.create({
    id: toTaxRateId(ids.generate()),
    hsnCode,
    rateBasisPoints,
    effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
    now: NOW,
  });

const repo = (overrides: Partial<TaxRateRepository> = {}): TaxRateRepository => {
  const repository: TaxRateRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findEffectiveForHsnCode: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  return repository;
};

describe('ResolveTaxUseCase', () => {
  it('returns unresolved with hsnCode: null when the product carries no HSN code at all', async () => {
    const taxRateRepository = repo();
    const useCase = new ResolveTaxUseCase({ taxRateRepository, clock });

    const result = await useCase.execute({ hsnCode: null, amount: Money.fromMajor(100) });

    expect(result).toEqual({ resolved: false, hsnCode: null });
    expect(taxRateRepository.findEffectiveForHsnCode).not.toHaveBeenCalled();
  });

  it('returns unresolved (carrying the HSN code) when no CA-approved rate exists yet for that HSN code', async () => {
    const taxRateRepository = repo({ findEffectiveForHsnCode: vi.fn().mockResolvedValue(null) });
    const useCase = new ResolveTaxUseCase({ taxRateRepository, clock });

    const result = await useCase.execute({ hsnCode: '0302', amount: Money.fromMajor(100) });

    expect(result).toEqual({ resolved: false, hsnCode: '0302' });
  });

  it('does not pretend a rate is known — never throws for an unresolved HSN code', async () => {
    const useCase = new ResolveTaxUseCase({ taxRateRepository: repo(), clock });

    await expect(
      useCase.execute({ hsnCode: '9999', amount: Money.fromMajor(100) }),
    ).resolves.toMatchObject({
      resolved: false,
    });
  });

  it('resolves the tax amount when a CA-approved rate exists', async () => {
    const taxRateRepository = repo({
      findEffectiveForHsnCode: vi.fn().mockResolvedValue(taxRate('0302', 500)),
    });
    const useCase = new ResolveTaxUseCase({ taxRateRepository, clock });

    const result = await useCase.execute({ hsnCode: '0302', amount: Money.fromMajor(1000) });

    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.rate.rateBasisPoints).toBe(500);
      expect(result.taxAmount.equals(Money.fromMajor(50))).toBe(true);
    }
  });

  it('rounds half-up via Money.percentageOf', async () => {
    // 5% of ₹9.99 (999 paise) = 49.95 paise, rounds to 50.
    const taxRateRepository = repo({
      findEffectiveForHsnCode: vi.fn().mockResolvedValue(taxRate('0302', 500)),
    });
    const useCase = new ResolveTaxUseCase({ taxRateRepository, clock });

    const result = await useCase.execute({ hsnCode: '0302', amount: Money.fromMinor(999n) });

    expect(result.resolved).toBe(true);
    if (result.resolved) {
      expect(result.taxAmount.equals(Money.fromMinor(50n))).toBe(true);
    }
  });

  it('defaults asOf to clock.now() when not supplied', async () => {
    const taxRateRepository = repo({
      findEffectiveForHsnCode: vi.fn().mockResolvedValue(taxRate('0302', 500)),
    });
    const useCase = new ResolveTaxUseCase({ taxRateRepository, clock });

    await useCase.execute({ hsnCode: '0302', amount: Money.fromMajor(100) });

    expect(taxRateRepository.findEffectiveForHsnCode).toHaveBeenCalledWith('0302', NOW);
  });

  it('uses an explicit asOf when supplied, to resolve a past instant', async () => {
    const asOf = new Date('2026-08-05T00:00:00.000Z');
    const taxRateRepository = repo({
      findEffectiveForHsnCode: vi.fn().mockResolvedValue(taxRate('0302', 500)),
    });
    const useCase = new ResolveTaxUseCase({ taxRateRepository, clock });

    await useCase.execute({ hsnCode: '0302', amount: Money.fromMajor(100), asOf });

    expect(taxRateRepository.findEffectiveForHsnCode).toHaveBeenCalledWith('0302', asOf);
  });
});
