import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV4Generator } from '@leen-mart/domain-kit';
import { SessionIssuer } from '../../../../../src/modules/identity/application/services/session-issuer.service.js';
import { RegisterCustomerUseCase } from '../../../../../src/modules/identity/application/use-cases/register-customer.use-case.js';
import { EmailAlreadyRegisteredError } from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
import {
  FakeAccessTokenService,
  FakePasswordHasher,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  SequentialRefreshTokenHasher,
  nullLogger,
} from './fakes.js';

const setup = (): {
  useCase: RegisterCustomerUseCase;
  userRepository: InMemoryUserRepository;
  refreshTokenRepository: InMemoryRefreshTokenRepository;
} => {
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
    adminIdleTimeoutMinutes: 30,
  });
  const passwordHasher = new FakePasswordHasher();

  const useCase = new RegisterCustomerUseCase({
    userRepository,
    passwordHasher,
    sessionIssuer,
    idGenerator,
    clock,
    logger: nullLogger,
  });

  return { useCase, userRepository, refreshTokenRepository };
};

describe('RegisterCustomerUseCase', () => {
  it('creates a CUSTOMER and issues a session', async () => {
    const { useCase } = setup();

    const session = await useCase.execute({
      email: 'shopper@example.com',
      password: 'correct horse battery',
    });

    expect(session.user.role.name).toBe('CUSTOMER');
    expect(session.accessToken).toBe('access-token');
    expect(session.refreshToken).toBe('raw-token-1');
  });

  it('hashes the password rather than storing it in the clear', async () => {
    const { useCase, userRepository } = setup();

    await useCase.execute({ email: 'shopper@example.com', password: 'correct horse battery' });

    const stored = await userRepository.findByEmail('shopper@example.com');
    expect(stored?.passwordHash?.value).toBe('hashed:correct horse battery');
  });

  it('rejects a second registration with the same email', async () => {
    const { useCase } = setup();
    await useCase.execute({ email: 'shopper@example.com', password: 'correct horse battery' });

    await expect(
      useCase.execute({ email: 'shopper@example.com', password: 'another password' }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('persists a refresh token alongside the user', async () => {
    const { useCase, refreshTokenRepository } = setup();

    const session = await useCase.execute({
      email: 'shopper@example.com',
      password: 'correct horse battery',
    });

    await expect(
      refreshTokenRepository.findByTokenHash(`hash:${session.refreshToken}`),
    ).resolves.not.toBeNull();
  });
});
