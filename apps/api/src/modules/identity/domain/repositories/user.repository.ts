import type { UserId } from '../value-objects/user-id.value-object.js';
import type { PhoneNumber } from '../value-objects/phone-number.value-object.js';
import type { RoleName } from '../value-objects/role.value-object.js';
import type { User } from '../entities/user.entity.js';

/**
 * `findByEmail` still uses a raw `string` — `Email` remains optional/unadopted
 * on `User` (Milestone 2 item 6, still deferred). `id` now uses the branded
 * `UserId`, matching `User.id` after the Milestone 2 Step 3 migration (see
 * docs/identity-milestone2-backlog.md). `findByPhone` uses `PhoneNumber`
 * directly since phone+OTP (Milestone 3 Step 2) adopted that value object
 * from day one rather than repeating email's deferred-adoption history.
 */
export interface UserRepository {
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
}
