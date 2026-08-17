import type { Logger, TransactionRunner } from '@leen-mart/domain-kit';
import type { Principal } from '../../../identity/index.js';
import { VendorProfileNotFoundError } from '../../domain/errors/vendor-errors.js';
import type { VendorRepository } from '../../domain/repositories/vendor.repository.js';
import type { ServiceablePincodeRepository } from '../../domain/repositories/serviceable-pincode.repository.js';

export interface VendorServiceablePincodes {
  readonly vendorId: string;
  /**
   * Whether the vendor has declared anything at all. `false` means they
   * currently deliver everywhere (locked decision D7) — the caller surfaces
   * that explicitly rather than showing an empty list that reads as "nowhere".
   */
  readonly configured: boolean;
  readonly pincodes: readonly string[];
}

export interface GetVendorServiceablePincodesInput {
  readonly principal: Principal;
}

export interface SetVendorServiceablePincodesInput {
  readonly principal: Principal;
  readonly pincodes: readonly string[];
}

export interface VendorServiceablePincodeDeps {
  readonly vendorRepository: VendorRepository;
  readonly serviceablePincodeRepository: ServiceablePincodeRepository;
  readonly transactionRunner: TransactionRunner;
  readonly logger: Logger;
}

/** Sorted and de-duplicated, so the stored set and every response are order-stable. */
const normalise = (pincodes: readonly string[]): readonly string[] => [...new Set(pincodes)].sort();

/**
 * A vendor reads back its own delivery serviceability set (S4-SERV).
 *
 * Resolved from `principal.userId`, never from a request-supplied vendor id —
 * the same discipline every other `/me/*` vendor route follows, and what makes
 * "vendor A reads vendor B's set" unspellable rather than merely refused.
 */
export class GetVendorServiceablePincodesUseCase {
  constructor(private readonly deps: VendorServiceablePincodeDeps) {}

  async execute(input: GetVendorServiceablePincodesInput): Promise<VendorServiceablePincodes> {
    const { vendorRepository, serviceablePincodeRepository } = this.deps;

    const vendor = await vendorRepository.findByUserId(input.principal.userId);
    if (!vendor) {
      throw new VendorProfileNotFoundError();
    }

    const pincodes = await serviceablePincodeRepository.findAllByVendor(vendor.id);
    return { vendorId: vendor.id, configured: pincodes.length > 0, pincodes };
  }
}

/**
 * A vendor replaces its own delivery serviceability set (S4-SERV, locked
 * decision D1). Gated by `CONFIGURE_DELIVERY_SLOTS` — SDD 8.2's own
 * "Configure delivery/slots" row (VENDOR_OWNER/VENDOR_MANAGER: `OWN`), which
 * existed with no route until this milestone.
 *
 * **Transactional**, unlike the other vendor self-service writes: replacement
 * is a delete followed by an insert, and a crash between them would leave the
 * vendor with an empty set — which under D7 silently means "serves
 * everywhere", the opposite of a partially-applied restriction. The two
 * statements therefore commit together or not at all.
 *
 * An empty array is accepted and meaningful: it clears the set and returns the
 * vendor to the unconfigured, serve-everywhere state.
 *
 * The vendor's own shop pincode is **not** added implicitly (locked decision
 * D2) — the set is exactly what the vendor declared.
 *
 * No audit record, following the same established shop-profile convention
 * `SetVendorShopNameUseCase`, `SetVendorPickupCapabilityUseCase` and
 * `SetVendorShopAddressUseCase` all use: `auditWriter` in this module is
 * reserved for KYC and admin decisions.
 */
export class SetVendorServiceablePincodesUseCase {
  constructor(private readonly deps: VendorServiceablePincodeDeps) {}

  async execute(input: SetVendorServiceablePincodesInput): Promise<VendorServiceablePincodes> {
    const { vendorRepository, serviceablePincodeRepository, transactionRunner, logger } = this.deps;

    const vendor = await vendorRepository.findByUserId(input.principal.userId);
    if (!vendor) {
      throw new VendorProfileNotFoundError();
    }

    const pincodes = normalise(input.pincodes);
    await transactionRunner.run(async (scope) => {
      await serviceablePincodeRepository
        .withTransaction(scope)
        .replaceForVendor(vendor.id, pincodes);
    });

    // The pincodes themselves are not logged: a vendor's delivery footprint is
    // its own commercial information, and the count is all an operator needs.
    logger.info(
      { vendorId: vendor.id, pincodeCount: pincodes.length },
      'Vendor replaced their serviceable pincode set',
    );
    return { vendorId: vendor.id, configured: pincodes.length > 0, pincodes };
  }
}
