import { describe, expect, it, vi } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { AdminMfaEnrollConfirmUseCase } from '../../../../../src/modules/identity/application/use-cases/admin-mfa-enroll-confirm.use-case.js';
import { InvalidCredentialsError } from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import { MfaSecret } from '../../../../../src/modules/identity/domain/entities/mfa-secret.entity.js';
import {
  ADMIN_ROLE_NAMES,
  Role,
  type RoleName,
} from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { UserStatus } from '../../../../../src/modules/identity/domain/value-objects/user-status.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toMfaSecretId } from '../../../../../src/modules/identity/domain/value-objects/mfa-secret-id.value-object.js';
import { SessionIssuer } from '../../../../../src/modules/identity/application/services/session-issuer.service.js';
import {
  FakeAccessTokenService,
  FakeMfaSecretCipher,
  FakePasswordHasher,
  FakeTotpService,
  InMemoryMfaSecretRepository,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  SequentialRefreshTokenHasher,
  nullLogger,
} from './fakes.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const ADMIN_PASSWORD = 'an-administrator-password';
const VALID_TOTP = '123456';
const PLAINTEXT_SECRET = 'the-plaintext-secret';

const setup = (): {
  useCase: AdminMfaEnrollConfirmUseCase;
  userRepository: InMemoryUserRepository;
  mfaSecretRepository: InMemoryMfaSecretRepository;
  refreshTokenRepository: InMemoryRefreshTokenRepository;
} => {
  const userRepository = new InMemoryUserRepository();
  const mfaSecretRepository = new InMemoryMfaSecretRepository();
  const refreshTokenRepository = new InMemoryRefreshTokenRepository();
  const clock = new FixedClock(NOW);
  const idGenerator = new UuidV7Generator();

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

  const useCase = new AdminMfaEnrollConfirmUseCase({
    userRepository,
    passwordHasher: new FakePasswordHasher(),
    mfaSecretRepository,
    totpService: new FakeTotpService(VALID_TOTP),
    mfaSecretCipher: new FakeMfaSecretCipher(),
    sessionIssuer,
    clock,
    logger: nullLogger,
  });

  return { useCase, userRepository, mfaSecretRepository, refreshTokenRepository };
};

let seq = 0;

/** Seeds an admin with a pending (unconfirmed) secret unless told otherwise — no HTTP or use-case path may create either. */
const seedAdminWithPendingSecret = async (
  userRepository: InMemoryUserRepository,
  mfaSecretRepository: InMemoryMfaSecretRepository,
  options: { role?: RoleName; pending?: boolean; confirmed?: boolean } = {},
): Promise<{ userId: ReturnType<typeof toUserId>; email: string }> => {
  seq += 1;
  const email = `ops-${seq}@leenmart.in`;
  const userId = toUserId(`00000000-0000-7000-8000-00000000${(9000 + seq).toString().slice(-4)}`);
  const admin = User.registerAdmin({
    id: userId,
    email,
    passwordHash: PasswordHash.create(`hashed:${ADMIN_PASSWORD}`),
    role: Role.fromName(options.role ?? 'SUPER_ADMIN'),
    now: NOW,
  });
  await userRepository.create(admin);

  if (options.pending !== false) {
    let secret = MfaSecret.enroll({
      id: toMfaSecretId(`00000000-0000-7000-8000-00000000${(9500 + seq).toString().slice(-4)}`),
      userId,
      encryptedSecret: `encrypted:${PLAINTEXT_SECRET}`,
      now: NOW,
    });
    if (options.confirmed) secret = secret.confirm(NOW);
    await mfaSecretRepository.create(secret);
  }

  return { userId, email };
};

