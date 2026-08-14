import type { UserId, VendorId } from '../../../identity/index.js';
import type { ProductMediaId } from '../../domain/value-objects/product-media-id.value-object.js';

/**
 * The minimum a background job needs to process one `ProductMedia` row
 * (S2-6b) — an id to load the row by, plus the identity a worker (which has
 * no HTTP request of its own) needs to establish the same sanctioned tenant
 * context `tenantContext` middleware would have: `runWithTenant({ userId,
 * vendorId }, ...)`. Never the media object's bytes, never the whole row —
 * "the job should identify the ProductMedia record by its ID."
 */
export interface ProductMediaProcessingJob {
  readonly mediaId: ProductMediaId;
  readonly vendorId: VendorId;
  readonly userId: UserId;
}

/**
 * Enqueues asynchronous processing for one uploaded media object (S2-6b,
 * SDD 12.2 step 5). A port, not a direct BullMQ `Queue` reference from
 * `CompleteProductMediaUploadUseCase` — `BullMqProductMediaProcessingQueue`
 * is the only file in the application/domain layers that imports `bullmq`
 * (D-S2-6-A), the same boundary `ObjectStore` keeps for the AWS SDK.
 */
export interface ProductMediaProcessingQueue {
  enqueue(job: ProductMediaProcessingJob): Promise<void>;
}
