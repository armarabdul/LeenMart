import type { TransactionScope } from '@leen-mart/domain-kit';
import type { UserId } from '../value-objects/user-id.value-object.js';
import type { PhoneNumber } from '../value-objects/phone-number.value-object.js';
import type { RoleName } from '../value-objects/role.value-object.js';
import type { User } from '../entities/user.entity.js';

/** One page of the admin-management list (Phase L.2), the platform's existing cursor convention (SDD 9.2) — same shape `CategoryPage` publishes. */
export interface AdminUserPage {
  readonly items: readonly User[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * `findByEmail` still uses a raw `string` — `Email` remains optional/unadopted
 * on `User` (Milestone 2 item 6, still deferred). `id` now uses the branded
 * `UserId`, matching `User.id` after the Milestone 2 Step 3 migration (see
 * docs/identity-milestone2-backlog.md). `findByPhone` uses `PhoneNumber`
 * directly since phone+OTP (Milestone 3 Step 2) adopted that value object
 * from day one rather than repeating email's deferred-adoption history.
 */
export interface UserRepository {
  /**
   * Re-binds this repository to an open transaction, so a write here commits
   * or rolls back with everything else in that scope.
   *
   * Needed because vendor registration promotes a `users` row and inserts a
   * `vendors` row atomically — two modules' tables, so neither module's
   * repository can own the transaction (SDD 5.1).
   */
  withTransaction(scope: TransactionScope): UserRepository;

  create(user: User): Promise<void>;
  update(user: User): Promise<void>;
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findByPhone(phone: PhoneNumber): Promise<User | null>;
  /**
   * Existence only — the bootstrap needs to know *whether* an administrator
   * exists, never which one. Deliberately narrower than a general
   * find-by-role query, which nothing needs yet.
   */
  existsWithAnyRole(roles: readonly RoleName[]): Promise<boolean>;

  /**
   * One page of every admin-family account (SDD 8.1), on UUID v7's own time
   * order — the SUPER_ADMIN-gated admin-management read surface's raw
   * material (Phase L.2). Mirrors `CategoryRepository.listPage` exactly.
   */
  listAdmins(input: { limit: number; cursor?: string | undefined }): Promise<AdminUserPage>;
}
