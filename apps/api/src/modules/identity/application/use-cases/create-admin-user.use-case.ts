import {
  toUuid,
  type Clock,
  type IdGenerator,
  type Logger,
  type TransactionRunner,
} from '@leen-mart/domain-kit';
import type { AuditWriter } from '../../../audit/index.js';
import { IDENTITY_AUDIT_ACTIONS, IDENTITY_AUDIT_ENTITY_TYPES } from '../../domain/audit-actions.js';
import { User } from '../../domain/entities/user.entity.js';
import { EmailAlreadyRegisteredError } from '../../domain/errors/identity-errors.js';
import { Role } from '../../domain/value-objects/role.value-object.js';
import { toUserId } from '../../domain/value-objects/user-id.value-object.js';
import type { Principal } from '../ports/principal.js';
import type { PasswordHasher } from '../ports/password-hasher.port.js';
import type { UserRepository } from '../ports/user-repository.port.js';

/**
 * The roles this use case may create — see `subordinateAdminRoleSchema`'s
 * own doc comment (`packages/contracts/src/identity/identity.contract.ts`)
 * for why SUPER_ADMIN is excluded. The HTTP schema is what actually refuses
 * the wrong value at the boundary; this type exists so the same restriction
 * is visible at the call site and a caller cannot pass a bare `string`.
 */
export type SubordinateAdminRole =
  | 'CATALOGUE_MODERATOR'
  | 'FINANCE_ADMIN'
  | 'RISK_ANALYST'
  | 'SUPPORT_AGENT';

export interface CreateAdminUserInput {
  readonly principal: Principal;
  readonly email: string;
  readonly password: string;
  readonly role: SubordinateAdminRole;
}

export interface CreateAdminUserResult {
  readonly admin: User;
}

export interface CreateAdminUserDeps {
  readonly userRepository: UserRepository;
  readonly passwordHasher: PasswordHasher;
  readonly transactionRunner: TransactionRunner;
  readonly auditWriter: AuditWriter;
  readonly idGenerator: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * SUPER_ADMIN-gated creation of a subordinate administrator (Phase L.2, SDD
 * 8.1/8.2) — the flow `BootstrapAdminUseCase`'s own doc comment names as
 * what a second and later admin account must come from: "further admins
 * must come from the SUPER_ADMIN-gated admin-management flow."
 *
 * The route's `requirePermission('MANAGE_ADMIN_USERS_OR_ROLES')` plus
 * `requireFullAccess` already confine the caller to a FULL-access grant —
 * SUPER_ADMIN alone, in today's matrix — before this use case ever runs;
 * it does not re-check the principal's role itself, the same division of
 * labour every other admin write in this codebase keeps (SDD 7.4 step 2 is
 * the middleware's job, not the use case's).
 *
 * The account is created with **no MFA secret**, exactly like the bootstrap
 * path: SDD 7.1 requires TOTP for every admin, so the new administrator's
 * first sign-in goes through the same enrollment surface
 * (`POST /api/v1/admin/mfa/enroll`) any admin without a confirmed secret
 * already uses. Nothing here can create a session or bypass that — this use
 * case returns a `User`, never a token.
 */
export class CreateAdminUserUseCase {
  constructor(private readonly deps: CreateAdminUserDeps) {}

  async execute(input: CreateAdminUserInput): Promise<CreateAdminUserResult> {
    const {
      userRepository,
      passwordHasher,
      transactionRunner,
      auditWriter,
      idGenerator,
      clock,
      logger,
    } = this.deps;

    // Same check-then-create shape `RegisterCustomerUseCase` already uses;
    // `users.email`'s DB-level unique constraint is the backstop for the
    // race a plain check cannot close.
    const existing = await userRepository.findByEmail(input.email);
    if (existing) {
      throw new EmailAlreadyRegisteredError();
    }

    const passwordHash = await passwordHasher.hash(input.password);

    return transactionRunner.run(async (scope) => {
      const repository = userRepository.withTransaction(scope);

      const admin = User.registerAdmin({
        id: toUserId(idGenerator.generate()),
        email: input.email,
        passwordHash,
        role: Role.fromName(input.role),
        now: clock.now(),
      });
      await repository.create(admin);

      // Atomic with the create (SDD 18.4): an admin account persisted with
      // no accompanying audit record is exactly the gap this transaction
      // exists to close, the same reasoning `CreateCategoryUseCase` applies.
      await auditWriter.withTransaction(scope).record({
        actorId: input.principal.userId,
        actorRole: input.principal.role,
        action: IDENTITY_AUDIT_ACTIONS.ADMIN_USER_CREATED,
        entityType: IDENTITY_AUDIT_ENTITY_TYPES.USER,
        entityId: toUuid(admin.id),
        // Never the password hash — only the metadata a reviewer of the
        // audit log needs to answer "who was created, with what role, by
        // whom."
        after: { email: admin.email, role: admin.role.name, status: admin.status.name },
      });

      logger.info(
        { adminId: admin.id, role: admin.role.name, createdBy: input.principal.userId },
        'Subordinate administrator created',
      );

      return { admin };
    });
  }
}
