import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { OTP } from 'otplib';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { createApp } from '../../src/app.js';
import { type Container, createContainer } from '../../src/container.js';
import { Argon2PasswordHasher } from '../../src/modules/identity/infrastructure/security/argon2-password-hasher.js';
import { AesGcmMfaSecretCipher } from '../../src/modules/identity/infrastructure/security/aes-gcm-mfa-secret-cipher.service.js';
import { OtplibTotpService } from '../../src/modules/identity/infrastructure/security/otplib-totp.service.js';
import { PrismaUserRepository } from '../../src/modules/identity/infrastructure/persistence/prisma-user.repository.js';
import { PrismaMfaSecretRepository } from '../../src/modules/identity/infrastructure/persistence/prisma-mfa-secret.repository.js';
import { User } from '../../src/modules/identity/domain/entities/user.entity.js';
import { MfaSecret } from '../../src/modules/identity/domain/entities/mfa-secret.entity.js';
import { Role } from '../../src/modules/identity/domain/value-objects/role.value-object.js';
import { toUserId } from '../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toMfaSecretId } from '../../src/modules/identity/domain/value-objects/mfa-secret-id.value-object.js';

interface StepOneBody {
  data: { mfaChallengeToken: string; mfaChallengeTokenExpiresAt: string };
}

interface StepTwoBody {
  data: {
    user: { id: string; role: string };
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
  };
}

interface ErrorBody {
  error: { code: string; message: string };
}

interface MeBody {
  data: { id: string; role: string };
}

interface EnrollBody {
  data: { secret: string; otpauthUri: string };
}

const EMAIL_PREFIX = 'admin-auth-integration-';
const ADMIN_PASSWORD = 'an-administrator-password';

