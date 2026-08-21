import type { PublicCategoryNode } from '@leen-mart/contracts';
import type { SelectOption } from '@leen-mart/ui';

/**
 * Flattens the public category tree into a single depth-indented option
 * list for the product-category `<Select>` (Phase J). There is no
 * vendor-facing tree picker in `@leen-mart/ui`, and a flat `<select>` is
 * standard, fully keyboard- and screen-reader-accessible HTML — the same
 * "native is appropriate" call this app's form fields already make
 * elsewhere.
 */
export const flattenCategoryTree = (
  nodes: readonly PublicCategoryNode[],
  depth = 0,
): SelectOption[] =>
  nodes.flatMap((node) => [
    { value: node.id, label: `${'— '.repeat(depth)}${node.name}` },
    ...flattenCategoryTree(node.children, depth + 1),
  ]);
