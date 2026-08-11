import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { createApp } from '../../src/app.js';
import { type Container, createContainer } from '../../src/container.js';
import { Argon2PasswordHasher } from '../../src/modules/identity/infrastructure/security/argon2-password-hasher.js';
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

interface ErrorBody {
  error: { code: string; message: string };
}

const EMAIL_PREFIX = 'admin-auth-integration-';
const ADMIN_PASSWORD = 'an-administrator-password';

const uniqueEmail = (label: string): string =>
  `${EMAIL_PREFIX}${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;

const adminLoginStepOne = (app: Express, email: string, password: string): request.Test =>
  request(app).post('/api/v1/admin/login').send({ email, password });

/**
 * Integration test against real PostgreSQL, same conventions as
 * `identity.test.ts`. No enrollment endpoint exists yet (Milestone 3 Step
 * 5E is login-step-1 only), so admin fixtures with a confirmed MFA secret
 * are seeded directly through the repositories, exactly as
 * `bootstrap-admin.use-case.test.ts` seeds admins directly rather than
 * through an HTTP path.
 */
describe('admin auth endpoints', () => {
  let container: Container;
  let app: Express;
  let userRepository: PrismaUserRepository;
  let mfaSecretRepository: PrismaMfaSecretRepository;
  let passwordHasher: Argon2PasswordHasher;
  let idGenerator: UuidV7Generator;
  let clock: FixedClock;

  beforeAll(() => {
    process.env.ENV_FILE = '.env.test';
    container = createContainer();
    app = createApp(container);
    userRepository = new PrismaUserRepository(container.prisma);
    mfaSecretRepository = new PrismaMfaSecretRepository(container.prisma);
    passwordHasher = new Argon2PasswordHasher();
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
});
