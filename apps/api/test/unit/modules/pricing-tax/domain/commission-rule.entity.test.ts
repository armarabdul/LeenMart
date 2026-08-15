import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { CommissionRule } from '../../../../../src/modules/pricing-tax/domain/entities/commission-rule.entity.js';
import { InvalidCommissionRuleError } from '../../../../../src/modules/pricing-tax/domain/errors/pricing-tax-errors.js';
import { toCommissionRuleId } from '../../../../../src/modules/pricing-tax/domain/value-objects/commission-rule-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-15T00:00:00.000Z');
const EFFECTIVE_FROM = new Date('2020-01-01T00:00:00.000Z');

const build = (rateBasisPoints: number): CommissionRule =>
  CommissionRule.create({
    id: toCommissionRuleId(ids.generate()),
    plan: 'COMMISSION',
    rateBasisPoints,
    effectiveFrom: EFFECTIVE_FROM,
    now: NOW,
  });

describe('CommissionRule', () => {
  it('create() accepts a valid basis-point rate', () => {
    const rule = build(1000);
    expect(rule.rateBasisPoints).toBe(1000);
    expect(rule.plan).toBe('COMMISSION');
    expect(rule.effectiveFrom).toEqual(EFFECTIVE_FROM);
    expect(rule.createdAt).toEqual(NOW);
  });

  it('create() accepts the boundary values 0 and 10000', () => {
    expect(build(0).rateBasisPoints).toBe(0);
    expect(build(10_000).rateBasisPoints).toBe(10_000);
  });

  it('create() rejects a negative rate', () => {
    expect(() => build(-1)).toThrow(InvalidCommissionRuleError);
  });

  it('create() rejects a rate above 10000 basis points (100%)', () => {
    expect(() => build(10_001)).toThrow(InvalidCommissionRuleError);
  });

  it('create() rejects a non-integer rate', () => {
    expect(() => build(10.5)).toThrow(InvalidCommissionRuleError);
  });

  it('reconstitute() rebuilds a persisted rule with no validation', () => {
    const id = toCommissionRuleId(ids.generate());
    const rule = CommissionRule.reconstitute({
      id,
      plan: 'SUBSCRIPTION',
      rateBasisPoints: 0,
      effectiveFrom: EFFECTIVE_FROM,
      createdAt: NOW,
    });
    expect(rule.id).toBe(id);
    expect(rule.plan).toBe('SUBSCRIPTION');
  });
});
