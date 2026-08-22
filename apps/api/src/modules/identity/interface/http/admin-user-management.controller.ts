import type { Request, Response } from 'express';
import type {
  AdminRoleDto,
  AdminUser,
  CreateAdminUserRequest,
  ListAdminUsersQuery,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { User } from '../../domain/entities/user.entity.js';
import { ADMIN_ROLE_NAMES, type RoleName } from '../../domain/value-objects/role.value-object.js';
import type {
  CreateAdminUserUseCase,
  SubordinateAdminRole,
} from '../../application/use-cases/create-admin-user.use-case.js';
import type { ListAdminUsersUseCase } from '../../application/use-cases/list-admin-users.use-case.js';

export interface AdminUserManagementController {
  readonly create: (req: Request, res: Response) => Promise<void>;
  readonly list: (req: Request, res: Response) => Promise<void>;
}

export interface AdminUserManagementControllerDeps {
  readonly createAdminUserUseCase: CreateAdminUserUseCase;
  readonly listAdminUsersUseCase: ListAdminUsersUseCase;
}

/** `User.registerAdmin` always sets an email; this names the invariant rather than silently publishing an empty string if it were ever violated. */
const emailOf = (user: User): string => {
  if (!user.email) {
    throw new Error(`Admin user ${user.id} has no email — registerAdmin() requires one.`);
  }
  return user.email;
};

const isAdminRole = (name: RoleName): name is AdminRoleDto =>
  (ADMIN_ROLE_NAMES as readonly string[]).includes(name);

/** `User.role` is typed against the platform's full nine-role union; both callers of this mapper only ever hand it an admin-family row (`listAdmins` filters by `ADMIN_ROLE_NAMES`, a freshly created admin always is one), and this names that invariant instead of silently mis-widening the type. */
const roleOf = (user: User): AdminRoleDto => {
  if (!isAdminRole(user.role.name)) {
    throw new Error(`User ${user.id} is not an admin-family role: "${user.role.name}".`);
  }
  return user.role.name;
};

/**
 * Mapped field by field, never spread — the same reason every other admin
 * read-model mapper in this codebase gives: a column added to `users` later
 * (a password hash is already one) fails loudly here instead of being
 * published by a spread.
 */
const toAdminUser = (user: User): AdminUser => ({
  id: user.id,
  email: emailOf(user),
  role: roleOf(user),
  status: user.status.name,
  createdAt: user.createdAt.toISOString(),
  updatedAt: user.updatedAt.toISOString(),
});

/** A route reaching a writing handler without a principal is a wiring bug, not a request problem — same shape `admin-category.controller.ts`'s own `principalOf` gives. */
const principalOf = (req: Request, route: string): NonNullable<Request['principal']> => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  return req.principal;
};

/**
 * Thin HTTP adapter for the SUPER_ADMIN-gated admin-management surface
 * (Phase L.2). Parses nothing itself, decides nothing, translates no errors
 * — `validate()` and the global error handler own those (SDD 17.1).
 */
export const createAdminUserManagementController = (
  deps: AdminUserManagementControllerDeps,
): AdminUserManagementController => ({
  create: async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'POST /admin/users');
    const { body } = validatedData<CreateAdminUserRequest>(req);

    const { admin } = await deps.createAdminUserUseCase.execute({
      principal,
      email: body.email,
      password: body.password,
      role: body.role as SubordinateAdminRole,
    });

    res.status(201).json({ data: toAdminUser(admin), meta: { requestId: getRequestId() } });
  },

  list: async (req: Request, res: Response): Promise<void> => {
    const { query } = validatedData<unknown, ListAdminUsersQuery>(req);

    const page = await deps.listAdminUsersUseCase.execute({
      limit: query.limit,
      cursor: query.cursor,
    });

    res.status(200).json({
      data: page.items.map(toAdminUser),
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      },
    });
  },
});
