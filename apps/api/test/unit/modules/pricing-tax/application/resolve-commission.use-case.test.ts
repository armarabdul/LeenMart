import { describe, expect, it, vi } from 'vitest';
import { FixedClock, Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { ResolveCommissionUseCase } from '../../../../../src/modules/pricing-tax/application/use-cases/resolve-commission.use-case.js';
import { CommissionRule } from '../../../../../src/modules/pricing-tax/domain/entities/commission-rule.entity.js';
import { CommissionRuleNotFoundError } from '../../../../../src/modules/pricing-tax/domain/errors/pricing-tax-errors.js';
import type { CommissionRuleRepository } from '../../../../../src/modules/pricing-tax/domain/repositories/commission-rule.repository.js';
import { toCommissionRuleId } from '../../../../../src/modules/pricing-tax/domain/value-objects/commission-rule-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-15T00:00:00.000Z');
const clock = new FixedClock(NOW);

const rule = (
  rateBasisPoints: number,
  plan: 'COMMISSION' | 'SUBSCRIPTION' = 'COMMISSION',
): CommissionRule =>
  CommissionRule.create({
    id: toCommissionRuleId(ids.generate()),
    plan,
    rateBasisPoints,
    effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
    now: NOW,
  });

const repo = (overrides: Partial<CommissionRuleRepository> = {}): CommissionRuleRepository => {
  const repository: CommissionRuleRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findEffectiveForPlan: vi.fn().mockResolvedValue(null),
    ...overrides,
  };
  return repository;
};

describe('ResolveCommissionUseCase', () => {
  it('resolves 10% for the COMMISSION plan', async () => {
    const commissionRuleRepository = repo({
      findEffectiveForPlan: vi.fn().mockResolvedValue(rule(1000, 'COMMISSION')),
    });
    const useCase = new ResolveCommissionUseCase({ commissionRuleRepository, clock });

    const result = await useCase.execute({ plan: 'COMMISSION', amount: Money.fromMajor(1000) });

    expect(result.rule.rateBasisPoints).toBe(1000);
    expect(result.commissionAmount.equals(Money.fromMajor(100))).toBe(true);
  });

  it('resolves 0% for the SUBSCRIPTION plan', async () => {
    const commissionRuleRepository = repo({
      findEffectiveForPlan: vi.fn().mockResolvedValue(rule(0, 'SUBSCRIPTION')),
    });
    const useCase = new ResolveCommissionUseCase({ commissionRuleRepository, clock });

    const result = await useCase.execute({ plan: 'SUBSCRIPTION', amount: Money.fromMajor(1000) });

    expect(result.commissionAmount.isZero()).toBe(true);
  });

  it('rounds half-up via Money.percentageOf, not naive integer division', async () => {
    // 10% of ₹9.99 (999 paise) = 99.9 paise, rounds to 100.
    const commissionRuleRepository = repo({
      findEffectiveForPlan: vi.fn().mockResolvedValue(rule(1000)),
    });
    const useCase = new ResolveCommissionUseCase({ commissionRuleRepository, clock });

    const result = await useCase.execute({ plan: 'COMMISSION', amount: Money.fromMinor(999n) });

    expect(result.commissionAmount.equals(Money.fromMinor(100n))).toBe(true);
  });

  it('throws CommissionRuleNotFoundError when no rule resolves', async () => {
    const useCase = new ResolveCommissionUseCase({ commissionRuleRepository: repo(), clock });

    await expect(
      useCase.execute({ plan: 'COMMISSION', amount: Money.fromMajor(100) }),
    ).rejects.toBeInstanceOf(CommissionRuleNotFoundError);
  });

  it('defaults asOf to clock.now() when not supplied', async () => {
    const commissionRuleRepository = repo({
      findEffectiveForPlan: vi.fn().mockResolvedValue(rule(1000)),
    });
    const useCase = new ResolveCommissionUseCase({ commissionRuleRepository, clock });

    await useCase.execute({ plan: 'COMMISSION', amount: Money.fromMajor(100) });

    expect(commissionRuleRepository.findEffectiveForPlan).toHaveBeenCalledWith('COMMISSION', NOW);
  });

  it('uses an explicit asOf when supplied, to resolve a past instant', async () => {
    const asOf = new Date('2021-06-01T00:00:00.000Z');
    const commissionRuleRepository = repo({
      findEffectiveForPlan: vi.fn().mockResolvedValue(rule(1000)),
    });
    const useCase = new ResolveCommissionUseCase({ commissionRuleRepository, clock });

    await useCase.execute({ plan: 'COMMISSION', amount: Money.fromMajor(100), asOf });

    expect(commissionRuleRepository.findEffectiveForPlan).toHaveBeenCalledWith('COMMISSION', asOf);
  });
});
