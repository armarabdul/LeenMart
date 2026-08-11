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
  InMemoryUserRepository,
  SequentialRefreshTokenHasher,
  nullLogger,
} from './fakes.js';

const setup = (): {
  registerUseCase: RegisterCustomerUseCase;
  refreshUseCase: RefreshSessionUseCase;
  logoutUseCase: LogoutUseCase;
} => {
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
  const idGenerator = new UuidV4Generator();
  const userRepository = new InMemoryUserRepository();
  const refreshTokenRepository = new InMemoryRefreshTokenRepository();
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
    clock,
    logger: nullLogger,
  });
  const logoutUseCase = new LogoutUseCase({
    refreshTokenRepository,
    refreshTokenHasher,
    clock,
    logger: nullLogger,
  });

  return { registerUseCase, refreshUseCase, logoutUseCase };
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
});
