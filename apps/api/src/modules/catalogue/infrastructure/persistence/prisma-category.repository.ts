import { Prisma, type PrismaClient } from '@prisma/client';
import type { TransactionScope } from '@leen-mart/domain-kit';
import { Category } from '../../domain/entities/category.entity.js';
import {
  CategoryNameConflictError,
  CategorySlugConflictError,
} from '../../domain/errors/catalogue-errors.js';
import type {
  CategoryPage,
  CategoryRepository,
} from '../../domain/repositories/category.repository.js';
import {
  toCategoryId,
  type CategoryId,
} from '../../domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../domain/value-objects/category-risk-level.value-object.js';
import {
  toCategorySlug,
  type CategorySlug,
} from '../../domain/value-objects/category-slug.value-object.js';

/** Prisma's unique-constraint-violation code. Which index it was decides which error the caller sees. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

interface CategoryRow {
  readonly id: string;
  readonly parentId: string | null;
  readonly path: string[];
  readonly depth: number;
  readonly name: string;
  readonly slug: string;
  readonly riskLevel: string;
  readonly requiresHsn: boolean;
  readonly requiresCountryOfOrigin: boolean;
  readonly requiresNetQuantity: boolean;
  readonly isActive: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly deletedAt: Date | null;
}

const toDomain = (row: CategoryRow): Category =>
  Category.reconstitute({
    id: toCategoryId(row.id),
    parentId: row.parentId ? toCategoryId(row.parentId) : null,
    path: row.path.map(toCategoryId),
    depth: row.depth,
    name: row.name,
    slug: toCategorySlug(row.slug),
    riskLevel: CategoryRiskLevel.fromName(row.riskLevel),
    requirements: {
      requiresHsn: row.requiresHsn,
      requiresCountryOfOrigin: row.requiresCountryOfOrigin,
      requiresNetQuantity: row.requiresNetQuantity,
    },
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  });

/** The mutable half of a row — everything `create` and `update` both write. */
const toColumns = (
  category: Category,
): {
  parentId: string | null;
  path: string[];
  depth: number;
  name: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'RESTRICTED';
  requiresHsn: boolean;
  requiresCountryOfOrigin: boolean;
  requiresNetQuantity: boolean;
  isActive: boolean;
  updatedAt: Date;
} => ({
  parentId: category.parentId,
  path: [...category.path],
  depth: category.depth,
  name: category.name,
  riskLevel: category.riskLevel.name,
  requiresHsn: category.requirements.requiresHsn,
  requiresCountryOfOrigin: category.requirements.requiresCountryOfOrigin,
  requiresNetQuantity: category.requirements.requiresNetQuantity,
  isActive: category.isActive,
  updatedAt: category.updatedAt,
});

/**
 * Translates a unique-index violation into the error that names the rule
 * actually broken.
 *
 * Which index fired is the difference between "pick another slug" and "pick
 * another name" — collapsing both into one generic conflict would leave an
 * admin guessing which of two fields to change.
 */
const translateUniqueViolation = (error: unknown): never => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  ) {
    // Prisma reports the offending index as `meta.target`, a string array for
    // PostgreSQL. Narrowed rather than stringified: `String(unknown)` on the
    // array's absence yields "[object Object]", which matches nothing and
    // would silently send every violation down the rethrow path.
    const meta = error.meta as { target?: string[] | string } | undefined;
    const target = Array.isArray(meta?.target) ? meta.target.join(',') : (meta?.target ?? '');
    if (target.includes('slug')) {
      throw new CategorySlugConflictError();
    }
    if (target.includes('name')) {
      throw new CategoryNameConflictError();
    }
  }
  throw error;
};

/**
 * Maps rows to `Category` at the boundary; Prisma types never escape this file
 * (SDD 3.4). Every read filters `deletedAt: null` — soft-deleted categories are
 * gone as far as the taxonomy is concerned.
 */
export class PrismaCategoryRepository implements CategoryRepository {
  /**
   * `inCallerTransaction` marks a client that is *already* a transaction
   * client. PostgreSQL has no nested transactions and Prisma refuses
   * `$transaction` on a transaction client, so the multi-statement methods
   * below have to know which they hold. Same flag, for the same reason, as
   * `PrismaVendorKycRepository`.
   */
  constructor(
    private readonly prisma: PrismaClient,
    private readonly inCallerTransaction = false,
  ) {}

