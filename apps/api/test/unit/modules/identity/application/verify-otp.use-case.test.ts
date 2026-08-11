import { describe, expect, it, vi } from 'vitest';
import { FixedClock, UuidV4Generator } from '@leen-mart/domain-kit';
import { VerifyOtpUseCase } from '../../../../../src/modules/identity/application/use-cases/verify-otp.use-case.js';
import { SessionIssuer } from '../../../../../src/modules/identity/application/services/session-issuer.service.js';
import { RequestOtpUseCase } from '../../../../../src/modules/identity/application/use-cases/request-otp.use-case.js';
import { PhoneNumber } from '../../../../../src/modules/identity/domain/value-objects/phone-number.value-object.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import { Otp } from '../../../../../src/modules/identity/domain/entities/otp.entity.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toOtpId } from '../../../../../src/modules/identity/domain/value-objects/otp-id.value-object.js';
import {
  ADMIN_ROLE_NAMES,
  Role,
} from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { UserStatus } from '../../../../../src/modules/identity/domain/value-objects/user-status.value-object.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import {
  ExpiredOtpError,
  InvalidOtpError,
} from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
import {
  FakeAccessTokenService,
  FakeOtpGenerator,
  FakeOtpHasher,
  InMemoryOtpRepository,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  SequentialRefreshTokenHasher,
  nullLogger,
} from './fakes.js';

const PHONE = '+919876543210';
const NOW = new Date('2026-01-01T00:00:00.000Z');

const setup = (): {
  verifyUseCase: VerifyOtpUseCase;
  requestUseCase: RequestOtpUseCase;
  userRepository: InMemoryUserRepository;
  otpRepository: InMemoryOtpRepository;
  otpHasher: FakeOtpHasher;
  refreshTokenRepository: InMemoryRefreshTokenRepository;
  clock: FixedClock;
} => {
  const clock = new FixedClock(NOW);
  const idGenerator = new UuidV4Generator();
  const userRepository = new InMemoryUserRepository();
  const otpRepository = new InMemoryOtpRepository();
  const otpGenerator = new FakeOtpGenerator(['004281']);
  const otpHasher = new FakeOtpHasher();
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

  const requestUseCase = new RequestOtpUseCase({
    userRepository,
    otpGenerator,
    otpHasher,
    otpRepository,
    idGenerator,
    clock,
    logger: nullLogger,
  });

  const verifyUseCase = new VerifyOtpUseCase({
    userRepository,
    otpHasher,
    otpRepository,
    sessionIssuer,
    clock,
    logger: nullLogger,
  });

  return {
    verifyUseCase,
    requestUseCase,
    userRepository,
    otpRepository,
    otpHasher,
    refreshTokenRepository,
    clock,
  };
};

