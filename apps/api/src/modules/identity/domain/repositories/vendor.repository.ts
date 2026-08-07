import type { VendorId } from '../value-objects/vendor-id.value-object.js';
import type { UserId } from '../value-objects/user-id.value-object.js';
import type { VendorProfile } from '../entities/vendor-profile.entity.js';

export interface VendorRepository {
  create(vendorProfile: VendorProfile): Promise<void>;
  update(vendorProfile: VendorProfile): Promise<void>;
  findById(id: VendorId): Promise<VendorProfile | null>;
  findByUserId(userId: UserId): Promise<VendorProfile | null>;
}
