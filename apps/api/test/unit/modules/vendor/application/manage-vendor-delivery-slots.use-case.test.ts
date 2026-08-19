import { describe, expect, it, vi } from 'vitest';
import { FixedClock, NullLogger, UuidV7Generator } from '@leen-mart/domain-kit';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import { VendorProfileNotFoundError } from '../../../../../src/modules/vendor/domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../../../../src/modules/vendor/domain/repositories/vendor.repository.js';
import type { DeliverySlotRepository } from '../../../../../src/modules/vendor/domain/repositories/delivery-slot.repository.js';
import type { DeliverySlotTemplate } from '../../../../../src/modules/vendor/domain/services/delivery-slot-policy.js';
import {
  GetVendorDeliverySlotsUseCase,
  SetVendorDeliverySlotsUseCase,
} from '../../../../../src/modules/vendor/application/use-cases/manage-vendor-delivery-slots.use-case.js';

const ids = new UuidV7Generator();
const NOW = new Date('2026-08-17T12:00:00.000Z');
const clock = new FixedClock(NOW);
const userId = toUserId(ids.generate());
const vendorId = toVendorId(ids.generate());
const principal: Principal = {
  userId,
  sessionId: toSessionId(ids.generate()),
  role: 'VENDOR_OWNER',
};

const vendor = VendorProfile.reconstitute({
  id: vendorId,
  userId,
  status: VendorStatus.ACTIVE,
  plan: 'COMMISSION',
  shopName: 'FreshMart',
  supportsPickup: true,
  shopAddress: null,
  createdAt: NOW,
  updatedAt: NOW,
});

const vendorRepo = (overrides: Partial<VendorRepository> = {}): VendorRepository => {
  const repository: VendorRepository = {
    withTransaction: () => repository,
    create: vi.fn(),
    update: vi.fn(),
    findById: vi.fn().mockResolvedValue(vendor),
    findByUserId: vi.fn().mockResolvedValue(vendor),
    ...overrides,
  };
  return repository;
};

const slotRepo = (
  stored: readonly DeliverySlotTemplate[] = [],
  bookings: readonly { date: string; startMinute: number; booked: number }[] = [],
): DeliverySlotRepository & { replaceForVendor: ReturnType<typeof vi.fn> } => {
  const replaceForVendor = vi.fn();
  const repository = {
    withTransaction: () => repository,
    findByVendor: vi.fn().mockResolvedValue(stored),
    findBookingsByVendor: vi.fn().mockResolvedValue(bookings),
    replaceForVendor,
  };
  return repository as unknown as DeliverySlotRepository & {
    replaceForVendor: ReturnType<typeof vi.fn>;
  };
};

const runner = (): TransactionRunner => ({ run: async (work) => work({} as TransactionScope) });

const deps = (
  vendorRepository: VendorRepository,
  deliverySlotRepository: DeliverySlotRepository,
): {
  vendorRepository: VendorRepository;
  deliverySlotRepository: DeliverySlotRepository;
  transactionRunner: TransactionRunner;
  clock: FixedClock;
  logger: NullLogger;
} => ({
  vendorRepository,
  deliverySlotRepository,
  transactionRunner: runner(),
  clock,
  logger: new NullLogger(),
});

const slot = (overrides: Partial<DeliverySlotTemplate> = {}): DeliverySlotTemplate => ({
  weekday: 2,
  startMinute: 9 * 60,
  endMinute: 11 * 60,
  capacity: 5,
  ...overrides,
});

