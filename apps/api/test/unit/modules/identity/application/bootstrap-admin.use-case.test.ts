import { describe, expect, it } from 'vitest';
import { FixedClock, UuidV7Generator } from '@leen-mart/domain-kit';
import { BootstrapAdminUseCase } from '../../../../../src/modules/identity/application/use-cases/bootstrap-admin.use-case.js';
import {
  AdminAlreadyExistsError,
  WeakAdminPasswordError,
} from '../../../../../src/modules/identity/domain/errors/identity-errors.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import {
  ADMIN_ROLE_NAMES,
  Role,
} from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import type { PasswordHasher } from '../../../../../src/modules/identity/application/ports/password-hasher.port.js';
import { InMemoryUserRepository, nullLogger } from './fakes.js';

const HASH_PREFIX = '$argon2id$v=19$fake$';

/**
 * Local rather than the shared `FakePasswordHasher`: that one prefixes with
 * `hashed:` (7 characters), so a 10-character password produces a 17-character
 * value that `PasswordHash` rejects as too short to be a hash. Real Argon2
 * output is ~95 characters, so the shared fake — not the policy — would be
 * what fails the minimum-length boundary test below.
 */
class RealisticLengthPasswordHasher implements PasswordHasher {
  hash(plaintext: string): Promise<PasswordHash> {
    return Promise.resolve(PasswordHash.create(`${HASH_PREFIX}${plaintext}`));
  }

  verify(hash: PasswordHash, plaintext: string): Promise<boolean> {
    return Promise.resolve(hash.value === `${HASH_PREFIX}${plaintext}`);
  }
}

const NOW = new Date('2026-01-01T00:00:00.000Z');
const EMAIL = 'ops@leenmart.in';
const VALID_PASSWORD = 'a-sufficiently-long-password';

const setup = (): { useCase: BootstrapAdminUseCase; userRepository: InMemoryUserRepository } => {
  const userRepository = new InMemoryUserRepository();
  const useCase = new BootstrapAdminUseCase({
    userRepository,
    passwordHasher: new RealisticLengthPasswordHasher(),
    idGenerator: new UuidV7Generator(),
    clock: new FixedClock(NOW),
    logger: nullLogger,
  });
  return { useCase, userRepository };
};

const existingAdmin = (role: Role): User =>
  User.registerAdmin({
    id: toUserId('00000000-0000-7000-8000-0000000000c1'),
    email: 'existing-admin@leenmart.in',
    passwordHash: PasswordHash.create('hashed:an-existing-admin-password'),
    role,
    now: NOW,
  });

describe('BootstrapAdminUseCase', () => {
  it('creates exactly one SUPER_ADMIN', async () => {
    const { useCase, userRepository } = setup();

    const admin = await useCase.execute({ email: EMAIL, password: VALID_PASSWORD });

    expect(admin.role).toBe(Role.SUPER_ADMIN);
    expect(admin.email).toBe(EMAIL);
    expect(await userRepository.findByEmail(EMAIL)).not.toBeNull();
  });

  it('creates the administrator as ACTIVE with both timestamps stamped', async () => {
    const { useCase } = setup();

    const admin = await useCase.execute({ email: EMAIL, password: VALID_PASSWORD });

    expect(admin.status.name).toBe('ACTIVE');
    expect(admin.createdAt).toEqual(NOW);
    expect(admin.updatedAt).toEqual(NOW);
  });

  it('creates no MFA secret — enrolment happens on the admin surface (SDD 7.1)', async () => {
    const { useCase } = setup();

    const admin = await useCase.execute({ email: EMAIL, password: VALID_PASSWORD });

    // The account carries credentials only; nothing in this chunk persists MFA state.
    expect(admin.passwordHash).toBeDefined();
    expect(Object.keys(admin)).not.toContain('mfaSecret');
  });

  it('hashes the password rather than storing it', async () => {
    const { useCase } = setup();

    const admin = await useCase.execute({ email: EMAIL, password: VALID_PASSWORD });

    expect(admin.passwordHash?.value).not.toBe(VALID_PASSWORD);
    expect(admin.passwordHash?.value).toContain(HASH_PREFIX);
  });

  it.each(ADMIN_ROLE_NAMES)('refuses to run when a %s already exists', async (roleName) => {
    const { useCase, userRepository } = setup();
    await userRepository.create(existingAdmin(Role.fromName(roleName)));

    await expect(
      useCase.execute({ email: EMAIL, password: VALID_PASSWORD }),
    ).rejects.toBeInstanceOf(AdminAlreadyExistsError);
  });

  it('does not create a duplicate administrator when it refuses', async () => {
    const { useCase, userRepository } = setup();
    await userRepository.create(existingAdmin(Role.SUPER_ADMIN));

    await expect(useCase.execute({ email: EMAIL, password: VALID_PASSWORD })).rejects.toThrow();

    expect(await userRepository.findByEmail(EMAIL)).toBeNull();
  });

  it('rejects a password shorter than 10 characters (SDD 7.5)', async () => {
    const { useCase } = setup();

    await expect(useCase.execute({ email: EMAIL, password: '123456789' })).rejects.toBeInstanceOf(
      WeakAdminPasswordError,
    );
  });

  it('accepts a password of exactly 10 characters', async () => {
    const { useCase } = setup();

    const admin = await useCase.execute({ email: EMAIL, password: '1234567890' });

    expect(admin.role).toBe(Role.SUPER_ADMIN);
  });

  it('checks the password before touching the repository', async () => {
    const { useCase, userRepository } = setup();

    await expect(useCase.execute({ email: EMAIL, password: 'short' })).rejects.toThrow();

    expect(await userRepository.findByEmail(EMAIL)).toBeNull();
  });

  it('ignores a non-admin account when deciding whether to run', async () => {
    const { useCase, userRepository } = setup();
    await userRepository.create(
      User.register({
        id: toUserId('00000000-0000-7000-8000-0000000000c2'),
        email: 'shopper@example.com',
        passwordHash: PasswordHash.create('hashed:a-customer-password-value'),
        now: NOW,
      }),
    );

    const admin = await useCase.execute({ email: EMAIL, password: VALID_PASSWORD });

    expect(admin.role).toBe(Role.SUPER_ADMIN);
  });
});
