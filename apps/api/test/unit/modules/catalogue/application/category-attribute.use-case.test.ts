import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../../../src/modules/audit/index.js';
import { CATALOGUE_AUDIT_ACTIONS } from '../../../../../src/modules/catalogue/domain/audit-actions.js';
import { AddCategoryAttributeUseCase } from '../../../../../src/modules/catalogue/application/use-cases/add-category-attribute.use-case.js';
import { UpdateCategoryAttributeUseCase } from '../../../../../src/modules/catalogue/application/use-cases/update-category-attribute.use-case.js';
import { RemoveCategoryAttributeUseCase } from '../../../../../src/modules/catalogue/application/use-cases/remove-category-attribute.use-case.js';
import { GetCategoryAttributeUseCase } from '../../../../../src/modules/catalogue/application/use-cases/get-category-attribute.use-case.js';
import { ListCategoryAttributesUseCase } from '../../../../../src/modules/catalogue/application/use-cases/list-category-attributes.use-case.js';
import {
  CategoryAttributeNotFoundError,
  CategoryNotFoundError,
} from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { Category } from '../../../../../src/modules/catalogue/domain/entities/category.entity.js';
import { CategoryAttribute } from '../../../../../src/modules/catalogue/domain/entities/category-attribute.entity.js';
import type { CategoryAttributeRepository } from '../../../../../src/modules/catalogue/domain/repositories/category-attribute.repository.js';
import type { CategoryRepository } from '../../../../../src/modules/catalogue/domain/repositories/category.repository.js';
import { toCategoryAttributeId } from '../../../../../src/modules/catalogue/domain/value-objects/category-attribute-id.value-object.js';
import { CategoryAttributeType } from '../../../../../src/modules/catalogue/domain/value-objects/category-attribute-type.value-object.js';
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

let counter = 0;
const category = (): Category =>
  Category.create({
    id: toCategoryId(ids.generate()),
    parent: null,
    name: `Category ${(counter += 1)}`,
    slug: toCategorySlug(`category-${counter}`),
    riskLevel: CategoryRiskLevel.LOW,
    requirements: {
      requiresHsn: false,
      requiresCountryOfOrigin: false,
      requiresNetQuantity: false,
    },
    now: NOW,
  });

const attribute = (
  categoryId = toCategoryId(ids.generate()),
  dataType = CategoryAttributeType.STRING,
): CategoryAttribute =>
  CategoryAttribute.create({
    id: toCategoryAttributeId(ids.generate()),
    categoryId,
    key: 'net_weight',
    label: 'Net weight',
    dataType,
    isRequired: false,
    unit: null,
    options: dataType.allowsOptions() ? ['a'] : [],
    position: 0,
    now: NOW,
  });

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

const categoryRepo = (found: Category | null): CategoryRepository => {
  const repository: CategoryRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn().mockResolvedValue(true),
    updateMany: vi.fn(),
    findById: vi.fn().mockResolvedValue(found),
    findBySlug: vi.fn().mockResolvedValue(null),
    findDescendants: vi.fn().mockResolvedValue([]),
    listPage: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
    softDeleteIfEmpty: vi.fn().mockResolvedValue(true),
  };
  return repository;
};

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

const shared = (
  attributes: CategoryAttributeRepository,
  auditWriter: AuditWriter = new RecordingAuditWriter(),
  onRollback?: () => void,
): {
  categoryAttributeRepository: CategoryAttributeRepository;
  transactionRunner: TransactionRunner;
  auditWriter: AuditWriter;
  clock: FixedClock;
  logger: NullLogger;
} => ({
  categoryAttributeRepository: attributes,
  transactionRunner: runner(onRollback),
  auditWriter,
  clock,
  logger: new NullLogger(),
});

const addInput = (
  categoryId: ReturnType<typeof toCategoryId>,
): Parameters<AddCategoryAttributeUseCase['execute']>[0] => ({
  principal,
  categoryId,
  key: 'net_weight',
  label: 'Net weight',
  dataType: 'NUMBER',
  isRequired: true,
  unit: 'kg',
  options: [],
  position: 2,
});

