import type { Uuid } from '@leen-mart/domain-kit';
import { Role } from './role.entity.js';
import { UserStatus } from '../value-objects/user-status.value-object.js';
import { AccountLockedError, AccountSuspendedError } from '../errors/identity-errors.js';

export interface UserProps {
  readonly id: Uuid;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: Role;
  /**
   * Optional for backward compatibility: rows persisted before this field
   * existed reconstitute without one. `status` getter defaults them to
   * ACTIVE, since that's what "no status column yet" has meant in practice
   * for every account created through the existing register() flow.
   */
  readonly status?: UserStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class User {
  private constructor(private readonly props: UserProps) {}

  /** New customer sign-up. Role is always CUSTOMER — there is no self-service path to VENDOR/ADMIN. */
  static register(props: { id: Uuid; email: string; passwordHash: string; now: Date }): User {
    return new User({
      id: props.id,
      email: props.email,
      passwordHash: props.passwordHash,
      role: Role.CUSTOMER,
      status: UserStatus.ACTIVE,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  /** Rehydrates a User from persisted state. Never applies registration defaults. */
  static reconstitute(props: UserProps): User {
    return new User(props);
  }

  get id(): Uuid {
    return this.props.id;
  }

  get email(): string {
    return this.props.email;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get role(): Role {
    return this.props.role;
  }

  get status(): UserStatus {
    return this.props.status ?? UserStatus.ACTIVE;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /**
   * The one stated invariant: suspended (and, by the same reasoning, locked)
   * users cannot become ACTIVE directly. The only way out of either state is
   * `reinstate()`, which lands on PENDING — a separate, explicit `activate()`
   * call is still required to reach ACTIVE, which is what makes "not
   * directly" true rather than just documented.
   */
  activate(now: Date): User {
    if (this.status.equals(UserStatus.SUSPENDED)) {
      throw new AccountSuspendedError();
    }
    if (this.status.equals(UserStatus.LOCKED)) {
      throw new AccountLockedError();
    }
    return new User({ ...this.props, status: UserStatus.ACTIVE, updatedAt: now });
  }

  suspend(now: Date): User {
    return new User({ ...this.props, status: UserStatus.SUSPENDED, updatedAt: now });
  }

  lock(now: Date): User {
    return new User({ ...this.props, status: UserStatus.LOCKED, updatedAt: now });
  }

  reinstate(now: Date): User {
    return new User({ ...this.props, status: UserStatus.PENDING, updatedAt: now });
  }
}
