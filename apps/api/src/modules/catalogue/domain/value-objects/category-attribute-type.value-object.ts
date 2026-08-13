export type CategoryAttributeTypeName = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'ENUM';

/**
 * The closed vocabulary a per-category attribute may be declared as (S2-2b).
 *
 * Four types, deliberately. Anything richer — nested objects, ranges,
 * cross-field conditions — becomes a schema language, and a schema language
 * stored in the database is a validation engine nobody can review and nothing
 * can typecheck.
 *
 * The two predicates below are why this is a class rather than a bare union:
 * "may this type carry options?" and "may this type carry a unit?" are asked
 * by the aggregate, by the request contract and by two database `CHECK`
 * constraints, and answering them in one place is what keeps those three
 * copies from drifting apart.
 */
export class CategoryAttributeType {
  private constructor(readonly name: CategoryAttributeTypeName) {}

  static readonly STRING = new CategoryAttributeType('STRING');
  static readonly NUMBER = new CategoryAttributeType('NUMBER');
  static readonly BOOLEAN = new CategoryAttributeType('BOOLEAN');
  static readonly ENUM = new CategoryAttributeType('ENUM');

  private static readonly BY_NAME: Readonly<
    Record<CategoryAttributeTypeName, CategoryAttributeType>
  > = {
    STRING: CategoryAttributeType.STRING,
    NUMBER: CategoryAttributeType.NUMBER,
    BOOLEAN: CategoryAttributeType.BOOLEAN,
    ENUM: CategoryAttributeType.ENUM,
  };

  static fromName(name: string): CategoryAttributeType {
    const type = CategoryAttributeType.BY_NAME[name as CategoryAttributeTypeName];
    if (!type) {
      throw new TypeError(`Not a valid category attribute type: "${name}"`);
    }
    return type;
  }

  /**
   * ENUM only — and this is an equivalence, not a permission: an ENUM without
   * options is as invalid as a BOOLEAN with them. `chk_category_attributes_options`
   * says the same thing in SQL.
   */
  allowsOptions(): boolean {
    return this.name === 'ENUM';
  }

  /** NUMBER only. "kg" on a BOOLEAN is not a value anyone can interpret. */
  allowsUnit(): boolean {
    return this.name === 'NUMBER';
  }

  equals(other: CategoryAttributeType): boolean {
    return this.name === other.name;
  }
}