describe('AddCategoryAttributeUseCase', () => {
  const build = (
    parent: Category | null,
    attributes = attributeRepo(),
    auditWriter: AuditWriter = new RecordingAuditWriter(),
    onRollback?: () => void,
  ): AddCategoryAttributeUseCase =>
    new AddCategoryAttributeUseCase({
      ...shared(attributes, auditWriter, onRollback),
      categoryRepository: categoryRepo(parent),
      idGenerator: ids,
    });

  it('defines the attribute against the category it loaded', async () => {
    const parent = category();

    const { attribute: created } = await build(parent).execute(addInput(parent.id));

    expect(created.categoryId).toBe(parent.id);
    expect(created.key).toBe('net_weight');
    expect(created.dataType.name).toBe('NUMBER');
    expect(created.unit).toBe('kg');
    expect(created.position).toBe(2);
  });

  it('reports an unknown category as not found and persists nothing', async () => {
    const attributes = attributeRepo();

    await expect(
      build(null, attributes).execute(addInput(toCategoryId(ids.generate()))),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
    expect(attributes.create).not.toHaveBeenCalled();
  });

  it('allows configuring a category that is merely inactive', async () => {
    const inactive = category().setActive(false, NOW);

    // Deactivating a category so it can be configured before going live is the
    // ordinary workflow; only a *deleted* category is off limits.
    await expect(build(inactive).execute(addInput(inactive.id))).resolves.toBeDefined();
  });

  it('records exactly one audit entry naming the action, actor and key', async () => {
    const parent = category();
    const auditWriter = new RecordingAuditWriter();

    await build(parent, attributeRepo(), auditWriter).execute(addInput(parent.id));

    expect(auditWriter.entries).toHaveLength(1);
    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.CATEGORY_ATTRIBUTE_ADDED);
    expect(auditWriter.entries[0]?.actorId).toBe(admin);
    expect(auditWriter.entries[0]?.entityId).toBe(parent.id);
    expect(auditWriter.entries[0]?.after).toMatchObject({ key: 'net_weight' });
  });

  it('rolls everything back when the audit write fails', async () => {
    const parent = category();
    const rolledBack = vi.fn();

    await expect(
      build(parent, attributeRepo(), new FailingAuditWriter(), rolledBack).execute(
        addInput(parent.id),
      ),
    ).rejects.toThrow(/audit/i);
    expect(rolledBack).toHaveBeenCalledTimes(1);
  });
});

describe('UpdateCategoryAttributeUseCase', () => {
  const build = (
    attributes: CategoryAttributeRepository,
    auditWriter: AuditWriter = new RecordingAuditWriter(),
  ): UpdateCategoryAttributeUseCase =>
    new UpdateCategoryAttributeUseCase(shared(attributes, auditWriter));

  it('applies only the supplied fields', async () => {
    const existing = attribute();
    const attributes = attributeRepo({ findById: vi.fn().mockResolvedValue(existing) });

    const { attribute: updated } = await build(attributes).execute({
      principal,
      categoryId: existing.categoryId,
      attributeId: existing.id,
      changes: { label: 'Renamed' },
    });

    expect(updated.label).toBe('Renamed');
    expect(updated.isRequired).toBe(existing.isRequired);
    expect(updated.position).toBe(existing.position);
    expect(updated.key).toBe(existing.key);
  });

  it('is not found for an unknown attribute', async () => {
    await expect(
      build(attributeRepo()).execute({
        principal,
        categoryId: toCategoryId(ids.generate()),
        attributeId: toCategoryAttributeId(ids.generate()),
        changes: {},
      }),
    ).rejects.toBeInstanceOf(CategoryAttributeNotFoundError);
  });

  it('is not found when the row vanishes between the read and the write', async () => {
    const existing = attribute();
    const attributes = attributeRepo({
      findById: vi.fn().mockResolvedValue(existing),
      update: vi.fn().mockResolvedValue(false),
    });

    await expect(
      build(attributes).execute({
        principal,
        categoryId: existing.categoryId,
        attributeId: existing.id,
        changes: { label: 'x' },
      }),
    ).rejects.toBeInstanceOf(CategoryAttributeNotFoundError);
  });

  it('writes no audit entry when the request changes nothing', async () => {
    const existing = attribute();
    const auditWriter = new RecordingAuditWriter();

    await build(
      attributeRepo({ findById: vi.fn().mockResolvedValue(existing) }),
      auditWriter,
    ).execute({
      principal,
      categoryId: existing.categoryId,
      attributeId: existing.id,
      changes: {},
    });

    expect(auditWriter.entries).toEqual([]);
  });

  it('records the update against the category, carrying the attribute key', async () => {
    const existing = attribute();
    const auditWriter = new RecordingAuditWriter();

    await build(
      attributeRepo({ findById: vi.fn().mockResolvedValue(existing) }),
      auditWriter,
    ).execute({
      principal,
      categoryId: existing.categoryId,
      attributeId: existing.id,
      changes: { isRequired: true },
    });

    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.CATEGORY_ATTRIBUTE_UPDATED);
    expect(auditWriter.entries[0]?.entityId).toBe(existing.categoryId);
    expect(auditWriter.entries[0]?.before).toMatchObject({ isRequired: false });
    expect(auditWriter.entries[0]?.after).toMatchObject({ isRequired: true });
  });
});