describe('VerifyOtpUseCase', () => {
  it('verifies a valid OTP, consumes it, activates the user, and issues a session', async () => {
    const { verifyUseCase, requestUseCase, userRepository, otpRepository } = setup();
    await requestUseCase.execute({ phone: PHONE });

    const session = await verifyUseCase.execute({ phone: PHONE, code: '004281' });

    expect(session.accessToken).toBe('access-token');
    expect(session.user.status.name).toBe('ACTIVE');
    expect(session.user.phoneVerifiedAt).toEqual(NOW);

    const persistedUser = await userRepository.findByPhone(PhoneNumber.create(PHONE));
    expect(persistedUser?.status.name).toBe('ACTIVE');
    expect(persistedUser?.phoneVerifiedAt).toEqual(NOW);

    // The OTP is now consumed, so it's no longer "active" for this user.
    expect(await otpRepository.findActiveByUserId(persistedUser!.id)).toBeNull();
  });

  it('never returns the plaintext OTP', async () => {
    const { verifyUseCase, requestUseCase } = setup();
    await requestUseCase.execute({ phone: PHONE });

    const session = await verifyUseCase.execute({ phone: PHONE, code: '004281' });

    expect(JSON.stringify(session)).not.toContain('004281');
  });

  it('rejects a wrong code, records a failed attempt, and does not verify the user', async () => {
    const { verifyUseCase, requestUseCase, userRepository, otpRepository } = setup();
    await requestUseCase.execute({ phone: PHONE });

    await expect(verifyUseCase.execute({ phone: PHONE, code: '999999' })).rejects.toBeInstanceOf(
      InvalidOtpError,
    );

    const user = await userRepository.findByPhone(PhoneNumber.create(PHONE));
    expect(user?.status.name).toBe('PENDING');
    expect(user?.phoneVerifiedAt).toBeNull();

    const otp = await otpRepository.findActiveByUserId(user!.id);
    expect(otp?.attempts).toBe(1);
  });

  it('does not call UserRepository.update() when the code is wrong', async () => {
    const { verifyUseCase, requestUseCase, userRepository } = setup();
    await requestUseCase.execute({ phone: PHONE });
    const updateSpy = vi.spyOn(userRepository, 'update');

    await expect(verifyUseCase.execute({ phone: PHONE, code: '999999' })).rejects.toThrow();

    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('rejects an expired OTP without calling the hasher', async () => {
    const { verifyUseCase, userRepository, otpRepository, otpHasher, clock } = setup();
    const user = User.registerWithPhone({
      id: toUserId('00000000-0000-7000-8000-000000000040'),
      phone: PhoneNumber.create(PHONE),
      now: NOW,
    });
    await userRepository.create(user);
    const otp = Otp.issue({
      id: toOtpId('00000000-0000-7000-8000-000000000041'),
      userId: user.id,
      codeHash: 'hashed:004281',
      now: NOW,
    });
    await otpRepository.create(otp);
    clock.advanceMs(6 * 60_000); // past the 5-minute validity window
    const verifySpy = vi.spyOn(otpHasher, 'verify');

    await expect(verifyUseCase.execute({ phone: PHONE, code: '004281' })).rejects.toBeInstanceOf(
      ExpiredOtpError,
    );
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('rejects an already-consumed OTP without calling the hasher', async () => {
    const { verifyUseCase, requestUseCase, userRepository, otpRepository, otpHasher } = setup();
    await requestUseCase.execute({ phone: PHONE });
    const user = await userRepository.findByPhone(PhoneNumber.create(PHONE));
    const otp = await otpRepository.findActiveByUserId(user!.id);
    await otpRepository.update(otp!.consume(NOW));
    const verifySpy = vi.spyOn(otpHasher, 'verify');

    await expect(verifyUseCase.execute({ phone: PHONE, code: '004281' })).rejects.toBeInstanceOf(
      InvalidOtpError,
    );
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('rejects an OTP that has exhausted its attempts without calling the hasher', async () => {
    const { verifyUseCase, requestUseCase, userRepository, otpRepository, otpHasher } = setup();
    await requestUseCase.execute({ phone: PHONE });
    const user = await userRepository.findByPhone(PhoneNumber.create(PHONE));
    let otp = (await otpRepository.findActiveByUserId(user!.id))!;
    for (let i = 0; i < Otp.MAX_ATTEMPTS; i += 1) {
      otp = otp.recordFailedAttempt(NOW);
    }
    await otpRepository.update(otp);
    const verifySpy = vi.spyOn(otpHasher, 'verify');

    await expect(verifyUseCase.execute({ phone: PHONE, code: '004281' })).rejects.toBeInstanceOf(
      InvalidOtpError,
    );
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('rejects an unknown phone without touching the OTP repository', async () => {
    const { verifyUseCase, otpRepository } = setup();
    const findSpy = vi.spyOn(otpRepository, 'findActiveByUserId');

    await expect(
      verifyUseCase.execute({ phone: '+919000000000', code: '004281' }),
    ).rejects.toBeInstanceOf(InvalidOtpError);
    expect(findSpy).not.toHaveBeenCalled();
  });

  describe('admin accounts (SDD 7.1)', () => {
    const ADMIN_PHONE = '+919812345678';

    /**
     * Seeds an admin that also holds a phone number.
     *
     * No production path can currently produce this: `User.registerWithPhone`
     * is the only thing that sets a phone and it hardcases `Role.CUSTOMER`.
     * The state is constructed directly here precisely because the guard under
     * test exists for the day a phone-change flow (FR-07) makes it reachable.
     */
    const seedAdminWithPhone = async (
      userRepository: InMemoryUserRepository,
      otpRepository: InMemoryOtpRepository,
      options: { withActiveOtp?: boolean } = {},
    ): Promise<ReturnType<typeof toUserId>> => {
      const userId = toUserId('00000000-0000-7000-8000-00000000a101');
      await userRepository.create(
        User.reconstitute({
          id: userId,
          email: 'ops@leenmart.in',
          phone: PhoneNumber.create(ADMIN_PHONE),
          phoneVerifiedAt: null,
          passwordHash: PasswordHash.create('hashed:not-a-real-password-hash'),
          role: Role.SUPER_ADMIN,
          status: UserStatus.ACTIVE,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );

      if (options.withActiveOtp !== false) {
        await otpRepository.create(
          Otp.issue({
            id: toOtpId('00000000-0000-7000-8000-00000000a102'),
            userId,
            codeHash: 'hashed:004281',
            now: NOW,
          }),
        );
      }

      return userId;
    };

    it('refuses an admin holding a valid OTP', async () => {
      const { verifyUseCase, userRepository, otpRepository } = setup();
      await seedAdminWithPhone(userRepository, otpRepository);

      await expect(
        verifyUseCase.execute({ phone: ADMIN_PHONE, code: '004281' }),
      ).rejects.toBeInstanceOf(InvalidOtpError);
    });

    it('issues no session, access token or refresh token for a refused admin', async () => {
      const { verifyUseCase, userRepository, otpRepository, refreshTokenRepository } = setup();
      await seedAdminWithPhone(userRepository, otpRepository);
      const issueSession = vi.spyOn(refreshTokenRepository, 'create');

      await expect(
        verifyUseCase.execute({ phone: ADMIN_PHONE, code: '004281' }),
      ).rejects.toBeInstanceOf(InvalidOtpError);

      expect(issueSession).not.toHaveBeenCalled();
      expect(refreshTokenRepository.all()).toHaveLength(0);
    });

    it('answers identically whether the admin supplied a right or wrong code (SEC-15)', async () => {
      // The rejection must not identify the account. Both calls produce the
      // same error, code and status as every other failure on this endpoint.
      const { verifyUseCase, userRepository, otpRepository } = setup();
      await seedAdminWithPhone(userRepository, otpRepository);

      const right: unknown = await verifyUseCase
        .execute({ phone: ADMIN_PHONE, code: '004281' })
        .catch((error: unknown) => error);
      const wrong: unknown = await verifyUseCase
        .execute({ phone: ADMIN_PHONE, code: '999999' })
        .catch((error: unknown) => error);

      expect(right).toBeInstanceOf(InvalidOtpError);
      expect(wrong).toBeInstanceOf(InvalidOtpError);
      expect((right as InvalidOtpError).code).toBe((wrong as InvalidOtpError).code);
      expect((right as InvalidOtpError).message).toBe((wrong as InvalidOtpError).message);
    });

    it('is indistinguishable from an unknown phone number (SEC-15)', async () => {
      // The property that actually matters: an attacker submitting phone
      // numbers cannot tell an administrator's from one that does not exist.
      const { verifyUseCase, userRepository, otpRepository } = setup();
      await seedAdminWithPhone(userRepository, otpRepository);

      const adminError: unknown = await verifyUseCase
        .execute({ phone: ADMIN_PHONE, code: '004281' })
        .catch((error: unknown) => error);
      const unknownError: unknown = await verifyUseCase
        .execute({ phone: '+919000000001', code: '004281' })
        .catch((error: unknown) => error);

      expect((adminError as InvalidOtpError).code).toBe((unknownError as InvalidOtpError).code);
      expect((adminError as InvalidOtpError).kind).toBe((unknownError as InvalidOtpError).kind);
      expect((adminError as InvalidOtpError).message).toBe(
        (unknownError as InvalidOtpError).message,
      );
    });

    it('leaves the admin OTP unconsumed and its attempt count untouched', async () => {
      // The guard runs before the OTP is read, so this endpoint cannot be used
      // to burn an administrator's OTP or drive it to its attempt ceiling.
      const { verifyUseCase, userRepository, otpRepository } = setup();
      const userId = await seedAdminWithPhone(userRepository, otpRepository);

      await expect(
        verifyUseCase.execute({ phone: ADMIN_PHONE, code: '004281' }),
      ).rejects.toBeInstanceOf(InvalidOtpError);

      const otp = await otpRepository.findActiveByUserId(userId);
      expect(otp).not.toBeNull();
      expect(otp?.isConsumed()).toBe(false);
      expect(otp?.attempts).toBe(0);
    });

    it('refuses an admin even when no OTP was ever issued for them', async () => {
      const { verifyUseCase, userRepository, otpRepository } = setup();
      await seedAdminWithPhone(userRepository, otpRepository, { withActiveOtp: false });

      await expect(
        verifyUseCase.execute({ phone: ADMIN_PHONE, code: '004281' }),
      ).rejects.toBeInstanceOf(InvalidOtpError);
    });

    it.each(ADMIN_ROLE_NAMES)('refuses a %s', async (roleName) => {
      const { verifyUseCase, userRepository, otpRepository } = setup();
      const userId = toUserId('00000000-0000-7000-8000-00000000a201');
      await userRepository.create(
        User.reconstitute({
          id: userId,
          email: `${roleName.toLowerCase()}@leenmart.in`,
          phone: PhoneNumber.create(ADMIN_PHONE),
          phoneVerifiedAt: null,
          passwordHash: PasswordHash.create('hashed:not-a-real-password-hash'),
          role: Role.fromName(roleName),
          status: UserStatus.ACTIVE,
          createdAt: NOW,
          updatedAt: NOW,
        }),
      );
      await otpRepository.create(
        Otp.issue({
          id: toOtpId('00000000-0000-7000-8000-00000000a202'),
          userId,
          codeHash: 'hashed:004281',
          now: NOW,
        }),
      );

      await expect(
        verifyUseCase.execute({ phone: ADMIN_PHONE, code: '004281' }),
      ).rejects.toBeInstanceOf(InvalidOtpError);
    });

    it('leaves the ordinary customer path completely unchanged', async () => {
      const { verifyUseCase, requestUseCase, userRepository } = setup();
      await requestUseCase.execute({ phone: PHONE });

      const session = await verifyUseCase.execute({ phone: PHONE, code: '004281' });

      expect(session.accessToken).toBe('access-token');
      expect(session.user.status.name).toBe('ACTIVE');
      expect(session.user.phoneVerifiedAt).toEqual(NOW);
      const persisted = await userRepository.findByPhone(PhoneNumber.create(PHONE));
      expect(persisted?.role.name).toBe('CUSTOMER');
    });

    it('never logs the submitted OTP code when refusing an admin', async () => {
      const recorded: unknown[] = [];
      const recordingLogger = {
        ...nullLogger,
        warn: (...args: unknown[]) => recorded.push(args),
        info: (...args: unknown[]) => recorded.push(args),
        child: () => recordingLogger,
      } as unknown as typeof nullLogger;

      const { userRepository, otpRepository } = setup();
      await seedAdminWithPhone(userRepository, otpRepository);
      const useCase = new VerifyOtpUseCase({
        userRepository,
        otpHasher: new FakeOtpHasher(),
        otpRepository,
        sessionIssuer: new SessionIssuer({
          accessTokenService: new FakeAccessTokenService({
            token: 'access-token',
            expiresAt: new Date('2026-01-01T00:15:00.000Z'),
          }),
          refreshTokenHasher: new SequentialRefreshTokenHasher(),
          refreshTokenRepository: new InMemoryRefreshTokenRepository(),
          idGenerator: new UuidV4Generator(),
          clock: new FixedClock(NOW),
          refreshTtlDays: 30,
          adminIdleTimeoutMinutes: 30,
        }),
        clock: new FixedClock(NOW),
        logger: recordingLogger,
      });

      await expect(useCase.execute({ phone: ADMIN_PHONE, code: '004281' })).rejects.toBeInstanceOf(
        InvalidOtpError,
      );

      const serialised = JSON.stringify(recorded);
      expect(serialised).not.toContain('004281');
      expect(serialised).not.toContain('hashed:');
    });
  });
});
