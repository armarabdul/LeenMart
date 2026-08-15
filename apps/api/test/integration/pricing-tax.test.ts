import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import { FixedClock, Money, UuidV7Generator } from '@leen-mart/domain-kit';
import {
  createIntegrationHarness,
  disposeIntegrationHarness,
  type IntegrationHarness,
} from '../support/integration-app.js';
import { signUpVendorOwner } from '../support/actors.js';
import { PrismaCommissionRuleRepository } from '../../src/modules/pricing-tax/infrastructure/persistence/prisma-commission-rule.repository.js';
import { PrismaTaxRateRepository } from '../../src/modules/pricing-tax/infrastructure/persistence/prisma-tax-rate.repository.js';
import { ResolveCommissionUseCase } from '../../src/modules/pricing-tax/application/use-cases/resolve-commission.use-case.js';
import { ResolveTaxUseCase } from '../../src/modules/pricing-tax/application/use-cases/resolve-tax.use-case.js';
import { CommissionRule } from '../../src/modules/pricing-tax/domain/entities/commission-rule.entity.js';
import { TaxRate } from '../../src/modules/pricing-tax/domain/entities/tax-rate.entity.js';
import { toCommissionRuleId } from '../../src/modules/pricing-tax/domain/value-objects/commission-rule-id.value-object.js';
import { toTaxRateId } from '../../src/modules/pricing-tax/domain/value-objects/tax-rate-id.value-object.js';

const EMAIL_PREFIX = 'pricing-tax-';
const ids = new UuidV7Generator();
const NOW = new Date('2026-08-15T00:00:00.000Z');
const clock = new FixedClock(NOW);

