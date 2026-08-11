import type { Clock, IdGenerator, Logger } from '@leen-mart/domain-kit';
import { User } from '../../domain/entities/user.entity.js';
import {
  AdminAlreadyExistsError,
  WeakAdminPasswordError,
} from '../../domain/errors/identity-errors.js';
import { ADMIN_ROLE_NAMES, Role } from '../../domain/value-objects/role.value-object.js';
import { toUserId } from '../../domain/value-objects/user-id.value-object.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { UserRepository } from '../ports/user-repository.port.js';

/**
 * SDD 7.5's password policy. Enforced here rather than at a request schema
 * because this path has none: bootstrap is an operator-run CLI, not an HTTP
 * surface. The same floor is applied to customer registration by
 * `PASSWORD_MIN_LENGTH` in the contracts package.
 */
export const ADMIN_PASSWORD_MIN_LENGTH = 10;

export interface BootstrapAdminInput {
  readonly email: string;
  readonly password: string;
}

export interface BootstrapAdminDeps {
  readonly userRepository: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Creates the platform's first administrator (a SUPER_ADMIN), run by an
 * operator from the CLI. SDD 8.2 makes "Manage admin users/roles" a
 * SUPER_ADMIN-only permission, which is circular for the very first
 * account — this breaks that cycle once and then refuses to run again.
 *
 * The account is created with **no MFA secret**. SDD 7.1 requires TOTP for
 * every admin, so the first sign-in must go through enrolment on the admin
 * surface; until that surface exists this account simply cannot authenticate
 * anywhere (`LoginUseCase` refuses admin roles).
 *
 * Deliberately not exposed over HTTP: there is no public path to creating an
 * administrator.
 */
export class BootstrapAdminUseCase {
  constructor(private readonly deps: BootstrapAdminDeps) {}

  async execute(input: BootstrapAdminInput): Promise<User> {
    const { userRepository, passwordHasher, idGenerator, clock, logger } = this.deps;

    if (input.password.length < ADMIN_PASSWORD_MIN_LENGTH) {
      throw new WeakAdminPasswordError({
        details: [
          {
            field: 'password',
            issue: `must be at least ${String(ADMIN_PASSWORD_MIN_LENGTH)} characters`,
          },
        ],
      });
    }

    if (await userRepository.existsWithAnyRole(ADMIN_ROLE_NAMES)) {
      throw new AdminAlreadyExistsError();
    }

    const passwordHash = await passwordHasher.hash(input.password);
    const admin = User.registerAdmin({
      id: toUserId(idGenerator.generate()),
      email: input.email,
      passwordHash,
      role: Role.SUPER_ADMIN,
      now: clock.now(),
    });
    await userRepository.create(admin);

    logger.info({ userId: admin.id, role: admin.role.name }, 'Bootstrap administrator created');
    return admin;
  }
}
