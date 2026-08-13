import { describe, expect, it } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { CategoryAttribute } from '../../../../../src/modules/catalogue/domain/entities/category-attribute.entity.js';
import { toCategoryAttributeId } from '../../../../../src/modules/catalogue/domain/value-objects/category-attribute-id.value-object.js';
import { CategoryAttributeType } from '../../../../../src/modules/catalogue/domain/value-objects/category-attribute-type.value-object.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const LATER = new Date('2026-03-02T00:00:00.000Z');
const categoryId = toCategoryId(ids.generate());

interface Overrides {
  dataType?: CategoryAttributeType;
  unit?: string | null;
  options?: readonly string[];
  position?: number;
  key?: string;
}

const make = (overrides: Overrides = {}): CategoryAttribute =>
  CategoryAttribute.create({
    id: toCategoryAttributeId(ids.generate()),
    categoryId,
    key: overrides.key ?? 'net_weight',
    label: 'Net weight',
    dataType: overrides.dataType ?? CategoryAttributeType.STRING,
    isRequired: false,
    unit: overrides.unit ?? null,
    options: overrides.options ?? [],
    position: overrides.position ?? 0,
    now: NOW,
  });

/** Domain-rule messages are uniform (SEC-15); what names the broken rule is `details`. */
const issueOf = (act: () => unknown): string => {
  try {
    act();
    return 'did not throw';
  } catch (error) {
    const failure = error as { details?: { field: string; issue: string }[] };
    return failure.details?.[0]?.issue ?? 'no detail';
  }
};

describe('CategoryAttributeType', () => {
  it.each(['STRING', 'NUMBER', 'BOOLEAN', 'ENUM'])('parses %s', (name) => {
    expect(CategoryAttributeType.fromName(name).name).toBe(name);
  });

  it('refuses anything outside the closed vocabulary', () => {
    expect(() => CategoryAttributeType.fromName('DATE')).toThrow(TypeError);
    expect(() => CategoryAttributeType.fromName('string')).toThrow(TypeError);
  });

  it('permits options for ENUM only', () => {
    expect(CategoryAttributeType.ENUM.allowsOptions()).toBe(true);
    expect(CategoryAttributeType.STRING.allowsOptions()).toBe(false);
    expect(CategoryAttributeType.NUMBER.allowsOptions()).toBe(false);
    expect(CategoryAttributeType.BOOLEAN.allowsOptions()).toBe(false);
  });

  it('permits a unit for NUMBER only', () => {
    expect(CategoryAttributeType.NUMBER.allowsUnit()).toBe(true);
    expect(CategoryAttributeType.STRING.allowsUnit()).toBe(false);
    expect(CategoryAttributeType.BOOLEAN.allowsUnit()).toBe(false);
    expect(CategoryAttributeType.ENUM.allowsUnit()).toBe(false);
  });
});

