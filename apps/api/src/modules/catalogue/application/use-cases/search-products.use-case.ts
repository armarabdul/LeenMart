import type { Logger } from '@leen-mart/domain-kit';
import { ValidationError } from '@leen-mart/domain-kit';
import type { VendorId } from '../../../identity/index.js';
import type { CategoryId } from '../../domain/value-objects/category-id.value-object.js';
import type {
  ProductSearchCursor,
  ProductSearchPage,
  ProductSearchQueryPort,
} from '../ports/product-search-query.port.js';

const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

export interface SearchProductsInput {
  readonly q?: string | undefined;
  readonly categoryId?: CategoryId | undefined;
  readonly vendorId?: VendorId | undefined;
  readonly limit?: number | undefined;
  /** The opaque token `product-search.contract.ts` calls `cursor` — never a decoded `{ name, id }` pair. */
  readonly cursor?: string | undefined;
}

export interface SearchProductsResultPage extends Omit<ProductSearchPage, 'nextCursor'> {
  readonly nextCursor: string | null;
}

export interface SearchProductsDeps {
  readonly productSearchQuery: ProductSearchQueryPort;
  readonly logger: Logger;
}

const CURSOR_ENCODING = 'base64url';

/** The opaque token on the wire. Only this use case knows it is base64url JSON — the port and its adapter see just `{ name, id }`. */
const encodeCursor = (cursor: ProductSearchCursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString(CURSOR_ENCODING);

const malformedCursorError = (): ValidationError =>
  new ValidationError('The search cursor is malformed.', {
    code: 'INVALID_CURSOR',
    details: [
      {
        field: 'cursor',
        issue: 'Must be an opaque cursor previously returned by this endpoint.',
      },
    ],
  });

const decodeCursor = (token: string): ProductSearchCursor => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, CURSOR_ENCODING).toString('utf8'));
  } catch {
    throw malformedCursorError();
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { name?: unknown }).name !== 'string' ||
    typeof (parsed as { id?: unknown }).id !== 'string'
  ) {
    throw malformedCursorError();
  }
  return { name: (parsed as { name: string }).name, id: (parsed as { id: string }).id };
};

/**
 * Belt-and-braces alongside `publicProductSearchQuerySchema`'s own
 * `min(1).max(100).default(20)` — the use case never trusts a caller who
 * bypasses HTTP validation (a future non-HTTP caller, a test) any more than
 * the controller's own request body does.
 */
const clampLimit = (limit: number | undefined): number => {
  if (limit === undefined || !Number.isFinite(limit)) {
    return DEFAULT_LIMIT;
  }
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(limit)));
};

/**
 * The public product search endpoint's use case (S2-7, SDD 6.4/9.4).
 *
 * Owns the one thing `ProductSearchQueryPort` and its Prisma adapter must
 * not: the opaque cursor's wire shape. Everything below the port boundary
 * works with a decoded `{ name, id }` pair; everything above it — the
 * controller, the contract, the client — sees only an opaque string nothing
 * but this class is meant to parse.
 *
 * No authorization check here, and none needed: this runs for every caller,
 * authenticated or not, alike (SDD 9.4 "auth optional") — the rate-limit
 * tier a request lands in is decided by `optionalAuthenticate` and the
 * two-tier limiter upstream, not by this use case.
 */
export class SearchProductsUseCase {
  constructor(private readonly deps: SearchProductsDeps) {}

  async execute(input: SearchProductsInput): Promise<SearchProductsResultPage> {
    const { productSearchQuery, logger } = this.deps;

    // Decoded first: a malformed cursor is a 400 the caller can fix, not a
    // silently-ignored filter that would return page one under a different
    // name.
    const cursor = input.cursor === undefined ? undefined : decodeCursor(input.cursor);
    const limit = clampLimit(input.limit);
    const trimmedQ = input.q?.trim();
    const q = trimmedQ ? trimmedQ : undefined;

    const page = await productSearchQuery.search({
      q,
      categoryId: input.categoryId,
      vendorId: input.vendorId,
      limit,
      cursor,
    });

    // Filter flags and counts only — no search term, no product id or name:
    // a log line per search page carrying what an anonymous caller looked
    // for would build a shadow record of public search activity.
    logger.info(
      {
        hasQuery: q !== undefined,
        hasCategoryFilter: input.categoryId !== undefined,
        hasVendorFilter: input.vendorId !== undefined,
        returned: page.items.length,
        hasMore: page.hasMore,
      },
      'Public product search executed',
    );

    return {
      items: page.items,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      hasMore: page.hasMore,
    };
  }
}
