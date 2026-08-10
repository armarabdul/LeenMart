import { describe, expect, it } from 'vitest';
import { Role } from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';

describe('Role', () => {
  it('exposes the nine fixed platform roles (SDD 8.1)', () => {
    expect(Role.CUSTOMER.name).toBe('CUSTOMER');
    expect(Role.VENDOR_OWNER.name).toBe('VENDOR_OWNER');
    expect(Role.VENDOR_MANAGER.name).toBe('VENDOR_MANAGER');
    expect(Role.VENDOR_STAFF.name).toBe('VENDOR_STAFF');
    expect(Role.SUPER_ADMIN.name).toBe('SUPER_ADMIN');
    expect(Role.CATALOGUE_MODERATOR.name).toBe('CATALOGUE_MODERATOR');
    expect(Role.FINANCE_ADMIN.name).toBe('FINANCE_ADMIN');
    expect(Role.RISK_ANALYST.name).toBe('RISK_ANALYST');
    expect(Role.SUPPORT_AGENT.name).toBe('SUPPORT_AGENT');
  });

  it('resolves a valid role name to the matching singleton', () => {
    expect(Role.fromName('SUPER_ADMIN')).toBe(Role.SUPER_ADMIN);
  });

  it.each([
    'CUSTOMER',
    'VENDOR_OWNER',
    'VENDOR_MANAGER',
    'VENDOR_STAFF',
    'SUPER_ADMIN',
    'CATALOGUE_MODERATOR',
    'FINANCE_ADMIN',
    'RISK_ANALYST',
    'SUPPORT_AGENT',
  ])('accepts %s as a valid role name', (name) => {
    expect(Role.fromName(name).name).toBe(name);
  });

  it('rejects an unknown role name', () => {
    expect(() => Role.fromName('SUPERADMIN')).toThrow(/Not a valid role/);
  });

  it('rejects the old flat role names removed by the SDD 8.1 hierarchy', () => {
    expect(() => Role.fromName('VENDOR')).toThrow(/Not a valid role/);
    expect(() => Role.fromName('ADMIN')).toThrow(/Not a valid role/);
  });

  it('compares roles by name', () => {
    expect(Role.CUSTOMER.equals(Role.fromName('CUSTOMER'))).toBe(true);
    expect(Role.CUSTOMER.equals(Role.VENDOR_OWNER)).toBe(false);
  });
});
