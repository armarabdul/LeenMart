import { describe, expect, it, vi } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import { ResolveBusinessHoursUseCase } from '../../../../../src/modules/order/application/use-cases/resolve-business-hours.use-case.js';
import type { BusinessHoursLookupRepository } from '../../../../../src/modules/vendor/domain/repositories/business-hours.repository.js';
import type { VendorBusinessHours } from '../../../../../src/modules/vendor/domain/services/business-hours-policy.js';

const ids = new UuidV7Generator();
const vendorA = toVendorId(ids.generate());
const vendorB = toVendorId(ids.generate());

/** 2026-08-19T04:30:00Z === Wednesday 10:00 IST. */
const WED_1000_IST = new Date('2026-08-19T04:30:00.000Z');
const OPEN_WEDNESDAY: VendorBusinessHours = {
  intervals: [{ weekday: 3, openMinute: 9 * 60, closeMinute: 18 * 60 }],
  closures: [],
};

const lookup = (
  entries: readonly (readonly [typeof vendorA, VendorBusinessHours])[],
): BusinessHoursLookupRepository => ({
  findForVendors: vi.fn().mockResolvedValue(new Map(entries)),
});

const buildUseCase = (
  repository: BusinessHoursLookupRepository,
  now = WED_1000_IST,
): ResolveBusinessHoursUseCase =>
  new ResolveBusinessHoursUseCase({
    businessHoursLookupRepository: repository,
    clock: new FixedClock(now),
  });

describe('ResolveBusinessHoursUseCase (S4-HOURS)', () => {
  it('reports an unconfigured vendor as open (H4-A)', async () => {
    const repository = lookup([[vendorA, { intervals: [], closures: [] }]]);

    await expect(
      buildUseCase(repository).execute({ deliveryVendorIds: [vendorA] }),
    ).resolves.toEqual([]);
  });

  it('reports an open vendor as open', async () => {
    const repository = lookup([[vendorA, OPEN_WEDNESDAY]]);

    await expect(
      buildUseCase(repository).execute({ deliveryVendorIds: [vendorA] }),
    ).resolves.toEqual([]);
  });

  it('reports a vendor outside its hours as closed', async () => {
    const repository = lookup([[vendorA, OPEN_WEDNESDAY]]);
    // 01:00 UTC === 06:30 IST, before the 09:00 opening.
    const useCase = buildUseCase(repository, new Date('2026-08-19T01:00:00.000Z'));

    await expect(useCase.execute({ deliveryVendorIds: [vendorA] })).resolves.toEqual([vendorA]);
  });

  it('reports a vendor on a recurring holiday as closed', async () => {
    const repository = lookup([
      [vendorA, { ...OPEN_WEDNESDAY, closures: [{ weekday: 3, closedOn: null }] }],
    ]);

    await expect(
      buildUseCase(repository).execute({ deliveryVendorIds: [vendorA] }),
    ).resolves.toEqual([vendorA]);
  });

  it('reports a vendor on a dated closure as closed', async () => {
    const repository = lookup([
      [vendorA, { ...OPEN_WEDNESDAY, closures: [{ weekday: null, closedOn: '2026-08-19' }] }],
    ]);

    await expect(
      buildUseCase(repository).execute({ deliveryVendorIds: [vendorA] }),
    ).resolves.toEqual([vendorA]);
  });

  it('evaluates each vendor independently in a multi-vendor cart', async () => {
    const repository = lookup([
      [vendorA, OPEN_WEDNESDAY],
      [vendorB, { intervals: [{ weekday: 3, openMinute: 0, closeMinute: 60 }], closures: [] }],
    ]);

    await expect(
      buildUseCase(repository).execute({ deliveryVendorIds: [vendorA, vendorB] }),
    ).resolves.toEqual([vendorB]);
  });

  it('treats a vendor missing from the repository result as open', async () => {
    // Defensive: the port promises every requested vendor is present, and H4-A
    // stays the single answer for "we know nothing".
    const repository = lookup([]);

    await expect(
      buildUseCase(repository).execute({ deliveryVendorIds: [vendorA] }),
    ).resolves.toEqual([]);
  });

  it('asks the database nothing when there are no delivery vendors (H2-A)', async () => {
    const repository = lookup([]);

    await expect(buildUseCase(repository).execute({ deliveryVendorIds: [] })).resolves.toEqual([]);
    expect(repository.findForVendors).not.toHaveBeenCalled();
  });

  it('resolves every vendor in one batched call, never one per vendor', async () => {
    const repository = lookup([
      [vendorA, OPEN_WEDNESDAY],
      [vendorB, OPEN_WEDNESDAY],
    ]);

    await buildUseCase(repository).execute({ deliveryVendorIds: [vendorA, vendorB] });

    expect(repository.findForVendors).toHaveBeenCalledTimes(1);
    expect(repository.findForVendors).toHaveBeenCalledWith([vendorA, vendorB], {
      weekday: 3,
      isoDate: '2026-08-19',
    });
  });

  it('reads the instant from the injected Clock, in IST', async () => {
    const repository = lookup([[vendorA, OPEN_WEDNESDAY]]);
    // 19:00 UTC on the 19th is already Thursday the 20th in IST.
    await buildUseCase(repository, new Date('2026-08-19T19:00:00.000Z')).execute({
      deliveryVendorIds: [vendorA],
    });

    expect(repository.findForVendors).toHaveBeenCalledWith([vendorA], {
      weekday: 4,
      isoDate: '2026-08-20',
    });
  });

  it('is deterministic — a fixed clock yields a fixed verdict', async () => {
    const repository = lookup([[vendorA, OPEN_WEDNESDAY]]);
    const useCase = buildUseCase(repository);

    const first = await useCase.execute({ deliveryVendorIds: [vendorA] });
    const second = await useCase.execute({ deliveryVendorIds: [vendorA] });

    expect(second).toEqual(first);
  });
});
