import { describe, expect, it, vi } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId, type VendorId } from '../../../../../src/modules/identity/index.js';
import type { SlotAvailabilityRepository } from '../../../../../src/modules/vendor/domain/repositories/delivery-slot.repository.js';
import type { DeliverySlotTemplate } from '../../../../../src/modules/vendor/domain/services/delivery-slot-policy.js';
import {
  OrderSlotNotOfferedError,
  OrderSlotRequiredError,
} from '../../../../../src/modules/order/domain/errors/order-errors.js';
import { ResolveSlotSelectionUseCase } from '../../../../../src/modules/order/application/use-cases/resolve-slot-selection.use-case.js';

const ids = new UuidV7Generator();
const vendorA = toVendorId(ids.generate());
const vendorB = toVendorId(ids.generate());

/** Monday 17 August 2026, 17:30 IST. */
const clock = new FixedClock(new Date('2026-08-17T12:00:00.000Z'));
const TUESDAY = 2;

const template = (overrides: Partial<DeliverySlotTemplate> = {}): DeliverySlotTemplate => ({
  weekday: TUESDAY,
  startMinute: 9 * 60,
  endMinute: 11 * 60,
  capacity: 5,
  ...overrides,
});

const repository = (
  templates: ReadonlyMap<VendorId, readonly DeliverySlotTemplate[]>,
): SlotAvailabilityRepository => {
  const repo = {
    withTransaction: () => repo,
    findTemplatesForVendors: vi.fn().mockResolvedValue(templates),
    findBookingsForVendors: vi.fn().mockResolvedValue(new Map()),
    consume: vi.fn().mockResolvedValue(true),
    release: vi.fn().mockResolvedValue(undefined),
  };
  return repo as unknown as SlotAvailabilityRepository;
};

const useCase = (
  templates: ReadonlyMap<VendorId, readonly DeliverySlotTemplate[]>,
): ResolveSlotSelectionUseCase =>
  new ResolveSlotSelectionUseCase({
    slotAvailabilityRepository: repository(templates),
    clock,
  });

const TUESDAY_9AM = { date: '2026-08-18', startMinute: 9 * 60 };

