import type { UserId } from '../../../identity/index.js';
import type { Address } from '../entities/address.entity.js';
import type { AddressId } from '../value-objects/address-id.value-object.js';

export interface AddressRepository {
  create(address: Address): Promise<void>;
  /** Scoped to `id` + `userId` — never a bare `id` lookup, so a client-supplied id can never reach another customer's row. */
  findById(id: AddressId, userId: UserId): Promise<Address | null>;
  findAllByUserId(userId: UserId): Promise<readonly Address[]>;
  /** Scoped update; returns `false` if nothing matched `id` + `userId` (wrong owner or already deleted), never throws for that case. */
  update(address: Address, userId: UserId): Promise<boolean>;
  /** Soft-deletes (SDD's `deleted_at` convention) and clears `isDefault` in the same write. Returns `false` if nothing matched. */
  remove(id: AddressId, userId: UserId, now: Date): Promise<boolean>;
  /**
   * Atomically clears any other default this user has and sets this address
   * as the new one, inside a single database transaction — closes the
   * window a plain check-then-write would leave for two concurrent
   * "set default" calls. Returns `false` if `id` + `userId` matched nothing.
   */
  setDefault(id: AddressId, userId: UserId, now: Date): Promise<boolean>;
}
