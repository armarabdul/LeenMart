import type { Request, Response } from 'express';
import type { PublicCategoryNode } from '@leen-mart/contracts';
import { getRequestId } from '../../../../shared/interface/http/middleware/request-context.js';
import { validatedData } from '../../../../shared/interface/http/middleware/validate.js';
import type { Category } from '../../domain/entities/category.entity.js';
import { toCategorySlug } from '../../domain/value-objects/category-slug.value-object.js';
import type {
  GetPublicCategoryTreeUseCase,
  PublicCategoryTreeNode,
} from '../../application/use-cases/get-public-category-tree.use-case.js';
import type { GetPublicCategoryUseCase } from '../../application/use-cases/get-public-category.use-case.js';

export interface PublicCategoryController {
  readonly list: (req: Request, res: Response) => Promise<void>;
  readonly get: (req: Request, res: Response) => Promise<void>;
}

export interface PublicCategoryControllerDeps {
  readonly getPublicCategoryTreeUseCase: GetPublicCategoryTreeUseCase;
  readonly getPublicCategoryUseCase: GetPublicCategoryUseCase;
}

/** Mapped field by field, never spread — the same reason every other `toResponse` in this module gives. */
const toNode = (
  category: Category,
  children: readonly PublicCategoryNode[],
): PublicCategoryNode => ({
  id: category.id,
  parentId: category.parentId,
  name: category.name,
  slug: category.slug,
  children,
});

/** Recurses through the use case's already-nested tree, mapping each level with `toNode`. */
const toTreeNode = (node: PublicCategoryTreeNode): PublicCategoryNode =>
  toNode(node.category, node.children.map(toTreeNode));

const listHandler =
  (useCase: GetPublicCategoryTreeUseCase): PublicCategoryController['list'] =>
  async (_req: Request, res: Response): Promise<void> => {
    const forest = await useCase.execute();
    res.status(200).json({ data: forest.map(toTreeNode), meta: { requestId: getRequestId() } });
  };

const getHandler =
  (useCase: GetPublicCategoryUseCase): PublicCategoryController['get'] =>
  async (req: Request, res: Response): Promise<void> => {
    const { params } = validatedData<unknown, unknown, { slug: string }>(req);

    const { category, children } = await useCase.execute({ slug: toCategorySlug(params.slug) });

    // One level only (S2-2c decision 2): each child's own `children` is empty
    // rather than recursed, so this never becomes an accidental full-subtree
    // fetch.
    const node = toNode(
      category,
      children.map((child) => toNode(child, [])),
    );
    res.status(200).json({ data: node, meta: { requestId: getRequestId() } });
  };

/**
 * Thin HTTP adapter for the public taxonomy surface (S2-2c). Parses nothing
 * itself, decides nothing, and translates no errors — `validate()` and the
 * global error handler own those (SDD 17.1), the same as every other
 * controller in this module.
 */
export const createPublicCategoryController = (
  deps: PublicCategoryControllerDeps,
): PublicCategoryController => ({
  list: listHandler(deps.getPublicCategoryTreeUseCase),
  get: getHandler(deps.getPublicCategoryUseCase),
});
