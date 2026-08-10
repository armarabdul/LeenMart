export type RoleName =
  | 'CUSTOMER'
  | 'VENDOR_OWNER'
  | 'VENDOR_MANAGER'
  | 'VENDOR_STAFF'
  | 'SUPER_ADMIN'
  | 'CATALOGUE_MODERATOR'
  | 'FINANCE_ADMIN'
  | 'RISK_ANALYST'
  | 'SUPPORT_AGENT';

/**
 * The platform's nine fixed roles (SDD 8.1's role hierarchy).
 *
 * A value object rather than a database-backed roles table: each user holds
 * exactly one of these fixed role names — no dynamic permissions/roles join
 * table is modelled, since nothing beyond fixed membership has been
 * requested. The permission matrix these roles feed (SDD 8.2) is separate,
 * out-of-scope-here policy, not part of this value object.
 */
export class Role {
  private constructor(public readonly name: RoleName) {}

  static readonly CUSTOMER = new Role('CUSTOMER');
  static readonly VENDOR_OWNER = new Role('VENDOR_OWNER');
  static readonly VENDOR_MANAGER = new Role('VENDOR_MANAGER');
  static readonly VENDOR_STAFF = new Role('VENDOR_STAFF');
  static readonly SUPER_ADMIN = new Role('SUPER_ADMIN');
  static readonly CATALOGUE_MODERATOR = new Role('CATALOGUE_MODERATOR');
  static readonly FINANCE_ADMIN = new Role('FINANCE_ADMIN');
  static readonly RISK_ANALYST = new Role('RISK_ANALYST');
  static readonly SUPPORT_AGENT = new Role('SUPPORT_AGENT');

  private static readonly BY_NAME: Readonly<Record<RoleName, Role>> = {
    CUSTOMER: Role.CUSTOMER,
    VENDOR_OWNER: Role.VENDOR_OWNER,
    VENDOR_MANAGER: Role.VENDOR_MANAGER,
    VENDOR_STAFF: Role.VENDOR_STAFF,
    SUPER_ADMIN: Role.SUPER_ADMIN,
    CATALOGUE_MODERATOR: Role.CATALOGUE_MODERATOR,
    FINANCE_ADMIN: Role.FINANCE_ADMIN,
    RISK_ANALYST: Role.RISK_ANALYST,
    SUPPORT_AGENT: Role.SUPPORT_AGENT,
  };

  static fromName(name: string): Role {
    const role = (Role.BY_NAME as Record<string, Role | undefined>)[name];
    if (!role) {
      throw new TypeError(`Not a valid role: "${name}"`);
    }
    return role;
  }

  equals(other: Role): boolean {
    return this.name === other.name;
  }
}
