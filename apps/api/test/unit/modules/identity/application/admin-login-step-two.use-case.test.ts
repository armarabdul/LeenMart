import { describe, expect, it, vi } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { AdminLoginStepTwoUseCase } from '../../../../../src/modules/identity/application/use-cases/admin-login-step-two.use-case.js';
import {
  AccountLockedError,
  AccountSuspendedError,
  InvalidCredentialsError,
} from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import { MfaSecret } from '../../../../../src/modules/identity/domain/entities/mfa-secret.entity.js';
import { MfaChallenge } from '../../../../../src/modules/identity/domain/entities/mfa-challenge.entity.js';
import { Role } from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { UserStatus } from '../../../../../src/modules/identity/domain/value-objects/user-status.value-object.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toMfaSecretId } from '../../../../../src/modules/identity/domain/value-objects/mfa-secret-id.value-object.js';
import { toMfaChallengeId } from '../../../../../src/modules/identity/domain/value-objects/mfa-challenge-id.value-object.js';
import {
  FakeAccessTokenService,
  FakeMfaSecretCipher,
  FakeTotpService,
  InMemoryMfaChallengeRepository,
  InMemoryMfaSecretRepository,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  FailingAuditWriter,
  RecordingAuditWriter,
  SequentialRefreshTokenHasher,
  nullLogger,
} from './fakes.js';
import { SessionIssuer } from '../../../../../src/modules/identity/application/services/session-issuer.service.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const VALID_TOTP = '123456';
const CHALLENGE_TOKEN = 'the-raw-challenge-token';
const CHALLENGE_TOKEN_HASH = `hash:${CHALLENGE_TOKEN}`;

const setup = (): {
  useCase: AdminLoginStepTwoUseCase;
  userRepository: InMemoryUserRepository;
  mfaSecretRepository: InMemoryMfaSecretRepository;
  mfaChallengeRepository: InMemoryMfaChallengeRepository;
  refreshTokenRepository: InMemoryRefreshTokenRepository;
  totpService: FakeTotpService;
  challengeTokenHasher: SequentialRefreshTokenHasher;
  auditWriter: RecordingAuditWriter;
} => {
  const userRepository = new InMemoryUserRepository();
  const mfaSecretRepository = new InMemoryMfaSecretRepository();
  const mfaChallengeRepository = new InMemoryMfaChallengeRepository();
  const refreshTokenRepository = new InMemoryRefreshTokenRepository();
  const challengeTokenHasher = new SequentialRefreshTokenHasher();
  const totpService = new FakeTotpService(VALID_TOTP);
  const mfaSecretCipher = new FakeMfaSecretCipher();
  const auditWriter = new RecordingAuditWriter();
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
    adminIdleTimeoutMinutes: 30,
  });

  const useCase = new AdminLoginStepTwoUseCase({
    userRepository,
    mfaSecretRepository,
    mfaChallengeRepository,
    challengeTokenHasher,
    totpService,
    mfaSecretCipher,
    sessionIssuer,
    auditWriter,
    clock,
    logger: nullLogger,
  });

  return {
    useCase,
    userRepository,
    mfaSecretRepository,
    mfaChallengeRepository,
    refreshTokenRepository,
    totpService,
    challengeTokenHasher,
    auditWriter,
  };
};

let seq = 0;

