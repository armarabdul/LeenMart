import { Prisma, type PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { CategoryAttribute } from '../../domain/entities/category-attribute.entity.js';
import { CategoryAttributeKeyConflictError } from '../../domain/errors/catalogue-errors.js';
import type { CategoryAttributeRepository } from '../../domain/repositories/category-attribute.repository.js';
import {
  toCategoryAttributeId,
  type CategoryAttributeId,
} from '../../domain/value-objects/category-attribute-id.value-object.js';
import { CategoryAttributeType } from '../../domain/value-objects/category-attribute-type.value-object.js';
import {
  toCategoryId,
  type CategoryId,
} from '../../domain/value-objects/category-id.value-object.js';

/** Prisma's unique-constraint-violation code — here, always `idx_category_attributes_key_unique`. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

interface CategoryAttributeRow {
  readonly id: string;
  readonly categoryId: string;
  readonly key: string;
  readonly label: string;
  readonly dataType: string;
  readonly isRequired: boolean;
  readonly unit: string | null;
  readonly options: string[];
  readonly position: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

const toDomain = (row: CategoryAttributeRow): CategoryAttribute =>
  CategoryAttribute.reconstitute({
    id: toCategoryAttributeId(row.id),
    categoryId: toCategoryId(row.categoryId),
    key: row.key,
    label: row.label,
    dataType: CategoryAttributeType.fromName(row.dataType),
    isRequired: row.isRequired,
    unit: row.unit,
    options: row.options,
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });

/** The mutable half of a row. `key` and `dataType` are absent because neither can change. */
const toColumns = (
  attribute: CategoryAttribute,
): {
  label: string;
  isRequired: boolean;
  unit: string | null;
  options: string[];
  position: number;
  updatedAt: Date;
} => ({
  label: attribute.label,
  isRequired: attribute.isRequired,
  unit: attribute.unit,
  options: [...attribute.options],
  position: attribute.position,
  updatedAt: attribute.updatedAt,
});

/**
 * Maps rows to `CategoryAttribute` at the boundary; Prisma types never escape
 * this file (SDD 3.4). Every read filters `deletedAt: null`.
 */
export class PrismaCategoryAttributeRepository implements CategoryAttributeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Rebinds to a caller's transaction. The cast is confined to this layer: the
   * port cannot name `PrismaClient` (SDD 2.3), and only `TransactionRunner.run`
   * can produce a `TransactionScope`.
   *
   * No `inCallerTransaction` flag, unlike `PrismaCategoryRepository`: every
   * method here is a single statement, so none of them opens a transaction of
   * its own and none needs to know whether it already sits in one. A flag
   * carried "for symmetry" would be an unread field pretending to be a
   * safeguard.
   */
  withTransaction(scope: TransactionScope): CategoryAttributeRepository {
    return new PrismaCategoryAttributeRepository(scope as unknown as PrismaClient);
  }

  async create(attribute: CategoryAttribute): Promise<void> {
    try {
      await this.prisma.categoryAttribute.create({
        data: {
          id: attribute.id,
          categoryId: attribute.categoryId,
          key: attribute.key,
          dataType: attribute.dataType.name,
          ...toColumns(attribute),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new CategoryAttributeKeyConflictError();
      }
      throw error;
    }
  }

  async update(attribute: CategoryAttribute): Promise<boolean> {
    const result = await this.prisma.categoryAttribute.updateMany({
      where: { id: attribute.id, categoryId: attribute.categoryId, deletedAt: null },
      data: toColumns(attribute),
    });
    return result.count === 1;
  }

  async findById(
    categoryId: CategoryId,
    id: CategoryAttributeId,
  ): Promise<CategoryAttribute | null> {
    const row = await this.prisma.categoryAttribute.findFirst({
      where: { id, categoryId, deletedAt: null },
    });
    return row ? toDomain(row) : null;
  }

  async listByCategoryId(categoryId: CategoryId): Promise<readonly CategoryAttribute[]> {
    const rows = await this.prisma.categoryAttribute.findMany({
      where: { categoryId, deletedAt: null },
      // Positions may tie by design, so `key` is what makes the order total.
      orderBy: [{ position: 'asc' }, { key: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async softDelete(attribute: CategoryAttribute): Promise<boolean> {
    const result = await this.prisma.categoryAttribute.updateMany({
      where: { id: attribute.id, categoryId: attribute.categoryId, deletedAt: null },
      data: { deletedAt: attribute.deletedAt, updatedAt: attribute.updatedAt },
    });
    return result.count === 1;
  }

  async softDeleteAllForCategory(categoryId: CategoryId, now: Date): Promise<number> {
    const result = await this.prisma.categoryAttribute.updateMany({
      where: { categoryId, deletedAt: null },
      data: { deletedAt: now, updatedAt: now },
    });
    return result.count;
  }
}
