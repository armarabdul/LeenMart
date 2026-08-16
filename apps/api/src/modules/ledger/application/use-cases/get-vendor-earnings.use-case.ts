import type { Principal } from '../../../identity/index.js';
import type { VendorRepository } from '../../../vendor/domain/repositories/vendor.repository.js';
import type {
  VendorEarningsQueryPort,
  VendorEarningsSummary,
  VendorEarningsLinesPage,
} from '../ports/vendor-earnings-query.port.js';
import { requireActiveVendor } from '../support/require-active-vendor.js';

export interface GetVendorEarningsInput {
  readonly principal: Principal;
  readonly limit: number;
  readonly cursor?: string | undefined;
}

export interface GetVendorEarningsResult {
  readonly summary: VendorEarningsSummary;
  readonly lines: VendorEarningsLinesPage;
}

export interface GetVendorEarningsDeps {
  readonly vendorRepository: VendorRepository;
  readonly vendorEarningsQuery: VendorEarningsQueryPort;
}

/**
 * "Vendor Earnings Statement" (S3-8, `VIEW_VENDOR_EARNINGS`) — a single
 * read combining the summary and one page of statement lines, per locked
 * decision #4's preference for the simpler shape over two endpoints. Both
 * halves are read fresh from the ledger on every call: there is no
 * intermediate stored total to fall out of sync with it (locked decision
 * #3/#7).
 *
 * Read-only, like `ListVendorOrdersUseCase`/`GetVendorOrderUseCase`: no
 * audit record and no outbox event are written for an ordinary read (locked
 * decision #12).
 */
export class GetVendorEarningsUseCase {
  constructor(private readonly deps: GetVendorEarningsDeps) {}

  async execute(input: GetVendorEarningsInput): Promise<GetVendorEarningsResult> {
    const { vendorRepository, vendorEarningsQuery } = this.deps;
    const vendor = await requireActiveVendor(vendorRepository, input.principal.userId);

    const [summary, lines] = await Promise.all([
      vendorEarningsQuery.getSummary(vendor.id),
      vendorEarningsQuery.listLines({
        vendorId: vendor.id,
        limit: input.limit,
        cursor: input.cursor,
      }),
    ]);

    return { summary, lines };
  }
}
