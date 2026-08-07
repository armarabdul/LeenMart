import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV4Generator } from '@leen-mart/domain-kit';
import { SessionIssuer } from '../../../../../src/modules/identity/application/services/session-issuer.service.js';
import { LoginUseCase } from '../../../../../src/modules/identity/application/use-cases/login.use-case.js';
import { RegisterCustomerUseCase } from '../../../../../src/modules/identity/application/use-cases/register-customer.use-case.js';
import { InvalidCredentialsError } from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
import {
  FakeAccessTokenService,
  FakePasswordHasher,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  SequentialRefreshTokenHasher,
  nullLogger,
} from './fakes.js';

const setup = (): { registerUseCase: RegisterCustomerUseCase; loginUseCase: LoginUseCase } => {
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
  const idGenerator = new UuidV4Generator();
  const userRepository = new InMemoryUserRepository();
  const refreshTokenRepository = new InMemoryRefreshTokenRepository();
  const sessionIssuer = new SessionIssuer({
    accessTokenService: new FakeAccessTokenService({
      token: 'access-token',
      expiresAt: new Date('2026-01-01T00:15:00.000Z'),
    }),
    refreshTokenHasher: new SequentialRefreshTokenHasher(),
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
  const loginUseCase = new LoginUseCase({ userRepository, passwordHasher, sessionIssuer, logger: nullLogger });

  return { registerUseCase, loginUseCase };
};

describe('LoginUseCase', () => {
  it('issues a new session for correct credentials', async () => {
    const { registerUseCase, loginUseCase } = setup();
    await registerUseCase.execute({ email: 'shopper@example.com', password: 'correct horse battery' });

    const session = await loginUseCase.execute({
      email: 'shopper@example.com',
      password: 'correct horse battery',
    });

    expect(session.user.email).toBe('shopper@example.com');
    expect(session.refreshToken).toBe('raw-token-2'); // token 1 was issued by registration
  });

  it('rejects an unknown email', async () => {
    const { loginUseCase } = setup();

    await expect(
      loginUseCase.execute({ email: 'ghost@example.com', password: 'whatever' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects a wrong password', async () => {
    const { registerUseCase, loginUseCase } = setup();
    await registerUseCase.execute({ email: 'shopper@example.com', password: 'correct horse battery' });

    await expect(
      loginUseCase.execute({ email: 'shopper@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('reports an unknown email and a wrong password identically, so login cannot enumerate accounts', async () => {
    const { registerUseCase, loginUseCase } = setup();
    await registerUseCase.execute({ email: 'shopper@example.com', password: 'correct horse battery' });

    const unknownEmailError: unknown = await loginUseCase
      .execute({ email: 'ghost@example.com', password: 'x' })
      .catch((error: unknown) => error);
    const wrongPasswordError: unknown = await loginUseCase
      .execute({ email: 'shopper@example.com', password: 'wrong' })
      .catch((error: unknown) => error);

    expect((unknownEmailError as Error).message).toBe((wrongPasswordError as Error).message);
  });
});
