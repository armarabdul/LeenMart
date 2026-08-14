import type { VendorId } from '../../../identity/index.js';
import type { ProductId } from '../value-objects/product-id.value-object.js';
import type { ProductMediaId } from '../value-objects/product-media-id.value-object.js';
import type { CatalogueDomainEvent } from './catalogue-domain-event.js';

/**
 * SDD 12.2 step 5i: "status = READY → domain event". Constructed by the
 * worker the moment `ProductMediaRepository.markReadyIfProcessing` wins its
 * race (S2-6b) — never on a lost race, since only the winner's transition
 * actually happened.
 *
 * `ProcessProductMediaUseCase` logs this event rather than dispatching it:
 * there is no outbox relay/consumer in this milestone (D-S2-6-H), the same
 * position `identity`'s own domain events are already in — see
 * `domain-event.ts`'s own comment. A future `S2-6c`/outbox milestone can add
 * genuine dispatch without this payload changing shape.
 */
export interface ProductMediaReadyEvent
  extends CatalogueDomainEvent<'catalogue.product_media.ready'> {
  readonly mediaId: ProductMediaId;
  readonly productId: ProductId;
  readonly vendorId: VendorId;
}

export const createProductMediaReadyEvent = (props: {
  mediaId: ProductMediaId;
  productId: ProductId;
  vendorId: VendorId;
  now: Date;
}): ProductMediaReadyEvent => ({
  type: 'catalogue.product_media.ready',
  boundedContext: 'catalogue',
  occurredAt: props.now,
  mediaId: props.mediaId,
  productId: props.productId,
  vendorId: props.vendorId,
});
