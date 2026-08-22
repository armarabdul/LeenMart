import { describe, expect, it } from 'vitest';
import { ListAdminUsersUseCase } from '../../../../../src/modules/identity/application/use-cases/list-admin-users.use-case.js';
import { User } from '../../../../../src/modules/identity/domain/entities/user.entity.js';
import { Role } from '../../../../../src/modules/identity/domain/value-objects/role.value-object.js';
import { PasswordHash } from '../../../../../src/modules/identity/domain/value-objects/password-hash.value-object.js';
import { toUserId } from '../../../../../src/modules/identity/domain/value-objects/user-id.value-object.js';
import { InMemoryUserRepository } from './fakes.js';

const NOW = new Date('2026-01-01T00:00:00.000Z');

const admin = (id: string, role = Role.SUPPORT_AGENT): User =>
  User.registerAdmin({
    id: toUserId(id),
    email: `${id}@leenmart.in`,
    passwordHash: PasswordHash.create('hashed:a-password-value'),
    role,
    now: NOW,
  });

const customer = (id: string): User =>
  User.register({
    id: toUserId(id),
    email: `${id}@example.com`,
    passwordHash: PasswordHash.create('hashed:a-password-value'),
    now: NOW,
  });

describe('ListAdminUsersUseCase', () => {
  it('lists only admin-family accounts, excluding customers', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.create(admin('00000000-0000-7000-8000-0000000000d1'));
    await userRepository.create(customer('00000000-0000-7000-8000-0000000000d2'));
    const useCase = new ListAdminUsersUseCase({ userRepository });

    const page = await useCase.execute({ limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.role.name).toBe('SUPPORT_AGENT');
  });

  it('pages on the platform cursor convention', async () => {
    const userRepository = new InMemoryUserRepository();
    await userRepository.create(admin('00000000-0000-7000-8000-0000000000e1'));
    await userRepository.create(admin('00000000-0000-7000-8000-0000000000e2'));
    const useCase = new ListAdminUsersUseCase({ userRepository });

    const firstPage = await useCase.execute({ limit: 1 });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.hasMore).toBe(true);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await useCase.execute({
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.hasMore).toBe(false);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);
  });
});
