import type { Request, Response } from 'express';
import type {
  AuthSessionResponse,
  LoginRequest,
  LogoutRequest,
  LogoutResponse,
  RefreshSessionRequest,
  RegisterCustomerRequest,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { AuthSession } from '../../application/services/session-issuer.service.js';
import type { LoginUseCase } from '../../application/use-cases/login.use-case.js';
import type { LogoutUseCase } from '../../application/use-cases/logout.use-case.js';
import type { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case.js';
import type { RegisterCustomerUseCase } from '../../application/use-cases/register-customer.use-case.js';

export interface IdentityController {
  readonly register: (req: Request, res: Response) => Promise<void>;
  readonly login: (req: Request, res: Response) => Promise<void>;
  readonly refresh: (req: Request, res: Response) => Promise<void>;
  readonly logout: (req: Request, res: Response) => Promise<void>;
}

export interface IdentityControllerDeps {
  readonly registerCustomerUseCase: RegisterCustomerUseCase;
  readonly loginUseCase: LoginUseCase;
  readonly refreshSessionUseCase: RefreshSessionUseCase;
  readonly logoutUseCase: LogoutUseCase;
}

const toSessionResponse = (session: AuthSession): AuthSessionResponse => ({
  user: { id: session.user.id, email: session.user.email, role: session.user.role.name },
  accessToken: session.accessToken,
  accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
  refreshToken: session.refreshToken,
  refreshTokenExpiresAt: session.refreshTokenExpiresAt.toISOString(),
});

/**
 * Thin HTTP adapter: parses nothing itself (that is `validate()`'s job),
 * translates use-case output to the wire envelope, and never translates
 * errors — the global error handler owns that (SDD 17.1).
 */
export const createIdentityController = (deps: IdentityControllerDeps): IdentityController => ({
  register: async (req: Request, res: Response): Promise<void> => {
    const { body } = validatedData<RegisterCustomerRequest>(req);
    const session = await deps.registerCustomerUseCase.execute(body);
    res.status(201).json({ data: toSessionResponse(session), meta: { requestId: getRequestId() } });
  },

  login: async (req: Request, res: Response): Promise<void> => {
    const { body } = validatedData<LoginRequest>(req);
    const session = await deps.loginUseCase.execute(body);
    res.status(200).json({ data: toSessionResponse(session), meta: { requestId: getRequestId() } });
  },

  refresh: async (req: Request, res: Response): Promise<void> => {
    const { body } = validatedData<RefreshSessionRequest>(req);
    const session = await deps.refreshSessionUseCase.execute(body);
    res.status(200).json({ data: toSessionResponse(session), meta: { requestId: getRequestId() } });
  },

  logout: async (req: Request, res: Response): Promise<void> => {
    const { body } = validatedData<LogoutRequest>(req);
    await deps.logoutUseCase.execute(body);
    const data: LogoutResponse = { success: true };
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },
});
