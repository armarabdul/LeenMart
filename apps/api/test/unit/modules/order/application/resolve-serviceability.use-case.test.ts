import { describe, expect, it, vi } from 'vitest';
import { UuidV7Generator } from '@leen-mart/domain-kit';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';
import { ResolveServiceabilityUseCase } from '../../../../../src/modules/order/application/use-cases/resolve-serviceability.use-case.js';
import type {
  ServiceabilityRepository,
  VendorServiceability,
} from '../../../../../src/modules/order/domain/repositories/serviceability.repository.js';

const ids = new UuidV7Generator();
const vendorA = toVendorId(ids.generate());
const vendorB = toVendorId(ids.generate());
const PINCODE = '560001';

const repo = (
  entries: readonly (readonly [typeof vendorA, VendorServiceability])[],
): ServiceabilityRepository => ({
  resolveForPincode: vi.fn().mockResolvedValue(new Map(entries)),
});

const buildUseCase = (repository: ServiceabilityRepository): ResolveServiceabilityUseCase =>
  new ResolveServiceabilityUseCase({ serviceabilityRepository: repository });

describe('ResolveServiceabilityUseCase (S4-SERV)', () => {
  it('treats an unconfigured vendor as serving everywhere (D7)', async () => {
    const repository = repo([[vendorA, { configured: false, servesPincode: false }]]);

    const unserviceable = await buildUseCase(repository).execute({
      pincode: PINCODE,
      deliveryVendorIds: [vendorA],
    });

    // The backward-compatibility rule: every vendor predates this table, and
    // reading "no rows" as "serves nowhere" would take the delivery fleet down.
    expect(unserviceable).toEqual([]);
  });

  it('accepts a configured vendor that declared the pincode', async () => {
    const repository = repo([[vendorA, { configured: true, servesPincode: true }]]);

    await expect(
      buildUseCase(repository).execute({ pincode: PINCODE, deliveryVendorIds: [vendorA] }),
    ).resolves.toEqual([]);
  });

  it('rejects a configured vendor that did not declare the pincode', async () => {
    const repository = repo([[vendorA, { configured: true, servesPincode: false }]]);

    await expect(
      buildUseCase(repository).execute({ pincode: PINCODE, deliveryVendorIds: [vendorA] }),
    ).resolves.toEqual([vendorA]);
  });

  it('evaluates each vendor independently in a multi-vendor cart', async () => {
    const repository = repo([
      [vendorA, { configured: true, servesPincode: true }],
      [vendorB, { configured: true, servesPincode: false }],
    ]);

    const unserviceable = await buildUseCase(repository).execute({
      pincode: PINCODE,
      deliveryVendorIds: [vendorA, vendorB],
    });

    expect(unserviceable).toEqual([vendorB]);
  });

  it('treats a vendor missing from the repository result as unconfigured', async () => {
    // Defensive: the port promises every requested vendor is present, and the
    // legacy rule stays the single answer for "we know nothing".
    const repository = repo([]);

    await expect(
      buildUseCase(repository).execute({ pincode: PINCODE, deliveryVendorIds: [vendorA] }),
    ).resolves.toEqual([]);
  });

  it('asks the database nothing when there are no delivery vendors', async () => {
    const repository = repo([]);

    const unserviceable = await buildUseCase(repository).execute({
      pincode: PINCODE,
      deliveryVendorIds: [],
    });

    // A pickup-only order performs no serviceability query at all (D6).
    expect(unserviceable).toEqual([]);
    expect(repository.resolveForPincode).not.toHaveBeenCalled();
  });

  it('resolves every vendor in one batched call, never one per vendor', async () => {
    const repository = repo([
      [vendorA, { configured: true, servesPincode: true }],
      [vendorB, { configured: true, servesPincode: true }],
    ]);

    await buildUseCase(repository).execute({
      pincode: PINCODE,
      deliveryVendorIds: [vendorA, vendorB],
    });

    // The N+1 guard: two vendors, exactly one lookup, and both ids in it.
    expect(repository.resolveForPincode).toHaveBeenCalledTimes(1);
    expect(repository.resolveForPincode).toHaveBeenCalledWith(PINCODE, [vendorA, vendorB]);
  });
});
