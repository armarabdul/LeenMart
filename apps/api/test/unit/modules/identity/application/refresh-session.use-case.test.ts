import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV4Generator } from '@leen-mart/domain-kit';
import { SessionIssuer } from '../../../../../src/modules/identity/application/services/session-issuer.service.js';
import { LogoutUseCase } from '../../../../../src/modules/identity/application/use-cases/logout.use-case.js';
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
  logoutUseCase: LogoutUseCase;
  refreshTokenRepository: InMemoryRefreshTokenRepository;
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
  const logoutUseCase = new LogoutUseCase({
    refreshTokenRepository,
    refreshTokenHasher,
    clock,
    logger: nullLogger,
  });

  return { registerUseCase, refreshUseCase, logoutUseCase, refreshTokenRepository, clock };
};

/** How many of the stored sessions are still usable — the blast radius assertions read this. */
const liveCount = (repository: InMemoryRefreshTokenRepository, now: Date): number =>
  repository.all().filter((token) => token.isActive(now)).length;

describe('RefreshSessionUseCase', () => {
  it('rotates: exchanges a valid token for a new pair', async () => {
    const { registerUseCase, refreshUseCase } = setup();
    const initial = await registerUseCase.execute({
      email: 'shopper@example.com',
      password: 'correct horse battery',
    });

    const rotated = await refreshUseCase.execute({ refreshToken: initial.refreshToken });

    expect(rotated.refreshToken).not.toBe(initial.refreshToken);
    expect(rotated.user.email).toBe('shopper@example.com');
  });

  it('rejects reuse of an already-rotated token', async () => {
    const { registerUseCase, refreshUseCase } = setup();
    const initial = await registerUseCase.execute({
      email: 'shopper@example.com',
      password: 'correct horse battery',
    });
    await refreshUseCase.execute({ refreshToken: initial.refreshToken });

    await expect(
      refreshUseCase.execute({ refreshToken: initial.refreshToken }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects a token that was never issued', async () => {
    const { refreshUseCase } = setup();

    await expect(refreshUseCase.execute({ refreshToken: 'never-issued' })).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });

  it('rejects an expired token', async () => {
    const { registerUseCase, refreshUseCase, clock } = setup();
    const initial = await registerUseCase.execute({
      email: 'shopper@example.com',
      password: 'correct horse battery',
    });

    clock.advanceMs(31 * DAY_MS); // past the 30-day TTL used in setup()

    await expect(
      refreshUseCase.execute({ refreshToken: initial.refreshToken }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  describe('session family (SDD 7.2)', () => {
    const register = async (
      registerUseCase: RegisterCustomerUseCase,
      email = 'shopper@example.com',
    ): ReturnType<RegisterCustomerUseCase['execute']> =>
      registerUseCase.execute({ email, password: 'correct horse battery' });

    it('keeps the same family across a rotation', async () => {
      const { registerUseCase, refreshUseCase } = setup();
      const initial = await register(registerUseCase);

      const rotated = await refreshUseCase.execute({ refreshToken: initial.refreshToken });

      expect(rotated.refreshTokenFamilyId).toBe(initial.refreshTokenFamilyId);
      expect(rotated.refreshTokenId).not.toBe(initial.refreshTokenId);
    });

    it('keeps the same family across many rotations', async () => {
      const { registerUseCase, refreshUseCase } = setup();
      const initial = await register(registerUseCase);

      let current = initial;
      for (let i = 0; i < 4; i += 1) {
        current = await refreshUseCase.execute({ refreshToken: current.refreshToken });
      }

      expect(current.refreshTokenFamilyId).toBe(initial.refreshTokenFamilyId);
    });

    it('revokes the entire family when a rotated-away token is replayed', async () => {
      const { registerUseCase, refreshUseCase, refreshTokenRepository, clock } = setup();
      const initial = await register(registerUseCase);
      const live = await refreshUseCase.execute({ refreshToken: initial.refreshToken });

      expect(liveCount(refreshTokenRepository, clock.now())).toBe(1);

      await expect(
        refreshUseCase.execute({ refreshToken: initial.refreshToken }),
      ).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // The thief's still-live descendant is now dead: this is the whole point.
      expect(liveCount(refreshTokenRepository, clock.now())).toBe(0);
      await expect(
        refreshUseCase.execute({ refreshToken: live.refreshToken }),
      ).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    });

    it('revokes descendants many rotations after the stolen token', async () => {
      const { registerUseCase, refreshUseCase, refreshTokenRepository, clock } = setup();
      const initial = await register(registerUseCase);

      let current = initial;
      for (let i = 0; i < 4; i += 1) {
        current = await refreshUseCase.execute({ refreshToken: current.refreshToken });
      }

      await expect(
        refreshUseCase.execute({ refreshToken: initial.refreshToken }),
      ).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      expect(liveCount(refreshTokenRepository, clock.now())).toBe(0);
      await expect(
        refreshUseCase.execute({ refreshToken: current.refreshToken }),
      ).rejects.toBeInstanceOf(InvalidRefreshTokenError);
    });

    it('still answers a replay with the same InvalidRefreshTokenError, revealing nothing', async () => {
      const { registerUseCase, refreshUseCase } = setup();
      const initial = await register(registerUseCase);
      await refreshUseCase.execute({ refreshToken: initial.refreshToken });

      const replay = await refreshUseCase
        .execute({ refreshToken: initial.refreshToken })
        .catch((error: unknown) => error);
      const unknownToken = await refreshUseCase
        .execute({ refreshToken: 'never-issued' })
        .catch((error: unknown) => error);

      expect(replay).toBeInstanceOf(InvalidRefreshTokenError);
      expect(unknownToken).toBeInstanceOf(InvalidRefreshTokenError);
      expect((replay as InvalidRefreshTokenError).code).toBe(
        (unknownToken as InvalidRefreshTokenError).code,
      );
      expect((replay as InvalidRefreshTokenError).message).toBe(
        (unknownToken as InvalidRefreshTokenError).message,
      );
    });

    it('does not revoke the family for an ordinary expired token', async () => {
      const { registerUseCase, refreshUseCase, refreshTokenRepository, clock } = setup();
      await register(registerUseCase);
      const other = await register(registerUseCase, 'second@example.com');

      clock.advanceMs(31 * DAY_MS);

      await expect(
        refreshUseCase.execute({ refreshToken: other.refreshToken }),
      ).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // Nothing was revoked — both sessions are merely expired, and an expiry
      // is not evidence of theft.
      expect(refreshTokenRepository.all().every((token) => !token.isRevoked())).toBe(true);
    });

    it('does not revoke the family for a logout-revoked token', async () => {
      const { registerUseCase, refreshUseCase, logoutUseCase, refreshTokenRepository, clock } =
        setup();
      const initial = await register(registerUseCase);
      const rotated = await refreshUseCase.execute({ refreshToken: initial.refreshToken });

      // Log the live session out, then retry with it like a stale client would.
      await logoutUseCase.execute({ refreshToken: rotated.refreshToken });
      const revokedBefore = refreshTokenRepository.all().filter((t) => t.isRevoked()).length;

      await expect(
        refreshUseCase.execute({ refreshToken: rotated.refreshToken }),
      ).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // No extra revocation was triggered: a logged-out token has no
      // replacement, so it is a stale client rather than a stolen token.
      expect(refreshTokenRepository.all().filter((t) => t.isRevoked()).length).toBe(revokedBefore);
      expect(liveCount(refreshTokenRepository, clock.now())).toBe(0);
    });

    it('leaves a separate login untouched when another family is compromised', async () => {
      const { registerUseCase, refreshUseCase, clock } = setup();
      const deviceA = await register(registerUseCase);
      const deviceB = await register(registerUseCase, 'second@example.com');

      expect(deviceB.refreshTokenFamilyId).not.toBe(deviceA.refreshTokenFamilyId);

      const deviceALive = await refreshUseCase.execute({ refreshToken: deviceA.refreshToken });
      await expect(
        refreshUseCase.execute({ refreshToken: deviceA.refreshToken }),
      ).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // Device A's family is gone...
      await expect(
        refreshUseCase.execute({ refreshToken: deviceALive.refreshToken }),
      ).rejects.toBeInstanceOf(InvalidRefreshTokenError);

      // ...while device B keeps working. SDD 7.2 revokes a family, not a user:
      // user-wide sign-out belongs to suspension and "log out all devices".
      const deviceBRotated = await refreshUseCase.execute({ refreshToken: deviceB.refreshToken });
      expect(deviceBRotated.refreshTokenFamilyId).toBe(deviceB.refreshTokenFamilyId);
      expect(deviceBRotated.user.email).toBe('second@example.com');
      expect(clock.now()).toBeInstanceOf(Date);
    });
  });
});
