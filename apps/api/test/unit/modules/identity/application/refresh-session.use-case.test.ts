import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV4Generator } from '@leen-mart/domain-kit';
import { SessionIssuer } from '../../../../../src/modules/identity/application/services/session-issuer.service.js';
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

const DAY_MS = 24 * 60 * 60 * 1000;

const setup = (): {
  registerUseCase: RegisterCustomerUseCase;
  refreshUseCase: RefreshSessionUseCase;
  clock: FixedClock;
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

  return { registerUseCase, refreshUseCase, clock };
};

describe('RefreshSessionUseCase', () => {
  it('rotates: exchanges a valid token for a new pair', async () => {
    const { registerUseCase, refreshUseCase } = setup();
    const initial = await registerUseCase.execute({ email: 'shopper@example.com', password: 'pw' });

    const rotated = await refreshUseCase.execute({ refreshToken: initial.refreshToken });

    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    expect(rotated.user.email).toBe('shopper@example.com');
  });

  it('rejects reuse of an already-rotated token', async () => {
    const { registerUseCase, refreshUseCase } = setup();
    const initial = await registerUseCase.execute({ email: 'shopper@example.com', password: 'pw' });
    await refreshUseCase.execute({ refreshToken: initial.refreshToken });

    await expect(refreshUseCase.execute({ refreshToken: initial.refreshToken })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('rejects a token that was never issued', async () => {
    const { refreshUseCase } = setup();

    await expect(refreshUseCase.execute({ refreshToken: 'never-issued' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('rejects an expired token', async () => {
    const { registerUseCase, refreshUseCase, clock } = setup();
    const initial = await registerUseCase.execute({ email: 'shopper@example.com', password: 'pw' });

    clock.advanceMs(31 * DAY_MS); // past the 30-day TTL used in setup()

    await expect(refreshUseCase.execute({ refreshToken: initial.refreshToken })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });
});
