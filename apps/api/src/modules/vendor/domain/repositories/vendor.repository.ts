import type { UserId, VendorId } from '../../../identity/index.js';
import type { VendorProfile } from '../entities/vendor-profile.entity.js';

/**
 * Relocated from `identity` (SDD 5 assigns the vendor profile and its
 * lifecycle to module 3, `vendor`). `findByUserId` is what enforces one
 * vendor profile per account at registration time.
 */
export interface VendorRepository {
  create(vendorProfile: VendorProfile): Promise<void>;
  update(vendorProfile: VendorProfile): Promise<void>;
  findById(id: VendorId): Promise<VendorProfile | null>;
  findByUserId(userId: UserId): Promise<VendorProfile | null>;
}
