import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../../../src/modules/audit/index.js';
import { CATALOGUE_AUDIT_ACTIONS } from '../../../../../src/modules/catalogue/domain/audit-actions.js';
import { CreateCategoryUseCase } from '../../../../../src/modules/catalogue/application/use-cases/create-category.use-case.js';
import { UpdateCategoryUseCase } from '../../../../../src/modules/catalogue/application/use-cases/update-category.use-case.js';
import { ReparentCategoryUseCase } from '../../../../../src/modules/catalogue/application/use-cases/reparent-category.use-case.js';
import { DeleteCategoryUseCase } from '../../../../../src/modules/catalogue/application/use-cases/delete-category.use-case.js';
import { GetCategoryUseCase } from '../../../../../src/modules/catalogue/application/use-cases/get-category.use-case.js';
import { ListCategoriesUseCase } from '../../../../../src/modules/catalogue/application/use-cases/list-categories.use-case.js';
import {
  CategoryNotEmptyError,
  CategoryNotFoundError,
} from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { Category } from '../../../../../src/modules/catalogue/domain/entities/category.entity.js';
import type { CategoryAttributeRepository } from '../../../../../src/modules/catalogue/domain/repositories/category-attribute.repository.js';
import type { CategoryRepository } from '../../../../../src/modules/catalogue/domain/repositories/category.repository.js';
import { toCategoryId } from '../../../../../src/modules/catalogue/domain/value-objects/category-id.value-object.js';
import { CategoryRiskLevel } from '../../../../../src/modules/catalogue/domain/value-objects/category-risk-level.value-object.js';
import { toCategorySlug } from '../../../../../src/modules/catalogue/domain/value-objects/category-slug.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { FailingAuditWriter, RecordingAuditWriter } from '../../identity/application/fakes.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);

const admin = toUserId(ids.generate());
const principal: Principal = {
  userId: admin,
  sessionId: toSessionId(ids.generate()),
  role: 'FINANCE_ADMIN',
};

const NO_REQUIREMENTS = {
  requiresHsn: false,
  requiresCountryOfOrigin: false,
  requiresNetQuantity: false,
};

let counter = 0;
const category = (parent: Category | null = null): Category =>
  Category.create({
    id: toCategoryId(ids.generate()),
    parent,
    name: `Category ${(counter += 1)}`,
    slug: toCategorySlug(`category-${counter}`),
    riskLevel: CategoryRiskLevel.LOW,
    requirements: NO_REQUIREMENTS,
    now: NOW,
  });

/** Runs the callback and rolls nothing back — failure propagates, as a real transaction's would. */
const runner = (onRollback?: () => void): TransactionRunner => ({
  run: async (work) => {
    try {
      return await work({} as TransactionScope);
    } catch (error) {
      onRollback?.();
      throw error;
    }
  },
});

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
    ...overrides,
  };
  return repository;
};

const deps = (
  repository: CategoryRepository,
  auditWriter: AuditWriter = new RecordingAuditWriter(),
  onRollback?: () => void,
): {
  categoryRepository: CategoryRepository;
  transactionRunner: TransactionRunner;
  auditWriter: AuditWriter;
  clock: FixedClock;
  logger: NullLogger;
} => ({
  categoryRepository: repository,
  transactionRunner: runner(onRollback),
  auditWriter,
  clock,
  logger: new NullLogger(),
});