describe('GetVendorDeliverySlotsUseCase (S4-SLOTS)', () => {
  it('reports a vendor with no windows as unconfigured', async () => {
    const useCase = new GetVendorDeliverySlotsUseCase(deps(vendorRepo(), slotRepo([])));

    const result = await useCase.execute({ principal });

    // What tells the portal to say "customers order without choosing a slot"
    // rather than showing a blank list that reads as "never available".
    expect(result).toMatchObject({ vendorId, configured: false, slots: [] });
  });

  it('returns the stored offer for a configured vendor', async () => {
    const useCase = new GetVendorDeliverySlotsUseCase(deps(vendorRepo(), slotRepo([slot()])));

    const result = await useCase.execute({ principal });

    expect(result.configured).toBe(true);
    expect(result.slots).toEqual([slot()]);
  });

  it('returns how full the coming days already are', async () => {
    const bookings = [{ date: '2026-08-18', startMinute: 540, booked: 2 }];
    const useCase = new GetVendorDeliverySlotsUseCase(
      deps(vendorRepo(), slotRepo([slot()], bookings)),
    );

    const result = await useCase.execute({ principal });

    expect(result.bookings).toEqual(bookings);
  });

  it('resolves the vendor from the principal, never from the request', async () => {
    const vendorRepository = vendorRepo();

    await new GetVendorDeliverySlotsUseCase(deps(vendorRepository, slotRepo())).execute({
      principal,
    });

    expect(vendorRepository.findByUserId).toHaveBeenCalledWith(userId);
    expect(vendorRepository.findById).not.toHaveBeenCalled();
  });

  it('refuses a caller with no vendor profile', async () => {
    const vendorRepository = vendorRepo({ findByUserId: vi.fn().mockResolvedValue(null) });

    await expect(
      new GetVendorDeliverySlotsUseCase(deps(vendorRepository, slotRepo())).execute({ principal }),
    ).rejects.toThrow(VendorProfileNotFoundError);
  });
});

describe('SetVendorDeliverySlotsUseCase (S4-SLOTS)', () => {
  it('replaces the offer, sorted so it reads the same way twice', async () => {
    const repository = slotRepo();
    const later = slot({ weekday: 3, startMinute: 16 * 60, endMinute: 18 * 60 });
    const earlier = slot({ weekday: 1, startMinute: 7 * 60, endMinute: 9 * 60 });

    const result = await new SetVendorDeliverySlotsUseCase(deps(vendorRepo(), repository)).execute({
      principal,
      slots: [later, earlier],
    });

    expect(repository.replaceForVendor).toHaveBeenCalledWith(vendorId, [earlier, later]);
    expect(result.slots).toEqual([earlier, later]);
    expect(result.configured).toBe(true);
  });

  it('sorts several windows within one weekday by start time', async () => {
    const repository = slotRepo();
    const evening = slot({ startMinute: 17 * 60, endMinute: 19 * 60 });
    const morning = slot({ startMinute: 7 * 60, endMinute: 9 * 60 });

    await new SetVendorDeliverySlotsUseCase(deps(vendorRepo(), repository)).execute({
      principal,
      slots: [evening, morning],
    });

    expect(repository.replaceForVendor).toHaveBeenCalledWith(vendorId, [morning, evening]);
  });

  it('accepts an empty offer, returning the vendor to taking orders without a slot', async () => {
    const repository = slotRepo([slot()]);

    const result = await new SetVendorDeliverySlotsUseCase(deps(vendorRepo(), repository)).execute({
      principal,
      slots: [],
    });

    expect(repository.replaceForVendor).toHaveBeenCalledWith(vendorId, []);
    expect(result).toMatchObject({ configured: false, slots: [] });
  });

  it('touches only the offer, never the capacity counter', async () => {
    // Bookings already taken carry their own snapshotted capacity, so editing
    // the offer must not rewrite them.
    const repository = slotRepo();

    await new SetVendorDeliverySlotsUseCase(deps(vendorRepo(), repository)).execute({
      principal,
      slots: [slot()],
    });

    expect(repository.replaceForVendor).toHaveBeenCalledTimes(1);
  });

  it('refuses a caller with no vendor profile, writing nothing', async () => {
    const vendorRepository = vendorRepo({ findByUserId: vi.fn().mockResolvedValue(null) });
    const repository = slotRepo();

    await expect(
      new SetVendorDeliverySlotsUseCase(deps(vendorRepository, repository)).execute({
        principal,
        slots: [slot()],
      }),
    ).rejects.toThrow(VendorProfileNotFoundError);
    expect(repository.replaceForVendor).not.toHaveBeenCalled();
  });
});
