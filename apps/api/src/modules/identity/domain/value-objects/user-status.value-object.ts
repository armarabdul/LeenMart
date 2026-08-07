export type UserStatusName = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'LOCKED';

/**
 * A user's account state. The allowed transitions between these (e.g. that
 * SUSPENDED cannot go straight back to ACTIVE) are enforced by the `User`
 * entity, not by this value object — this type only represents "which state."
 */
export class UserStatus {
  private constructor(public readonly name: UserStatusName) {}

  static readonly PENDING = new UserStatus('PENDING');
  static readonly ACTIVE = new UserStatus('ACTIVE');
  static readonly SUSPENDED = new UserStatus('SUSPENDED');
  static readonly LOCKED = new UserStatus('LOCKED');

  private static readonly BY_NAME: Readonly<Record<UserStatusName, UserStatus>> = {
    PENDING: UserStatus.PENDING,
    ACTIVE: UserStatus.ACTIVE,
    SUSPENDED: UserStatus.SUSPENDED,
    LOCKED: UserStatus.LOCKED,
  };

  static fromName(name: string): UserStatus {
    const status = (UserStatus.BY_NAME as Record<string, UserStatus | undefined>)[name];
    if (!status) {
      throw new TypeError(`Not a valid user status: "${name}"`);
    }
    return status;
  }

  equals(other: UserStatus): boolean {
    return this.name === other.name;
  }
}
