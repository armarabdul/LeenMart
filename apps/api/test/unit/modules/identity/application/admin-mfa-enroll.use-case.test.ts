import { describe, expect, it, vi } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { AdminMfaEnrollUseCase } from '../../../../../src/modules/identity/application/use-cases/admin-mfa-enroll.use-case.js';
import {
  InvalidCredentialsError,
  MfaSecretAlreadyExistsError,
} from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
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
  FakeMfaSecretCipher,
  FakePasswordHasher,
  FakeTotpService,
  InMemoryMfaSecretRepository,
  InMemoryUserRepository,
  nullLogger,
} from './fakes.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const ADMIN_PASSWORD = 'an-administrator-password';
const ISSUER = 'leen-mart-api';

const setup = (): {
  useCase: AdminMfaEnrollUseCase;
  userRepository: InMemoryUserRepository;
  mfaSecretRepository: InMemoryMfaSecretRepository;
} => {
  const userRepository = new InMemoryUserRepository();
  const mfaSecretRepository = new InMemoryMfaSecretRepository();

  const useCase = new AdminMfaEnrollUseCase({
    userRepository,
    passwordHasher: new FakePasswordHasher(),
    mfaSecretRepository,
    totpService: new FakeTotpService(),
    mfaSecretCipher: new FakeMfaSecretCipher(),
    idGenerator: new UuidV7Generator(),
    clock: new FixedClock(NOW),
    issuer: ISSUER,
    logger: nullLogger,
  });

  return { useCase, userRepository, mfaSecretRepository };
};

let seq = 0;

/** Seeds an admin directly — no HTTP or use-case path may create one. */
const seedAdmin = async (
  userRepository: InMemoryUserRepository,
  options: { role?: RoleName; email?: string } = {},
): Promise<{ userId: ReturnType<typeof toUserId>; email: string }> => {
  seq += 1;
  const email = options.email ?? `ops-${seq}@leenmart.in`;
  const userId = toUserId(`00000000-0000-7000-8000-00000000${(7000 + seq).toString().slice(-4)}`);
  const admin = User.registerAdmin({
    id: userId,
    email,
    passwordHash: PasswordHash.create(`hashed:${ADMIN_PASSWORD}`),
    role: Role.fromName(options.role ?? 'SUPER_ADMIN'),
    now: NOW,
  });
  await userRepository.create(admin);
  return { userId, email };
};

describe('AdminMfaEnrollUseCase', () => {
  it.each(ADMIN_ROLE_NAMES)(
    'creates an unconfirmed secret for a %s with correct credentials',
    async (roleName) => {
      const { useCase, userRepository, mfaSecretRepository } = setup();
      const { userId, email } = await seedAdmin(userRepository, { role: roleName });

      const result = await useCase.execute({ email, password: ADMIN_PASSWORD });

      expect(result.secret).toEqual(expect.any(String));
      expect(result.otpauthUri).toMatch(/^otpauth:\/\/totp\//);

      const stored = await mfaSecretRepository.findByUserId(userId);
      expect(stored).not.toBeNull();
      expect(stored?.isConfirmed()).toBe(false);
    },
  );

  it('never persists the plaintext secret — only its encrypted form', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { userId, email } = await seedAdmin(userRepository);

    const result = await useCase.execute({ email, password: ADMIN_PASSWORD });

    const stored = await mfaSecretRepository.findByUserId(userId);
    expect(stored?.encryptedSecret).not.toBe(result.secret);
    expect(stored?.encryptedSecret).toContain('encrypted:');
  });

  it('does not issue an access token, refresh token, or session of any kind', async () => {
    const { useCase, userRepository } = setup();
    const { email } = await seedAdmin(userRepository);

    const result = await useCase.execute({ email, password: ADMIN_PASSWORD });

    expect(result).not.toHaveProperty('accessToken');
    expect(result).not.toHaveProperty('refreshToken');
    expect(Object.keys(result).sort()).toEqual(['otpauthUri', 'secret']);
  });

  it('rejects an unknown email', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ email: 'ghost@leenmart.in', password: 'whatever' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects a wrong password', async () => {
    const { useCase, userRepository } = setup();
    const { email } = await seedAdmin(userRepository);

    await expect(useCase.execute({ email, password: 'wrong' })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('rejects a customer account', async () => {
    const { useCase, userRepository } = setup();
    const email = 'shopper@example.com';
    await userRepository.create(
      User.register({
        id: toUserId('00000000-0000-7000-8000-000000008001'),
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
          id: toUserId('00000000-0000-7000-8000-000000008002'),
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

  it('rejects when a confirmed secret already exists', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { userId, email } = await seedAdmin(userRepository);
    await mfaSecretRepository.create(
      MfaSecret.enroll({
        id: toMfaSecretId('00000000-0000-7000-8000-000000008003'),
        userId,
        encryptedSecret: 'encrypted:already-here',
        now: NOW,
      }).confirm(NOW),
    );

    await expect(useCase.execute({ email, password: ADMIN_PASSWORD })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('rejects when an unconfirmed secret already exists (no re-enrollment)', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { userId, email } = await seedAdmin(userRepository);
    await mfaSecretRepository.create(
      MfaSecret.enroll({
        id: toMfaSecretId('00000000-0000-7000-8000-000000008004'),
        userId,
        encryptedSecret: 'encrypted:pending',
        now: NOW,
      }),
    );

    await expect(useCase.execute({ email, password: ADMIN_PASSWORD })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('does not create a duplicate secret when it refuses', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { userId, email } = await seedAdmin(userRepository);
    await mfaSecretRepository.create(
      MfaSecret.enroll({
        id: toMfaSecretId('00000000-0000-7000-8000-000000008005'),
        userId,
        encryptedSecret: 'encrypted:pending',
        now: NOW,
      }),
    );

    await expect(useCase.execute({ email, password: ADMIN_PASSWORD })).rejects.toThrow();

    const secrets: unknown[] = [];
    const found = await mfaSecretRepository.findByUserId(userId);
    if (found) secrets.push(found);
    expect(secrets).toHaveLength(1);
  });

  it('translates a repository race (MfaSecretAlreadyExistsError) into the uniform failure', async () => {
    const { useCase, userRepository, mfaSecretRepository } = setup();
    const { email } = await seedAdmin(userRepository);
    vi.spyOn(mfaSecretRepository, 'create').mockRejectedValueOnce(
      new MfaSecretAlreadyExistsError(),
    );

    await expect(useCase.execute({ email, password: ADMIN_PASSWORD })).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });

  it('never logs the plaintext secret, otpauth URI, or password', async () => {
    const { userRepository, mfaSecretRepository } = setup();
    const { email } = await seedAdmin(userRepository);
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
    const useCase = new AdminMfaEnrollUseCase({
      userRepository,
      passwordHasher: new FakePasswordHasher(),
      mfaSecretRepository,
      totpService: new FakeTotpService(),
      mfaSecretCipher: new FakeMfaSecretCipher(),
      idGenerator: new UuidV7Generator(),
      clock: new FixedClock(NOW),
      issuer: ISSUER,
      logger: recordingLogger,
    });

    const result = await useCase.execute({ email, password: ADMIN_PASSWORD });

    const serialized = JSON.stringify(recordedCalls);
    expect(serialized).not.toContain(result.secret);
    expect(serialized).not.toContain(result.otpauthUri);
    expect(serialized).not.toContain(ADMIN_PASSWORD);
  });
});