describe('AdminMfaEnrollConfirmUseCase', () => {
  it.each(ADMIN_ROLE_NAMES)(
    'confirms the secret and issues a session for a %s',
    async (roleName) => {
      const { useCase, userRepository, mfaSecretRepository } = setup();
      const { userId, email } = await seedAdminWithPendingSecret(
        userRepository,
        mfaSecretRepository,
        {
          role: roleName,
        },
      );

      const session = await useCase.execute({
        email,
        password: ADMIN_PASSWORD,
        totpCode: VALID_TOTP,
      });

      expect(session.user.id).toBe(userId);
      expect(session.accessToken).toBe('access-token');

      const secret = await mfaSecretRepository.findByUserId(userId);
      expect(secret?.isConfirmed()).toBe(true);
    },
  );

  it('preserves the admin role in the issued session', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { email } = await seedAdminWithPendingSecret(userRepository, mfaSecretRepository);

    const session = await useCase.execute({
      email,
      password: ADMIN_PASSWORD,
      totpCode: VALID_TOTP,
    });

    expect(session.user.role).toBe(Role.SUPER_ADMIN);
  });

  it('persists the confirmed state', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { userId, email } = await seedAdminWithPendingSecret(userRepository, mfaSecretRepository);

    await useCase.execute({ email, password: ADMIN_PASSWORD, totpCode: VALID_TOTP });

    const secret = await mfaSecretRepository.findByUserId(userId);
    expect(secret?.confirmedAt).toEqual(NOW);
  });

  it('does not create a second MfaSecret', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { email } = await seedAdminWithPendingSecret(userRepository, mfaSecretRepository);
    const createSpy = vi.spyOn(mfaSecretRepository, 'create');

    await useCase.execute({ email, password: ADMIN_PASSWORD, totpCode: VALID_TOTP });

    expect(createSpy).not.toHaveBeenCalled();
  });

  it('wrong password does not confirm the secret or issue a session', async () => {
    const { useCase, userRepository, mfaSecretRepository, refreshTokenRepository } = setup();
    const { userId, email } = await seedAdminWithPendingSecret(userRepository, mfaSecretRepository);
    const createSessionSpy = vi.spyOn(refreshTokenRepository, 'create');

    await expect(
      useCase.execute({ email, password: 'wrong', totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const secret = await mfaSecretRepository.findByUserId(userId);
    expect(secret?.isConfirmed()).toBe(false);
    expect(createSessionSpy).not.toHaveBeenCalled();
  });

  it('wrong TOTP does not confirm the secret or issue a session', async () => {
    const { useCase, userRepository, mfaSecretRepository, refreshTokenRepository } = setup();
    const { userId, email } = await seedAdminWithPendingSecret(userRepository, mfaSecretRepository);
    const createSessionSpy = vi.spyOn(refreshTokenRepository, 'create');

    await expect(
      useCase.execute({ email, password: ADMIN_PASSWORD, totpCode: '000000' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const secret = await mfaSecretRepository.findByUserId(userId);
    expect(secret?.isConfirmed()).toBe(false);
    expect(createSessionSpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown email', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ email: 'ghost@leenmart.in', password: 'whatever', totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects a customer account', async () => {
    const { useCase, userRepository } = setup();
    const email = 'shopper@example.com';
    await userRepository.create(
      User.register({
        id: toUserId('00000000-0000-7000-8000-000000009901'),
        email,
        passwordHash: PasswordHash.create(`hashed:${ADMIN_PASSWORD}`),
        now: NOW,
      }),
    );

    await expect(
      useCase.execute({ email, password: ADMIN_PASSWORD, totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it.each(['VENDOR_OWNER', 'VENDOR_MANAGER', 'VENDOR_STAFF'] as const)(
    'rejects a %s vendor account',
    async (roleName) => {
      const { useCase, userRepository } = setup();
      const email = 'vendor@example.com';
      await userRepository.create(
        User.reconstitute({
          id: toUserId('00000000-0000-7000-8000-000000009902'),
          email,
          passwordHash: PasswordHash.create(`hashed:${ADMIN_PASSWORD}`),
          role: Role.fromName(roleName),
          status: UserStatus.ACTIVE,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );

      await expect(
        useCase.execute({ email, password: ADMIN_PASSWORD, totpCode: VALID_TOTP }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    },
  );

  it('rejects when there is no pending enrollment at all', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { email } = await seedAdminWithPendingSecret(userRepository, mfaSecretRepository, {
      pending: false,
    });

    await expect(
      useCase.execute({ email, password: ADMIN_PASSWORD, totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects when the secret is already confirmed (no re-confirmation)', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { email } = await seedAdminWithPendingSecret(userRepository, mfaSecretRepository, {
      confirmed: true,
    });

    await expect(
      useCase.execute({ email, password: ADMIN_PASSWORD, totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('reports unknown email, wrong password, wrong TOTP, and no-pending-secret identically', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { email: pendingEmail } = await seedAdminWithPendingSecret(
      userRepository,
      mfaSecretRepository,
    );
    const { email: confirmedEmail } = await seedAdminWithPendingSecret(
      userRepository,
      mfaSecretRepository,
      {
        confirmed: true,
      },
    );

    const unknownError: unknown = await useCase
      .execute({ email: 'ghost@leenmart.in', password: 'x', totpCode: VALID_TOTP })
      .catch((error: unknown) => error);
    const wrongPasswordError: unknown = await useCase
      .execute({ email: pendingEmail, password: 'wrong', totpCode: VALID_TOTP })
      .catch((error: unknown) => error);
    const noPendingError: unknown = await useCase
      .execute({ email: confirmedEmail, password: ADMIN_PASSWORD, totpCode: VALID_TOTP })
      .catch((error: unknown) => error);

    expect((unknownError as Error).message).toBe((wrongPasswordError as Error).message);
    expect((wrongPasswordError as Error).message).toBe((noPendingError as Error).message);
    expect((unknownError as InvalidCredentialsError).code).toBe(
      (noPendingError as InvalidCredentialsError).code,
    );
  });

  it('never logs the plaintext secret, TOTP code, or password', async () => {
    const { userRepository, mfaSecretRepository, refreshTokenRepository } = setup();
    const { email } = await seedAdminWithPendingSecret(userRepository, mfaSecretRepository);
    const recordedCalls: unknown[] = [];
    const record = (context: unknown, message: string): void => {
      recordedCalls.push({ context, message });
    };
    const noop = (): void => {
      /* not exercised by this use case */
    };
    const recordingLogger = {
      fatal: noop,
      error: noop,
      warn: record,
      info: record,
      debug: noop,
      trace: noop,
      child: () => recordingLogger,
    };
    const clock = new FixedClock(NOW);
    const sessionIssuer = new SessionIssuer({
      accessTokenService: new FakeAccessTokenService({
        token: 'access-token',
        expiresAt: new Date('2026-01-01T00:15:00.000Z'),
      }),
      refreshTokenHasher: new SequentialRefreshTokenHasher(),
      refreshTokenRepository,
      idGenerator: new UuidV7Generator(),
      clock,
      refreshTtlDays: 30,
    });
    const useCase = new AdminMfaEnrollConfirmUseCase({
      userRepository,
      passwordHasher: new FakePasswordHasher(),
      mfaSecretRepository,
      totpService: new FakeTotpService(VALID_TOTP),
      mfaSecretCipher: new FakeMfaSecretCipher(),
      sessionIssuer,
      clock,
      logger: recordingLogger,
    });

    await useCase.execute({ email, password: ADMIN_PASSWORD, totpCode: VALID_TOTP });

    const serialized = JSON.stringify(recordedCalls);
    expect(serialized).not.toContain(PLAINTEXT_SECRET);
    expect(serialized).not.toContain(VALID_TOTP);
    expect(serialized).not.toContain(ADMIN_PASSWORD);
  });
});
