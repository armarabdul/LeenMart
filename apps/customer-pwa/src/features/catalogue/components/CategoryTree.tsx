import { Link } from 'react-router-dom';
import type { PublicCategoryNode } from '@leen-mart/contracts';

interface CategoryTreeProps {
  readonly nodes: readonly PublicCategoryNode[];
  /** Caps recursion depth for a nav rendering (the tree itself is unbounded) — omit to render every level. */
  readonly maxDepth?: number | undefined;
}

/**
 * Recursive category navigation (Phase 2). Each node links to
 * `/catalogue/:slug`, which resolves the slug server-side via
 * `GET /catalogue/categories/:slug` — this component only needs to know the
 * slug, never the id, matching how the public API itself is addressed.
 */
export const CategoryTree = ({ nodes, maxDepth }: CategoryTreeProps): JSX.Element => (
  <ul className="flex flex-col gap-1">
    {nodes.map((node) => (
      <li key={node.id}>
        <Link
          to={`/catalogue/${node.slug}`}
          className="block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-brand-50 hover:text-brand-700"
        >
          {node.name}
        </Link>
        {node.children.length > 0 && maxDepth !== 0 && (
          <div className="ml-3 border-l border-slate-100 pl-2">
            <CategoryTree
              nodes={node.children}
              maxDepth={maxDepth === undefined ? undefined : maxDepth - 1}
            />
          </div>
        )}
      </li>
    ))}
  </ul>
);
