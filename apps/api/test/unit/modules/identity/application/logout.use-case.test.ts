import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV4Generator } from '@leen-mart/domain-kit';
import { SessionIssuer } from '../../../../../src/modules/identity/application/services/session-issuer.service.js';
import { LogoutUseCase } from '../../../../../src/modules/identity/application/use-cases/logout.use-case.js';
import { RefreshSessionUseCase } from '../../../../../src/modules/identity/application/use-cases/refresh-session.use-case.js';
import { RegisterCustomerUseCase } from '../../../../../src/modules/identity/application/use-cases/register-customer.use-case.js';
import { InvalidRefreshTokenError } from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
import {
  FakeAccessTokenService,
  FakePasswordHasher,
  InMemoryRefreshTokenRepository,
  InMemorySessionDenylist,
  InMemoryUserRepository,
  SequentialRefreshTokenHasher,
  nullLogger,
} from './fakes.js';

/** Mirrors `JWT_ACCESS_TTL_SECONDS`; the bound every denylist entry must respect (SDD 7.2). */
const ACCESS_TOKEN_TTL_SECONDS = 600;

const setup = (): {
  registerUseCase: RegisterCustomerUseCase;
  refreshUseCase: RefreshSessionUseCase;
  logoutUseCase: LogoutUseCase;
  sessionDenylist: InMemorySessionDenylist;
  refreshTokenRepository: InMemoryRefreshTokenRepository;
} => {
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
  const idGenerator = new UuidV4Generator();
  const userRepository = new InMemoryUserRepository();
  const refreshTokenRepository = new InMemoryRefreshTokenRepository();
  const sessionDenylist = new InMemorySessionDenylist();
  const refreshTokenHasher = new SequentialRefreshTokenHasher();
  const sessionIssuer = new SessionIssuer({
    accessTokenService: new FakeAccessTokenService({
      token: 'access-token',
      expiresAt: new Date('2026-01-01T00:15:00.000Z'),
    }),
    refreshTokenHasher,
    refreshTokenRepository,
    idGenerator,
    clock,
    refreshTtlDays: 30,
    adminIdleTimeoutMinutes: 30,
  });
  const passwordHasher = new FakePasswordHasher();

  const registerUseCase = new RegisterCustomerUseCase({
    userRepository,
    passwordHasher,
    sessionIssuer,
    idGenerator,
    clock,
    logger: nullLogger,
  });
  const refreshUseCase = new RefreshSessionUseCase({
    userRepository,
    refreshTokenRepository,
    refreshTokenHasher,
    sessionIssuer,
    sessionDenylist,
    accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    clock,
    logger: nullLogger,
  });
  const logoutUseCase = new LogoutUseCase({
    refreshTokenRepository,
    refreshTokenHasher,
    sessionDenylist,
    accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    clock,
    logger: nullLogger,
  });

  return {
    registerUseCase,
    refreshUseCase,
    logoutUseCase,
    sessionDenylist,
    refreshTokenRepository,
  };
};

describe('LogoutUseCase', () => {
  it('revokes an active token so a subsequent refresh is rejected', async () => {
    const { registerUseCase, refreshUseCase, logoutUseCase } = setup();
    const session = await registerUseCase.execute({
      email: 'shopper@example.com',
      password: 'correct horse battery',
    });

    await logoutUseCase.execute({ refreshToken: session.refreshToken });

    await expect(
      refreshUseCase.execute({ refreshToken: session.refreshToken }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('is idempotent for a token that was already revoked', async () => {
    const { registerUseCase, logoutUseCase } = setup();
    const session = await registerUseCase.execute({
      email: 'shopper@example.com',
      password: 'correct horse battery',
    });

    await logoutUseCase.execute({ refreshToken: session.refreshToken });

    await expect(
      logoutUseCase.execute({ refreshToken: session.refreshToken }),
    ).resolves.toBeUndefined();
  });

  it('is idempotent for a token that was never issued, so it cannot be used to probe token validity', async () => {
    const { logoutUseCase } = setup();

    await expect(logoutUseCase.execute({ refreshToken: 'never-issued' })).resolves.toBeUndefined();
  });

  describe('access-token revocation (SDD 7.2)', () => {
    it('denies the session, so its access token stops authenticating immediately', async () => {
      // Revoking the refresh row alone left the access token usable for the
      // rest of its life — this is the half of logout that closes that.
      const { registerUseCase, logoutUseCase, sessionDenylist } = setup();
      const session = await registerUseCase.execute({
        email: 'shopper@example.com',
        password: 'correct horse battery',
      });

      await logoutUseCase.execute({ refreshToken: session.refreshToken });

      expect(await sessionDenylist.isDenied(session.refreshTokenId)).toBe(true);
    });

    it('bounds the denylist entry by the access-token lifetime, never longer', async () => {
      const { registerUseCase, logoutUseCase, sessionDenylist } = setup();
      const session = await registerUseCase.execute({
        email: 'shopper@example.com',
        password: 'correct horse battery',
      });

      await logoutUseCase.execute({ refreshToken: session.refreshToken });

      // Past this point the token has expired on its own, so holding the
      // entry longer would pin dead sessions in Redis for no security gain.
      expect(sessionDenylist.denied.get(session.refreshTokenId)).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });

    it('leaves another live session untouched', async () => {
      const { registerUseCase, logoutUseCase, sessionDenylist } = setup();
      const first = await registerUseCase.execute({
        email: 'shopper@example.com',
        password: 'correct horse battery',
      });
      const second = await registerUseCase.execute({
        email: 'other@example.com',
        password: 'correct horse battery',
      });

      await logoutUseCase.execute({ refreshToken: first.refreshToken });

      expect(await sessionDenylist.isDenied(second.refreshTokenId)).toBe(false);
    });

    it('denies nothing for an unknown token, so logout cannot be used to probe sessions', async () => {
      const { logoutUseCase, sessionDenylist } = setup();

      await logoutUseCase.execute({ refreshToken: 'never-issued' });

      expect(sessionDenylist.denied.size).toBe(0);
    });

    it('denies nothing extra when replaying a logout for an already-revoked token', async () => {
      const { registerUseCase, logoutUseCase, sessionDenylist } = setup();
      const session = await registerUseCase.execute({
        email: 'shopper@example.com',
        password: 'correct horse battery',
      });

      await logoutUseCase.execute({ refreshToken: session.refreshToken });
      await logoutUseCase.execute({ refreshToken: session.refreshToken });

      expect(sessionDenylist.denied.size).toBe(1);
    });
  });
});
