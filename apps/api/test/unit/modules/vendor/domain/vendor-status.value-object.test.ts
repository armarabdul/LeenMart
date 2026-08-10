import { describe, expect, it } from 'vitest';
import { VendorStatus } from '../../../../../src/modules/vendor/domain/value-objects/vendor-status.value-object.js';

const SDD_15_1_STATES = [
  'REGISTERED',
  'KYC_SUBMITTED',
  'KYC_UNDER_REVIEW',
  'KYC_REJECTED',
  'KYC_APPROVED',
  'ACTIVE',
  'SUSPENDED',
  'TERMINATED',
] as const;

describe('VendorStatus', () => {
  it('exposes exactly the eight SDD 15.1 lifecycle states', () => {
    for (const name of SDD_15_1_STATES) {
      expect(VendorStatus.fromName(name).name).toBe(name);
    }
  });

  it.each(SDD_15_1_STATES)('resolves %s to the matching singleton', (name) => {
    expect(VendorStatus.fromName(name)).toBe(VendorStatus.fromName(name));
  });

  it('rejects an unknown status name', () => {
    expect(() => VendorStatus.fromName('PENDING_REVIEW')).toThrow(/Not a valid vendor status/);
  });

  it('rejects UserStatus names that are not part of the vendor lifecycle', () => {
    expect(() => VendorStatus.fromName('PENDING')).toThrow(/Not a valid vendor status/);
    expect(() => VendorStatus.fromName('LOCKED')).toThrow(/Not a valid vendor status/);
  });

  it('compares statuses by name', () => {
    expect(VendorStatus.REGISTERED.equals(VendorStatus.fromName('REGISTERED'))).toBe(true);
    expect(VendorStatus.REGISTERED.equals(VendorStatus.ACTIVE)).toBe(false);
  });
});
