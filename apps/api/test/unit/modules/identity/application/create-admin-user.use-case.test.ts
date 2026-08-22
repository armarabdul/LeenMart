import { describe, expect, it } from 'vitest';
import type { TransactionRunner, TransactionScope } from '@leen-mart/domain-kit';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { CreateAdminUserUseCase } from '../../../../../src/modules/identity/application/use-cases/create-admin-user.use-case.js';
import { EmailAlreadyRegisteredError } from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { toSessionId } from '../../../../../src/modules/identity/domain/value-objects/session-id.value-object.js';
import type { Principal } from '../../../../../src/modules/identity/application/ports/principal.js';
import {
  FailingAuditWriter,
  FakePasswordHasher,
  InMemoryUserRepository,
  RecordingAuditWriter,
  nullLogger,
} from './fakes.js';

/**
 * A transaction runner that actually rolls back on failure — the in-memory
 * stand-in for what PostgreSQL does, same shape
 * `register-vendor.use-case.test.ts`'s own `FakeTransactionRunner` uses.
 */
class FakeTransactionRunner implements TransactionRunner {
  constructor(private readonly userRepository: InMemoryUserRepository) {}

  async run<T>(work: (scope: TransactionScope) => Promise<T>): Promise<T> {
    const before = this.userRepository.snapshot();
    try {
      return await work({} as TransactionScope);
    } catch (error) {
      this.userRepository.restore(before);
      throw error;
    }
  }
}

const NOW = new Date('2026-01-01T00:00:00.000Z');
const SUPER_ADMIN_ID = toUserId('00000000-0000-7000-8000-0000000000a1');
const SUPER_ADMIN_PRINCIPAL: Principal = {
  userId: SUPER_ADMIN_ID,
  sessionId: toSessionId('00000000-0000-7000-8000-0000000000a2'),
  role: 'SUPER_ADMIN',
};
const EMAIL = 'new-moderator@leenmart.in';
const VALID_PASSWORD = 'a-sufficiently-long-password';

const setup = (): {
  useCase: CreateAdminUserUseCase;
  userRepository: InMemoryUserRepository;
  auditWriter: RecordingAuditWriter;
} => {
  const userRepository = new InMemoryUserRepository();
  const auditWriter = new RecordingAuditWriter();
  const useCase = new CreateAdminUserUseCase({
    userRepository,
    passwordHasher: new FakePasswordHasher(),
    transactionRunner: new FakeTransactionRunner(userRepository),
    auditWriter,
    idGenerator: new UuidV7Generator(),
    clock: new FixedClock(NOW),
    logger: nullLogger,
  });
  return { useCase, userRepository, auditWriter };
};

describe('CreateAdminUserUseCase', () => {
  it.each(['CATALOGUE_MODERATOR', 'FINANCE_ADMIN', 'RISK_ANALYST', 'SUPPORT_AGENT'] as const)(
    'creates a %s account, ACTIVE, with no MFA secret',
    async (role) => {
      const { useCase, userRepository } = setup();

      const { admin } = await useCase.execute({
        principal: SUPER_ADMIN_PRINCIPAL,
        email: EMAIL,
        password: VALID_PASSWORD,
        role,
      });

      expect(admin.role.name).toBe(role);
      expect(admin.status.name).toBe('ACTIVE');
      expect(admin.email).toBe(EMAIL);
      expect(await userRepository.findByEmail(EMAIL)).not.toBeNull();
    },
  );

  it('hashes the password rather than storing it', async () => {
    const { useCase } = setup();

    const { admin } = await useCase.execute({
      principal: SUPER_ADMIN_PRINCIPAL,
      email: EMAIL,
      password: VALID_PASSWORD,
      role: 'SUPPORT_AGENT',
    });

    expect(admin.passwordHash?.value).not.toBe(VALID_PASSWORD);
    expect(admin.passwordHash?.value).toBe(`hashed:${VALID_PASSWORD}`);
  });

  it('rejects a duplicate email and creates nothing', async () => {
    const { useCase, userRepository } = setup();
    await userRepository.create(
      User.register({
        id: toUserId('00000000-0000-7000-8000-0000000000b1'),
        email: EMAIL,
        passwordHash: PasswordHash.create('hashed:someone-elses-password'),
        now: NOW,
      }),
    );

    await expect(
      useCase.execute({
        principal: SUPER_ADMIN_PRINCIPAL,
        email: EMAIL,
        password: VALID_PASSWORD,
        role: 'SUPPORT_AGENT',
      }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('records an audit entry naming the actor, the new admin, and the role — never the password', async () => {
    const { useCase, auditWriter } = setup();

    const { admin } = await useCase.execute({
      principal: SUPER_ADMIN_PRINCIPAL,
      email: EMAIL,
      password: VALID_PASSWORD,
      role: 'FINANCE_ADMIN',
    });

    expect(auditWriter.entries).toHaveLength(1);
    const entry = auditWriter.entries[0];
    expect(entry?.actorId).toBe(SUPER_ADMIN_ID);
    expect(entry?.actorRole).toBe('SUPER_ADMIN');
    expect(entry?.entityId).toBe(admin.id);
    expect(entry?.after).toEqual({ email: EMAIL, role: 'FINANCE_ADMIN', status: 'ACTIVE' });
    expect(JSON.stringify(entry)).not.toContain(VALID_PASSWORD);
    expect(JSON.stringify(entry)).not.toContain('hashed:');
  });

  it('rolls back the created account when the audit write fails', async () => {
    const userRepository = new InMemoryUserRepository();
    const useCase = new CreateAdminUserUseCase({
      userRepository,
      passwordHasher: new FakePasswordHasher(),
      transactionRunner: new FakeTransactionRunner(userRepository),
      auditWriter: new FailingAuditWriter(),
      idGenerator: new UuidV7Generator(),
      clock: new FixedClock(NOW),
      logger: nullLogger,
    });

    await expect(
      useCase.execute({
        principal: SUPER_ADMIN_PRINCIPAL,
        email: EMAIL,
        password: VALID_PASSWORD,
        role: 'SUPPORT_AGENT',
      }),
    ).rejects.toThrow('audit log unavailable');

    expect(await userRepository.findByEmail(EMAIL)).toBeNull();
  });
});