describe('CategoryAttribute', () => {
  describe('creation', () => {
    it.each(['STRING', 'BOOLEAN'])('creates a plain %s with no unit and no options', (name) => {
      const attribute = make({ dataType: CategoryAttributeType.fromName(name) });

      expect(attribute.dataType.name).toBe(name);
      expect(attribute.unit).toBeNull();
      expect(attribute.options).toEqual([]);
      expect(attribute.isDeleted).toBe(false);
    });

    it('creates a NUMBER with a unit', () => {
      const attribute = make({ dataType: CategoryAttributeType.NUMBER, unit: 'kg' });

      expect(attribute.unit).toBe('kg');
    });

    it('creates a NUMBER without a unit — the unit is optional, not required', () => {
      expect(make({ dataType: CategoryAttributeType.NUMBER }).unit).toBeNull();
    });

    it('creates an ENUM with options', () => {
      const attribute = make({
        dataType: CategoryAttributeType.ENUM,
        options: ['small', 'medium'],
      });

      expect(attribute.options).toEqual(['small', 'medium']);
    });

    it.each(['STRING', 'BOOLEAN', 'ENUM'])('refuses a unit on %s', (name) => {
      const options = name === 'ENUM' ? ['a'] : [];

      expect(
        issueOf(() =>
          make({ dataType: CategoryAttributeType.fromName(name), unit: 'kg', options }),
        ),
      ).toMatch(/only for NUMBER/i);
    });

    it.each(['STRING', 'NUMBER', 'BOOLEAN'])('refuses options on %s', (name) => {
      expect(
        issueOf(() => make({ dataType: CategoryAttributeType.fromName(name), options: ['a'] })),
      ).toMatch(/only for ENUM/i);
    });

    it('refuses an ENUM with no options at all', () => {
      expect(issueOf(() => make({ dataType: CategoryAttributeType.ENUM }))).toMatch(
        /at least one option/i,
      );
    });

    it('refuses duplicate options', () => {
      expect(
        issueOf(() => make({ dataType: CategoryAttributeType.ENUM, options: ['a', 'a'] })),
      ).toMatch(/unique/i);
    });

    it('refuses a blank option', () => {
      expect(
        issueOf(() => make({ dataType: CategoryAttributeType.ENUM, options: ['a', '   '] })),
      ).toMatch(/blank/i);
    });

    it.each(['Weight', '1weight', '_weight', 'net-weight', 'net weight', ''])(
      'refuses the key %s',
      (key) => {
        expect(issueOf(() => make({ key }))).toMatch(/lowercase letter/i);
      },
    );

    it.each(['weight', 'net_weight', 'a1', 'a_1_b'])('accepts the key %s', (key) => {
      expect(make({ key }).key).toBe(key);
    });

    it.each([-1, 1.5])('refuses the position %s', (position) => {
      expect(issueOf(() => make({ position }))).toMatch(/zero or more/i);
    });

    it('accepts position zero', () => {
      expect(make({ position: 0 }).position).toBe(0);
    });
  });

  describe('immutability', () => {
    it('offers no way to change the key or the data type', () => {
      const methods = Object.getOwnPropertyNames(CategoryAttribute.prototype);

      // A key is the stable identifier product values will reference, and a
      // type that could change under stored values is a corruption path.
      expect(methods).not.toContain('changeKey');
      expect(methods).not.toContain('rekey');
      expect(methods).not.toContain('changeDataType');
      expect(methods).not.toContain('changeType');
    });
  });

  describe('edits', () => {
    it('relabels without touching anything else', () => {
      const attribute = make();
      const relabelled = attribute.relabel('Weight (net)', LATER);

      expect(relabelled.label).toBe('Weight (net)');
      expect(relabelled.key).toBe(attribute.key);
      expect(relabelled.dataType.name).toBe(attribute.dataType.name);
      expect(relabelled.updatedAt).toEqual(LATER);
    });

    it('toggles requiredness', () => {
      expect(make().setRequired(true, LATER).isRequired).toBe(true);
    });

    it('moves to a new position and refuses a negative one', () => {
      expect(make().moveTo(7, LATER).position).toBe(7);
      expect(issueOf(() => make().moveTo(-1, LATER))).toMatch(/zero or more/i);
    });

    it('changes a NUMBER’s unit and can clear it', () => {
      const attribute = make({ dataType: CategoryAttributeType.NUMBER, unit: 'kg' });

      expect(attribute.changeUnit('g', LATER).unit).toBe('g');
      expect(attribute.changeUnit(null, LATER).unit).toBeNull();
    });

    it('refuses a unit on a stored non-NUMBER, which only the aggregate can know', () => {
      // The request schema cannot check this: `dataType` is immutable and so
      // is not on the wire for a PATCH.
      expect(issueOf(() => make().changeUnit('kg', LATER))).toMatch(/only for NUMBER/i);
    });

    it('changes an ENUM’s options', () => {
      const attribute = make({ dataType: CategoryAttributeType.ENUM, options: ['a'] });

      expect(attribute.changeOptions(['a', 'b'], LATER).options).toEqual(['a', 'b']);
    });

    it('refuses to empty an ENUM’s options', () => {
      const attribute = make({ dataType: CategoryAttributeType.ENUM, options: ['a'] });

      expect(issueOf(() => attribute.changeOptions([], LATER))).toMatch(/at least one option/i);
    });

    it('refuses options on a stored non-ENUM', () => {
      expect(issueOf(() => make().changeOptions(['a'], LATER))).toMatch(/only for ENUM/i);
    });

    it('accepts an empty options list on a non-ENUM as a no-op', () => {
      expect(make().changeOptions([], LATER).options).toEqual([]);
    });
  });

  describe('soft delete', () => {
    it('stamps deletedAt', () => {
      const deleted = make().softDelete(NOW);

      expect(deleted.deletedAt).toEqual(NOW);
      expect(deleted.isDeleted).toBe(true);
    });

    it('refuses every edit once deleted', () => {
      const deleted = make({ dataType: CategoryAttributeType.NUMBER }).softDelete(NOW);

      expect(issueOf(() => deleted.relabel('x', LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.setRequired(true, LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.moveTo(1, LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.changeUnit('kg', LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.changeOptions([], LATER))).toMatch(/deleted/i);
      expect(issueOf(() => deleted.softDelete(LATER))).toMatch(/deleted/i);
    });
  });
});
