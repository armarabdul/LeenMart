import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TENANT_SCOPED_MODELS } from '../../../src/shared/infrastructure/persistence/tenant-context.js';

/**
 * Source-level guard for the one rule the type system cannot express.
 *
 * A bare `prisma.$transaction` over a tenant-scoped model gives the query
 * extension no way to reach the pinned connection: it would open a *second*
 * transaction, set `app.vendor_id` there, and leave the real query running
 * with no tenant context. Once KYC-2B-3's policies exist that is a silent zero
 * rows, not an error — and from inside the extension there is no signal
 * distinguishing "on a transaction client" from "on the base client", so it
 * cannot be caught at runtime.
 *
 * Hence a static check. It is deliberately a test rather than a custom ESLint
 * rule: it lives beside the behaviour it protects, and it fails with an
 * explanation rather than a rule id.
 */

const REPOSITORY_ROOT = join(process.cwd(), 'src', 'modules');

/** Prisma delegate names (`prisma.vendorProfile`) for the registered models. */
const TENANT_DELEGATES = [...TENANT_SCOPED_MODELS].map(
  (model) => model.charAt(0).toLowerCase() + model.slice(1),
);

const TENANT_TABLES = [
  'vendors',
  'vendor_kyc_submissions',
  'kyc_documents',
  'products',
  'product_variants',
  'inventory',
  'product_media',
];

interface SourceFile {
  readonly path: string;
  readonly source: string;
}

const repositorySources = (directory: string): SourceFile[] => {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return repositorySources(path);
    }
    if (!entry.name.endsWith('.repository.ts')) {
      return [];
    }
    return [{ path, source: readFileSync(path, 'utf8') }];
  });
};

const touchesTenantModel = (source: string): boolean =>
  TENANT_DELEGATES.some((delegate) => source.includes(`.${delegate}.`));

describe('tenant transaction convention', () => {
  const sources = repositorySources(REPOSITORY_ROOT);

  it('finds repository sources to inspect', () => {
    // Guards the guard: a broken path would make every assertion below pass
    // vacuously.
    expect(sources.length).toBeGreaterThan(0);
  });

  it('recognises at least one tenant-scoped repository', () => {
    expect(sources.filter((file) => touchesTenantModel(file.source)).length).toBeGreaterThan(0);
  });

  it('uses the sanctioned helper in every tenant-scoped repository transaction', () => {
    const offenders = sources
      .filter((file) => touchesTenantModel(file.source) && file.source.includes('$transaction'))
      .filter((file) => !file.source.includes('runInTenantTransaction'))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('has no bare $transaction left in a tenant-scoped repository', () => {
    // `runInTenantTransaction` is the only sanctioned opener, and it lives in
    // the persistence layer — a repository calling `$transaction` directly on
    // its client is the exact mistake this chunk exists to prevent.
    const offenders = sources
      .filter((file) => touchesTenantModel(file.source))
      .filter((file) => /\bthis\.prisma\.\$transaction\b/.test(file.source))
      .map((file) => file.path);

    expect(offenders).toEqual([]);
  });

  it('confirms the KYC repository was converted', () => {
    const kyc = sources.find((file) => file.path.includes('prisma-vendor-kyc.repository.ts'));

    expect(kyc?.source).toContain('runInTenantTransaction');
    expect(kyc?.source).not.toMatch(/\bthis\.prisma\.\$transaction\b/);
  });

  it('leaves non-tenant repositories free to use $transaction directly', () => {
    // `addresses` is user-scoped, not vendor-scoped, and its array-form
    // transaction is untouched by this chunk.
    const address = sources.find((file) => file.path.includes('prisma-address.repository.ts'));

    expect(address?.source).toContain('$transaction');
    expect(touchesTenantModel(address?.source ?? '')).toBe(false);
  });

  describe('SEC-17 duplicate detection stays off the vendor-scoped client', () => {
    it('has no production caller', () => {
      // `findByIdentifierFingerprints` searches *other* vendors by design.
      // Under the vendor RLS policies that returns zero rows — no error, no
      // failing test, just ban-evasion detection quietly switched off. It is
      // deliberately unwired until KYC-4/KYC-5 routes it through `adminPrisma`
      // behind an interface-layer authorisation decision (SDD 7.4).
      const callers = readdirSync(REPOSITORY_ROOT, { recursive: true, encoding: 'utf8' })
        .filter((entry) => entry.endsWith('.ts'))
        .filter((entry) => !entry.endsWith('vendor-kyc.repository.ts'))
        .filter((entry) =>
          readFileSync(join(REPOSITORY_ROOT, entry), 'utf8').includes(
            'findByIdentifierFingerprints',
          ),
        );

      expect(callers).toEqual([]);
    });

    it('is documented as an admin-credential operation where it is declared', () => {
      // If someone wires it up, the reason it cannot use the vendor client is
      // written at the definition rather than in a commit message.
      const port = readFileSync(
        join(REPOSITORY_ROOT, 'vendor', 'domain', 'repositories', 'vendor-kyc.repository.ts'),
        'utf8',
      );

      expect(port).toMatch(/adminPrisma|admin credential|leenmart_admin/);
    });
  });

  describe('raw SQL against tenant tables', () => {
    it('does not exist in any repository today', () => {
      // Raw SQL bypasses the extension entirely (asserted in the integration
      // suite). It stays a documented escape hatch rather than a prohibition,
      // so this records that nothing currently uses it.
      const offenders = sources
        .filter((file) => /\$queryRaw|\$executeRaw/.test(file.source))
        .filter((file) => TENANT_TABLES.some((table) => file.source.includes(table)))
        .map((file) => file.path);

      expect(offenders).toEqual([]);
    });
  });
});
