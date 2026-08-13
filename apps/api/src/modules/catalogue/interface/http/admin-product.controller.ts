import type { Request, Response } from 'express';
import type {
  AdminProductDetail,
  AdminProductQueueItem,
  AdminProductQueueQuery,
  DecideProductRequest,
  DecideProductResponse,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { Product } from '../../domain/entities/product.entity.js';
import { toProductId } from '../../domain/value-objects/product-id.value-object.js';
import type {
  ProductReviewDetail,
  ProductReviewQueueItem,
} from '../../application/ports/product-review-query.port.js';
import type { GetProductReviewUseCase } from '../../application/use-cases/get-product-review.use-case.js';
import type { ListProductReviewQueueUseCase } from '../../application/use-cases/list-product-review-queue.use-case.js';
import type { DecideProductUseCase } from '../../application/use-cases/decide-product.use-case.js';

export interface AdminProductController {
  readonly listQueue: (req: Request, res: Response) => Promise<void>;
  readonly getSubmission: (req: Request, res: Response) => Promise<void>;
  readonly decide: (req: Request, res: Response) => Promise<void>;
}

export interface AdminProductControllerDeps {
  readonly listProductReviewQueueUseCase: ListProductReviewQueueUseCase;
  readonly getProductReviewUseCase: GetProductReviewUseCase;
  readonly decideProductUseCase: DecideProductUseCase;
}

/** Mapped field by field, never spread — the same reason `toQueueItem`/`toDetail` in `admin-kyc.controller.ts` are. */
const toQueueItem = (item: ProductReviewQueueItem): AdminProductQueueItem => ({
  productId: item.productId,
  vendorId: item.vendorId,
  categoryId: item.categoryId,
  name: item.name,
  status: item.status,
  updatedAt: item.updatedAt.toISOString(),
});

const toDetail = (detail: ProductReviewDetail): AdminProductDetail => ({
  productId: detail.productId,
  vendorId: detail.vendorId,
  categoryId: detail.categoryId,
  name: detail.name,
  brand: detail.brand,
  description: detail.description,
  hsnCode: detail.hsnCode,
  countryOfOrigin: detail.countryOfOrigin,
  netQuantity: detail.netQuantity,
  attributeValues: detail.attributeValues,
  status: detail.status,
  rejectionReason: detail.rejectionReason as AdminProductDetail['rejectionReason'],
  rejectionNote: detail.rejectionNote,
  createdAt: detail.createdAt.toISOString(),
  updatedAt: detail.updatedAt.toISOString(),
});

const toDecisionResponse = (product: Product): DecideProductResponse => ({
  productId: product.id,
  status: product.status as DecideProductResponse['status'],
  rejectionReason:
    (product.rejectionReason?.name as DecideProductResponse['rejectionReason']) ?? null,
  rejectionNote: product.rejectionNote,
  updatedAt: product.updatedAt.toISOString(),
});

/** Narrows the wire union to the use case's command; the two shapes are deliberately separate. */
const toDecisionCommand = (
  body: DecideProductRequest,
): { decision: 'APPROVE' } | { decision: 'REJECT'; reason: string; note?: string | undefined } =>
  body.decision === 'APPROVE'
    ? { decision: 'APPROVE' }
    : { decision: 'REJECT', reason: body.reason, note: body.note };

/**
 * Thin HTTP adapter for the admin product moderation surface (S2-5). Parses
 * nothing itself, decides nothing, translates no errors — `validate()` and
 * the global error handler own those (SDD 17.1), mirroring
 * `admin-kyc.controller.ts` exactly.
 *
 * Both `listQueue` and `getSubmission` are `GET` and neither writes: opening
 * the queue or a product must leave every row exactly as it was — there is no
 * claim step here to accidentally trigger (S2-5 D-5-D).
 */
export const createAdminProductController = (
  deps: AdminProductControllerDeps,
): AdminProductController => ({
  listQueue: async (req: Request, res: Response): Promise<void> => {
    const { query } = validatedData<unknown, AdminProductQueueQuery>(req);

    const page = await deps.listProductReviewQueueUseCase.execute({
      statuses: query.status,
      limit: query.limit,
      cursor: query.cursor,
    });

    res.status(200).json({
      data: page.items.map(toQueueItem),
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      },
    });
  },

  getSubmission: async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, { productId: string }>(req);

    const detail = await deps.getProductReviewUseCase.execute({
      productId: toProductId(params.productId),
    });

    res.status(200).json({ data: toDetail(detail), meta: { requestId: getRequestId() } });
  },

  decide: async (req: Request, res: Response): Promise<void> => {
    if (!req.principal) {
      throw new Error(
        'POST /admin/products/:productId/decision reached without authenticate() middleware — req.principal is unset.',
      );
    }
    const { body, params } = validatedData<DecideProductRequest, unknown, { productId: string }>(
      req,
    );

    const { product } = await deps.decideProductUseCase.execute({
      principal: req.principal,
      productId: toProductId(params.productId),
      command: toDecisionCommand(body),
    });

    res
      .status(200)
      .json({ data: toDecisionResponse(product), meta: { requestId: getRequestId() } });
  },
});
