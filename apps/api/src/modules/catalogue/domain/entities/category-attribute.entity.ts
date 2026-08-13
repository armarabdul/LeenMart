import { InvalidCategoryAttributeOperationError } from '../errors/catalogue-errors.js';
import type { CategoryAttributeId } from '../value-objects/category-attribute-id.value-object.js';
import type { CategoryAttributeType } from '../value-objects/category-attribute-type.value-object.js';
import type { CategoryId } from '../value-objects/category-id.value-object.js';

/** A stable machine identifier, not a display string. Mirrors `chk_category_attributes_key_format`. */
export const CATEGORY_ATTRIBUTE_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

export interface CategoryAttributeProps {
  readonly id: CategoryAttributeId;
  readonly categoryId: CategoryId;
  readonly key: string;
  readonly label: string;
  readonly dataType: CategoryAttributeType;
  readonly isRequired: boolean;
  /** Permitted for NUMBER only; `null` for every other type. */
  readonly unit: string | null;
  /** Non-empty for ENUM; empty for every other type. */
  readonly options: readonly string[];
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

const assertKey = (key: string): void => {
  if (!CATEGORY_ATTRIBUTE_KEY_PATTERN.test(key)) {
    throw new InvalidCategoryAttributeOperationError(
      'key',
      'Must start with a lowercase letter and contain only lowercase letters, digits and underscores.',
    );
  }
};

const assertPosition = (position: number): void => {
  if (!Number.isInteger(position) || position < 0) {
    throw new InvalidCategoryAttributeOperationError(
      'position',
      'Must be a whole number of zero or more.',
    );
  }
};

/**
 * Options are validated as a set, not just as a list: a duplicated or blank
 * option is a definition a product could never satisfy unambiguously.
 */
const assertOptionsFor = (
  dataType: CategoryAttributeType,
  options: readonly string[],
): readonly string[] => {
  if (!dataType.allowsOptions()) {
    if (options.length > 0) {
      throw new InvalidCategoryAttributeOperationError(
        'options',
        `Options are permitted only for ENUM attributes, not ${dataType.name}.`,
      );
    }
    return [];
  }

  if (options.length === 0) {
    throw new InvalidCategoryAttributeOperationError(
      'options',
      'An ENUM attribute must define at least one option.',
    );
  }
  if (options.some((option) => option.trim().length === 0)) {
    throw new InvalidCategoryAttributeOperationError('options', 'An option cannot be blank.');
  }
  if (new Set(options).size !== options.length) {
    throw new InvalidCategoryAttributeOperationError('options', 'Options must be unique.');
  }
  return [...options];
};

const assertUnitFor = (dataType: CategoryAttributeType, unit: string | null): string | null => {
  if (unit !== null && !dataType.allowsUnit()) {
    throw new InvalidCategoryAttributeOperationError(
      'unit',
      `A unit is permitted only for NUMBER attributes, not ${dataType.name}.`,
    );
  }
  return unit;
};

/**
 * One per-category product attribute **definition** (SDD 5 module 4, FR-14).
 *
 * Definitions only. The values a product supplies against these are JSONB on
 * the product (SDD 6.1) and belong to a later chunk; nothing here anticipates
 * that shape.
 *
 * **`key` and `dataType` are immutable**, and the aggregate exposes no mutator
 * for either. A key that can change is not a stable identifier for the values
 * that will eventually reference it, and a type that can change under stored
 * values is a data-corruption path with no migration story.
 *
 * `unit` and `options` are type-conditional in both directions — see
 * `CategoryAttributeType`'s two predicates, which the request contract and two
 * database `CHECK` constraints also read.
 *
 * The attribute knows its `categoryId` and nothing else about the taxonomy: it
 * does not read depth, path, risk level or the statutory flags, and it does not
 * decide whether its category may be deleted. Those are `Category`'s, and
 * duplicating them here would give two answers to one question.
 */
export class CategoryAttribute {
  private constructor(private readonly props: CategoryAttributeProps) {}

  static create(props: {
    id: CategoryAttributeId;
    categoryId: CategoryId;
    key: string;
    label: string;
    dataType: CategoryAttributeType;
    isRequired: boolean;
    unit: string | null;
    options: readonly string[];
    position: number;
    now: Date;
  }): CategoryAttribute {
    assertKey(props.key);
    assertPosition(props.position);

    return new CategoryAttribute({
      id: props.id,
      categoryId: props.categoryId,
      key: props.key,
      label: props.label,
      dataType: props.dataType,
      isRequired: props.isRequired,
      unit: assertUnitFor(props.dataType, props.unit),
      options: assertOptionsFor(props.dataType, props.options),
      position: props.position,
      createdAt: props.now,
      updatedAt: props.now,
      deletedAt: null,
    });
  }

  static reconstitute(props: CategoryAttributeProps): CategoryAttribute {
    return new CategoryAttribute(props);
  }

  get id(): CategoryAttributeId {
    return this.props.id;
  }

  get categoryId(): CategoryId {
    return this.props.categoryId;
  }

  get key(): string {
    return this.props.key;
  }

  get label(): string {
    return this.props.label;
  }

  get dataType(): CategoryAttributeType {
    return this.props.dataType;
  }

  get isRequired(): boolean {
    return this.props.isRequired;
  }

  get unit(): string | null {
    return this.props.unit;
  }

  get options(): readonly string[] {
    return this.props.options;
  }

  get position(): number {
    return this.props.position;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt;
  }

  get isDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  relabel(label: string, now: Date): CategoryAttribute {
    this.assertLive('label');
    return new CategoryAttribute({ ...this.props, label, updatedAt: now });
  }

  setRequired(isRequired: boolean, now: Date): CategoryAttribute {
    this.assertLive('isRequired');
    return new CategoryAttribute({ ...this.props, isRequired, updatedAt: now });
  }

  moveTo(position: number, now: Date): CategoryAttribute {
    this.assertLive('position');
    assertPosition(position);
    return new CategoryAttribute({ ...this.props, position, updatedAt: now });
  }

  /** Validated against the *stored* type, which is the only thing that can answer it. */
  changeUnit(unit: string | null, now: Date): CategoryAttribute {
    this.assertLive('unit');
    return new CategoryAttribute({
      ...this.props,
      unit: assertUnitFor(this.props.dataType, unit),
      updatedAt: now,
    });
  }

  changeOptions(options: readonly string[], now: Date): CategoryAttribute {
    this.assertLive('options');
    return new CategoryAttribute({
      ...this.props,
      options: assertOptionsFor(this.props.dataType, options),
      updatedAt: now,
    });
  }

  softDelete(now: Date): CategoryAttribute {
    this.assertLive('deletedAt');
    return new CategoryAttribute({ ...this.props, deletedAt: now, updatedAt: now });
  }

  private assertLive(field: string): void {
    if (this.isDeleted) {
      throw new InvalidCategoryAttributeOperationError(field, 'This attribute has been deleted.');
    }
  }
}
