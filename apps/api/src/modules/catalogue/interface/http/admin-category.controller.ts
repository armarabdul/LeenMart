import type { Request, Response } from 'express';
import type {
  AdminCategory,
  AdminCategoryListQuery,
  CreateCategoryRequest,
  ReparentCategoryRequest,
  UpdateCategoryRequest,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { Category } from '../../domain/entities/category.entity.js';
import { toCategoryId } from '../../domain/value-objects/category-id.value-object.js';
import { toCategorySlug } from '../../domain/value-objects/category-slug.value-object.js';
import type { CreateCategoryUseCase } from '../../application/use-cases/create-category.use-case.js';
import type { DeleteCategoryUseCase } from '../../application/use-cases/delete-category.use-case.js';
import type { GetCategoryUseCase } from '../../application/use-cases/get-category.use-case.js';
import type { ListCategoriesUseCase } from '../../application/use-cases/list-categories.use-case.js';
import type { ReparentCategoryUseCase } from '../../application/use-cases/reparent-category.use-case.js';
import type { UpdateCategoryUseCase } from '../../application/use-cases/update-category.use-case.js';

export interface AdminCategoryController {
  readonly list: (req: Request, res: Response) => Promise<void>;
  readonly get: (req: Request, res: Response) => Promise<void>;
  readonly create: (req: Request, res: Response) => Promise<void>;
  readonly update: (req: Request, res: Response) => Promise<void>;
  readonly reparent: (req: Request, res: Response) => Promise<void>;
  readonly remove: (req: Request, res: Response) => Promise<void>;
}

export interface AdminCategoryControllerDeps {
  readonly createCategoryUseCase: CreateCategoryUseCase;
  readonly updateCategoryUseCase: UpdateCategoryUseCase;
  readonly reparentCategoryUseCase: ReparentCategoryUseCase;
  readonly deleteCategoryUseCase: DeleteCategoryUseCase;
  readonly getCategoryUseCase: GetCategoryUseCase;
  readonly listCategoriesUseCase: ListCategoriesUseCase;
}

/**
 * Mapped field by field, never spread — the same reason `toQueueItem` gives:
 * a spread publishes whatever a future column is called, and `deletedAt` is
 * already one field this response must never carry.
 */
const toResponse = (category: Category): AdminCategory => ({
  id: category.id,
  parentId: category.parentId,
  path: [...category.path],
  depth: category.depth,
  name: category.name,
  slug: category.slug,
  riskLevel: category.riskLevel.name,
  requirements: category.requirements,
  isActive: category.isActive,
  createdAt: category.createdAt.toISOString(),
  updatedAt: category.updatedAt.toISOString(),
});

/** Every writing handler needs the verified principal; a route reaching here without one is a wiring bug. */
const principalOf = (req: Request, route: string): NonNullable<Request['principal']> => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  return req.principal;
};

/**
 * Each handler is built by its own factory rather than declared inline in one
 * object literal — the same shape `createAccessDocumentHandler` uses in the
 * vendor module, and what keeps this file under its max-lines-per-function
 * budget as the surface grows.
 */
const listHandler =
  (useCase: ListCategoriesUseCase): AdminCategoryController['list'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { query } = validatedData<unknown, AdminCategoryListQuery>(req);

    const page = await useCase.execute({ limit: query.limit, cursor: query.cursor });

    res.status(200).json({
      data: page.items.map(toResponse),
      // The platform's existing pagination envelope (SDD 9.3).
      meta: {
        requestId: getRequestId(),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      },
    });
  };

const getHandler =
  (useCase: GetCategoryUseCase): AdminCategoryController['get'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, { categoryId: string }>(req);

    const category = await useCase.execute({ categoryId: toCategoryId(params.categoryId) });

    res.status(200).json({ data: toResponse(category), meta: { requestId: getRequestId() } });
  };

const createHandler =
  (useCase: CreateCategoryUseCase): AdminCategoryController['create'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'POST /admin/categories');
    const { body } = validatedData<CreateCategoryRequest>(req);

    const { category } = await useCase.execute({
      principal,
      parentId: body.parentId ? toCategoryId(body.parentId) : null,
      name: body.name,
      slug: toCategorySlug(body.slug),
      riskLevel: body.riskLevel,
      requirements: body.requirements,
    });

    res.status(201).json({ data: toResponse(category), meta: { requestId: getRequestId() } });
  };

const updateHandler =
  (useCase: UpdateCategoryUseCase): AdminCategoryController['update'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'PATCH /admin/categories/:categoryId');
    const { body, params } = validatedData<UpdateCategoryRequest, unknown, { categoryId: string }>(
      req,
    );

    const { category } = await useCase.execute({
      principal,
      categoryId: toCategoryId(params.categoryId),
      changes: body,
    });

    res.status(200).json({ data: toResponse(category), meta: { requestId: getRequestId() } });
  };

const reparentHandler =
  (useCase: ReparentCategoryUseCase): AdminCategoryController['reparent'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'POST /admin/categories/:categoryId/parent');
    const { body, params } = validatedData<
      ReparentCategoryRequest,
      unknown,
      { categoryId: string }
    >(req);

    const { category } = await useCase.execute({
      principal,
      categoryId: toCategoryId(params.categoryId),
      newParentId: body.parentId ? toCategoryId(body.parentId) : null,
    });

    res.status(200).json({ data: toResponse(category), meta: { requestId: getRequestId() } });
  };

const removeHandler =
  (useCase: DeleteCategoryUseCase): AdminCategoryController['remove'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'DELETE /admin/categories/:categoryId');
    const { params } = validatedData<unknown, unknown, { categoryId: string }>(req);

    const { category } = await useCase.execute({
      principal,
      categoryId: toCategoryId(params.categoryId),
    });

    res.status(200).json({ data: toResponse(category), meta: { requestId: getRequestId() } });
  };

/**
 * Thin HTTP adapter for the admin taxonomy surface. Parses nothing itself,
 * decides nothing, and translates no errors — `validate()` and the global
 * error handler own those (SDD 17.1).
 */
export const createAdminCategoryController = (
  deps: AdminCategoryControllerDeps,
): AdminCategoryController => ({
  list: listHandler(deps.listCategoriesUseCase),
  get: getHandler(deps.getCategoryUseCase),
  create: createHandler(deps.createCategoryUseCase),
  update: updateHandler(deps.updateCategoryUseCase),
  reparent: reparentHandler(deps.reparentCategoryUseCase),
  remove: removeHandler(deps.deleteCategoryUseCase),
});