describe('ResolveSlotSelectionUseCase (S4-SLOTS)', () => {
  it('resolves nothing for an empty cart, asking the database nothing', async () => {
    const repo = repository(new Map());
    const result = await new ResolveSlotSelectionUseCase({
      slotAvailabilityRepository: repo,
      clock,
    }).execute({ vendorIds: [], selections: new Map() });

    expect(result.size).toBe(0);
    expect(repo.findTemplatesForVendors).not.toHaveBeenCalled();
  });

  it('requires no slot from a vendor who offers none (the D7/H4-A default)', async () => {
    const result = await useCase(new Map([[vendorA, []]])).execute({
      vendorIds: [vendorA],
      selections: new Map(),
    });

    expect(result.size).toBe(0);
  });

  it('refuses a placement that names no slot for a vendor who offers them', async () => {
    await expect(
      useCase(new Map([[vendorA, [template()]]])).execute({
        vendorIds: [vendorA],
        selections: new Map(),
      }),
    ).rejects.toThrow(OrderSlotRequiredError);
  });

  it('resolves a valid selection to the vendor’s own window', async () => {
    const result = await useCase(new Map([[vendorA, [template()]]])).execute({
      vendorIds: [vendorA],
      selections: new Map([[vendorA, TUESDAY_9AM]]),
    });

    expect(result.get(vendorA)).toEqual({
      date: '2026-08-18',
      startMinute: 9 * 60,
      endMinute: 11 * 60,
      capacity: 5,
    });
  });

  it('reads the end minute and capacity from the template, never the request', async () => {
    // The security property. A client that sends only `{date, startMinute}`
    // cannot widen the window or inflate the capacity it will consume.
    const result = await useCase(
      new Map([[vendorA, [template({ endMinute: 10 * 60, capacity: 1 })]]]),
    ).execute({ vendorIds: [vendorA], selections: new Map([[vendorA, TUESDAY_9AM]]) });

    expect(result.get(vendorA)).toMatchObject({ endMinute: 10 * 60, capacity: 1 });
  });

  it('refuses a window the vendor does not offer', async () => {
    await expect(
      useCase(new Map([[vendorA, [template()]]])).execute({
        vendorIds: [vendorA],
        selections: new Map([[vendorA, { date: '2026-08-18', startMinute: 15 * 60 }]]),
      }),
    ).rejects.toThrow(OrderSlotNotOfferedError);
  });

  it('refuses a slot named for a vendor who offers none, rather than ignoring it', async () => {
    // Silently dropping it would tell the customer their choice was honoured
    // when nothing recorded it.
    await expect(
      useCase(new Map([[vendorA, []]])).execute({
        vendorIds: [vendorA],
        selections: new Map([[vendorA, TUESDAY_9AM]]),
      }),
    ).rejects.toThrow(OrderSlotNotOfferedError);
  });

  it('refuses a slot for one vendor named against another’s window', async () => {
    // Vendor B offers Tuesday 16:00, not Tuesday 09:00.
    const templates = new Map([
      [vendorA, [template()]],
      [vendorB, [template({ startMinute: 16 * 60, endMinute: 18 * 60 })]],
    ]);

    await expect(
      useCase(templates).execute({
        vendorIds: [vendorA, vendorB],
        selections: new Map([
          [vendorA, TUESDAY_9AM],
          [vendorB, TUESDAY_9AM],
        ]),
      }),
    ).rejects.toThrow(OrderSlotNotOfferedError);
  });

  it('resolves each vendor in a multi-vendor cart independently', async () => {
    const templates = new Map([
      [vendorA, [template()]],
      [vendorB, [template({ startMinute: 16 * 60, endMinute: 18 * 60, capacity: 2 })]],
    ]);

    const result = await useCase(templates).execute({
      vendorIds: [vendorA, vendorB],
      selections: new Map([
        [vendorA, TUESDAY_9AM],
        [vendorB, { date: '2026-08-18', startMinute: 16 * 60 }],
      ]),
    });

    expect(result.get(vendorA)).toMatchObject({ endMinute: 11 * 60, capacity: 5 });
    expect(result.get(vendorB)).toMatchObject({ endMinute: 18 * 60, capacity: 2 });
  });

  it('requires a slot from a slot-offering vendor even when a sibling offers none', async () => {
    const templates = new Map([
      [vendorA, [template()]],
      [vendorB, []],
    ]);

    await expect(
      useCase(templates).execute({ vendorIds: [vendorA, vendorB], selections: new Map() }),
    ).rejects.toThrow(OrderSlotRequiredError);
  });

  it('never consults capacity — that is the atomic update’s job', async () => {
    // Availability at validation time proves nothing about availability a
    // millisecond later, so this use case must not read bookings at all.
    const repo = repository(new Map([[vendorA, [template()]]]));

    await new ResolveSlotSelectionUseCase({ slotAvailabilityRepository: repo, clock }).execute({
      vendorIds: [vendorA],
      selections: new Map([[vendorA, TUESDAY_9AM]]),
    });

    expect(repo.findBookingsForVendors).not.toHaveBeenCalled();
    expect(repo.consume).not.toHaveBeenCalled();
  });

  it('refuses a window that has already ended today rather than rolling it forward', async () => {
    await expect(
      useCase(new Map([[vendorA, [template({ weekday: 1, startMinute: 9 * 60 })]]])).execute({
        vendorIds: [vendorA],
        selections: new Map([[vendorA, { date: '2026-08-17', startMinute: 9 * 60 }]]),
      }),
    ).rejects.toThrow(OrderSlotNotOfferedError);
  });
});
