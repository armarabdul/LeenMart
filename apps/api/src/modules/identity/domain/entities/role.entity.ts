export type RoleName = 'CUSTOMER' | 'VENDOR' | 'ADMIN';

/**
 * The platform's three fixed roles (SDD 6.1).
 *
 * A value object rather than a database-backed roles table: nothing beyond
 * simple membership in one of three known roles has been requested, so a
 * permissions/roles join table would model authority this platform does not
 * yet grant.
 */
export class Role {
  private constructor(public readonly name: RoleName) {}

  static readonly CUSTOMER = new Role('CUSTOMER');
  static readonly VENDOR = new Role('VENDOR');
  static readonly ADMIN = new Role('ADMIN');

  private static readonly BY_NAME: Readonly<Record<RoleName, Role>> = {
    CUSTOMER: Role.CUSTOMER,
    VENDOR: Role.VENDOR,
    ADMIN: Role.ADMIN,
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
