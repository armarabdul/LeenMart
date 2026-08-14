import type { TransactionScope } from '@leen-mart/domain-kit';
import type { ProductVariantId } from '../../../catalogue/index.js';
import type { CartItem } from '../entities/cart-item.entity.js';
import type { CartId } from '../value-objects/cart-id.value-object.js';
import type { CartItemId } from '../value-objects/cart-item-id.value-object.js';

export interface CartItemRepository {
  /** Re-binds to a transaction the caller already opened. Same shape every other repository in this codebase publishes. */
  withTransaction(scope: TransactionScope): CartItemRepository;

  create(item: CartItem): Promise<void>;

  /** Scoped to one cart's live rows for one variant — backs the "adding an already-present variant increments its quantity" behaviour. */
  findByCartAndVariant(cartId: CartId, variantId: ProductVariantId): Promise<CartItem | null>;

  /** Scoped to `id` + `cartId` — never a bare `id` lookup, so a client-supplied id can never reach another cart's row. */
  findByCartAndId(id: CartItemId, cartId: CartId): Promise<CartItem | null>;

  listByCartId(cartId: CartId): Promise<readonly CartItem[]>;

  /**
   * Writes the new quantity **only if** the row still belongs to `cartId`
   * and is still live. `false` means it was removed or never belonged to
   * this cart — a caller turns that into `CartItemNotFoundError`. Conditional
   * rather than read-then-write for the same reason every other conditional
   * write in this codebase is: the read would already be stale.
   */
  updateQuantityIfOwned(item: CartItem, cartId: CartId): Promise<boolean>;

  /** Soft-deletes one item, scoped to `id` + `cartId`. `false` if nothing matched (wrong owner or already gone). */
  softDelete(id: CartItemId, cartId: CartId, now: Date): Promise<boolean>;

  /** Soft-deletes every live item in one cart. Returns how many. */
  softDeleteAllForCart(cartId: CartId, now: Date): Promise<number>;
}
