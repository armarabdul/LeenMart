import { describe, expect, it, vi } from 'vitest';
import { Money, UuidV7Generator } from '@leen-mart/domain-kit';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import { GetVendorEarningsUseCase } from '../../../../../src/modules/ledger/application/use-cases/get-vendor-earnings.use-case.js';
import { VendorNotActiveForEarningsError } from '../../../../../src/modules/ledger/domain/errors/ledger-errors.js';
import type {
  VendorEarningsLine,
  VendorEarningsQueryPort,
  VendorEarningsSummary,
} from '../../../../../src/modules/ledger/application/ports/vendor-earnings-query.port.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-17T00:00:00.000Z');
const inr = (minor: bigint | number): Money => Money.fromMinor(minor, 'INR');

const userId = toUserId(ids.generate());
const vendorId = toVendorId(ids.generate());
const principal: Principal = {
  userId,
  sessionId: toSessionId(ids.generate()),
  role: 'VENDOR_OWNER',
};

const activeVendor = VendorProfile.reconstitute({
  id: vendorId,
  userId,
  status: VendorStatus.ACTIVE,
  plan: 'COMMISSION',
  shopName: 'Test Shop',
  supportsPickup: false,
  shopAddress: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const vendorRepo = (overrides: Partial<VendorRepository> = {}): VendorRepository => {
  const repository: VendorRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn().mockResolvedValue(activeVendor),
    findByUserId: vi.fn().mockResolvedValue(activeVendor),
    ...overrides,
  };
  return repository;
};

const zeroSummary: VendorEarningsSummary = {
  vendorId,
  grossAccrued: inr(0),
  commission: inr(0),
  netAccrued: inr(0),
};

const buildLine = (overrides: Partial<VendorEarningsLine> = {}): VendorEarningsLine => ({
  subOrderId: ids.generate(),
  orderId: ids.generate(),
  paymentAttemptId: ids.generate(),
  vendorId,
  occurredAt: NOW,
  grossAmount: inr(29_800),
  commissionAmount: inr(2_980),
  netAmount: inr(26_820),
  ...overrides,
});

const queryPort = (overrides: Partial<VendorEarningsQueryPort> = {}): VendorEarningsQueryPort => ({
  getSummary: vi.fn().mockResolvedValue(zeroSummary),
  listLines: vi.fn().mockResolvedValue({ items: [], nextCursor: null, hasMore: false }),
  ...overrides,
});

describe('GetVendorEarningsUseCase', () => {
  it('rejects with VendorNotActiveForEarningsError when the caller has no vendor profile', async () => {
    const useCase = new GetVendorEarningsUseCase({
      vendorRepository: vendorRepo({ findByUserId: vi.fn().mockResolvedValue(null) }),
      vendorEarningsQuery: queryPort(),
    });

    await expect(useCase.execute({ principal, limit: 20 })).rejects.toThrow(
      VendorNotActiveForEarningsError,
    );
  });

  it('rejects with VendorNotActiveForEarningsError when the vendor is not ACTIVE', async () => {
    const suspended = VendorProfile.reconstitute({
      id: vendorId,
      userId,
      status: VendorStatus.SUSPENDED,
      plan: 'COMMISSION',
      shopName: 'Test Shop',
      supportsPickup: false,
      shopAddress: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
    const useCase = new GetVendorEarningsUseCase({
      vendorRepository: vendorRepo({ findByUserId: vi.fn().mockResolvedValue(suspended) }),
      vendorEarningsQuery: queryPort(),
    });

    await expect(useCase.execute({ principal, limit: 20 })).rejects.toThrow(
      VendorNotActiveForEarningsError,
    );
  });

  it('queries the summary and lines for the resolved vendor id, not a client-supplied one', async () => {
    const query = queryPort();
    const useCase = new GetVendorEarningsUseCase({
      vendorRepository: vendorRepo(),
      vendorEarningsQuery: query,
    });

    await useCase.execute({ principal, limit: 20, cursor: 'some-cursor' });

    expect(query.getSummary).toHaveBeenCalledWith(vendorId);
    expect(query.listLines).toHaveBeenCalledWith({ vendorId, limit: 20, cursor: 'some-cursor' });
  });

  it('returns gross/commission/net exactly as reported by the query port — no recomputation', async () => {
    const summary: VendorEarningsSummary = {
      vendorId,
      grossAccrued: inr(59_600),
      commission: inr(5_960),
      netAccrued: inr(53_640),
    };
    const useCase = new GetVendorEarningsUseCase({
      vendorRepository: vendorRepo(),
      vendorEarningsQuery: queryPort({ getSummary: vi.fn().mockResolvedValue(summary) }),
    });

    const result = await useCase.execute({ principal, limit: 20 });

    expect(result.summary).toBe(summary);
    expect(result.summary.netAccrued.equals(inr(53_640))).toBe(true);
  });

  it('carries a zero-commission line through untouched', async () => {
    const zeroCommissionLine = buildLine({ commissionAmount: inr(0), netAmount: inr(29_800) });
    const useCase = new GetVendorEarningsUseCase({
      vendorRepository: vendorRepo(),
      vendorEarningsQuery: queryPort({
        listLines: vi
          .fn()
          .mockResolvedValue({ items: [zeroCommissionLine], nextCursor: null, hasMore: false }),
      }),
    });

    const result = await useCase.execute({ principal, limit: 20 });

    expect(result.lines.items).toEqual([zeroCommissionLine]);
    expect(result.lines.items[0]?.commissionAmount.isZero()).toBe(true);
  });

  it('carries multiple sub-order lines and pagination metadata through untouched', async () => {
    const lines = [buildLine(), buildLine(), buildLine()];
    const useCase = new GetVendorEarningsUseCase({
      vendorRepository: vendorRepo(),
      vendorEarningsQuery: queryPort({
        listLines: vi
          .fn()
          .mockResolvedValue({ items: lines, nextCursor: 'next-page-cursor', hasMore: true }),
      }),
    });

    const result = await useCase.execute({ principal, limit: 2 });

    expect(result.lines.items).toHaveLength(3);
    expect(result.lines.nextCursor).toBe('next-page-cursor');
    expect(result.lines.hasMore).toBe(true);
  });

  it('returns an empty statement — zero summary, no lines — for a vendor with no ledger activity', async () => {
    const useCase = new GetVendorEarningsUseCase({
      vendorRepository: vendorRepo(),
      vendorEarningsQuery: queryPort(),
    });

    const result = await useCase.execute({ principal, limit: 20 });

    expect(result.summary.grossAccrued.isZero()).toBe(true);
    expect(result.summary.commission.isZero()).toBe(true);
    expect(result.summary.netAccrued.isZero()).toBe(true);
    expect(result.lines.items).toEqual([]);
  });

  it('preserves the currency reported by the query port (single-currency repository convention)', async () => {
    const summary: VendorEarningsSummary = {
      vendorId,
      grossAccrued: inr(10_000),
      commission: inr(1_000),
      netAccrued: inr(9_000),
    };
    const useCase = new GetVendorEarningsUseCase({
      vendorRepository: vendorRepo(),
      vendorEarningsQuery: queryPort({ getSummary: vi.fn().mockResolvedValue(summary) }),
    });

    const result = await useCase.execute({ principal, limit: 20 });

    expect(result.summary.grossAccrued.currency).toBe('INR');
    expect(result.summary.commission.currency).toBe('INR');
    expect(result.summary.netAccrued.currency).toBe('INR');
  });
});
