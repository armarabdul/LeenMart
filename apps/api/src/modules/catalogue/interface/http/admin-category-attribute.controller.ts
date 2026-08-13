import type { Request, Response } from 'express';
import type {
  AdminCategoryAttribute,
  CreateCategoryAttributeRequest,
  UpdateCategoryAttributeRequest,
} from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { CategoryAttribute } from '../../domain/entities/category-attribute.entity.js';
import { toCategoryAttributeId } from '../../domain/value-objects/category-attribute-id.value-object.js';
import { toCategoryId } from '../../domain/value-objects/category-id.value-object.js';
import type { AddCategoryAttributeUseCase } from '../../application/use-cases/add-category-attribute.use-case.js';
import type { GetCategoryAttributeUseCase } from '../../application/use-cases/get-category-attribute.use-case.js';
import type { ListCategoryAttributesUseCase } from '../../application/use-cases/list-category-attributes.use-case.js';
import type { RemoveCategoryAttributeUseCase } from '../../application/use-cases/remove-category-attribute.use-case.js';
import type { UpdateCategoryAttributeUseCase } from '../../application/use-cases/update-category-attribute.use-case.js';

export interface AdminCategoryAttributeController {
  readonly list: (req: Request, res: Response) => Promise<void>;
  readonly get: (req: Request, res: Response) => Promise<void>;
  readonly add: (req: Request, res: Response) => Promise<void>;
  readonly update: (req: Request, res: Response) => Promise<void>;
  readonly remove: (req: Request, res: Response) => Promise<void>;
}

export interface AdminCategoryAttributeControllerDeps {
  readonly addCategoryAttributeUseCase: AddCategoryAttributeUseCase;
  readonly updateCategoryAttributeUseCase: UpdateCategoryAttributeUseCase;
  readonly removeCategoryAttributeUseCase: RemoveCategoryAttributeUseCase;
  readonly getCategoryAttributeUseCase: GetCategoryAttributeUseCase;
  readonly listCategoryAttributesUseCase: ListCategoryAttributesUseCase;
}

/** Every attribute route carries both ids: an attribute is only ever addressed under its category. */
interface AttributeParams {
  categoryId: string;
  attributeId: string;
}

/**
 * Mapped field by field, never spread — the same reason the category mapper
 * gives. `deletedAt` is the field this must never publish.
 */
const toResponse = (attribute: CategoryAttribute): AdminCategoryAttribute => ({
  id: attribute.id,
  categoryId: attribute.categoryId,
  key: attribute.key,
  label: attribute.label,
  dataType: attribute.dataType.name,
  isRequired: attribute.isRequired,
  unit: attribute.unit,
  options: [...attribute.options],
  position: attribute.position,
  createdAt: attribute.createdAt.toISOString(),
  updatedAt: attribute.updatedAt.toISOString(),
});

/** A route reaching a writing handler without a principal is a wiring bug, not a request problem. */
const principalOf = (req: Request, route: string): NonNullable<Request['principal']> => {
  if (!req.principal) {
    throw new Error(`${route} reached without authenticate() middleware — req.principal is unset.`);
  }
  return req.principal;
};

const listHandler =
  (useCase: ListCategoryAttributesUseCase): AdminCategoryAttributeController['list'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, { categoryId: string }>(req);

    const attributes = await useCase.execute({ categoryId: toCategoryId(params.categoryId) });

    // No pagination envelope: this list is small, ordered and only useful
    // whole — half a form's fields is not a form.
    res.status(200).json({ data: attributes.map(toResponse), meta: { requestId: getRequestId() } });
  };

const getHandler =
  (useCase: GetCategoryAttributeUseCase): AdminCategoryAttributeController['get'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, AttributeParams>(req);

    const attribute = await useCase.execute({
      categoryId: toCategoryId(params.categoryId),
      attributeId: toCategoryAttributeId(params.attributeId),
    });

    res.status(200).json({ data: toResponse(attribute), meta: { requestId: getRequestId() } });
  };

const addHandler =
  (useCase: AddCategoryAttributeUseCase): AdminCategoryAttributeController['add'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(req, 'POST /admin/categories/:categoryId/attributes');
    const { body, params } = validatedData<
      CreateCategoryAttributeRequest,
      unknown,
      { categoryId: string }
    >(req);

    const { attribute } = await useCase.execute({
      principal,
      categoryId: toCategoryId(params.categoryId),
      key: body.key,
      label: body.label,
      dataType: body.dataType,
      isRequired: body.isRequired,
      // Read off the discriminated union rather than defaulted: the wire shape
      // has already made it impossible for either field to reach the wrong type.
      unit: body.dataType === 'NUMBER' ? (body.unit ?? null) : null,
      options: body.dataType === 'ENUM' ? body.options : [],
      position: body.position,
    });

    res.status(201).json({ data: toResponse(attribute), meta: { requestId: getRequestId() } });
  };

const updateHandler =
  (useCase: UpdateCategoryAttributeUseCase): AdminCategoryAttributeController['update'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(
      req,
      'PATCH /admin/categories/:categoryId/attributes/:attributeId',
    );
    const { body, params } = validatedData<
      UpdateCategoryAttributeRequest,
      unknown,
      AttributeParams
    >(req);

    const { attribute } = await useCase.execute({
      principal,
      categoryId: toCategoryId(params.categoryId),
      attributeId: toCategoryAttributeId(params.attributeId),
      changes: body,
    });

    res.status(200).json({ data: toResponse(attribute), meta: { requestId: getRequestId() } });
  };

const removeHandler =
  (useCase: RemoveCategoryAttributeUseCase): AdminCategoryAttributeController['remove'] =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = principalOf(
      req,
      'DELETE /admin/categories/:categoryId/attributes/:attributeId',
    );
    const { params } = validatedData<unknown, unknown, AttributeParams>(req);

    const { attribute } = await useCase.execute({
      principal,
      categoryId: toCategoryId(params.categoryId),
      attributeId: toCategoryAttributeId(params.attributeId),
    });

    res.status(200).json({ data: toResponse(attribute), meta: { requestId: getRequestId() } });
  };

/**
 * Thin HTTP adapter for the per-category attribute surface (S2-2b).
 *
 * A file of its own rather than five more handlers on the category
 * controller: they address a different resource under the same router, and
 * one 300-line controller is harder to review than two focused ones.
 *
 * Parses nothing itself, decides nothing, translates no errors — `validate()`
 * and the global error handler own those (SDD 17.1).
 */
export const createAdminCategoryAttributeController = (
  deps: AdminCategoryAttributeControllerDeps,
): AdminCategoryAttributeController => ({
  list: listHandler(deps.listCategoryAttributesUseCase),
  get: getHandler(deps.getCategoryAttributeUseCase),
  add: addHandler(deps.addCategoryAttributeUseCase),
  update: updateHandler(deps.updateCategoryAttributeUseCase),
  remove: removeHandler(deps.removeCategoryAttributeUseCase),
});
