import { describe, expect, it } from 'vitest';
import { Role } from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';

describe('Role', () => {
  it('exposes the three fixed platform roles', () => {
    expect(Role.CUSTOMER.name).toBe('CUSTOMER');
    expect(Role.VENDOR.name).toBe('VENDOR');
    expect(Role.ADMIN.name).toBe('ADMIN');
  });

  it('resolves a valid role name to the matching singleton', () => {
    expect(Role.fromName('ADMIN')).toBe(Role.ADMIN);
  });

  it('rejects an unknown role name', () => {
    expect(() => Role.fromName('SUPERADMIN')).toThrow(/Not a valid role/);
  });

  it('compares roles by name', () => {
    expect(Role.CUSTOMER.equals(Role.fromName('CUSTOMER'))).toBe(true);
    expect(Role.CUSTOMER.equals(Role.VENDOR)).toBe(false);
  });
});