describe('CreateCategoryUseCase', () => {
  const build = (
    repository = repo(),
    auditWriter: AuditWriter = new RecordingAuditWriter(),
  ): CreateCategoryUseCase =>
    new CreateCategoryUseCase({ ...deps(repository, auditWriter), idGenerator: ids });

  const input = (
    parentId: ReturnType<typeof toCategoryId> | null = null,
  ): Parameters<CreateCategoryUseCase['execute']>[0] => ({
    principal,
    parentId,
    name: 'Groceries',
    slug: toCategorySlug('groceries'),
    riskLevel: 'LOW',
    requirements: NO_REQUIREMENTS,
  });

  it('creates a root when no parent is named', async () => {
    const { category: created } = await build().execute(input());

    expect(created.parentId).toBeNull();
    expect(created.depth).toBe(1);
  });

  it('places a child under the parent it loaded, never under an id it was handed', async () => {
    const parent = category();
    const repository = repo({ findById: vi.fn().mockResolvedValue(parent) });

    const { category: created } = await build(repository).execute(input(parent.id));

    expect(created.parentId).toBe(parent.id);
    expect(created.path).toEqual([parent.id]);
  });

  it('reports an unknown parent as not found rather than creating an orphan', async () => {
    const repository = repo({ findById: vi.fn().mockResolvedValue(null) });

    await expect(
      build(repository).execute(input(toCategoryId(ids.generate()))),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('records exactly one audit entry naming the created action and the actor', async () => {
    const auditWriter = new RecordingAuditWriter();
    await build(repo(), auditWriter).execute(input());

    expect(auditWriter.entries).toHaveLength(1);
    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.CATEGORY_CREATED);
    expect(auditWriter.entries[0]?.actorId).toBe(admin);
    expect(auditWriter.entries[0]?.actorRole).toBe('FINANCE_ADMIN');
  });

  it('rolls the whole thing back when the audit write fails', async () => {
    const rolledBack = vi.fn();
    const repository = repo();
    const useCase = new CreateCategoryUseCase({
      ...deps(repository, new FailingAuditWriter(), rolledBack),
      idGenerator: ids,
    });

    await expect(useCase.execute(input())).rejects.toThrow(/audit/i);
    expect(rolledBack).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateCategoryUseCase', () => {
  const build = (
    repository: CategoryRepository,
    auditWriter: AuditWriter = new RecordingAuditWriter(),
  ): UpdateCategoryUseCase => new UpdateCategoryUseCase(deps(repository, auditWriter));

  const existing = (): Category => category();

  it('applies only the supplied fields', async () => {
    const current = existing();
    const repository = repo({ findById: vi.fn().mockResolvedValue(current) });

    const { category: updated } = await build(repository).execute({
      principal,
      categoryId: current.id,
      changes: { name: 'Renamed' },
    });

    expect(updated.name).toBe('Renamed');
    expect(updated.riskLevel.name).toBe(current.riskLevel.name);
    expect(updated.isActive).toBe(current.isActive);
  });

  it('records a rename as a rename', async () => {
    const current = existing();
    const auditWriter = new RecordingAuditWriter();
    await build(repo({ findById: vi.fn().mockResolvedValue(current) }), auditWriter).execute({
      principal,
      categoryId: current.id,
      changes: { name: 'Renamed' },
    });

    expect(auditWriter.entries.map((entry) => entry.action)).toEqual([
      CATALOGUE_AUDIT_ACTIONS.CATEGORY_RENAMED,
    ]);
  });

  it('records a settings change separately from a rename, and both when both happen', async () => {
    const current = existing();
    const auditWriter = new RecordingAuditWriter();
    await build(repo({ findById: vi.fn().mockResolvedValue(current) }), auditWriter).execute({
      principal,
      categoryId: current.id,
      changes: { name: 'Renamed', riskLevel: 'RESTRICTED' },
    });

    // Two distinct acts with different reviewers; a log that cannot tell them
    // apart is worth less than one that can.
    expect(auditWriter.entries.map((entry) => entry.action)).toEqual([
      CATALOGUE_AUDIT_ACTIONS.CATEGORY_RENAMED,
      CATALOGUE_AUDIT_ACTIONS.CATEGORY_SETTINGS_UPDATED,
    ]);
  });

  it('writes no audit entry when the request changes nothing', async () => {
    const current = existing();
    const auditWriter = new RecordingAuditWriter();
    await build(repo({ findById: vi.fn().mockResolvedValue(current) }), auditWriter).execute({
      principal,
      categoryId: current.id,
      changes: {},
    });

    expect(auditWriter.entries).toEqual([]);
  });

  it('is not found when the category does not exist', async () => {
    await expect(
      build(repo()).execute({ principal, categoryId: toCategoryId(ids.generate()), changes: {} }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it('is not found when the row vanishes between the read and the write', async () => {
    const current = existing();
    const repository = repo({
      findById: vi.fn().mockResolvedValue(current),
      update: vi.fn().mockResolvedValue(false),
    });

    await expect(
      build(repository).execute({ principal, categoryId: current.id, changes: { name: 'x' } }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });
});

describe('ReparentCategoryUseCase', () => {
  const build = (
    repository: CategoryRepository,
    auditWriter: AuditWriter = new RecordingAuditWriter(),
  ): ReparentCategoryUseCase => new ReparentCategoryUseCase(deps(repository, auditWriter));

  it('loads the descendants before moving, and persists the whole rewritten subtree', async () => {
    const root = category();
    const mid = category(root);
    const leaf = category(mid);
    const target = category();
    const repository = repo({
      findById: vi.fn((id: unknown) => Promise.resolve(id === mid.id ? mid : target)),
      findDescendants: vi.fn().mockResolvedValue([leaf]),
    });

    const { rewritten } = await build(repository).execute({
      principal,
      categoryId: mid.id,
      newParentId: target.id,
    });

    expect(repository.findDescendants).toHaveBeenCalledWith(mid.id);
    expect(rewritten).toBe(2);
    expect(vi.mocked(repository.updateMany).mock.calls[0]?.[0]).toHaveLength(2);
  });

  it('moves to the root when no new parent is named', async () => {
    const root = category();
    const child = category(root);
    const repository = repo({ findById: vi.fn().mockResolvedValue(child) });

    const { category: moved } = await build(repository).execute({
      principal,
      categoryId: child.id,
      newParentId: null,
    });

    expect(moved.parentId).toBeNull();
    expect(moved.depth).toBe(1);
  });

  it('is not found when the new parent does not exist', async () => {
    const child = category();
    const repository = repo({
      findById: vi.fn((id: unknown) => Promise.resolve(id === child.id ? child : null)),
    });

    await expect(
      build(repository).execute({
        principal,
        categoryId: child.id,
        newParentId: toCategoryId(ids.generate()),
      }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
    expect(repository.updateMany).not.toHaveBeenCalled();
  });

  it('records the move with both the old and the new placement', async () => {
    const root = category();
    const child = category(root);
    const target = category();
    const auditWriter = new RecordingAuditWriter();
    const repository = repo({
      findById: vi.fn((id: unknown) => Promise.resolve(id === child.id ? child : target)),
    });

    await build(repository, auditWriter).execute({
      principal,
      categoryId: child.id,
      newParentId: target.id,
    });

    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.CATEGORY_REPARENTED);
    expect(auditWriter.entries[0]?.before).toMatchObject({ parentId: root.id });
    expect(auditWriter.entries[0]?.after).toMatchObject({ parentId: target.id });
  });
});

const attributeRepo = (
  overrides: Partial<CategoryAttributeRepository> = {},
): CategoryAttributeRepository => {
  const repository: CategoryAttributeRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
    findById: vi.fn().mockResolvedValue(null),
    listByCategoryId: vi.fn().mockResolvedValue([]),
    softDelete: vi.fn().mockResolvedValue(true),
    softDeleteAllForCategory: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return repository;
};

describe('DeleteCategoryUseCase', () => {
  const build = (
    repository: CategoryRepository,
    auditWriter: AuditWriter = new RecordingAuditWriter(),
    categoryAttributeRepository: CategoryAttributeRepository = attributeRepo(),
  ): DeleteCategoryUseCase =>
    new DeleteCategoryUseCase({ ...deps(repository, auditWriter), categoryAttributeRepository });

  it('soft-deletes an empty category and records it', async () => {
    const current = category();
    const auditWriter = new RecordingAuditWriter();
    const repository = repo({ findById: vi.fn().mockResolvedValue(current) });

    const { category: deleted } = await build(repository, auditWriter).execute({
      principal,
      categoryId: current.id,
    });

    expect(deleted.deletedAt).toEqual(NOW);
    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.CATEGORY_DELETED);
  });

  it('refuses a category that still has children, and audits nothing', async () => {
    const current = category();
    const auditWriter = new RecordingAuditWriter();
    const repository = repo({
      findById: vi.fn().mockResolvedValue(current),
      softDeleteIfEmpty: vi.fn().mockResolvedValue(false),
    });

    await expect(
      build(repository, auditWriter).execute({ principal, categoryId: current.id }),
    ).rejects.toBeInstanceOf(CategoryNotEmptyError);
    expect(auditWriter.entries).toEqual([]);
  });

  it('is not found when the category does not exist', async () => {
    await expect(
      build(repo()).execute({ principal, categoryId: toCategoryId(ids.generate()) }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it('takes the category’s own attribute definitions with it, stamped at the same moment', async () => {
    const current = category();
    const attributes = attributeRepo({ softDeleteAllForCategory: vi.fn().mockResolvedValue(3) });

    await build(
      repo({ findById: vi.fn().mockResolvedValue(current) }),
      undefined,
      attributes,
    ).execute({ principal, categoryId: current.id });

    expect(attributes.softDeleteAllForCategory).toHaveBeenCalledWith(current.id, NOW);
  });

  it('leaves every attribute untouched when the delete is refused', async () => {
    const current = category();
    const attributes = attributeRepo();
    const repository = repo({
      findById: vi.fn().mockResolvedValue(current),
      softDeleteIfEmpty: vi.fn().mockResolvedValue(false),
    });

    await expect(
      build(repository, undefined, attributes).execute({ principal, categoryId: current.id }),
    ).rejects.toBeInstanceOf(CategoryNotEmptyError);

    // The conditional category delete is the arbiter; nothing after it runs.
    expect(attributes.softDeleteAllForCategory).not.toHaveBeenCalled();
  });

  it('records how many attribute definitions went with it', async () => {
    const current = category();
    const auditWriter = new RecordingAuditWriter();
    const attributes = attributeRepo({ softDeleteAllForCategory: vi.fn().mockResolvedValue(2) });

    await build(
      repo({ findById: vi.fn().mockResolvedValue(current) }),
      auditWriter,
      attributes,
    ).execute({ principal, categoryId: current.id });

    expect(auditWriter.entries[0]?.before).toMatchObject({ attributesRemoved: 2 });
  });
});

describe('read use cases', () => {
  it('returns the category it found', async () => {
    const current = category();
    const useCase = new GetCategoryUseCase({
      categoryRepository: repo({ findById: vi.fn().mockResolvedValue(current) }),
    });

    expect(await useCase.execute({ categoryId: current.id })).toBe(current);
  });

  it('is not found for an unknown id', async () => {
    const useCase = new GetCategoryUseCase({ categoryRepository: repo() });

    await expect(
      useCase.execute({ categoryId: toCategoryId(ids.generate()) }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it('passes the cursor and limit straight through to the repository', async () => {
    const repository = repo();
    const useCase = new ListCategoriesUseCase({ categoryRepository: repository });

    await useCase.execute({ limit: 20, cursor: 'abc' });

    expect(repository.listPage).toHaveBeenCalledWith({ limit: 20, cursor: 'abc' });
  });

  it('neither read opens a transaction or writes an audit record', () => {
    // Reads are not admin *actions* (SDD 18.4) — the same line KYC-6 drew for
    // the review queue. A read use case is not even given a writer to call.
    const getDeps = Object.keys(new GetCategoryUseCase({ categoryRepository: repo() }));
    expect(getDeps).not.toContain('auditWriter');
    expect(getDeps).not.toContain('transactionRunner');
  });
});
