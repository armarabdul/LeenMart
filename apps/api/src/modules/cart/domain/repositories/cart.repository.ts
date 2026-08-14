import type { TransactionScope } from '@leen-mart/domain-kit';
import type { UserId } from '../../../identity/index.js';
import type { Cart } from '../entities/cart.entity.js';

export interface CartRepository {
  /** Re-binds to a transaction the caller already opened. Same shape every other repository in this codebase publishes. */
  withTransaction(scope: TransactionScope): CartRepository;

  findByUserId(userId: UserId): Promise<Cart | null>;

  /**
   * Atomic get-or-create (`INSERT ... ON CONFLICT (user_id) DO UPDATE`, via
   * Prisma's `upsert`) — the one per-user row is enforced by `uq_carts_user`,
   * so two concurrent first-adds cannot create two rows; whichever loses the
   * race simply reads back the winner's row instead of erroring, which is
   * all "get or create" ever needs to guarantee.
   *
   * Takes a freshly-opened `Cart` rather than a bare `userId` so its id is
   * always minted by the caller's `IdGenerator` (ADR-005: ids are generated
   * in the application layer, never by a repository or the database) — the
   * candidate id is simply discarded if this call turns out to be the
   * loser of the race.
   */
  upsertForUser(candidate: Cart): Promise<Cart>;
}