  /**
   * Rebinds to a caller's transaction. The cast is confined to this layer: the
   * port cannot name `PrismaClient` (SDD 2.3), and only `TransactionRunner.run`
   * can produce a `TransactionScope`, so nothing else can fabricate one.
   */
  withTransaction(scope: TransactionScope): CategoryRepository {
    return new PrismaCategoryRepository(scope as unknown as PrismaClient, true);
  }

  async create(category: Category): Promise<void> {
    try {
      await this.prisma.category.create({
        data: { id: category.id, slug: category.slug, ...toColumns(category) },
      });
    } catch (error) {
      translateUniqueViolation(error);
    }
  }

  async update(category: Category): Promise<boolean> {
    try {
      const result = await this.prisma.category.updateMany({
        where: { id: category.id, deletedAt: null },
        data: toColumns(category),
      });
      return result.count === 1;
    } catch (error) {
      return translateUniqueViolation(error);
    }
  }

  async updateMany(categories: readonly Category[]): Promise<void> {
    // A subtree move is one fact: a partially rewritten `path` would leave
    // rows whose depth and ancestry disagree — which
    // `chk_categories_path_depth` would reject anyway, but only after the
    // first half had already committed.
    const writes = categories.map((category) =>
      this.prisma.category.updateMany({
        where: { id: category.id, deletedAt: null },
        data: toColumns(category),
      }),
    );

    if (this.inCallerTransaction) {
      // Already atomic — the caller's transaction is the boundary. Opening a
      // second one here would be a nested transaction, which Prisma refuses.
      for (const write of writes) {
        await write;
      }
      return;
    }
    await this.prisma.$transaction(writes);
  }

  async findById(id: CategoryId): Promise<Category | null> {
    const row = await this.prisma.category.findFirst({ where: { id, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findBySlug(slug: CategorySlug): Promise<Category | null> {
    const row = await this.prisma.category.findFirst({ where: { slug, deletedAt: null } });
    return row ? toDomain(row) : null;
  }

  async findDescendants(id: CategoryId): Promise<readonly Category[]> {
    // `has` compiles to the array containment operator, which is what
    // `idx_categories_path` (GIN) serves. Ordered by depth so a caller
    // rewriting the subtree sees parents before their children.
    const rows = await this.prisma.category.findMany({
      where: { path: { has: id }, deletedAt: null },
      orderBy: [{ depth: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toDomain);
  }

  async listPage(input: { limit: number; cursor?: string | undefined }): Promise<CategoryPage> {
    // One row beyond the page, so `hasMore` is an observation rather than a
    // second count query.
    const take = input.limit + 1;
    const rows = await this.prisma.category.findMany({
      where: { deletedAt: null },
      // UUID v7 is time-ordered, so `id` alone is a total order and the keyset
      // cursor below can neither skip nor repeat a row.
      orderBy: { id: 'asc' },
      take,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > input.limit;
    const page = hasMore ? rows.slice(0, input.limit) : rows;

    return {
      items: page.map(toDomain),
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async softDeleteIfEmpty(category: Category): Promise<boolean> {
    if (this.inCallerTransaction) {
      return this.deleteIfChildless(this.prisma, category);
    }
    return this.prisma.$transaction((tx) =>
      this.deleteIfChildless(tx as unknown as PrismaClient, category),
    );
  }

  /**
   * The count and the delete, in whichever transaction the caller supplied.
   *
   * Both statements must share one transaction: a child inserted between them
   * would otherwise be orphaned by a delete that had already passed its own
   * test. This is the one condition the database cannot express in the
   * `WHERE` clause of the `UPDATE` itself, which is why it is two statements
   * rather than the conditional-update shape used elsewhere.
   */
  private async deleteIfChildless(tx: PrismaClient, category: Category): Promise<boolean> {
    const liveChildren = await tx.category.count({
      where: { parentId: category.id, deletedAt: null },
    });
    if (liveChildren > 0) {
      return false;
    }

    const deleted = await tx.category.updateMany({
      where: { id: category.id, deletedAt: null },
      data: { deletedAt: category.deletedAt, updatedAt: category.updatedAt },
    });
    return deleted.count === 1;
  }
}
