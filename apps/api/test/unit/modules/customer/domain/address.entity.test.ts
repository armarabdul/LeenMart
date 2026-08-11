import { describe, expect, it } from 'vitest';
import { toUserId } from '../../../../../src/modules/identity/index.js';
import {
  Address,
  type AddressDetails,
} from '../../../../../src/modules/customer/domain/entities/address.entity.js';
import { toAddressId } from '../../../../../src/modules/customer/domain/value-objects/address-id.value-object.js';

const id = toAddressId('00000000-0000-7000-8000-0000000000a1');
const userId = toUserId('00000000-0000-7000-8000-0000000000a2');
const now = new Date('2026-01-01T00:00:00.000Z');

const validDetails: AddressDetails = {
  recipientName: 'Asha Rao',
  phone: '+919876543210',
  line1: '221B Baker Street',
  line2: 'Near City Mall',
  city: 'Bengaluru',
  state: 'Karnataka',
  pincode: '560001',
  landmark: 'Opposite the bakery',
  label: 'Home',
};

describe('Address', () => {
  it('adds a new address, defaulting isDefault to whatever the caller passes', () => {
    const address = Address.add({ id, userId, details: validDetails, isDefault: false, now });

    expect(address.id).toBe(id);
    expect(address.userId).toBe(userId);
    expect(address.recipientName).toBe('Asha Rao');
    expect(address.phone).toBe('+919876543210');
    expect(address.line1).toBe('221B Baker Street');
    expect(address.line2).toBe('Near City Mall');
    expect(address.city).toBe('Bengaluru');
    expect(address.state).toBe('Karnataka');
    expect(address.pincode).toBe('560001');
    expect(address.landmark).toBe('Opposite the bakery');
    expect(address.label).toBe('Home');
    expect(address.isDefault).toBe(false);
    expect(address.createdAt).toEqual(now);
    expect(address.updatedAt).toEqual(now);
  });

  it('accepts null line2/landmark for an address with no second line or landmark', () => {
    const address = Address.add({
      id,
      userId,
      details: { ...validDetails, line2: null, landmark: null },
      isDefault: false,
      now,
    });

    expect(address.line2).toBeNull();
    expect(address.landmark).toBeNull();
  });

  it('can be added as the default directly', () => {
    const address = Address.add({ id, userId, details: validDetails, isDefault: true, now });
    expect(address.isDefault).toBe(true);
  });

  describe('updateDetails', () => {
    it('changes only the supplied fields, leaving the rest untouched', () => {
      const address = Address.add({ id, userId, details: validDetails, isDefault: false, now });
      const laterNow = new Date('2026-01-02T00:00:00.000Z');

      const updated = address.updateDetails({ city: 'Mumbai', state: 'Maharashtra' }, laterNow);

      expect(updated.city).toBe('Mumbai');
      expect(updated.state).toBe('Maharashtra');
      expect(updated.recipientName).toBe('Asha Rao');
      expect(updated.line1).toBe('221B Baker Street');
      expect(updated.updatedAt).toEqual(laterNow);
      expect(updated.createdAt).toEqual(now);
    });

    it('never changes id, userId, or isDefault', () => {
      const address = Address.add({ id, userId, details: validDetails, isDefault: true, now });

      const updated = address.updateDetails({ city: 'Pune' }, now);

      expect(updated.id).toBe(id);
      expect(updated.userId).toBe(userId);
      expect(updated.isDefault).toBe(true);
    });

    it('returns a new instance rather than mutating the original', () => {
      const address = Address.add({ id, userId, details: validDetails, isDefault: false, now });

      const updated = address.updateDetails({ city: 'Chennai' }, now);

      expect(address.city).toBe('Bengaluru');
      expect(updated).not.toBe(address);
    });

    it('can explicitly clear line2/landmark to null', () => {
      const address = Address.add({ id, userId, details: validDetails, isDefault: false, now });

      const updated = address.updateDetails({ line2: null, landmark: null }, now);

      expect(updated.line2).toBeNull();
      expect(updated.landmark).toBeNull();
    });
  });

  describe('markAsDefault / unmarkAsDefault', () => {
    it('markAsDefault sets isDefault and bumps updatedAt', () => {
      const address = Address.add({ id, userId, details: validDetails, isDefault: false, now });
      const laterNow = new Date('2026-01-02T00:00:00.000Z');

      const marked = address.markAsDefault(laterNow);

      expect(marked.isDefault).toBe(true);
      expect(marked.updatedAt).toEqual(laterNow);
      expect(address.isDefault).toBe(false);
    });

    it('unmarkAsDefault clears isDefault and bumps updatedAt', () => {
      const address = Address.add({ id, userId, details: validDetails, isDefault: true, now });
      const laterNow = new Date('2026-01-02T00:00:00.000Z');

      const unmarked = address.unmarkAsDefault(laterNow);

      expect(unmarked.isDefault).toBe(false);
      expect(unmarked.updatedAt).toEqual(laterNow);
    });
  });

  it('reconstitutes a persisted address without defaulting its state', () => {
    const address = Address.reconstitute({
      id,
      userId,
      ...validDetails,
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

    expect(address.isDefault).toBe(true);
    expect(address.recipientName).toBe('Asha Rao');
  });
});
