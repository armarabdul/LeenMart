import { describe, expect, it, vi } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { AdminLoginStepOneUseCase } from '../../../../../src/modules/identity/application/use-cases/admin-login-step-one.use-case.js';
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
import {
  FakePasswordHasher,
  InMemoryMfaChallengeRepository,
  InMemoryMfaSecretRepository,
  InMemoryUserRepository,
  SequentialRefreshTokenHasher,
  nullLogger,
} from './fakes.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const ADMIN_PASSWORD = 'an-administrator-password';

const setup = (): {
  useCase: AdminLoginStepOneUseCase;
  userRepository: InMemoryUserRepository;
  mfaSecretRepository: InMemoryMfaSecretRepository;
  mfaChallengeRepository: InMemoryMfaChallengeRepository;
  logger: typeof nullLogger;
} => {
  const userRepository = new InMemoryUserRepository();
  const mfaSecretRepository = new InMemoryMfaSecretRepository();
  const mfaChallengeRepository = new InMemoryMfaChallengeRepository();
  const challengeTokenHasher = new SequentialRefreshTokenHasher();
  const idGenerator = new UuidV7Generator();
  const clock = new FixedClock(NOW);
  const logger = nullLogger;

  const useCase = new AdminLoginStepOneUseCase({
    userRepository,
    passwordHasher: new FakePasswordHasher(),
    mfaSecretRepository,
    mfaChallengeRepository,
    challengeTokenGenerator: challengeTokenHasher,
    challengeTokenHasher,
    idGenerator,
    clock,
    logger,
  });

  return { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository, logger };
};

let adminSeq = 0;

/** Seeds an admin directly, with a confirmed MFA secret unless told otherwise — no HTTP or use-case path may create either. */
const seedAdmin = async (
  userRepository: InMemoryUserRepository,
  mfaSecretRepository: InMemoryMfaSecretRepository,
  options: { role?: RoleName; email?: string; confirmedMfa?: boolean } = {},
): Promise<{ userId: ReturnType<typeof toUserId>; email: string }> => {
  adminSeq += 1;
  const email = options.email ?? `ops-${adminSeq}@leenmart.in`;
  const userId = toUserId(
    `00000000-0000-7000-8000-00000000${(1000 + adminSeq).toString().slice(-4)}`,
  );
  const admin = User.registerAdmin({
    id: userId,
    email,
    passwordHash: PasswordHash.create(`hashed:${ADMIN_PASSWORD}`),
    role: Role.fromName(options.role ?? 'SUPER_ADMIN'),
    now: NOW,
  });
  await userRepository.create(admin);

  if (options.confirmedMfa !== false) {
    const secret = MfaSecret.enroll({
      id: toMfaSecretId(
        `00000000-0000-7000-8000-00000000${(2000 + adminSeq).toString().slice(-4)}`,
      ),
      userId,
      encryptedSecret: 'ciphertext:not-a-real-secret',
      now: NOW,
    }).confirm(NOW);
    await mfaSecretRepository.create(secret);
  }

  return { userId, email };
};

