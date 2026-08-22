import type { AdminUserPage } from '../../domain/repositories/user.repository.js';
import type { UserRepository } from '../ports/user-repository.port.js';

export interface ListAdminUsersInput {
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface ListAdminUsersDeps {
  readonly userRepository: UserRepository;
}

/**
 * One page of every admin-family account (SDD 8.1) for the SUPER_ADMIN-gated
 * admin-management surface (Phase L.2). A read — no transaction, no audit
 * record, mirroring `ListCategoriesUseCase` exactly.
 */
export class ListAdminUsersUseCase {
  constructor(private readonly deps: ListAdminUsersDeps) {}

  execute(input: ListAdminUsersInput): Promise<AdminUserPage> {
    return this.deps.userRepository.listAdmins({ limit: input.limit, cursor: input.cursor });
  }
}
