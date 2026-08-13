export type CategoryRiskLevelName = 'LOW' | 'MEDIUM' | 'RESTRICTED';

/**
 * SDD 15.2's category risk tiers — the column headers of its approval matrix:
 * "Low-risk category | Medium-risk | Restricted (food, vehicles, second-hand,
 * health)".
 *
 * **Assigned explicitly per category, never inherited from a parent.**
 * Inheritance sounds convenient and is a trap: reparenting a subtree would
 * silently reclassify every listing beneath it, turning a taxonomy tidy-up
 * into a moderation policy change nobody reviewed.
 *
 * Under the Stage-2 decision that every vendor sits at trust tier `NEW`, this
 * level routes nothing to auto-approval — every submission is manual
 * regardless. What it does drive is queue prioritisation (SDD 15.2's SLA:
 * "the admin queue is prioritised by vendor tier, category risk and age"),
 * which is why it is worth recording now rather than after the queue exists.
 *
 * A class rather than a bare union for the same reason `VendorStatus` is one:
 * the parse-from-string step has exactly one home, so an unrecognised value
 * cannot enter the domain from a request, a database row or a test fixture.
 */
export class CategoryRiskLevel {
  private constructor(readonly name: CategoryRiskLevelName) {}

  static readonly LOW = new CategoryRiskLevel('LOW');
  static readonly MEDIUM = new CategoryRiskLevel('MEDIUM');
  static readonly RESTRICTED = new CategoryRiskLevel('RESTRICTED');

  private static readonly BY_NAME: Readonly<Record<CategoryRiskLevelName, CategoryRiskLevel>> = {
    LOW: CategoryRiskLevel.LOW,
    MEDIUM: CategoryRiskLevel.MEDIUM,
    RESTRICTED: CategoryRiskLevel.RESTRICTED,
  };

  static fromName(name: string): CategoryRiskLevel {
    const level = CategoryRiskLevel.BY_NAME[name as CategoryRiskLevelName];
    if (!level) {
      throw new TypeError(`Not a valid category risk level: "${name}"`);
    }
    return level;
  }

  equals(other: CategoryRiskLevel): boolean {
    return this.name === other.name;
  }
}
