import type { Request, Response } from 'express';
import type {
  AuthSessionResponse,
  LoginRequest,
  LogoutRequest,
  LogoutResponse,
  MeResponse,
  RefreshSessionRequest,
  RegisterCustomerRequest,
  RequestOtpRequest,
  RequestOtpResponse,
  VerifyOtpRequest,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { AuthSession } from '../../application/services/session-issuer.service.js';
import type { LoginUseCase } from '../../application/use-cases/login.use-case.js';
import type { LogoutUseCase } from '../../application/use-cases/logout.use-case.js';
import type { RefreshSessionUseCase } from '../../application/use-cases/refresh-session.use-case.js';
import type { RegisterCustomerUseCase } from '../../application/use-cases/register-customer.use-case.js';
import type { RequestOtpUseCase } from '../../application/use-cases/request-otp.use-case.js';
import type { VerifyOtpUseCase } from '../../application/use-cases/verify-otp.use-case.js';

export interface IdentityController {
  readonly register: (req: Request, res: Response) => Promise<void>;
  readonly login: (req: Request, res: Response) => Promise<void>;
  readonly refresh: (req: Request, res: Response) => Promise<void>;
  readonly logout: (req: Request, res: Response) => Promise<void>;
  readonly requestOtp: (req: Request, res: Response) => Promise<void>;
  readonly verifyOtp: (req: Request, res: Response) => Promise<void>;
  /**
   * Synchronous, unlike the other handlers: it does no I/O, only reads the
   * `Principal` the `authenticate()` middleware already attached to the
   * request — there's nothing here to `await`.
   */
  readonly me: (req: Request, res: Response) => void;
}

export interface IdentityControllerDeps {
  readonly registerCustomerUseCase: RegisterCustomerUseCase;
  readonly loginUseCase: LoginUseCase;
  readonly refreshSessionUseCase: RefreshSessionUseCase;
  readonly logoutUseCase: LogoutUseCase;
  readonly requestOtpUseCase: RequestOtpUseCase;
  readonly verifyOtpUseCase: VerifyOtpUseCase;
}

export const toSessionResponse = (session: AuthSession): AuthSessionResponse => ({
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

  requestOtp: async (req: Request, res: Response): Promise<void> => {
    const { body } = validatedData<RequestOtpRequest>(req);
    await deps.requestOtpUseCase.execute(body);
    const data: RequestOtpResponse = { success: true };
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },

  verifyOtp: async (req: Request, res: Response): Promise<void> => {
    const { body } = validatedData<VerifyOtpRequest>(req);
    const session = await deps.verifyOtpUseCase.execute(body);
    res.status(200).json({ data: toSessionResponse(session), meta: { requestId: getRequestId() } });
  },

  me: (req: Request, res: Response): void => {
    // `authenticate()` guarantees `req.principal` is set before this handler
    // runs — reachability without it means the route was wired without the
    // middleware, a programming error, not a client-facing 401 case.
    if (!req.principal) {
      throw new Error(
        'GET /me reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const data: MeResponse = { id: req.principal.userId, role: req.principal.role };
    res.status(200).json({ data, meta: { requestId: getRequestId() } });
  },
});
