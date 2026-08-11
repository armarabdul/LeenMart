import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV4Generator } from '@leen-mart/domain-kit';
import { SessionIssuer } from '../../../../../src/modules/identity/application/services/session-issuer.service.js';
import { LogoutUseCase } from '../../../../../src/modules/identity/application/use-cases/logout.use-case.js';
import { RefreshSessionUseCase } from '../../../../../src/modules/identity/application/use-cases/refresh-session.use-case.js';
import { RegisterCustomerUseCase } from '../../../../../src/modules/identity/application/use-cases/register-customer.use-case.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import { RefreshToken } from '../../../../../src/modules/identity/domain/entities/refresh-token.entity.js';
import { Role } from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import { InvalidRefreshTokenError } from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
import {
  FakeAccessTokenService,
  FakePasswordHasher,
  InMemoryRefreshTokenRepository,
  InMemorySessionDenylist,
  FailingAuditWriter,
  RecordingAuditWriter,
  InMemoryUserRepository,
  SequentialRefreshTokenHasher,
  nullLogger,
} from './fakes.js';

/** Mirrors `JWT_ACCESS_TTL_SECONDS`; the bound every denylist entry must respect (SDD 7.2). */
const ACCESS_TOKEN_TTL_SECONDS = 600;

const setup = (): {
  registerUseCase: RegisterCustomerUseCase;
  refreshUseCase: RefreshSessionUseCase;
  logoutUseCase: LogoutUseCase;
  sessionDenylist: InMemorySessionDenylist;
  refreshTokenRepository: InMemoryRefreshTokenRepository;
  auditWriter: RecordingAuditWriter;
  userRepository: InMemoryUserRepository;
} => {
  const clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
  const idGenerator = new UuidV4Generator();
  const userRepository = new InMemoryUserRepository();
  const refreshTokenRepository = new InMemoryRefreshTokenRepository();
  const sessionDenylist = new InMemorySessionDenylist();
  const auditWriter = new RecordingAuditWriter();
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
    sessionDenylist,
    accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    clock,
    logger: nullLogger,
  });
  const logoutUseCase = new LogoutUseCase({
    userRepository,
    auditWriter,
    refreshTokenRepository,
    refreshTokenHasher,
    sessionDenylist,
    accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    clock,
    logger: nullLogger,
  });

  return {
    auditWriter,
    userRepository,
    registerUseCase,
    refreshUseCase,
    logoutUseCase,
    sessionDenylist,
    refreshTokenRepository,
  };
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

  describe('access-token revocation (SDD 7.2)', () => {
    it('denies the session, so its access token stops authenticating immediately', async () => {
      // Revoking the refresh row alone left the access token usable for the
      // rest of its life — this is the half of logout that closes that.
      const { registerUseCase, logoutUseCase, sessionDenylist } = setup();
      const session = await registerUseCase.execute({
        email: 'shopper@example.com',
        password: 'correct horse battery',
      });

      await logoutUseCase.execute({ refreshToken: session.refreshToken });

      expect(await sessionDenylist.isDenied(session.refreshTokenId)).toBe(true);
    });

    it('bounds the denylist entry by the access-token lifetime, never longer', async () => {
      const { registerUseCase, logoutUseCase, sessionDenylist } = setup();
      const session = await registerUseCase.execute({
        email: 'shopper@example.com',
        password: 'correct horse battery',
      });

      await logoutUseCase.execute({ refreshToken: session.refreshToken });

      // Past this point the token has expired on its own, so holding the
      // entry longer would pin dead sessions in Redis for no security gain.
      expect(sessionDenylist.denied.get(session.refreshTokenId)).toBe(ACCESS_TOKEN_TTL_SECONDS);
    });

    it('leaves another live session untouched', async () => {
      const { registerUseCase, logoutUseCase, sessionDenylist } = setup();
      const first = await registerUseCase.execute({
        email: 'shopper@example.com',
        password: 'correct horse battery',
      });
      const second = await registerUseCase.execute({
        email: 'other@example.com',
        password: 'correct horse battery',
      });

      await logoutUseCase.execute({ refreshToken: first.refreshToken });

      expect(await sessionDenylist.isDenied(second.refreshTokenId)).toBe(false);
    });

    it('denies nothing for an unknown token, so logout cannot be used to probe sessions', async () => {
      const { logoutUseCase, sessionDenylist } = setup();

      await logoutUseCase.execute({ refreshToken: 'never-issued' });

      expect(sessionDenylist.denied.size).toBe(0);
    });

    it('denies nothing extra when replaying a logout for an already-revoked token', async () => {
      const { registerUseCase, logoutUseCase, sessionDenylist } = setup();
      const session = await registerUseCase.execute({
        email: 'shopper@example.com',
        password: 'correct horse battery',
      });

      await logoutUseCase.execute({ refreshToken: session.refreshToken });
      await logoutUseCase.execute({ refreshToken: session.refreshToken });

      expect(sessionDenylist.denied.size).toBe(1);
    });
  });

  describe('admin audit (SDD 18.4)', () => {
    const NOW = new Date('2026-01-01T00:00:00.000Z');

    /** Seeds an admin and a live session for them, without going through login. */
    const seedAdminSession = async (
      userRepository: InMemoryUserRepository,
      refreshTokenRepository: InMemoryRefreshTokenRepository,
      role = Role.SUPER_ADMIN,
    ): Promise<{ userId: ReturnType<typeof toUserId>; rawToken: string }> => {
      const userId = toUserId('00000000-0000-7000-8000-000000007701');
      await userRepository.create(
        User.registerAdmin({
          id: userId,
          email: 'ops@leenmart.in',
          passwordHash: PasswordHash.create('hashed:not-a-real-password-hash'),
          role,
          now: NOW,
        }),
      );
      const rawToken = 'admin-raw-token';
      await refreshTokenRepository.create(
        RefreshToken.issue({
          id: toSessionId('00000000-0000-7000-8000-000000007702'),
          userId,
          tokenHash: `hash:${rawToken}`,
          expiresAt: new Date('2026-02-01T00:00:00.000Z'),
          now: NOW,
        }),
      );
      return { userId, rawToken };
    };

    it('records exactly one entry for a successful admin logout', async () => {
      const { logoutUseCase, userRepository, refreshTokenRepository, auditWriter } = setup();
      const { rawToken } = await seedAdminSession(userRepository, refreshTokenRepository);

      await logoutUseCase.execute({ refreshToken: rawToken });

      expect(auditWriter.entries).toHaveLength(1);
    });

    it('records the approved action, entity type, actor and entity id', async () => {
      const { logoutUseCase, userRepository, refreshTokenRepository, auditWriter } = setup();
      const { userId, rawToken } = await seedAdminSession(userRepository, refreshTokenRepository);

      await logoutUseCase.execute({ refreshToken: rawToken });

      const [entry] = auditWriter.entries;
      expect(entry?.action).toBe('identity.admin.logout');
      expect(entry?.entityType).toBe('User');
      expect(entry?.actorId).toBe(userId);
      expect(entry?.actorRole).toBe('SUPER_ADMIN');
      expect(entry?.entityId).toBe(userId);
    });

    it('records no token material anywhere in the entry', async () => {
      const { logoutUseCase, userRepository, refreshTokenRepository, auditWriter } = setup();
      const { rawToken } = await seedAdminSession(userRepository, refreshTokenRepository);

      await logoutUseCase.execute({ refreshToken: rawToken });

      const serialised = JSON.stringify(auditWriter.entries);
      expect(serialised).not.toContain(rawToken);
      expect(serialised).not.toContain('hash:');
      // The session id is deliberately omitted rather than carried as metadata.
      expect(serialised).not.toContain('00000000-0000-7000-8000-000000007702');
    });

    it('records nothing for a customer logout', async () => {
      // `/logout` is one endpoint shared by both audiences; only the
      // administrative half is audited.
      const { registerUseCase, logoutUseCase, auditWriter } = setup();
      const session = await registerUseCase.execute({
        email: 'shopper@example.com',
        password: 'correct horse battery',
      });

      await logoutUseCase.execute({ refreshToken: session.refreshToken });

      expect(auditWriter.entries).toHaveLength(0);
    });

    it('records nothing for an unknown refresh token', async () => {
      const { logoutUseCase, auditWriter } = setup();

      await logoutUseCase.execute({ refreshToken: 'never-issued' });

      expect(auditWriter.entries).toHaveLength(0);
    });

    it('records nothing when replaying a logout for an already-revoked session', async () => {
      const { logoutUseCase, userRepository, refreshTokenRepository, auditWriter } = setup();
      const { rawToken } = await seedAdminSession(userRepository, refreshTokenRepository);

      await logoutUseCase.execute({ refreshToken: rawToken });
      await logoutUseCase.execute({ refreshToken: rawToken });

      expect(auditWriter.entries).toHaveLength(1);
    });

    it('still revokes the session even though a failed audit write surfaces an error', async () => {
      // Logging out is the security-positive act; it happens first, so a
      // failure to record it cannot leave the session alive.
      const { userRepository, refreshTokenRepository, sessionDenylist } = setup();
      const { rawToken } = await seedAdminSession(userRepository, refreshTokenRepository);

      const failing = new LogoutUseCase({
        userRepository,
        refreshTokenRepository,
        refreshTokenHasher: new SequentialRefreshTokenHasher(),
        sessionDenylist,
        auditWriter: new FailingAuditWriter(),
        accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
        clock: new FixedClock(NOW),
        logger: nullLogger,
      });

      await expect(failing.execute({ refreshToken: rawToken })).rejects.toThrow(
        /audit log unavailable/,
      );

      const stored = await refreshTokenRepository.findByTokenHash(`hash:${rawToken}`);
      expect(stored?.isRevoked()).toBe(true);
    });
  });
});
