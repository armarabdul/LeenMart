import type { Uuid } from '@leen-mart/domain-kit';
import { Role } from './role.entity.js';

export interface UserProps {
  readonly id: Uuid;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: Role;
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

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }
}
