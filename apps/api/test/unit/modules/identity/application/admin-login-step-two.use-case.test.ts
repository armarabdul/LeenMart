import { describe, expect, it, vi } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { AdminLoginStepTwoUseCase } from '../../../../../src/modules/identity/application/use-cases/admin-login-step-two.use-case.js';
import { InvalidCredentialsError } from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import { MfaSecret } from '../../../../../src/modules/identity/domain/entities/mfa-secret.entity.js';
import { MfaChallenge } from '../../../../../src/modules/identity/domain/entities/mfa-challenge.entity.js';
import { Role } from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
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
} => {
  const userRepository = new InMemoryUserRepository();
  const mfaSecretRepository = new InMemoryMfaSecretRepository();
  const mfaChallengeRepository = new InMemoryMfaChallengeRepository();
  const refreshTokenRepository = new InMemoryRefreshTokenRepository();
  const challengeTokenHasher = new SequentialRefreshTokenHasher();
  const totpService = new FakeTotpService(VALID_TOTP);
  const mfaSecretCipher = new FakeMfaSecretCipher();
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

  const useCase = new AdminLoginStepTwoUseCase({
    userRepository,
    mfaSecretRepository,
    mfaChallengeRepository,
    challengeTokenHasher,
    totpService,
    mfaSecretCipher,
    sessionIssuer,
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
    });
    const useCase = new AdminLoginStepTwoUseCase({
      userRepository,
      mfaSecretRepository,
      mfaChallengeRepository,
      challengeTokenHasher,
      totpService: new FakeTotpService(VALID_TOTP),
      mfaSecretCipher: new FakeMfaSecretCipher(),
      sessionIssuer,
      clock,
      logger: recordingLogger,
    });

    await useCase.execute({ mfaChallengeToken: CHALLENGE_TOKEN, totpCode: VALID_TOTP });

    const serialized = JSON.stringify(recordedCalls);
    expect(serialized).not.toContain('the-plaintext-secret');
    expect(serialized).not.toContain(VALID_TOTP);
  });
});