/** Seeds an admin with a confirmed MFA secret and an active challenge for it — no HTTP or use-case path may create any of these. */
const seedAdminWithChallenge = async (
  userRepository: InMemoryUserRepository,
  mfaSecretRepository: InMemoryMfaSecretRepository,
  mfaChallengeRepository: InMemoryMfaChallengeRepository,
  options: { tokenHash?: string; now?: Date } = {},
): Promise<{ userId: ReturnType<typeof toUserId> }> => {
  seq += 1;
  const userId = toUserId(`00000000-0000-7000-8000-00000000${(3000 + seq).toString().slice(-4)}`);
  const admin = User.registerAdmin({
    id: userId,
    email: `admin-${seq}@leenmart.in`,
    passwordHash: PasswordHash.create('hashed:irrelevant-for-step-2'),
    role: Role.SUPER_ADMIN,
    now: NOW,
  });
  await userRepository.create(admin);

  const secret = MfaSecret.enroll({
    id: toMfaSecretId(`00000000-0000-7000-8000-00000000${(4000 + seq).toString().slice(-4)}`),
    userId,
    encryptedSecret: 'encrypted:the-plaintext-secret',
    now: NOW,
  }).confirm(NOW);
  await mfaSecretRepository.create(secret);

  const challenge = MfaChallenge.issue({
    id: toMfaChallengeId(`00000000-0000-7000-8000-00000000${(5000 + seq).toString().slice(-4)}`),
    userId,
    tokenHash: options.tokenHash ?? CHALLENGE_TOKEN_HASH,
    now: options.now ?? NOW,
  });
  await mfaChallengeRepository.create(challenge);

  return { userId };
};

