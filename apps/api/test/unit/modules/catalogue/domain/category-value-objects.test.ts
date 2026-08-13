import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import {
  isCategoryId,
  toCategoryId,
} from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../../../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import {
  CATEGORY_SLUG_MAX_LENGTH,
  isCategorySlug,
  toCategorySlug,
} from '../../../../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';

const ids = new UuidV7Generator();

describe('CategoryId', () => {
  it('accepts a generated uuid', () => {
    const value = ids.generate();

    expect(isCategoryId(value)).toBe(true);
    expect(toCategoryId(value)).toBe(value);
  });

  it('refuses anything that is not a uuid', () => {
    expect(isCategoryId('groceries')).toBe(false);
    expect(() => toCategoryId('groceries')).toThrow(TypeError);
  });
});

describe('CategoryRiskLevel', () => {
  it.each(['LOW', 'MEDIUM', 'RESTRICTED'])('parses %s', (name) => {
    expect(CategoryRiskLevel.fromName(name).name).toBe(name);
  });

  it('refuses a level outside SDD 15.2’s three tiers', () => {
    expect(() => CategoryRiskLevel.fromName('CRITICAL')).toThrow(TypeError);
    expect(() => CategoryRiskLevel.fromName('low')).toThrow(TypeError);
  });

  it('compares by name', () => {
    expect(CategoryRiskLevel.LOW.equals(CategoryRiskLevel.fromName('LOW'))).toBe(true);
    expect(CategoryRiskLevel.LOW.equals(CategoryRiskLevel.RESTRICTED)).toBe(false);
  });
});

describe('CategorySlug', () => {
  it.each(['groceries', 'fresh-fish', 'a1', 'home-and-kitchen-2'])('accepts %s', (value) => {
    expect(isCategorySlug(value)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['Groceries', 'uppercase'],
    ['-groceries', 'leading hyphen'],
    ['groceries-', 'trailing hyphen'],
    ['fresh--fish', 'doubled hyphen'],
    ['fresh fish', 'space'],
    ['fresh_fish', 'underscore'],
    ['fresh/fish', 'slash'],
  ])('refuses %s (%s)', (value) => {
    expect(isCategorySlug(value)).toBe(false);
    expect(() => toCategorySlug(value)).toThrow(TypeError);
  });

  it(`refuses a slug longer than ${String(CATEGORY_SLUG_MAX_LENGTH)} characters`, () => {
    expect(isCategorySlug('a'.repeat(CATEGORY_SLUG_MAX_LENGTH))).toBe(true);
    expect(isCategorySlug('a'.repeat(CATEGORY_SLUG_MAX_LENGTH + 1))).toBe(false);
  });
});
