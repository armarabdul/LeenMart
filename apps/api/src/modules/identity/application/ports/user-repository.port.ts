import type { Uuid } from '@leen-mart/domain-kit';
import type { User } from '../../domain/entities/user.entity.js';

export interface UserRepository {
  create(user: User): Promise<void>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: Uuid): Promise<User | null>;
}
