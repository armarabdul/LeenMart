import { describe, expect, it, vi } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { GetPublicCategoryTreeUseCase } from '../../../../../src/modules/catalogue/application/use-cases/get-public-category-tree.use-case.js';
import { GetPublicCategoryUseCase } from '../../../../../src/modules/catalogue/application/use-cases/get-public-category.use-case.js';
import { CategoryNotFoundError } from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { Category } from '../../../../../src/modules/catalogue/domain/entities/category.entity.js';
import type { CategoryRepository } from '../../../../../src/modules/catalogue/domain/repositories/category.repository.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../../../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategorySlug } from '../../../../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');

const NO_REQUIREMENTS = {
  requiresHsn: false,
  requiresCountryOfOrigin: false,
  requiresNetQuantity: false,
};

let counter = 0;
const category = (options: {
  parent?: Category | null;
  name?: string;
  isActive?: boolean;
}): Category => {
  counter += 1;
  const built = Category.create({
    id: toCategoryId(ids.generate()),
    parent: options.parent ?? null,
    name: options.name ?? `Category ${counter}`,
    slug: toCategorySlug(`category-${counter}`),
    riskLevel: CategoryRiskLevel.LOW,
    requirements: NO_REQUIREMENTS,
    now: NOW,
  });
  return options.isActive === false ? built.setActive(false, NOW) : built;
};

const repo = (overrides: Partial<CategoryRepository> = {}): CategoryRepository => {
  const repository: CategoryRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
    updateMany: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    findBySlug: vi.fn().mockResolvedValue(null),
    findDescendants: vi.fn().mockResolvedValue([]),
    listPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    softDeleteIfEmpty: vi.fn().mockResolvedValue(true),
    findAllActive: vi.fn().mockResolvedValue([]),
    findChildren: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
  return repository;
};

describe('GetPublicCategoryTreeUseCase', () => {
  it('returns an empty forest when nothing is active', async () => {
    const useCase = new GetPublicCategoryTreeUseCase({
      categoryRepository: repo({ findAllActive: vi.fn().mockResolvedValue([]) }),
    });

    await expect(useCase.execute()).resolves.toEqual([]);
  });

  it('nests children under their parent, roots at the top level', async () => {
    const root = category({ name: 'Groceries' });
    const child = category({ parent: root, name: 'Snacks' });
    const grandchild = category({ parent: child, name: 'Chips' });

    const useCase = new GetPublicCategoryTreeUseCase({
      categoryRepository: repo({
        findAllActive: vi.fn().mockResolvedValue([root, child, grandchild]),
      }),
    });

    const forest = await useCase.execute();

    expect(forest).toHaveLength(1);
    expect(forest[0]?.category.id).toBe(root.id);
    expect(forest[0]?.children).toHaveLength(1);
    expect(forest[0]?.children[0]?.category.id).toBe(child.id);
    expect(forest[0]?.children[0]?.children).toHaveLength(1);
    expect(forest[0]?.children[0]?.children[0]?.category.id).toBe(grandchild.id);
  });

  it('supports multiple roots and multiple siblings under one parent', async () => {
    const rootA = category({ name: 'Groceries' });
    const rootB = category({ name: 'Electronics' });
    const childA1 = category({ parent: rootA, name: 'Snacks' });
    const childA2 = category({ parent: rootA, name: 'Beverages' });

    const useCase = new GetPublicCategoryTreeUseCase({
      categoryRepository: repo({
        findAllActive: vi.fn().mockResolvedValue([rootA, rootB, childA1, childA2]),
      }),
    });

    const forest = await useCase.execute();

    expect(forest.map((node) => node.category.id)).toEqual([rootA.id, rootB.id]);
    expect(forest[0]?.children.map((node) => node.category.id)).toEqual([childA1.id, childA2.id]);
    expect(forest[1]?.children).toEqual([]);
  });

  it('orphans an active child whose parent is inactive — it never reaches the output', async () => {
    // The inactive parent is never fetched by a real `findAllActive` (it
    // filters `isActive: true`); the fake mirrors that by simply never
    // including it in the returned list, exactly as production would.
    const activeChildOfMissingParent = category({ name: 'Orphan' });
    const detachedParentId = toCategoryId(ids.generate());
    const orphan = Category.reconstitute({
      id: activeChildOfMissingParent.id,
      parentId: detachedParentId,
      path: [detachedParentId],
      depth: 2,
      name: activeChildOfMissingParent.name,
      slug: activeChildOfMissingParent.slug,
      riskLevel: activeChildOfMissingParent.riskLevel,
      requirements: activeChildOfMissingParent.requirements,
      isActive: true,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    });

    const useCase = new GetPublicCategoryTreeUseCase({
      categoryRepository: repo({ findAllActive: vi.fn().mockResolvedValue([orphan]) }),
    });

    await expect(useCase.execute()).resolves.toEqual([]);
  });
});

describe('GetPublicCategoryUseCase', () => {
  it('returns the category with its active children', async () => {
    const parent = category({ name: 'Groceries' });
    const activeChild = category({ parent, name: 'Snacks' });
    const inactiveChild = category({ parent, name: 'Discontinued', isActive: false });

    const useCase = new GetPublicCategoryUseCase({
      categoryRepository: repo({
        findBySlug: vi.fn().mockResolvedValue(parent),
        findChildren: vi.fn().mockResolvedValue([activeChild, inactiveChild]),
      }),
    });

    const result = await useCase.execute({ slug: parent.slug });

    expect(result.category.id).toBe(parent.id);
    expect(result.children.map((child) => child.id)).toEqual([activeChild.id]);
  });

  it('throws CategoryNotFoundError for an unknown slug', async () => {
    const useCase = new GetPublicCategoryUseCase({
      categoryRepository: repo({ findBySlug: vi.fn().mockResolvedValue(null) }),
    });

    await expect(useCase.execute({ slug: toCategorySlug('unknown') })).rejects.toBeInstanceOf(
      CategoryNotFoundError,
    );
  });

  it('throws the same CategoryNotFoundError for an inactive category — no distinguishing signal', async () => {
    const inactive = category({ name: 'Retired', isActive: false });
    const useCase = new GetPublicCategoryUseCase({
      categoryRepository: repo({ findBySlug: vi.fn().mockResolvedValue(inactive) }),
    });

    await expect(useCase.execute({ slug: inactive.slug })).rejects.toBeInstanceOf(
      CategoryNotFoundError,
    );
  });
});
