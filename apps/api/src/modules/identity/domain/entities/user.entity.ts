import type { UserId } from '../value-objects/user-id.value-object.js';
import { Role } from '../value-objects/role.value-object.js';
import type { PasswordHash } from '../value-objects/password-hash.value-object.js';
import type { PhoneNumber } from '../value-objects/phone-number.value-object.js';
import { UserStatus } from '../value-objects/user-status.value-object.js';
import { AccountLockedError, AccountSuspendedError } from '../errors/identity-errors.js';

export interface UserProps {
  readonly id: UserId;
  /** Optional: a customer may register with either email+password or phone+OTP (SDD 7.1). */
  readonly email?: string;
  readonly passwordHash?: PasswordHash;
  readonly phone?: PhoneNumber;
  readonly phoneVerifiedAt?: Date | null;
  readonly role: Role;
  readonly status: UserStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class User {
  private constructor(private readonly props: UserProps) {}

  /** New customer sign-up. Role is always CUSTOMER — there is no self-service path to VENDOR/ADMIN. */
  static register(props: {
    id: UserId;
    email: string;
    passwordHash: PasswordHash;
    now: Date;
  }): User {
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

  /**
   * Creates an administrator (SDD 8.1's admin-family roles). Not a
   * self-service path — there is no HTTP surface that reaches this; the
   * caller is the operator-run bootstrap, and later a SUPER_ADMIN-gated
   * admin-management flow.
   *
   * Rejecting a non-admin role throws `TypeError` rather than a domain
   * error: no client input can reach this, so a wrong role here is a
   * programming mistake, matching how `Role.fromName()` treats an unknown
   * role name.
   */
  static registerAdmin(props: {
    id: UserId;
    email: string;
    passwordHash: PasswordHash;
    role: Role;
    now: Date;
  }): User {
    if (!props.role.isAdmin()) {
      throw new TypeError(`Not an admin role: "${props.role.name}"`);
    }
    return new User({
      id: props.id,
      email: props.email,
      passwordHash: props.passwordHash,
      role: props.role,
      status: UserStatus.ACTIVE,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  /** Phone+OTP sign-up (SDD 7.1's primary customer path). Unverified until `verifyPhone()`. */
  static registerWithPhone(props: { id: UserId; phone: PhoneNumber; now: Date }): User {
    return new User({
      id: props.id,
      phone: props.phone,
      phoneVerifiedAt: null,
      role: Role.CUSTOMER,
      status: UserStatus.PENDING,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  /** Rehydrates a User from persisted state. Never applies registration defaults. */
  static reconstitute(props: UserProps): User {
    return new User(props);
  }

  get id(): UserId {
    return this.props.id;
  }

  get email(): string | undefined {
    return this.props.email;
  }

  get passwordHash(): PasswordHash | undefined {
    return this.props.passwordHash;
  }

  get phone(): PhoneNumber | undefined {
    return this.props.phone;
  }

  get phoneVerifiedAt(): Date | null {
    return this.props.phoneVerifiedAt ?? null;
  }

  get role(): Role {
    return this.props.role;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /**
   * Refuses a shut-out account (SDD 7.2's revocation model, which exists so
   * that "a suspended vendor with a 7-day JWT would otherwise keep trading
   * for a week" cannot happen).
   *
   * Every path that hands out a session must call this. Revoking sessions
   * only ends the ones already issued; without this check the same account
   * simply authenticates again and is handed a fresh one, which makes
   * suspension a database annotation rather than a control.
   *
   * SUSPENDED and LOCKED only — the same two states `activate()` has always
   * refused. PENDING is deliberately allowed through: a phone signup starts
   * there and is activated *by* authenticating (`verifyPhone`), so blocking
   * it would break the OTP flow rather than protect anything.
   *
   * Callers must invoke this **after** verifying credentials. Before them, a
   * distinct 403 would tell an unauthenticated caller which accounts exist
   * and are suspended (SEC-15); after them, it tells that only to someone who
   * already proved they hold the account's credentials.
   */
  assertCanAuthenticate(): void {
    if (this.status.equals(UserStatus.SUSPENDED)) {
      throw new AccountSuspendedError();
    }
    if (this.status.equals(UserStatus.LOCKED)) {
      throw new AccountLockedError();
    }
  }

  /**
   * The one stated invariant: suspended (and, by the same reasoning, locked)
   * users cannot become ACTIVE directly. The only way out of either state is
   * `reinstate()`, which lands on PENDING — a separate, explicit `activate()`
   * call is still required to reach ACTIVE, which is what makes "not
   * directly" true rather than just documented.
   */
  activate(now: Date): User {
    this.assertCanAuthenticate();
    return new User({ ...this.props, status: UserStatus.ACTIVE, updatedAt: now });
  }

  /**
   * Records a successful OTP verification and activates the account in one
   * step — the same suspended/locked guard as `activate()`, since a phone
   * check must not be able to reactivate an account that was deliberately
   * shut out.
   */
  verifyPhone(now: Date): User {
    this.assertCanAuthenticate();
    return new User({
      ...this.props,
      phoneVerifiedAt: now,
      status: UserStatus.ACTIVE,
      updatedAt: now,
    });
  }

  /**
   * Promotes a customer account to vendor owner (SDD 8.1).
   *
   * Registration is the only caller and the only path: SDD 8.1 presents role
   * membership as fixed, and the one transition the platform actually needs is
   * the moment a customer becomes a vendor. Narrow on purpose — a general
   * `changeRole` would be a privilege-escalation primitive sitting in the
   * domain waiting for a careless caller.
   *
   * Refuses any starting role but CUSTOMER. An admin account must never
   * acquire a vendor's tenancy, and a vendor owner promoted twice would be a
   * second vendor profile for one account, which `vendors.user_id`'s unique
   * constraint already refuses at the database.
   */
  promoteToVendorOwner(now: Date): User {
    if (!this.props.role.equals(Role.CUSTOMER)) {
      throw new TypeError(
        `Only a CUSTOMER may become a vendor owner, not "${this.props.role.name}".`,
      );
    }
    return new User({ ...this.props, role: Role.VENDOR_OWNER, updatedAt: now });
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