describe('RemoveCategoryAttributeUseCase', () => {
  const build = (
    attributes: CategoryAttributeRepository,
    auditWriter: AuditWriter = new RecordingAuditWriter(),
  ): RemoveCategoryAttributeUseCase =>
    new RemoveCategoryAttributeUseCase(shared(attributes, auditWriter));

  it('soft-deletes and records it', async () => {
    const existing = attribute();
    const auditWriter = new RecordingAuditWriter();

    const { attribute: deleted } = await build(
      attributeRepo({ findById: vi.fn().mockResolvedValue(existing) }),
      auditWriter,
    ).execute({ principal, categoryId: existing.categoryId, attributeId: existing.id });

    expect(deleted.deletedAt).toEqual(NOW);
    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.CATEGORY_ATTRIBUTE_REMOVED);
  });

  it('is not found for an unknown attribute, and audits nothing', async () => {
    const auditWriter = new RecordingAuditWriter();

    await expect(
      build(attributeRepo(), auditWriter).execute({
        principal,
        categoryId: toCategoryId(ids.generate()),
        attributeId: toCategoryAttributeId(ids.generate()),
      }),
    ).rejects.toBeInstanceOf(CategoryAttributeNotFoundError);
    expect(auditWriter.entries).toEqual([]);
  });
});

describe('read use cases', () => {
  it('returns the attribute it found, scoped by both ids', async () => {
    const existing = attribute();
    const attributes = attributeRepo({ findById: vi.fn().mockResolvedValue(existing) });
    const useCase = new GetCategoryAttributeUseCase({ categoryAttributeRepository: attributes });

    expect(
      await useCase.execute({ categoryId: existing.categoryId, attributeId: existing.id }),
    ).toBe(existing);
    expect(attributes.findById).toHaveBeenCalledWith(existing.categoryId, existing.id);
  });

  it('is not found when the attribute belongs to another category', async () => {
    const useCase = new GetCategoryAttributeUseCase({
      categoryAttributeRepository: attributeRepo(),
    });

    await expect(
      useCase.execute({
        categoryId: toCategoryId(ids.generate()),
        attributeId: toCategoryAttributeId(ids.generate()),
      }),
    ).rejects.toBeInstanceOf(CategoryAttributeNotFoundError);
  });

  it('lists a category’s attributes', async () => {
    const parent = category();
    const listed = [attribute(parent.id)];
    const attributes = attributeRepo({ listByCategoryId: vi.fn().mockResolvedValue(listed) });

    const useCase = new ListCategoryAttributesUseCase({
      categoryRepository: categoryRepo(parent),
      categoryAttributeRepository: attributes,
    });

    expect(await useCase.execute({ categoryId: parent.id })).toBe(listed);
  });

  it('answers 404 for an unknown category rather than an empty array', async () => {
    // An empty array would be indistinguishable from a category that simply
    // has no attributes yet.
    const useCase = new ListCategoryAttributesUseCase({
      categoryRepository: categoryRepo(null),
      categoryAttributeRepository: attributeRepo(),
    });

    await expect(
      useCase.execute({ categoryId: toCategoryId(ids.generate()) }),
    ).rejects.toBeInstanceOf(CategoryNotFoundError);
  });

  it('neither read is given a transaction runner or an audit writer', () => {
    const get = new GetCategoryAttributeUseCase({ categoryAttributeRepository: attributeRepo() });
    const list = new ListCategoryAttributesUseCase({
      categoryRepository: categoryRepo(null),
      categoryAttributeRepository: attributeRepo(),
    });

    for (const useCase of [get, list]) {
      expect(Object.keys(useCase)).not.toContain('auditWriter');
      expect(Object.keys(useCase)).not.toContain('transactionRunner');
    }
  });
});
