import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV4Generator } from '@leen-mart/domain-kit';
import { SessionIssuer } from '../../../../../src/modules/identity/application/services/session-issuer.service.js';
import { LoginUseCase } from '../../../../../src/modules/identity/application/use-cases/login.use-case.js';
import { RegisterCustomerUseCase } from '../../../../../src/modules/identity/application/use-cases/register-customer.use-case.js';
import { InvalidCredentialsError } from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import {
  ADMIN_ROLE_NAMES,
  Role,
  type RoleName,
} from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { UserStatus } from '../../../../../src/modules/identity/domain/value-objects/user-status.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
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
  loginUseCase: LoginUseCase;
  userRepository: InMemoryUserRepository;
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

  const registerUseCase = new RegisterCustomerUseCase({
    userRepository,
    passwordHasher,
    sessionIssuer,
    idGenerator,
    clock,
    logger: nullLogger,
  });
  const loginUseCase = new LoginUseCase({
    userRepository,
    passwordHasher,
    sessionIssuer,
    logger: nullLogger,
  });

  return { registerUseCase, loginUseCase, userRepository };
};

const ADMIN_PASSWORD = 'an-administrator-password';

/** Seeds an admin directly: no HTTP or use-case path may create one. */
const seedAdmin = async (
  userRepository: InMemoryUserRepository,
  roleName: RoleName,
  email: string,
): Promise<void> => {
  await userRepository.create(
    User.registerAdmin({
      id: toUserId('00000000-0000-7000-8000-0000000000d1'),
      email,
      passwordHash: PasswordHash.create(`hashed:${ADMIN_PASSWORD}`),
      role: Role.fromName(roleName),
      now: new Date('2026-01-01T00:00:00.000Z'),
    }),
  );
};

describe('LoginUseCase', () => {
  it('issues a new session for correct credentials', async () => {
    const { registerUseCase, loginUseCase } = setup();
    await registerUseCase.execute({
      email: 'shopper@example.com',
      password: 'correct horse battery',
    });

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
    await registerUseCase.execute({
      email: 'shopper@example.com',
      password: 'correct horse battery',
    });

    await expect(
      loginUseCase.execute({ email: 'shopper@example.com', password: 'wrong' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('reports an unknown email and a wrong password identically, so login cannot enumerate accounts', async () => {
    const { registerUseCase, loginUseCase } = setup();
    await registerUseCase.execute({
      email: 'shopper@example.com',
      password: 'correct horse battery',
    });

    const unknownEmailError: unknown = await loginUseCase
      .execute({ email: 'ghost@example.com', password: 'x' })
      .catch((error: unknown) => error);
    const wrongPasswordError: unknown = await loginUseCase
      .execute({ email: 'shopper@example.com', password: 'wrong' })
      .catch((error: unknown) => error);

    expect((unknownEmailError as Error).message).toBe((wrongPasswordError as Error).message);
  });

  describe('admin accounts (SDD 7.1: mandatory TOTP)', () => {
    it.each(ADMIN_ROLE_NAMES)('refuses a %s on the customer login surface', async (roleName) => {
      const { loginUseCase, userRepository } = setup();
      const email = 'ops@leenmart.in';
      await seedAdmin(userRepository, roleName, email);

      await expect(
        loginUseCase.execute({ email, password: ADMIN_PASSWORD }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('refuses an admin identically to an unknown account, revealing nothing', async () => {
      const { loginUseCase, userRepository } = setup();
      const email = 'ops@leenmart.in';
      await seedAdmin(userRepository, 'SUPER_ADMIN', email);

      const adminError: unknown = await loginUseCase
        .execute({ email, password: ADMIN_PASSWORD })
        .catch((error: unknown) => error);
      const unknownEmailError: unknown = await loginUseCase
        .execute({ email: 'ghost@example.com', password: ADMIN_PASSWORD })
        .catch((error: unknown) => error);

      expect((adminError as Error).message).toBe((unknownEmailError as Error).message);
      expect((adminError as InvalidCredentialsError).code).toBe(
        (unknownEmailError as InvalidCredentialsError).code,
      );
    });

    it('refuses an admin even when the password is correct', async () => {
      const { loginUseCase, userRepository } = setup();
      const email = 'ops@leenmart.in';
      await seedAdmin(userRepository, 'SUPER_ADMIN', email);

      // FakePasswordHasher would verify this successfully — the role guard
      // must reject before the password is ever checked.
      await expect(
        loginUseCase.execute({ email, password: ADMIN_PASSWORD }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it.each(['VENDOR_OWNER', 'VENDOR_MANAGER', 'VENDOR_STAFF'] as const)(
      'still allows a %s to log in — vendor authentication is unchanged',
      async (roleName) => {
        const { loginUseCase, userRepository } = setup();
        const email = 'vendor@example.com';
        await userRepository.create(
          User.reconstitute({
            id: toUserId('00000000-0000-7000-8000-0000000000d2'),
            email,
            passwordHash: PasswordHash.create(`hashed:${ADMIN_PASSWORD}`),
            role: Role.fromName(roleName),
            status: UserStatus.ACTIVE,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          }),
        );

        const session = await loginUseCase.execute({ email, password: ADMIN_PASSWORD });

        expect(session.user.role.name).toBe(roleName);
      },
    );
  });
});
