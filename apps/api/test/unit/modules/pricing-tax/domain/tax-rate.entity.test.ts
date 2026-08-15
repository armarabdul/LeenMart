import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { InvalidTaxRateError } from '../../../../../src/modules/pricing-tax/domain/errors/pricing-tax-errors.js';
import { TaxRate } from '../../../../../src/modules/pricing-tax/domain/entities/tax-rate.entity.js';
import { toTaxRateId } from '../../../../../src/modules/pricing-tax/domain/value-objects/tax-rate-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-15T00:00:00.000Z');
const EFFECTIVE_FROM = new Date('2026-08-01T00:00:00.000Z');

const build = (rateBasisPoints: number): TaxRate =>
  TaxRate.create({
    id: toTaxRateId(ids.generate()),
    hsnCode: '0302',
    rateBasisPoints,
    effectiveFrom: EFFECTIVE_FROM,
    now: NOW,
  });

describe('TaxRate', () => {
  it('create() accepts a valid basis-point rate', () => {
    const rate = build(500);
    expect(rate.rateBasisPoints).toBe(500);
    expect(rate.hsnCode).toBe('0302');
    expect(rate.effectiveFrom).toEqual(EFFECTIVE_FROM);
    expect(rate.createdAt).toEqual(NOW);
  });

  it('create() accepts the boundary values 0 and 10000', () => {
    expect(build(0).rateBasisPoints).toBe(0);
    expect(build(10_000).rateBasisPoints).toBe(10_000);
  });

  it('create() rejects a negative rate', () => {
    expect(() => build(-1)).toThrow(InvalidTaxRateError);
  });

  it('create() rejects a rate above 10000 basis points (100%)', () => {
    expect(() => build(10_001)).toThrow(InvalidTaxRateError);
  });

  it('create() rejects a non-integer rate', () => {
    expect(() => build(5.5)).toThrow(InvalidTaxRateError);
  });

  it('reconstitute() rebuilds a persisted rate with no validation', () => {
    const id = toTaxRateId(ids.generate());
    const rate = TaxRate.reconstitute({
      id,
      hsnCode: '6109',
      rateBasisPoints: 1200,
      effectiveFrom: EFFECTIVE_FROM,
      createdAt: NOW,
    });
    expect(rate.id).toBe(id);
    expect(rate.hsnCode).toBe('6109');
  });
});
