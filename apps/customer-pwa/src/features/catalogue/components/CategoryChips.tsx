import { NavLink } from 'react-router-dom';
import type { PublicCategoryNode } from '@leen-mart/contracts';

interface CategoryChipsProps {
  readonly nodes: readonly PublicCategoryNode[];
  /** Renders an "All" chip that clears the category filter. */
  readonly includeAll?: boolean;
  readonly label: string;
}

const chipClassName = ({ isActive }: { isActive: boolean }): string =>
  [
    'inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-4 text-sm transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
    isActive
      ? 'border-primary bg-primary text-on-primary'
      : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text',
  ].join(' ');

/**
 * Top-level categories as a single scrollable row.
 *
 * A tree is the right shape for a desktop rail, but on a phone it turns
 * category discovery into vertical scrolling before any product is visible.
 * A horizontal chip row keeps the whole first level reachable in one gesture
 * and costs one line of vertical space.
 *
 * `overflow-x-auto` with `shrink-0` chips is what keeps this from wrapping
 * into a tall block — and the row scrolls rather than the page, so a wide
 * category set can never introduce horizontal overflow on the document.
 */
export const CategoryChips = ({
  nodes,
  includeAll = false,
  label,
}: CategoryChipsProps): JSX.Element => (
  <nav aria-label={label} className="-mx-4 px-4 sm:mx-0 sm:px-0">
    <ul className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {includeAll && (
        <li>
          <NavLink to="/catalogue" end className={chipClassName}>
            All
          </NavLink>
        </li>
      )}
      {nodes.map((node) => (
        <li key={node.id}>
          <NavLink to={`/catalogue/${node.slug}`} className={chipClassName}>
            {node.name}
          </NavLink>
        </li>
      ))}
    </ul>
  </nav>
);
