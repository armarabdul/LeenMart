import type { Request, Response } from 'express';
import type {
  CreateProductMediaUploadIntentRequest,
  CreateProductMediaUploadIntentResponse,
  VendorProductMedia,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { ProductMedia } from '../../domain/entities/product-media.entity.js';
import { toProductId } from '../../domain/value-objects/product-id.value-object.js';
import { toProductMediaId } from '../../domain/value-objects/product-media-id.value-object.js';
import type { CompleteProductMediaUploadUseCase } from '../../application/use-cases/complete-product-media-upload.use-case.js';
import type { CreateProductMediaUploadIntentUseCase } from '../../application/use-cases/create-product-media-upload-intent.use-case.js';
import type { ListProductMediaUseCase } from '../../application/use-cases/list-product-media.use-case.js';
import type { RemoveProductMediaUseCase } from '../../application/use-cases/remove-product-media.use-case.js';

export interface VendorProductMediaController {
  readonly createUploadIntent: (req: Request, res: Response) => Promise<void>;
  readonly complete: (req: Request, res: Response) => Promise<void>;
  readonly list: (req: Request, res: Response) => Promise<void>;
  readonly remove: (req: Request, res: Response) => Promise<void>;
}

export interface VendorProductMediaControllerDeps {
  readonly createProductMediaUploadIntentUseCase: CreateProductMediaUploadIntentUseCase;
  readonly completeProductMediaUploadUseCase: CompleteProductMediaUploadUseCase;
  readonly listProductMediaUseCase: ListProductMediaUseCase;
  readonly removeProductMediaUseCase: RemoveProductMediaUseCase;
}

/** Every media route carries both ids: a media item is only ever addressed under its product, the same shape `VariantParams` uses. */
interface MediaParams {
  productId: string;
  mediaId: string;
}

/** A route reaching a writing handler without a principal is a wiring bug, not a request problem — mirrors `vendor-product-variant.controller.ts`'s own `principalOf`. */
const principalOf = (req: Request, route: string): NonNullable<Request['principal']> => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  return req.principal;
};

/** `objectKey`/`vendorId`/`deletedAt` never leave this boundary — mapped field by field, never spread, the same discipline `toProductResponse` keeps. */
export const toMediaResponse = (media: ProductMedia): VendorProductMedia => ({
  id: media.id,
  productId: media.productId,
  contentType: media.contentType,
  sizeBytes: media.sizeBytes,
  status: media.status,
  createdAt: media.createdAt.toISOString(),
  updatedAt: media.updatedAt.toISOString(),
});

const createUploadIntentHandler =
  (
    useCase: CreateProductMediaUploadIntentUseCase,
  ): VendorProductMediaController['createUploadIntent'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'POST /vendor/products/:productId/media');
    const { body, params } = validatedData<
      CreateProductMediaUploadIntentRequest,
      unknown,
      { productId: string }
    >(req);

    const { media, uploadUrl, expiresAt } = await useCase.execute({
      principal,
      productId: toProductId(params.productId),
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
    });

    const response: CreateProductMediaUploadIntentResponse = {
      mediaId: media.id,
      uploadUrl,
      expiresAt: expiresAt.toISOString(),
      // Echoes the validated request, not `media.contentType` — the entity
      // stores it shape-checked only (a plain `string`), while the wire type
      // is the narrower allowlist `body.contentType` already satisfied.
      contentType: body.contentType,
      sizeBytes: media.sizeBytes,
      status: media.status,
    };

    res.status(201).json({ data: response, meta: { requestId: getRequestId() } });
  };

const completeHandler =
  (useCase: CompleteProductMediaUploadUseCase): VendorProductMediaController['complete'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'POST /vendor/products/:productId/media/:mediaId/complete');
    const { params } = validatedData<unknown, unknown, MediaParams>(req);

    const { media } = await useCase.execute({
      principal,
      productId: toProductId(params.productId),
      mediaId: toProductMediaId(params.mediaId),
    });

    res.status(200).json({ data: toMediaResponse(media), meta: { requestId: getRequestId() } });
  };

const listHandler =
  (useCase: ListProductMediaUseCase): VendorProductMediaController['list'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, { productId: string }>(req);

    const media = await useCase.execute({ productId: toProductId(params.productId) });

    // No pagination envelope: capped at `MAX_IMAGES_PER_PRODUCT` (8), the same
    // reasoning `listHandler` in `vendor-product-variant.controller.ts` gives.
    res.status(200).json({ data: media.map(toMediaResponse), meta: { requestId: getRequestId() } });
  };

const removeHandler =
  (useCase: RemoveProductMediaUseCase): VendorProductMediaController['remove'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'DELETE /vendor/products/:productId/media/:mediaId');
    const { params } = validatedData<unknown, unknown, MediaParams>(req);

    const { media } = await useCase.execute({
      principal,
      productId: toProductId(params.productId),
      mediaId: toProductMediaId(params.mediaId),
    });

    res.status(200).json({ data: toMediaResponse(media), meta: { requestId: getRequestId() } });
  };

/**
 * Thin HTTP adapter for the per-product media surface (S2-6a). A file of its
 * own for the same reason `vendor-product-variant.controller.ts` is: a
 * different resource under the same router, split out to keep each file
 * within its line budget.
 */
export const createVendorProductMediaController = (
  deps: VendorProductMediaControllerDeps,
): VendorProductMediaController => ({
  createUploadIntent: createUploadIntentHandler(deps.createProductMediaUploadIntentUseCase),
  complete: completeHandler(deps.completeProductMediaUploadUseCase),
  list: listHandler(deps.listProductMediaUseCase),
  remove: removeHandler(deps.removeProductMediaUseCase),
});
