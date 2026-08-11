import { NullLogger } from '@leen-mart/domain-kit';
import type { UserId } from '../../../../../src/modules/identity/index.js';
import type { Address } from '../../../../../src/modules/customer/domain/entities/address.entity.js';
import type { AddressRepository } from '../../../../../src/modules/customer/domain/repositories/address.repository.js';
import type { AddressId } from '../../../../../src/modules/customer/domain/value-objects/address-id.value-object.js';

export class InMemoryAddressRepository implements AddressRepository {
  private readonly byId = new Map<AddressId, Address>();
  /** Soft-deleted rows are kept here (out of `byId`) purely so a test can assert on them if it ever needs to; nothing reads it today. */
  private readonly deleted = new Map<AddressId, Address>();

  create(address: Address): Promise<void> {
    this.byId.set(address.id, address);
    return Promise.resolve();
  }

  findById(id: AddressId, userId: UserId): Promise<Address | null> {
    const address = this.byId.get(id);
    return Promise.resolve(address && address.userId === userId ? address : null);
  }

  findAllByUserId(userId: UserId): Promise<readonly Address[]> {
    const addresses = [...this.byId.values()].filter((address) => address.userId === userId);
    addresses.sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    return Promise.resolve(addresses);
  }

  update(address: Address, userId: UserId): Promise<boolean> {
    const existing = this.byId.get(address.id);
    if (!existing || existing.userId !== userId) return Promise.resolve(false);
    this.byId.set(address.id, address);
    return Promise.resolve(true);
  }

  remove(id: AddressId, userId: UserId, now: Date): Promise<boolean> {
    const existing = this.byId.get(id);
    if (!existing || existing.userId !== userId) return Promise.resolve(false);
    this.byId.delete(id);
    this.deleted.set(id, existing.unmarkAsDefault(now));
    return Promise.resolve(true);
  }

  setDefault(id: AddressId, userId: UserId, now: Date): Promise<boolean> {
    const target = this.byId.get(id);
    if (!target || target.userId !== userId) return Promise.resolve(false);

    for (const [otherId, other] of this.byId) {
      if (other.userId === userId && other.isDefault && otherId !== id) {
        this.byId.set(otherId, other.unmarkAsDefault(now));
      }
    }
    this.byId.set(id, target.markAsDefault(now));
    return Promise.resolve(true);
  }
}

export const nullLogger = new NullLogger();
