import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { type Container, createContainer } from '../../src/container.js';
import { Argon2OtpHasher } from '../../src/modules/identity/infrastructure/security/argon2-otp-hasher.js';

interface AuthSessionBody {
  data: {
    user: { id: string; email?: string; role: string };
    accessToken: string;
    accessTokenExpiresAt: string;
    refreshToken: string;
    refreshTokenExpiresAt: string;
  };
}

interface ErrorBody {
  error: { code: string; message: string };
}

const EMAIL_PREFIX = 'identity-integration-';
const PHONE_PREFIX = '+9197';

const uniqueEmail = (label: string): string =>
  `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

let phoneSeq = 0;
const uniquePhone = (): string => {
  phoneSeq += 1;
  return `${PHONE_PREFIX}${(10_000_000 + phoneSeq).toString().padStart(8, '0')}`;
};

const registerCustomer = (app: Express, email: string, password: string): request.Test =>
  request(app).post('/api/v1/identity/register').send({ email, password });

const requestOtp = (app: Express, phone: string): request.Test =>
  request(app).post('/api/v1/identity/otp/request').send({ phone });

const verifyOtp = (app: Express, phone: string, code: string): request.Test =>
  request(app).post('/api/v1/identity/otp/verify').send({ phone, code });

/**
 * Integration test against real PostgreSQL (SDD README §"Conventions for the
 * first business module"). Requires `pnpm infra:up` and an applied migration.
 * Not mocked: rotation and uniqueness constraints are exactly what this suite
 * exists to prove.
 */
describe('identity endpoints', () => {
  let container: Container;
  let app: Express;

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
  });

  afterAll(async () => {
    await container.prisma.user.deleteMany({ where: { email: { contains: EMAIL_PREFIX } } });
    await container.prisma.user.deleteMany({ where: { phone: { startsWith: PHONE_PREFIX } } });
    await container.dispose();
  });

  it('registers a new customer and returns a session', async () => {
    const email = uniqueEmail('register');

    const response = await registerCustomer(app, email, 'correct horse battery staple').expect(201);

    const body = response.body as AuthSessionBody;
    expect(body.data.user).toMatchObject({ email, role: 'CUSTOMER' });
    expect(body.data.accessToken).toEqual(expect.any(String));
    expect(body.data.refreshToken).toEqual(expect.any(String));
  });

  it('rejects a duplicate registration', async () => {
    const email = uniqueEmail('duplicate');
    await registerCustomer(app, email, 'correct horse battery staple').expect(201);

    const response = await registerCustomer(app, email, 'a different password').expect(409);

    expect((response.body as ErrorBody).error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it('rejects a field the client should not be able to set, closing the mass-assignment hole', async () => {
    const email = uniqueEmail('mass-assignment');

    await request(app)
      .post('/api/v1/identity/register')
      .send({ email, password: 'correct horse battery staple', role: 'ADMIN' })
      .expect(400);
  });

  it('logs a registered customer in', async () => {
    const email = uniqueEmail('login');
    const password = 'correct horse battery staple';
    await registerCustomer(app, email, password).expect(201);

    const response = await request(app)
      .post('/api/v1/identity/login')
      .send({ email, password })
      .expect(200);

    expect((response.body as AuthSessionBody).data.user.email).toBe(email);
  });

  it('rejects login with the wrong password without revealing which field was wrong', async () => {
    const email = uniqueEmail('bad-login');
    await registerCustomer(app, email, 'correct horse battery staple').expect(201);

    const response = await request(app)
      .post('/api/v1/identity/login')
      .send({ email, password: 'not the right password' })
      .expect(401);

    expect((response.body as ErrorBody).error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rotates a refresh token and rejects reuse of the rotated-away token', async () => {
    const email = uniqueEmail('refresh');
    const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(
      201,
    );
    const originalRefreshToken = (registered.body as AuthSessionBody).data.refreshToken;

    const refreshed = await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: originalRefreshToken })
      .expect(200);
    expect((refreshed.body as AuthSessionBody).data.refreshToken).not.toBe(originalRefreshToken);

    const reused = await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken: originalRefreshToken })
      .expect(401);
    expect((reused.body as ErrorBody).error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('logs out and invalidates the refresh token', async () => {
    const email = uniqueEmail('logout');
    const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(
      201,
    );
    const refreshToken = (registered.body as AuthSessionBody).data.refreshToken;

    await request(app).post('/api/v1/identity/logout').send({ refreshToken }).expect(200);

    const response = await request(app)
      .post('/api/v1/identity/refresh')
      .send({ refreshToken })
      .expect(401);
    expect((response.body as ErrorBody).error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('is idempotent when logging out an already-revoked token', async () => {
    const email = uniqueEmail('logout-twice');
    const registered = await registerCustomer(app, email, 'correct horse battery staple').expect(
      201,
    );
    const refreshToken = (registered.body as AuthSessionBody).data.refreshToken;

    await request(app).post('/api/v1/identity/logout').send({ refreshToken }).expect(200);
    await request(app).post('/api/v1/identity/logout').send({ refreshToken }).expect(200);
  });

  describe('phone OTP endpoints', () => {
    const otpHasher = new Argon2OtpHasher();

    /**
     * The real OTP is generated with a CSPRNG and never returned, logged, or
     * persisted anywhere in plaintext (by design — SEC-09). To exercise the
     * success path through real HTTP + Postgres, this seeds a *known* code
     * directly via Prisma, using the same `Argon2OtpHasher` production code
     * uses, mirroring the direct-repository fixture technique already
     * established in `prisma-otp.repository.test.ts`. No production code
     * path is altered or bypassed to make this possible.
     */
    const seedKnownOtp = async (
      phone: string,
      code: string,
      overrides: { expiresAt?: Date } = {},
    ): Promise<void> => {
      const user = await container.prisma.user.findUniqueOrThrow({ where: { phone } });
      await container.prisma.otp.deleteMany({ where: { userId: user.id } });
      await container.prisma.otp.create({
        data: {
          id: container.idGenerator.generate(),
          userId: user.id,
          codeHash: await otpHasher.hash(code),
          expiresAt: overrides.expiresAt ?? new Date(Date.now() + 5 * 60_000),
        },
      });
    };

    it('requests an OTP and creates a pending customer for a new phone', async () => {
      const phone = uniquePhone();

      const response = await requestOtp(app, phone).expect(200);

      expect(response.body).toEqual({
        data: { success: true },
        meta: { requestId: expect.any(String) as unknown as string },
      });
      const user = await container.prisma.user.findUniqueOrThrow({ where: { phone } });
      expect(user.status).toBe('PENDING');
      expect(user.phoneVerifiedAt).toBeNull();
    });

    it('does not create a duplicate user when requesting OTP for an existing phone', async () => {
      const phone = uniquePhone();

      await requestOtp(app, phone).expect(200);
      await requestOtp(app, phone).expect(200);

      const users = await container.prisma.user.findMany({ where: { phone } });
      expect(users).toHaveLength(1);
    });

    it('rejects a malformed phone number', async () => {
      await requestOtp(app, '12345').expect(400);
    });

    it('never exposes the plaintext OTP in the request response', async () => {
      const phone = uniquePhone();

      const response = await requestOtp(app, phone).expect(200);

      expect(JSON.stringify(response.body)).not.toMatch(/"\d{6}"/);
    });

    it('verifies a valid OTP, activates the customer, and issues a session', async () => {
      const phone = uniquePhone();
      await requestOtp(app, phone).expect(200);
      await seedKnownOtp(phone, '123456');

      const response = await verifyOtp(app, phone, '123456').expect(200);

      const body = response.body as AuthSessionBody;
      expect(body.data.accessToken).toEqual(expect.any(String));
      expect(body.data.refreshToken).toEqual(expect.any(String));
      expect(body.data.user.role).toBe('CUSTOMER');

      const user = await container.prisma.user.findUniqueOrThrow({ where: { phone } });
      expect(user.status).toBe('ACTIVE');
      expect(user.phoneVerifiedAt).not.toBeNull();
    });

    it('rejects a wrong OTP code without revealing which part was wrong', async () => {
      const phone = uniquePhone();
      await requestOtp(app, phone).expect(200);
      await seedKnownOtp(phone, '123456');

      const response = await verifyOtp(app, phone, '999999').expect(400);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_OTP');
    });

    it('rejects an unknown phone with the same uniform error as a wrong code', async () => {
      const response = await verifyOtp(app, uniquePhone(), '123456').expect(400);

      expect((response.body as ErrorBody).error.code).toBe('INVALID_OTP');
    });

    it('rejects a malformed OTP code before it reaches the use case', async () => {
      const phone = uniquePhone();
      await requestOtp(app, phone).expect(200);

      const response = await verifyOtp(app, phone, '42').expect(400);

      expect((response.body as ErrorBody).error.code).toBe('VALIDATION_FAILED');
    });

    it('rejects an expired OTP', async () => {
      const phone = uniquePhone();
      await requestOtp(app, phone).expect(200);
      await seedKnownOtp(phone, '123456', { expiresAt: new Date(Date.now() - 60_000) });

      const response = await verifyOtp(app, phone, '123456').expect(401);

      expect((response.body as ErrorBody).error.code).toBe('EXPIRED_OTP');
    });
  });
});
