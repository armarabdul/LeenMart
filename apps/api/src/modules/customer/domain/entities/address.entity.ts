import type { UserId } from '../../../identity/index.js';
import type { AddressId } from '../value-objects/address-id.value-object.js';

export interface AddressDetails {
  readonly recipientName: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
  readonly pincode: string;
  readonly landmark: string | null;
  readonly label: string;
}

export interface AddressProps extends AddressDetails {
  readonly id: AddressId;
  readonly userId: UserId;
  readonly isDefault: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A customer's saved delivery address (SDD Stage 1: "customer profile and
 * address book"). Deliberately holds plain validated strings rather than
 * dedicated value objects for `phone`/`pincode`: `phone` here is a
 * *recipient's* contact number, not the account's own login phone (so it
 * cannot reuse identity's internal, unpublished `PhoneNumber`), and neither
 * field carries behaviour beyond format validation — the same reasoning
 * `User.email` already uses to stay a plain `string` (see
 * `user.repository.ts`'s own comment on that deferred adoption). Format
 * validation for both happens once, at the HTTP boundary (`phoneSchema`/
 * `pincodeSchema`), matching how `registerCustomerRequestSchema` etc.
 * already validate before anything reaches the domain.
 *
 * Geocoding (lat/lng) is deliberately absent: no provider is configured
 * yet, and an unpopulated pair of nullable columns would be exactly the
 * kind of speculative field this codebase avoids adding ahead of a real
 * consumer.
 */
export class Address {
  private constructor(private readonly props: AddressProps) {}

  static add(props: {
    id: AddressId;
    userId: UserId;
    details: AddressDetails;
    isDefault: boolean;
    now: Date;
  }): Address {
    return new Address({
      id: props.id,
      userId: props.userId,
      ...props.details,
      isDefault: props.isDefault,
      createdAt: props.now,
      updatedAt: props.now,
    });
  }

  static reconstitute(props: AddressProps): Address {
    return new Address(props);
  }

  get id(): AddressId {
    return this.props.id;
  }

  get userId(): UserId {
    return this.props.userId;
  }

  get recipientName(): string {
    return this.props.recipientName;
  }

  get phone(): string {
    return this.props.phone;
  }

  get line1(): string {
    return this.props.line1;
  }

  get line2(): string | null {
    return this.props.line2;
  }

  get city(): string {
    return this.props.city;
  }

  get state(): string {
    return this.props.state;
  }

  get pincode(): string {
    return this.props.pincode;
  }

  get landmark(): string | null {
    return this.props.landmark;
  }

  get label(): string {
    return this.props.label;
  }

  get isDefault(): boolean {
    return this.props.isDefault;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  /** A partial edit — only the supplied fields change; `id`/`userId`/`isDefault`/`createdAt` never do. */
  updateDetails(details: Partial<AddressDetails>, now: Date): Address {
    return new Address({ ...this.props, ...details, updatedAt: now });
  }

  /** Domain-side mirror of the repository's atomic `setDefault()` — used to build the returned value without a second read. */
  markAsDefault(now: Date): Address {
    return new Address({ ...this.props, isDefault: true, updatedAt: now });
  }

  unmarkAsDefault(now: Date): Address {
    return new Address({ ...this.props, isDefault: false, updatedAt: now });
  }
}