const uniqueEmail = (label: string): string =>
  `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

const adminLoginStepOne = (app: Express, email: string, password: string): request.Test =>
  request(app).post('/api/v1/admin/login').send({ email, password });

const adminMfaVerify = (app: Express, mfaChallengeToken: string, totpCode: string): request.Test =>
  request(app).post('/api/v1/admin/mfa/verify').send({ mfaChallengeToken, totpCode });

const adminMfaEnroll = (app: Express, email: string, password: string): request.Test =>
  request(app).post('/api/v1/admin/mfa/enroll').send({ email, password });

const adminMfaEnrollConfirm = (
  app: Express,
  email: string,
  password: string,
  totpCode: string,
): request.Test =>
  request(app).post('/api/v1/admin/mfa/enroll/confirm').send({ email, password, totpCode });

/** Generates a real, currently-valid TOTP code for a secret, independently of the app's own `TotpService`. */
const currentTotpCode = async (base32Secret: string): Promise<string> => {
  const otp = new OTP({ strategy: 'totp' });
  return otp.generate({
    secret: base32Secret,
    algorithm: 'sha1',
    digits: 6,
    period: 30,
    epoch: Math.floor(Date.now() / 1000),
  });
};

/**
 * Integration test against real PostgreSQL, same conventions as
 * `identity.test.ts`. Fixtures that need a *confirmed* MFA secret for step
 * 1/step 2 tests are still seeded directly through the repositories
 * (mirroring `bootstrap-admin.use-case.test.ts`'s direct-seed convention),
 * since that's the smallest way to set up those tests' preconditions; the
 * enrollment describe block below exercises the real HTTP enroll → confirm
 * path end to end instead.
 */
describe('admin auth endpoints', () => {
  let container: Container;
  let app: Express;
  let userRepository: PrismaUserRepository;
  let mfaSecretRepository: PrismaMfaSecretRepository;
  let passwordHasher: Argon2PasswordHasher;
  let mfaSecretCipher: AesGcmMfaSecretCipher;
  let idGenerator: UuidV7Generator;
  let clock: FixedClock;

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
    userRepository = new PrismaUserRepository(container.prisma);
    mfaSecretRepository = new PrismaMfaSecretRepository(container.prisma);
    passwordHasher = new Argon2PasswordHasher();
    mfaSecretCipher = new AesGcmMfaSecretCipher(
      Buffer.from(container.env.MFA_ENCRYPTION_KEY, 'hex'),
    );
    idGenerator = new UuidV7Generator();
    clock = new FixedClock(new Date('2026-01-01T00:00:00.000Z'));
  });

  afterAll(async () => {
    await container.prisma.mfaChallenge.deleteMany({
      where: { user: { email: { contains: EMAIL_PREFIX } } },
    });
    await container.prisma.mfaSecret.deleteMany({
      where: { user: { email: { contains: EMAIL_PREFIX } } },
    });
    await container.prisma.user.deleteMany({ where: { email: { contains: EMAIL_PREFIX } } });
    await container.dispose();
  });

  const seedEnrolledAdmin = async (label: string): Promise<string> => {
    const email = uniqueEmail(label);
    const passwordHash = await passwordHasher.hash(ADMIN_PASSWORD);
    const admin = User.registerAdmin({
      id: toUserId(idGenerator.generate()),
      email,
      passwordHash,
      role: Role.SUPER_ADMIN,
      now: clock.now(),
    });
    await userRepository.create(admin);

    const secret = MfaSecret.enroll({
      id: toMfaSecretId(idGenerator.generate()),
      userId: admin.id,
      encryptedSecret: 'ciphertext:not-a-real-secret',
      now: clock.now(),
    }).confirm(clock.now());
    await mfaSecretRepository.create(secret);

    return email;
  };

  const seedUnenrolledAdmin = async (label: string): Promise<string> => {
    const email = uniqueEmail(label);
    const passwordHash = await passwordHasher.hash(ADMIN_PASSWORD);
    const admin = User.registerAdmin({
      id: toUserId(idGenerator.generate()),
      email,
      passwordHash,
      role: Role.SUPER_ADMIN,
      now: clock.now(),
    });
    await userRepository.create(admin);
    return email;
  };

  /** Seeds an admin with a real, known base32 secret so tests can compute genuinely correct TOTP codes. */
  const seedEnrolledAdminWithKnownSecret = async (
    label: string,
  ): Promise<{ email: string; secret: string }> => {
    const email = uniqueEmail(label);
    const passwordHash = await passwordHasher.hash(ADMIN_PASSWORD);
    const admin = User.registerAdmin({
      id: toUserId(idGenerator.generate()),
      email,
      passwordHash,
      role: Role.SUPER_ADMIN,
      now: clock.now(),
    });
    await userRepository.create(admin);

    const secret = new OtplibTotpService().generateSecret();
    const mfaSecret = MfaSecret.enroll({
      id: toMfaSecretId(idGenerator.generate()),
      userId: admin.id,
      encryptedSecret: mfaSecretCipher.encrypt(secret),
      now: clock.now(),
    }).confirm(clock.now());
    await mfaSecretRepository.create(mfaSecret);

    return { email, secret };
  };

  it('returns a 200 envelope with an opaque MFA challenge for correct admin credentials', async () => {
    const email = await seedEnrolledAdmin('success');

    const response = await adminLoginStepOne(app, email, ADMIN_PASSWORD).expect(200);

    const body = response.body as StepOneBody;
    expect(body.data.mfaChallengeToken).toEqual(expect.any(String));
    expect(body.data.mfaChallengeToken.length).toBeGreaterThan(0);
    expect(new Date(body.data.mfaChallengeTokenExpiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(response.body).not.toHaveProperty('data.accessToken');
    expect(response.body).not.toHaveProperty('data.refreshToken');
  });

  it('persists the MFA challenge, findable only by its hash — the raw token is never stored', async () => {
    const email = await seedEnrolledAdmin('persisted');

    const response = await adminLoginStepOne(app, email, ADMIN_PASSWORD).expect(200);
    const { mfaChallengeToken } = (response.body as StepOneBody).data;

    const rows = await container.prisma.mfaChallenge.findMany({
      where: { user: { email } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).not.toBe(mfaChallengeToken);
    expect(rows[0]?.consumedAt).toBeNull();
    expect(rows[0]?.attempts).toBe(0);
  });

  it('does not create a refresh token / session row', async () => {
    const email = await seedEnrolledAdmin('no-session');
    const admin = await userRepository.findByEmail(email);
    if (!admin) throw new Error('fixture admin was not persisted');

    await adminLoginStepOne(app, email, ADMIN_PASSWORD).expect(200);

    const sessions = await container.prisma.refreshToken.findMany({
      where: { userId: admin.id },
    });
    expect(sessions).toHaveLength(0);
  });

  it('rejects an unknown email and a wrong password identically', async () => {
    const email = await seedEnrolledAdmin('uniform');

    const unknown = await adminLoginStepOne(app, 'ghost@leenmart.in', 'whatever').expect(401);
    const wrongPassword = await adminLoginStepOne(app, email, 'wrong-password').expect(401);

    expect((unknown.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
    expect((unknown.body as ErrorBody).error.code).toBe(
      (wrongPassword.body as ErrorBody).error.code,
    );
    expect((unknown.body as ErrorBody).error.message).toBe(
      (wrongPassword.body as ErrorBody).error.message,
    );
  });

  it('rejects an admin with no confirmed MFA secret, identically to an unknown email', async () => {
    const unenrolledEmail = await seedUnenrolledAdmin('unenrolled');

    const unenrolled = await adminLoginStepOne(app, unenrolledEmail, ADMIN_PASSWORD).expect(401);
    const unknown = await adminLoginStepOne(app, 'ghost2@leenmart.in', 'whatever').expect(401);

    expect((unenrolled.body as ErrorBody).error.code).toBe((unknown.body as ErrorBody).error.code);
  });

  it('rejects a customer account', async () => {
    const email = uniqueEmail('customer');
    const passwordHash = await passwordHasher.hash(ADMIN_PASSWORD);
    await userRepository.create(
      User.register({
        id: toUserId(idGenerator.generate()),
        email,
        passwordHash,
        now: clock.now(),
      }),
    );

    const response = await adminLoginStepOne(app, email, ADMIN_PASSWORD).expect(401);
    expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a request missing the password field with the validation envelope', async () => {
    const response = await request(app)
      .post('/api/v1/admin/login')
      .send({ email: 'someone@leenmart.in' })
      .expect(400);

    expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
  });

  it('is mounted under /api/v1/admin, not /api/v1/identity', async () => {
    await request(app)
      .post('/api/v1/identity/admin-login')
      .send({ email: 'x@example.com', password: 'x' })
      .expect(404);
  });

  describe('POST /api/v1/admin/mfa/verify (step 2)', () => {
    it('completes the full step 1 + step 2 flow: correct challenge + correct TOTP issues a working session', async () => {
      const { email, secret } = await seedEnrolledAdminWithKnownSecret('step2-success');
      const stepOne = await adminLoginStepOne(app, email, ADMIN_PASSWORD).expect(200);
      const { mfaChallengeToken } = (stepOne.body as StepOneBody).data;
      const totpCode = await currentTotpCode(secret);

      const response = await adminMfaVerify(app, mfaChallengeToken, totpCode).expect(200);

      const body = response.body as StepTwoBody;
      expect(body.data.user.role).toBe('SUPER_ADMIN');
      expect(body.data.accessToken).toEqual(expect.any(String));
      expect(body.data.refreshToken).toEqual(expect.any(String));

      // The access token isn't just present — it actually verifies, via the
      // same middleware every other authenticated route already uses.
      const me = await request(app)
        .get('/api/v1/identity/me')
        .set('Authorization', `Bearer ${body.data.accessToken}`)
        .expect(200);
      expect((me.body as MeBody).data.role).toBe('SUPER_ADMIN');
    });

    it('consumes the challenge and persists exactly one session', async () => {
      const { email, secret } = await seedEnrolledAdminWithKnownSecret('step2-consume');
      const stepOne = await adminLoginStepOne(app, email, ADMIN_PASSWORD).expect(200);
      const { mfaChallengeToken } = (stepOne.body as StepOneBody).data;
      const totpCode = await currentTotpCode(secret);

      await adminMfaVerify(app, mfaChallengeToken, totpCode).expect(200);

      const admin = await userRepository.findByEmail(email);
      if (!admin) throw new Error('fixture admin was not persisted');
      const challenges = await container.prisma.mfaChallenge.findMany({
        where: { userId: admin.id },
      });
      expect(challenges).toHaveLength(1);
      expect(challenges[0]?.consumedAt).not.toBeNull();

      const sessions = await container.prisma.refreshToken.findMany({
        where: { userId: admin.id },
      });
      expect(sessions).toHaveLength(1);
    });

    it('replay: a second identical verify request fails after the first succeeds', async () => {
      const { email, secret } = await seedEnrolledAdminWithKnownSecret('step2-replay');
      const stepOne = await adminLoginStepOne(app, email, ADMIN_PASSWORD).expect(200);
      const { mfaChallengeToken } = (stepOne.body as StepOneBody).data;
      const totpCode = await currentTotpCode(secret);

      await adminMfaVerify(app, mfaChallengeToken, totpCode).expect(200);
      const replay = await adminMfaVerify(app, mfaChallengeToken, totpCode).expect(401);

      expect((replay.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
    });

    it('wrong TOTP fails, increments the challenge attempt count, and issues no session', async () => {
      const { email, secret } = await seedEnrolledAdminWithKnownSecret('step2-wrong-totp');
      const stepOne = await adminLoginStepOne(app, email, ADMIN_PASSWORD).expect(200);
      const { mfaChallengeToken } = (stepOne.body as StepOneBody).data;
      const totpCode = await currentTotpCode(secret);
      const wrongCode = totpCode === '000000' ? '111111' : '000000';

      const response = await adminMfaVerify(app, mfaChallengeToken, wrongCode).expect(401);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');

      const admin = await userRepository.findByEmail(email);
      if (!admin) throw new Error('fixture admin was not persisted');
      const challenges = await container.prisma.mfaChallenge.findMany({
        where: { userId: admin.id },
      });
      expect(challenges[0]?.attempts).toBe(1);
      expect(challenges[0]?.consumedAt).toBeNull();

      const sessions = await container.prisma.refreshToken.findMany({
        where: { userId: admin.id },
      });
      expect(sessions).toHaveLength(0);
    });

    it('five failed attempts exhaust the challenge; a subsequent correct TOTP also fails', async () => {
      const { email, secret } = await seedEnrolledAdminWithKnownSecret('step2-exhausted');
      const stepOne = await adminLoginStepOne(app, email, ADMIN_PASSWORD).expect(200);
      const { mfaChallengeToken } = (stepOne.body as StepOneBody).data;
      const totpCode = await currentTotpCode(secret);
      const wrongCode = totpCode === '000000' ? '111111' : '000000';

      for (let i = 0; i < 5; i += 1) {
        await adminMfaVerify(app, mfaChallengeToken, wrongCode).expect(401);
      }

      const response = await adminMfaVerify(app, mfaChallengeToken, totpCode).expect(401);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
    });

    it('an expired challenge fails even with the correct TOTP', async () => {
      const { email, secret } = await seedEnrolledAdminWithKnownSecret('step2-expired');
      const stepOne = await adminLoginStepOne(app, email, ADMIN_PASSWORD).expect(200);
      const { mfaChallengeToken } = (stepOne.body as StepOneBody).data;
      const totpCode = await currentTotpCode(secret);

      const admin = await userRepository.findByEmail(email);
      if (!admin) throw new Error('fixture admin was not persisted');
      await container.prisma.mfaChallenge.updateMany({
        where: { userId: admin.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const response = await adminMfaVerify(app, mfaChallengeToken, totpCode).expect(401);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects a malformed TOTP code with the validation envelope', async () => {
      const response = await request(app)
        .post('/api/v1/admin/mfa/verify')
        .send({ mfaChallengeToken: 'whatever', totpCode: 'abc' })
        .expect(400);

      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an unknown challenge token uniformly', async () => {
      const response = await adminMfaVerify(app, 'never-issued-token', '123456').expect(401);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
    });

    it('race: two concurrent verify requests for the same challenge produce exactly one session', async () => {
      const { email, secret } = await seedEnrolledAdminWithKnownSecret('step2-race');
      const stepOne = await adminLoginStepOne(app, email, ADMIN_PASSWORD).expect(200);
      const { mfaChallengeToken } = (stepOne.body as StepOneBody).data;
      const totpCode = await currentTotpCode(secret);

      const [first, second] = await Promise.all([
        adminMfaVerify(app, mfaChallengeToken, totpCode),
        adminMfaVerify(app, mfaChallengeToken, totpCode),
      ]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 401]);

      const admin = await userRepository.findByEmail(email);
      if (!admin) throw new Error('fixture admin was not persisted');
      const sessions = await container.prisma.refreshToken.findMany({
        where: { userId: admin.id },
      });
      expect(sessions).toHaveLength(1);
    });
  });

  describe('POST /api/v1/admin/mfa/enroll (+ /enroll/confirm)', () => {
    it('completes the full enroll → confirm flow, issuing a session with a working access token', async () => {
      const email = await seedUnenrolledAdmin('enroll-success');

      const enrollResponse = await adminMfaEnroll(app, email, ADMIN_PASSWORD).expect(200);
      const { secret } = (enrollResponse.body as EnrollBody).data;
      const totpCode = await currentTotpCode(secret);

      const confirmResponse = await adminMfaEnrollConfirm(
        app,
        email,
        ADMIN_PASSWORD,
        totpCode,
      ).expect(200);
      const body = confirmResponse.body as StepTwoBody;
      expect(body.data.user.role).toBe('SUPER_ADMIN');
      expect(body.data.accessToken).toEqual(expect.any(String));

      const me = await request(app)
        .get('/api/v1/identity/me')
        .set('Authorization', `Bearer ${body.data.accessToken}`)
        .expect(200);
      expect((me.body as MeBody).data.role).toBe('SUPER_ADMIN');
    });

    it('returns the plaintext secret and otpauth URI only from enroll, never from confirm', async () => {
      const email = await seedUnenrolledAdmin('enroll-secret-once');

      const enrollResponse = await adminMfaEnroll(app, email, ADMIN_PASSWORD).expect(200);
      const { secret, otpauthUri } = (enrollResponse.body as EnrollBody).data;
      expect(secret).toEqual(expect.any(String));
      expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);

      const totpCode = await currentTotpCode(secret);
      const confirmResponse = await adminMfaEnrollConfirm(
        app,
        email,
        ADMIN_PASSWORD,
        totpCode,
      ).expect(200);
      expect(confirmResponse.body).not.toHaveProperty('data.secret');
      expect(confirmResponse.body).not.toHaveProperty('data.otpauthUri');
      expect(JSON.stringify(confirmResponse.body)).not.toContain(secret);
    });

    it('persists the confirmed state after a successful confirm', async () => {
      const email = await seedUnenrolledAdmin('enroll-persist');
      const enrollResponse = await adminMfaEnroll(app, email, ADMIN_PASSWORD).expect(200);
      const { secret } = (enrollResponse.body as EnrollBody).data;
      const totpCode = await currentTotpCode(secret);

      await adminMfaEnrollConfirm(app, email, ADMIN_PASSWORD, totpCode).expect(200);

      const admin = await userRepository.findByEmail(email);
      if (!admin) throw new Error('fixture admin was not persisted');
      const rows = await container.prisma.mfaSecret.findMany({ where: { userId: admin.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.confirmedAt).not.toBeNull();
    });

    it('a second enrollment attempt for the same admin is rejected', async () => {
      const email = await seedUnenrolledAdmin('enroll-twice');
      await adminMfaEnroll(app, email, ADMIN_PASSWORD).expect(200);

      const second = await adminMfaEnroll(app, email, ADMIN_PASSWORD).expect(401);
      expect((second.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');

      const admin = await userRepository.findByEmail(email);
      if (!admin) throw new Error('fixture admin was not persisted');
      const rows = await container.prisma.mfaSecret.findMany({ where: { userId: admin.id } });
      expect(rows).toHaveLength(1);
    });

    it('wrong password at enroll creates no secret', async () => {
      const email = await seedUnenrolledAdmin('enroll-wrong-password');

      const response = await adminMfaEnroll(app, email, 'wrong-password').expect(401);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');

      const admin = await userRepository.findByEmail(email);
      if (!admin) throw new Error('fixture admin was not persisted');
      const rows = await container.prisma.mfaSecret.findMany({ where: { userId: admin.id } });
      expect(rows).toHaveLength(0);
    });

    it('wrong password at confirm does not confirm the secret or issue a session', async () => {
      const email = await seedUnenrolledAdmin('enroll-confirm-wrong-password');
      const enrollResponse = await adminMfaEnroll(app, email, ADMIN_PASSWORD).expect(200);
      const { secret } = (enrollResponse.body as EnrollBody).data;
      const totpCode = await currentTotpCode(secret);

      const response = await adminMfaEnrollConfirm(app, email, 'wrong-password', totpCode).expect(
        401,
      );
      expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');

      const admin = await userRepository.findByEmail(email);
      if (!admin) throw new Error('fixture admin was not persisted');
      const rows = await container.prisma.mfaSecret.findMany({ where: { userId: admin.id } });
      expect(rows[0]?.confirmedAt).toBeNull();
    });

    it('wrong TOTP at confirm does not confirm the secret or issue a session', async () => {
      const email = await seedUnenrolledAdmin('enroll-confirm-wrong-totp');
      const enrollResponse = await adminMfaEnroll(app, email, ADMIN_PASSWORD).expect(200);
      const { secret } = (enrollResponse.body as EnrollBody).data;
      const totpCode = await currentTotpCode(secret);
      const wrongCode = totpCode === '000000' ? '111111' : '000000';

      const response = await adminMfaEnrollConfirm(app, email, ADMIN_PASSWORD, wrongCode).expect(
        401,
      );
      expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');

      const admin = await userRepository.findByEmail(email);
      if (!admin) throw new Error('fixture admin was not persisted');
      const rows = await container.prisma.mfaSecret.findMany({ where: { userId: admin.id } });
      expect(rows[0]?.confirmedAt).toBeNull();

      const sessions = await container.prisma.refreshToken.findMany({
        where: { userId: admin.id },
      });
      expect(sessions).toHaveLength(0);
    });

    it('rejects a customer account at enroll', async () => {
      const email = uniqueEmail('enroll-customer');
      const passwordHash = await passwordHasher.hash(ADMIN_PASSWORD);
      await userRepository.create(
        User.register({
          id: toUserId(idGenerator.generate()),
          email,
          passwordHash,
          now: clock.now(),
        }),
      );

      const response = await adminMfaEnroll(app, email, ADMIN_PASSWORD).expect(401);
      expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
    });

    it('rejects a malformed enroll request with the validation envelope', async () => {
      const response = await request(app)
        .post('/api/v1/admin/mfa/enroll')
        .send({ email: 'not-an-email' })
        .expect(400);

      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects a malformed confirm request (bad TOTP shape) with the validation envelope', async () => {
      const response = await request(app)
        .post('/api/v1/admin/mfa/enroll/confirm')
        .send({ email: 'someone@leenmart.in', password: 'x', totpCode: 'abc' })
        .expect(400);

      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('race: two concurrent enrollment attempts for the same admin produce exactly one secret, cleanly', async () => {
      const email = await seedUnenrolledAdmin('enroll-race');

      const [first, second] = await Promise.all([
        adminMfaEnroll(app, email, ADMIN_PASSWORD),
        adminMfaEnroll(app, email, ADMIN_PASSWORD),
      ]);

      const statuses = [first.status, second.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 401]);
      // Cleanly rejected, not a raw unhandled/internal error.
      const failed = first.status === 401 ? first : second;
      expect((failed.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');

      const admin = await userRepository.findByEmail(email);
      if (!admin) throw new Error('fixture admin was not persisted');
      const rows = await container.prisma.mfaSecret.findMany({ where: { userId: admin.id } });
      expect(rows).toHaveLength(1);
    });
  });
});
