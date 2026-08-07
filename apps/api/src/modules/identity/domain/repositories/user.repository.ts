import type { Uuid } from '@leen-mart/domain-kit';
import type { User } from '../entities/user.entity.js';

/**
 * `id`/`findByEmail` use the generic `Uuid`/`string` types `User` itself
 * still declares, not `UserId`/`Email` — the branded-ID and value-object
 * migration for `User` is deferred to Milestone 2 (see
 * docs/identity-milestone2-backlog.md); this interface mirrors the entity it
 * describes rather than getting ahead of it.
 */
export interface UserRepository {
  create(user: User): Promise<void>;
  findById(id: Uuid): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
}
