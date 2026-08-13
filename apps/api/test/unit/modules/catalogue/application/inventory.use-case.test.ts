import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../../../src/modules/audit/index.js';
import { CATALOGUE_AUDIT_ACTIONS } from '../../../../../src/modules/catalogue/domain/audit-actions.js';
import { GetInventoryUseCase } from '../../../../../src/modules/catalogue/application/use-cases/get-inventory.use-case.js';
import { SetInventoryUseCase } from '../../../../../src/modules/catalogue/application/use-cases/set-inventory.use-case.js';
import {
  InventoryNotFoundError,
  InventoryVersionConflictError,
} from '../../../../../src/modules/catalogue/domain/errors/catalogue-errors.js';
import { Inventory } from '../../../../../src/modules/catalogue/domain/entities/inventory.entity.js';
import type { InventoryRepository } from '../../../../../src/modules/catalogue/domain/repositories/inventory.repository.js';
import { toProductId } from '../../../../../src/modules/catalogue/domain/value-objects/product-id.value-object.js';
import { toProductVariantId } from '../../../../../src/modules/catalogue/domain/value-objects/product-variant-id.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { FailingAuditWriter, RecordingAuditWriter } from '../../identity/application/fakes.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-03-01T00:00:00.000Z');
const clock = new FixedClock(NOW);

const productId = toProductId(ids.generate());
const variantId = toProductVariantId(ids.generate());
const vendorId = toVendorId(ids.generate());
const principal: Principal = {
  userId: toUserId(ids.generate()),
  sessionId: toSessionId(ids.generate()),
  role: 'VENDOR_STAFF',
};

const existing = (): Inventory => Inventory.initial({ variantId, vendorId, now: NOW });

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

const repo = (overrides: Partial<InventoryRepository> = {}): InventoryRepository => {
  const repository: InventoryRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    findByProductAndVariant: vi.fn().mockResolvedValue(null),
    setIfVersionMatches: vi.fn().mockResolvedValue(true),
    deleteForVariants: vi.fn().mockResolvedValue(0),
    deleteForProduct: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
  return repository;
};

describe('GetInventoryUseCase', () => {
  it('returns the counter it found, scoped by both ids', async () => {
    const found = existing();
    const repository = repo({ findByProductAndVariant: vi.fn().mockResolvedValue(found) });

    const result = await new GetInventoryUseCase({ inventoryRepository: repository }).execute({
      productId,
      variantId,
    });

    expect(result).toBe(found);
    expect(repository.findByProductAndVariant).toHaveBeenCalledWith(productId, variantId);
  });

  it('is not found for a variant the tenant-scoped repository cannot see', async () => {
    await expect(
      new GetInventoryUseCase({ inventoryRepository: repo() }).execute({ productId, variantId }),
    ).rejects.toBeInstanceOf(InventoryNotFoundError);
  });

  it('takes no transaction runner and no audit writer', () => {
    const useCase = new GetInventoryUseCase({ inventoryRepository: repo() });

    expect(Object.keys(useCase)).not.toContain('transactionRunner');
    expect(Object.keys(useCase)).not.toContain('auditWriter');
  });
});

describe('SetInventoryUseCase', () => {
  const build = (
    repository: InventoryRepository,
    auditWriter: AuditWriter = new RecordingAuditWriter(),
    onRollback?: () => void,
  ): SetInventoryUseCase =>
    new SetInventoryUseCase({
      inventoryRepository: repository,
      transactionRunner: runner(onRollback),
      auditWriter,
      clock,
      logger: new NullLogger(),
    });

  const input = (
    available = 50,
    expectedVersion = 1,
  ): Parameters<SetInventoryUseCase['execute']>[0] => ({
    principal,
    productId,
    variantId,
    available,
    expectedVersion,
  });

  it('sets the absolute figure and advances the version', async () => {
    const repository = repo({ findByProductAndVariant: vi.fn().mockResolvedValue(existing()) });

    const { inventory } = await build(repository).execute(input(50));

    expect(inventory.available).toBe(50);
    expect(inventory.version).toBe(2);
  });

  it('passes the caller’s expected version to the conditional write, not the new one', async () => {
    const repository = repo({ findByProductAndVariant: vi.fn().mockResolvedValue(existing()) });

    await build(repository).execute(input(50, 1));

    // The `WHERE` must match what the caller read, or the guard is meaningless.
    expect(vi.mocked(repository.setIfVersionMatches).mock.calls[0]?.[1]).toBe(1);
  });

  it('is a conflict when someone else moved first', async () => {
    const repository = repo({
      findByProductAndVariant: vi.fn().mockResolvedValue(existing()),
      setIfVersionMatches: vi.fn().mockResolvedValue(false),
    });

    await expect(build(repository).execute(input(50, 1))).rejects.toBeInstanceOf(
      InventoryVersionConflictError,
    );
  });

  it('is a conflict for a version that was never current', async () => {
    const repository = repo({
      findByProductAndVariant: vi.fn().mockResolvedValue(existing()),
      setIfVersionMatches: vi.fn().mockResolvedValue(false),
    });

    await expect(build(repository).execute(input(50, 99))).rejects.toBeInstanceOf(
      InventoryVersionConflictError,
    );
  });

  it('is not found for a variant the caller cannot see, and writes nothing', async () => {
    const repository = repo();

    await expect(build(repository).execute(input())).rejects.toBeInstanceOf(InventoryNotFoundError);
    expect(repository.setIfVersionMatches).not.toHaveBeenCalled();
  });

  it('records the change against the product, with both figures', async () => {
    const auditWriter = new RecordingAuditWriter();
    const repository = repo({ findByProductAndVariant: vi.fn().mockResolvedValue(existing()) });

    await build(repository, auditWriter).execute(input(50));

    expect(auditWriter.entries).toHaveLength(1);
    expect(auditWriter.entries[0]?.action).toBe(CATALOGUE_AUDIT_ACTIONS.PRODUCT_INVENTORY_UPDATED);
    expect(auditWriter.entries[0]?.entityId).toBe(productId);
    expect(auditWriter.entries[0]?.actorId).toBe(principal.userId);
    expect(auditWriter.entries[0]?.before).toMatchObject({ available: 0 });
    expect(auditWriter.entries[0]?.after).toMatchObject({ available: 50 });
  });

  it('writes no audit entry when the write is refused', async () => {
    const auditWriter = new RecordingAuditWriter();
    const repository = repo({
      findByProductAndVariant: vi.fn().mockResolvedValue(existing()),
      setIfVersionMatches: vi.fn().mockResolvedValue(false),
    });

    await expect(build(repository, auditWriter).execute(input())).rejects.toBeInstanceOf(
      InventoryVersionConflictError,
    );
    expect(auditWriter.entries).toEqual([]);
  });

  it('rolls the stock change back when the audit write fails', async () => {
    const rolledBack = vi.fn();
    const repository = repo({ findByProductAndVariant: vi.fn().mockResolvedValue(existing()) });

    await expect(
      build(repository, new FailingAuditWriter(), rolledBack).execute(input()),
    ).rejects.toThrow(/audit/i);
    expect(rolledBack).toHaveBeenCalledTimes(1);
  });
});
