import { describe, expect, it } from 'vitest';
import { VendorProfile } from '../../../../../src/modules/vendor/domain/entities/vendor-profile.entity.js';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toVendorId } from '../../../../../src/modules/identity/domain/value-objects/vendor-id.value-object.js';

const vendorId = toVendorId('00000000-0000-7000-8000-0000000000a1');
const userId = toUserId('00000000-0000-7000-8000-0000000000a2');
const now = new Date('2026-01-01T00:00:00.000Z');

describe('VendorProfile', () => {
  it('registers a new vendor in the REGISTERED state (SDD 15.1 lifecycle entry)', () => {
    const vendor = VendorProfile.register({ id: vendorId, userId, now });

    expect(vendor.status).toBe(VendorStatus.REGISTERED);
    expect(vendor.id).toBe(vendorId);
    expect(vendor.userId).toBe(userId);
  });

  it('stamps both timestamps at registration', () => {
    const vendor = VendorProfile.register({ id: vendorId, userId, now });

    expect(vendor.createdAt).toEqual(now);
    expect(vendor.updatedAt).toEqual(now);
  });

  it('never starts anywhere other than REGISTERED, whatever the caller passes', () => {
    const vendor = VendorProfile.register({ id: vendorId, userId, now });

    expect(vendor.status.name).toBe('REGISTERED');
  });

  it('reconstitutes a persisted vendor with its stored status rather than defaulting it', () => {
    const vendor = VendorProfile.reconstitute({
      id: vendorId,
      userId,
      status: VendorStatus.KYC_UNDER_REVIEW,
      createdAt: now,
      updatedAt: now,
    });

    expect(vendor.status).toBe(VendorStatus.KYC_UNDER_REVIEW);
  });
});
