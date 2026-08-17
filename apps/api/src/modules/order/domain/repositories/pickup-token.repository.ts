import type { TransactionScope } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type { PickupToken } from '../entities/pickup-token.entity.js';
import type { PickupTokenId } from '../value-objects/pickup-token-id.value-object.js';
import type { SubOrderId } from '../value-objects/sub-order-id.value-object.js';

/**
 * `pickup_tokens` (S4-QR, SDD 13.1). Constructed on two different
 * credentials depending on caller, the same way `VendorRepository` already
 * is elsewhere in this module: the *customer's* own issue/rotate path runs
 * on `leenmart_checkout` (ownership enforced in the use case, mirroring
 * `orders`/`sub_orders`' own customer-facing reach), while the *vendor's*
 * redemption path runs on the tenant-scoped `leenmart_app` client, where RLS
 * confines every read/write to the caller's own `vendor_id`.
 */
export interface PickupTokenRepository {
  /** Re-binds this repository to an open transaction. Same shape every other repository in this codebase publishes. */
  withTransaction(scope: TransactionScope): PickupTokenRepository;

  /** The one row for this sub-order, or `null` if none has been issued yet. */
  findBySubOrderId(subOrderId: SubOrderId): Promise<PickupToken | null>;

  /** Inserts the sub-order's first token. Fails on a second call for the same `subOrderId` — the unique index is the arbiter (mirrors `AddCartItemUseCase`'s own "read-then-write, the index decides" acceptance). */
  create(token: PickupToken): Promise<void>;

  /** Overwrites the hash/nonce/validity window in place (rotation) — never touches `status`. */
  rotate(token: PickupToken): Promise<void>;

  /**
   * The atomic `status = 'ISSUED' -> 'REDEEMED'` compare-and-set (SDD 13.1)
   * that makes concurrent/replayed redemption impossible. `true` only if
   * this exact row was still `ISSUED` — `false` means it was already
   * redeemed, by this same request racing itself or an earlier scan.
   */
  redeemIfIssued(id: PickupTokenId, redeemedAt: Date, redeemedByUserId: UserId): Promise<boolean>;
}