describe('pricing-tax (S3-2)', () => {
  let harness: IntegrationHarness;
  let app: Express;
  let db: PrismaClient;
  let commissionRuleRepository: PrismaCommissionRuleRepository;
  let taxRateRepository: PrismaTaxRateRepository;

  beforeAll(() => {
    harness = createIntegrationHarness();
    app = harness.app;
    db = harness.db;
    commissionRuleRepository = new PrismaCommissionRuleRepository(db);
    taxRateRepository = new PrismaTaxRateRepository(db);
  }, 60_000);

  afterAll(async () => {
    // `commission_rules`/`tax_rates` are platform-owned config, not scoped
    // to a test user — `disposeIntegrationHarness` (email-prefix-scoped)
    // never touches them, so this suite cleans up what it inserted itself,
    // the same way `route-manifest.ts`'s own suites drop the categories they
    // create. The two migration-seeded baseline rows (`effective_from =
    // 2020-01-01`) are preserved; `tax_rates` starts genuinely empty, so it
    // is safe to clear entirely.
    await db.commissionRule.deleteMany({
      where: { effectiveFrom: { gt: new Date('2020-01-01T00:00:00.000Z') } },
    });
    await db.taxRate.deleteMany({});
    await disposeIntegrationHarness(harness, EMAIL_PREFIX);
    await db.$disconnect();
  });

  describe('the seeded V1 commission rules (20260815090000_add_pricing_tax_foundation)', () => {
    it('resolves 10% for COMMISSION and 0% for SUBSCRIPTION as of now', async () => {
      const resolveCommissionUseCase = new ResolveCommissionUseCase({
        commissionRuleRepository,
        clock,
      });

      const commission = await resolveCommissionUseCase.execute({
        plan: 'COMMISSION',
        amount: Money.fromMajor(1000),
      });
      const subscription = await resolveCommissionUseCase.execute({
        plan: 'SUBSCRIPTION',
        amount: Money.fromMajor(1000),
      });

      expect(commission.rule.rateBasisPoints).toBe(1000);
      expect(commission.commissionAmount.equals(Money.fromMajor(100))).toBe(true);
      expect(subscription.rule.rateBasisPoints).toBe(0);
      expect(subscription.commissionAmount.isZero()).toBe(true);
    });
  });

  describe('PrismaCommissionRuleRepository — effective-date selection', () => {
    it('picks the most recent row with effectiveFrom <= asOf, never a later one', async () => {
      const plan = 'COMMISSION';
      const earlier = CommissionRule.create({
        id: toCommissionRuleId(ids.generate()),
        plan,
        rateBasisPoints: 1500,
        effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
        now: NOW,
      });
      const later = CommissionRule.create({
        id: toCommissionRuleId(ids.generate()),
        plan,
        rateBasisPoints: 2000,
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        now: NOW,
      });
      await commissionRuleRepository.create(earlier);
      await commissionRuleRepository.create(later);

      const beforeBoth = await commissionRuleRepository.findEffectiveForPlan(
        plan,
        new Date('2025-01-01T00:00:00.000Z'),
      );
      const betweenTheTwo = await commissionRuleRepository.findEffectiveForPlan(
        plan,
        new Date('2026-03-01T00:00:00.000Z'),
      );
      const afterBoth = await commissionRuleRepository.findEffectiveForPlan(
        plan,
        new Date('2026-12-01T00:00:00.000Z'),
      );

      // Before either of this test's own rows, the seeded baseline (1000 bps,
      // effective 2020-01-01) is still the most recent match — never null.
      expect(beforeBoth?.rateBasisPoints).toBe(1000);
      expect(betweenTheTwo?.id).toBe(earlier.id);
      expect(afterBoth?.id).toBe(later.id);
    });

    it('returns null for a plan with no configured rule as of a date before any row', async () => {
      const result = await commissionRuleRepository.findEffectiveForPlan(
        'COMMISSION',
        new Date('1999-01-01T00:00:00.000Z'),
      );
      expect(result).toBeNull();
    });
  });

  describe('PrismaCommissionRuleRepository — database constraints', () => {
    const rawInsert = (planValue: string, rateBasisPoints: number): Promise<number> =>
      db.$executeRawUnsafe(
        `INSERT INTO commission_rules (id, plan, rate_basis_points, effective_from, created_at)
         VALUES ('${randomUUID()}', '${planValue}', ${rateBasisPoints}, now(), now())`,
      );

    it('refuses a rate above 10000 basis points — the constraint this migration names', async () => {
      await expect(rawInsert('COMMISSION', 10_001)).rejects.toThrow(
        /chk_commission_rules_rate_basis_points_range/,
      );
    });

    it('refuses a negative rate', async () => {
      await expect(rawInsert('COMMISSION', -1)).rejects.toThrow(
        /chk_commission_rules_rate_basis_points_range/,
      );
    });

    it('refuses two rules for the same plan at the same effective instant', async () => {
      const plan = 'SUBSCRIPTION';
      const effectiveFrom = new Date('2027-01-01T00:00:00.000Z');
      await commissionRuleRepository.create(
        CommissionRule.create({
          id: toCommissionRuleId(ids.generate()),
          plan,
          rateBasisPoints: 500,
          effectiveFrom,
          now: NOW,
        }),
      );

      await expect(
        commissionRuleRepository.create(
          CommissionRule.create({
            id: toCommissionRuleId(ids.generate()),
            plan,
            rateBasisPoints: 700,
            effectiveFrom,
            now: NOW,
          }),
        ),
        // The typed Prisma `.create()` API reports a unique-constraint
        // violation by field list (`Unique constraint failed on the fields:
        // (\`plan\`,\`effective_from\`)`), not by constraint name — unlike the
        // raw-SQL CHECK-constraint tests below, where Postgres's own error
        // does name the constraint directly.
      ).rejects.toThrow(/Unique constraint failed/);
    });
  });

  describe('tax_rates — starts empty, unresolved is the correct V1 state', () => {
    it('resolves as unresolved for any HSN code until a CA-approved rate is created', async () => {
      const resolveTaxUseCase = new ResolveTaxUseCase({ taxRateRepository, clock });

      const result = await resolveTaxUseCase.execute({
        hsnCode: '0302',
        amount: Money.fromMajor(1000),
      });

      expect(result).toEqual({ resolved: false, hsnCode: '0302' });
    });

    it('resolves once a rate is created, and respects effective-dating the same way commission does', async () => {
      // 8 hex chars — fits `hsn_code`'s VARCHAR(8) exactly (real HSN codes
      // are at most 8 digits) and is unique enough per run to avoid
      // colliding with `uq_tax_rates_hsn_code_effective_from` on replay
      // against a persistent dev database.
      const hsnCode = randomUUID().replace(/-/g, '').slice(0, 8);
      const rate = TaxRate.create({
        id: toTaxRateId(ids.generate()),
        hsnCode,
        rateBasisPoints: 500,
        effectiveFrom: new Date('2026-06-01T00:00:00.000Z'),
        now: NOW,
      });
      await taxRateRepository.create(rate);

      const beforeEffective = await taxRateRepository.findEffectiveForHsnCode(
        hsnCode,
        new Date('2026-01-01T00:00:00.000Z'),
      );
      const afterEffective = await taxRateRepository.findEffectiveForHsnCode(
        hsnCode,
        new Date('2026-07-01T00:00:00.000Z'),
      );

      expect(beforeEffective).toBeNull();
      expect(afterEffective?.rateBasisPoints).toBe(500);
    });
  });

  describe('PrismaTaxRateRepository — database constraints', () => {
    const rawInsert = (hsnCode: string, rateBasisPoints: number): Promise<number> =>
      db.$executeRawUnsafe(
        `INSERT INTO tax_rates (id, hsn_code, rate_basis_points, effective_from, created_at)
         VALUES ('${randomUUID()}', '${hsnCode}', ${rateBasisPoints}, now(), now())`,
      );

    it('refuses a rate above 10000 basis points', async () => {
      await expect(rawInsert('9999', 10_001)).rejects.toThrow(
        /chk_tax_rates_rate_basis_points_range/,
      );
    });

    it('refuses a negative rate', async () => {
      await expect(rawInsert('9999', -1)).rejects.toThrow(/chk_tax_rates_rate_basis_points_range/);
    });
  });

  describe('VendorProfile.plan', () => {
    it('defaults a newly registered vendor to COMMISSION', async () => {
      const vendor = await signUpVendorOwner(app, EMAIL_PREFIX, 'plan-default');

      const row = await db.vendorProfile.findUniqueOrThrow({ where: { id: vendor.vendorId } });

      expect(row.plan).toBe('COMMISSION');
    });
  });
});