describe('AdminLoginStepTwoUseCase', () => {
  it('issues a full session for a valid challenge and correct TOTP', async () => {
    const {
      useCase,
      userRepository,
      mfaSecretRepository,
      mfaChallengeRepository,
      refreshTokenRepository,
    } = setup();
    const { userId } = await seedAdminWithChallenge(
      userRepository,
      mfaSecretRepository,
      mfaChallengeRepository,
    );

    const session = await useCase.execute({
      mfaChallengeToken: CHALLENGE_TOKEN,
      totpCode: VALID_TOTP,
    });

    expect(session.user.id).toBe(userId);
    expect(session.accessToken).toBe('access-token');
    expect(session.refreshToken).toEqual(expect.any(String));
    const persistedSessions = await refreshTokenRepository.findByTokenHash(
      `hash:${session.refreshToken}`,
    );
    expect(persistedSessions).not.toBeNull();
  });

  it('consumes the challenge on success', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);

    await useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP });

    const challenge = await mfaChallengeRepository.findByTokenHash(CHALLENGE_TOKEN_HASH);
    expect(challenge?.isConsumed()).toBe(true);
  });

  it('cannot be replayed — a second call with the same token fails and issues no session', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);

    await useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP });

    await expect(
      useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('preserves the admin role in the issued session', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);

    const session = await useCase.execute({
      mfaChallengeToken: CHALLENGE_TOKEN,
      totpCode: VALID_TOTP,
    });

    expect(session.user.role).toBe(Role.SUPER_ADMIN);
  });

  it('wrong TOTP increments attempts, issues nothing, and fails uniformly', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);

    await expect(
      useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: '000000' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const challenge = await mfaChallengeRepository.findByTokenHash(CHALLENGE_TOKEN_HASH);
    expect(challenge?.attempts).toBe(1);
    expect(challenge?.isConsumed()).toBe(false);
  });

  it('the fifth failed attempt exhausts the challenge', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);

    for (let i = 0; i < MfaChallenge.MAX_ATTEMPTS; i += 1) {
      await expect(
        useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: '000000' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    }

    const challenge = await mfaChallengeRepository.findByTokenHash(CHALLENGE_TOKEN_HASH);
    expect(challenge?.hasExceededMaxAttempts()).toBe(true);

    // A correct code is now irrelevant — the challenge is dead.
    await expect(
      useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('an expired challenge is rejected without attempting TOTP verification', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository, totpService } =
      setup();
    await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository, {
      now: new Date('2025-01-01T00:00:00.000Z'), // 5-minute TTL long since elapsed by NOW
    });
    const verifySpy = vi.spyOn(totpService, 'verify');

    await expect(
      useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('a consumed challenge is rejected and issues no session', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);
    await useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP });

    await expect(
      useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('an unknown challenge token fails uniformly', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ mfaChallengeToken: 'never-issued', totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('a malformed challenge token fails uniformly, the same as unknown', async () => {
    const { useCase } = setup();

    await expect(
      useCase.execute({ mfaChallengeToken: '', totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('a malformed TOTP code fails uniformly, the same as a wrong code', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);

    await expect(
      useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: 'not-a-code' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects when the MFA secret is missing entirely', async () => {
    const { useCase, userRepository, mfaChallengeRepository } = setup();
    const userId = toUserId('00000000-0000-7000-8000-000000006001');
    await userRepository.create(
      User.registerAdmin({
        id: userId,
        email: 'no-secret@leenmart.in',
        passwordHash: PasswordHash.create('hashed:irrelevant-for-step-2'),
        role: Role.SUPER_ADMIN,
        now: NOW,
      }),
    );
    await mfaChallengeRepository.create(
      MfaChallenge.issue({
        id: toMfaChallengeId('00000000-0000-7000-8000-000000006002'),
        userId,
        tokenHash: CHALLENGE_TOKEN_HASH,
        now: NOW,
      }),
    );

    await expect(
      useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('rejects when the MFA secret exists but is unconfirmed', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    const userId = toUserId('00000000-0000-7000-8000-000000006003');
    await userRepository.create(
      User.registerAdmin({
        id: userId,
        email: 'unconfirmed@leenmart.in',
        passwordHash: PasswordHash.create('hashed:irrelevant-for-step-2'),
        role: Role.SUPER_ADMIN,
        now: NOW,
      }),
    );
    await mfaSecretRepository.create(
      MfaSecret.enroll({
        id: toMfaSecretId('00000000-0000-7000-8000-000000006004'),
        userId,
        encryptedSecret: 'encrypted:whatever',
        now: NOW,
      }),
    );
    await mfaChallengeRepository.create(
      MfaChallenge.issue({
        id: toMfaChallengeId('00000000-0000-7000-8000-000000006005'),
        userId,
        tokenHash: CHALLENGE_TOKEN_HASH,
        now: NOW,
      }),
    );

    await expect(
      useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('reports unknown challenge, expired challenge, and wrong TOTP identically', async () => {
    const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
    await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository, {
      tokenHash: 'hash:expired-token',
      now: new Date('2025-01-01T00:00:00.000Z'),
    });
    await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository, {
      tokenHash: 'hash:wrong-code-token',
    });

    const unknownError: unknown = await useCase
      .execute({ mfaChallengeToken: 'never-issued', totpCode: VALID_TOTP })
      .catch((error: unknown) => error);
    const expiredError: unknown = await useCase
      .execute({ mfaChallengeToken: 'expired-token', totpCode: VALID_TOTP })
      .catch((error: unknown) => error);
    const wrongCodeError: unknown = await useCase
      .execute({ mfaChallengeToken: 'wrong-code-token', totpCode: '000000' })
      .catch((error: unknown) => error);

    expect((unknownError as Error).message).toBe((expiredError as Error).message);
    expect((expiredError as Error).message).toBe((wrongCodeError as Error).message);
    expect((unknownError as InvalidCredentialsError).code).toBe(
      (wrongCodeError as InvalidCredentialsError).code,
    );
  });

  it('decrypts the MFA secret only transiently and never logs it', async () => {
    const { userRepository, mfaSecretRepository, mfaChallengeRepository, challengeTokenHasher } =
      setup();
    await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);
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
      refreshTokenRepository: new InMemoryRefreshTokenRepository(),
      idGenerator: new UuidV7Generator(),
      clock,
      refreshTtlDays: 30,
      adminIdleTimeoutMinutes: 30,
    });
    const useCase = new AdminLoginStepTwoUseCase({
      userRepository,
      mfaSecretRepository,
      mfaChallengeRepository,
      challengeTokenHasher,
      totpService: new FakeTotpService(VALID_TOTP),
      mfaSecretCipher: new FakeMfaSecretCipher(),
      sessionIssuer,
      auditWriter: new RecordingAuditWriter(),
      clock,
      logger: recordingLogger,
    });

    await useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP });

    const serialized = JSON.stringify(recordedCalls);
    expect(serialized).not.toContain('the-plaintext-secret');
    expect(serialized).not.toContain(VALID_TOTP);
  });
  describe('shut-out accounts (SDD 7.2)', () => {
    const suspendSeeded = async (
      userRepository: InMemoryUserRepository,
      userId: ReturnType<typeof toUserId>,
      status: UserStatus,
    ): Promise<void> => {
      const admin = await userRepository.findById(userId);
      if (!admin) throw new Error('seeded admin missing');
      await userRepository.update(
        User.reconstitute({
          id: admin.id,
          ...(admin.email === undefined ? {} : { email: admin.email }),
          ...(admin.passwordHash === undefined ? {} : { passwordHash: admin.passwordHash }),
          role: admin.role,
          status,
          createdAt: admin.createdAt,
          updatedAt: admin.updatedAt,
        }),
      );
    };

    it('refuses a suspended admin who supplied a correct TOTP', async () => {
      const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
      const { userId } = await seedAdminWithChallenge(
        userRepository,
        mfaSecretRepository,
        mfaChallengeRepository,
      );
      await suspendSeeded(userRepository, userId, UserStatus.SUSPENDED);

      await expect(
        useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
      ).rejects.toBeInstanceOf(AccountSuspendedError);
    });

    it('refuses a locked admin who supplied a correct TOTP', async () => {
      const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
      const { userId } = await seedAdminWithChallenge(
        userRepository,
        mfaSecretRepository,
        mfaChallengeRepository,
      );
      await suspendSeeded(userRepository, userId, UserStatus.LOCKED);

      await expect(
        useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
      ).rejects.toBeInstanceOf(AccountLockedError);
    });

    it('never reveals status to a caller with the wrong TOTP (SEC-15)', async () => {
      const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
      const { userId } = await seedAdminWithChallenge(
        userRepository,
        mfaSecretRepository,
        mfaChallengeRepository,
      );
      await suspendSeeded(userRepository, userId, UserStatus.SUSPENDED);

      await expect(
        useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: '000000' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });

    it('burns the challenge, so a suspended admin cannot replay it', async () => {
      const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository } = setup();
      const { userId } = await seedAdminWithChallenge(
        userRepository,
        mfaSecretRepository,
        mfaChallengeRepository,
      );
      await suspendSeeded(userRepository, userId, UserStatus.SUSPENDED);

      await expect(
        useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
      ).rejects.toBeInstanceOf(AccountSuspendedError);

      // Reinstating must not resurrect the already-consumed challenge.
      await suspendSeeded(userRepository, userId, UserStatus.ACTIVE);
      await expect(
        useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);
    });
  });

  describe('audit (SDD 18.4)', () => {
    it('records exactly one entry for a successful admin login', async () => {
      const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository, auditWriter } =
        setup();
      await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);

      await useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP });

      expect(auditWriter.entries).toHaveLength(1);
    });

    it('records the approved action, entity type, actor and entity id', async () => {
      const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository, auditWriter } =
        setup();
      const { userId } = await seedAdminWithChallenge(
        userRepository,
        mfaSecretRepository,
        mfaChallengeRepository,
      );

      await useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP });

      const [entry] = auditWriter.entries;
      expect(entry?.action).toBe('identity.admin.login');
      expect(entry?.entityType).toBe('User');
      expect(entry?.actorId).toBe(userId);
      expect(entry?.actorRole).toBe('SUPER_ADMIN');
      expect(entry?.entityId).toBe(userId);
    });

    it('records no credential material anywhere in the entry', async () => {
      const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository, auditWriter } =
        setup();
      await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);

      const session = await useCase.execute({
        mfaChallengeToken: CHALLENGE_TOKEN,
        totpCode: VALID_TOTP,
      });

      const serialised = JSON.stringify(auditWriter.entries);
      expect(serialised).not.toContain(CHALLENGE_TOKEN);
      expect(serialised).not.toContain(VALID_TOTP);
      expect(serialised).not.toContain(session.accessToken);
      expect(serialised).not.toContain(session.refreshToken);
      expect(serialised).not.toContain('the-plaintext-secret');
      expect(serialised).not.toContain('hashed:');
      expect(serialised).not.toContain('hash:');
    });

    it('leaves before/after/reason unset — a login changes no entity state', async () => {
      const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository, auditWriter } =
        setup();
      await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);

      await useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP });

      const [entry] = auditWriter.entries;
      expect(entry?.before).toBeUndefined();
      expect(entry?.after).toBeUndefined();
      expect(entry?.reason).toBeUndefined();
    });

    it('records nothing when the TOTP is wrong', async () => {
      const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository, auditWriter } =
        setup();
      await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);

      await expect(
        useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: '000000' }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);

      expect(auditWriter.entries).toHaveLength(0);
    });

    it('records nothing for an unknown challenge token', async () => {
      const { useCase, auditWriter } = setup();

      await expect(
        useCase.execute({ mfaChallengeToken: 'never-issued', totpCode: VALID_TOTP }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);

      expect(auditWriter.entries).toHaveLength(0);
    });

    it('records nothing when the admin has no confirmed MFA secret', async () => {
      const { useCase, userRepository, mfaChallengeRepository, auditWriter } = setup();
      const userId = toUserId('00000000-0000-7000-8000-000000008801');
      await userRepository.create(
        User.registerAdmin({
          id: userId,
          email: 'unenrolled@leenmart.in',
          passwordHash: PasswordHash.create('hashed:not-a-real-password-hash'),
          role: Role.SUPER_ADMIN,
          now: NOW,
        }),
      );
      await mfaChallengeRepository.create(
        MfaChallenge.issue({
          id: toMfaChallengeId('00000000-0000-7000-8000-000000008802'),
          userId,
          tokenHash: CHALLENGE_TOKEN_HASH,
          now: NOW,
        }),
      );

      await expect(
        useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);

      expect(auditWriter.entries).toHaveLength(0);
    });

    it('records nothing for a replayed challenge', async () => {
      const { useCase, userRepository, mfaSecretRepository, mfaChallengeRepository, auditWriter } =
        setup();
      await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);
      await useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP });

      await expect(
        useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
      ).rejects.toBeInstanceOf(InvalidCredentialsError);

      // Still just the one entry from the successful first call.
      expect(auditWriter.entries).toHaveLength(1);
    });

    it('fails the login and issues no session when the audit write fails', async () => {
      // SDD 18.4 makes the record legally significant; an administrator
      // session that no entry accounts for is the outcome this prevents.
      const {
        userRepository,
        mfaSecretRepository,
        mfaChallengeRepository,
        refreshTokenRepository,
      } = setup();
      await seedAdminWithChallenge(userRepository, mfaSecretRepository, mfaChallengeRepository);

      const failing = new AdminLoginStepTwoUseCase({
        userRepository,
        mfaSecretRepository,
        mfaChallengeRepository,
        challengeTokenHasher: new SequentialRefreshTokenHasher(),
        totpService: new FakeTotpService(VALID_TOTP),
        mfaSecretCipher: new FakeMfaSecretCipher(),
        sessionIssuer: new SessionIssuer({
          accessTokenService: new FakeAccessTokenService({
            token: 'access-token',
            expiresAt: new Date('2026-01-01T00:15:00.000Z'),
          }),
          refreshTokenHasher: new SequentialRefreshTokenHasher(),
          refreshTokenRepository,
          idGenerator: new UuidV7Generator(),
          clock: new FixedClock(NOW),
          refreshTtlDays: 30,
          adminIdleTimeoutMinutes: 30,
        }),
        auditWriter: new FailingAuditWriter(),
        clock: new FixedClock(NOW),
        logger: nullLogger,
      });

      await expect(
        failing.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP }),
      ).rejects.toThrow(/audit log unavailable/);

      expect(refreshTokenRepository.all()).toHaveLength(0);
    });
  });
});