describe('AdminLoginStepOneUseCase', () => {
  it.each(ADMIN_ROLE_NAMES)(
    'creates exactly one MFA challenge for a %s with correct credentials',
    async (roleName) => {
      const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
      const { userId, email } = await seedAdmin(userRepository, mfaSecretRepository, {
        role: roleName,
      });

      const result = await useCase.execute({ email, password: ADMIN_PASSWORD });

      expect(result.mfaChallengeToken).toEqual(expect.any(String));
      expect(result.mfaChallengeTokenExpiresAt).toEqual(new Date('2026-01-01T00:05:00.000Z'));

      const found = await mfaChallengeRepository.findByTokenHash(
        `hash:${result.mfaChallengeToken}`,
      );
      expect(found).not.toBeNull();
      expect(found?.userId).toBe(userId);
    },
  );

  it('does not issue an access token or a refresh token', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { email } = await seedAdmin(userRepository, mfaSecretRepository);

    const result = await useCase.execute({ email, password: ADMIN_PASSWORD });

    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
    expect(Object.keys(result).sort()).toEqual(['mfaChallengeToken', 'mfaChallengeTokenExpiresAt']);
  });

  it('returns the challenge token only as an opaque credential — never the hash', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    const { email } = await seedAdmin(userRepository, mfaSecretRepository);

    const result = await useCase.execute({ email, password: ADMIN_PASSWORD });

    const persisted = await mfaChallengeRepository.findByTokenHash(
      `hash:${result.mfaChallengeToken}`,
    );
    expect(persisted?.tokenHash).not.toBe(result.mfaChallengeToken);
  });

  it('rejects an unknown email with the same error as every other failure', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ email: 'ghost@leenmart.in', password: 'whatever' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects a wrong password', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { email } = await seedAdmin(userRepository, mfaSecretRepository);

    await expect(useCase.execute({ email, password: 'wrong' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('rejects a customer account', async () => {
    const { useCase, userRepository } = setup();
    const email = 'shopper@example.com';
    await userRepository.create(
      User.register({
        id: toUserId('00000000-0000-7000-8000-000000009001'),
        email,
        passwordHash: PasswordHash.create(`hashed:${ADMIN_PASSWORD}`),
        now: NOW,
      }),
    );

    await expect(useCase.execute({ email, password: ADMIN_PASSWORD })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it.each(['VENDOR_OWNER', 'VENDOR_MANAGER', 'VENDOR_STAFF'] as const)(
    'rejects a %s vendor account',
    async (roleName) => {
      const { useCase, userRepository } = setup();
      const email = 'vendor@example.com';
      await userRepository.create(
        User.reconstitute({
          id: toUserId('00000000-0000-7000-8000-000000009002'),
          email,
          passwordHash: PasswordHash.create(`hashed:${ADMIN_PASSWORD}`),
          role: Role.fromName(roleName),
          status: UserStatus.ACTIVE,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );

      await expect(useCase.execute({ email, password: ADMIN_PASSWORD })).rejects.toBeInstanceOf(
        InvalidCredentialsError,
      );
    },
  );

  it('rejects an admin with no MFA secret at all', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { email } = await seedAdmin(userRepository, mfaSecretRepository, { confirmedMfa: false });

    await expect(useCase.execute({ email, password: ADMIN_PASSWORD })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('rejects an admin with an unconfirmed MFA secret', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { userId, email } = await seedAdmin(userRepository, mfaSecretRepository, {
      confirmedMfa: false,
    });
    const unconfirmed = MfaSecret.enroll({
      id: toMfaSecretId('00000000-0000-7000-8000-000000009003'),
      userId,
      encryptedSecret: 'ciphertext:unconfirmed',
      now: NOW,
    });
    await mfaSecretRepository.create(unconfirmed);

    await expect(useCase.execute({ email, password: ADMIN_PASSWORD })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('reports unknown email, wrong password, and unconfirmed MFA identically', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { email: confirmedEmail } = await seedAdmin(userRepository, mfaSecretRepository);
    const { email: unenrolledEmail } = await seedAdmin(userRepository, mfaSecretRepository, {
      confirmedMfa: false,
    });

    const unknownEmailError: unknown = await useCase
      .execute({ email: 'ghost@leenmart.in', password: 'x' })
      .catch((error: unknown) => error);
    const wrongPasswordError: unknown = await useCase
      .execute({ email: confirmedEmail, password: 'wrong' })
      .catch((error: unknown) => error);
    const unenrolledError: unknown = await useCase
      .execute({ email: unenrolledEmail, password: ADMIN_PASSWORD })
      .catch((error: unknown) => error);

    expect((unknownEmailError as Error).message).toBe((wrongPasswordError as Error).message);
    expect((wrongPasswordError as Error).message).toBe((unenrolledError as Error).message);
    expect((unknownEmailError as InvalidCredentialsError).code).toBe(
      (unenrolledError as InvalidCredentialsError).code,
    );
  });

  it('does not touch the MFA secret or challenge repositories after a credential failure', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    await seedAdmin(userRepository, mfaSecretRepository);
    const findByUserIdSpy = vi.spyOn(mfaSecretRepository, 'findByUserId');
    const createChallengeSpy = vi.spyOn(mfaChallengeRepository, 'create');

    await expect(
      useCase.execute({ email: 'ghost@leenmart.in', password: 'whatever' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(findByUserIdSpy).not.toHaveBeenCalled();
    expect(createChallengeSpy).not.toHaveBeenCalled();
  });

  it('verifies the password via the injected PasswordHasher, not by comparing plaintext', async () => {
    const { userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    const { email } = await seedAdmin(userRepository, mfaSecretRepository);
    const passwordHasher = new FakePasswordHasher();
    const verifySpy = vi.spyOn(passwordHasher, 'verify');
    const challengeTokenHasher = new SequentialRefreshTokenHasher();
    const useCase = new AdminLoginStepOneUseCase({
      userRepository,
      passwordHasher,
      mfaSecretRepository,
      mfaChallengeRepository,
      challengeTokenGenerator: challengeTokenHasher,
      challengeTokenHasher,
      idGenerator: new UuidV7Generator(),
      clock: new FixedClock(NOW),
      logger: nullLogger,
    });

    await useCase.execute({ email, password: ADMIN_PASSWORD });

    expect(verifySpy).toHaveBeenCalledWith(expect.anything(), ADMIN_PASSWORD);
  });

  it('never logs the password or the raw challenge token, on success or failure', async () => {
    const { userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    const { email } = await seedAdmin(userRepository, mfaSecretRepository);
    const challengeTokenHasher = new SequentialRefreshTokenHasher();
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
    const useCase = new AdminLoginStepOneUseCase({
      userRepository,
      passwordHasher: new FakePasswordHasher(),
      mfaSecretRepository,
      mfaChallengeRepository,
      challengeTokenGenerator: challengeTokenHasher,
      challengeTokenHasher,
      idGenerator: new UuidV7Generator(),
      clock: new FixedClock(NOW),
      logger: recordingLogger,
    });

    const result = await useCase.execute({ email, password: ADMIN_PASSWORD });
    await useCase.execute({ email, password: 'wrong' }).catch(() => undefined);

    const serialized = JSON.stringify(recordedCalls);
    expect(serialized).not.toContain(ADMIN_PASSWORD);
    expect(serialized).not.toContain(result.mfaChallengeToken);
  });
});
