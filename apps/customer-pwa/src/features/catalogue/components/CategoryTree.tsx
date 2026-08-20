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
          // Phase D: design tokens, and a 36px row so a rail entry is a
          // comfortable target rather than a 26px line of text.
          className="flex min-h-9 items-center rounded-md px-2 text-sm text-text-muted transition-colors hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {node.name}
        </Link>
        {node.children.length > 0 && maxDepth !== 0 && (
          <div className="ml-3 border-l border-border pl-2">
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
