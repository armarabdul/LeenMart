import type { ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface BreadcrumbItem {
  readonly label: string;
  /** Omit on the last/current item — it renders as plain text with `aria-current="page"`, not a link to itself. */
  readonly href?: string;
}

export interface BreadcrumbProps {
  readonly items: readonly BreadcrumbItem[];
  /**
   * How each non-final item renders. Defaults to a plain `<a>` — pass a
   * router's own `Link` (e.g. `(props) => <RouterLink to={props.href} .../>`)
   * so breadcrumb navigation doesn't force a full page reload.
   */
  readonly renderLink?: (item: {
    readonly href: string;
    readonly children: ReactNode;
  }) => ReactNode;
  readonly className?: string;
}

const DefaultLink = ({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}): JSX.Element => (
  <a href={href} className="text-text-muted hover:text-primary">
    {children}
  </a>
);

export const Breadcrumb = ({ items, renderLink, className }: BreadcrumbProps): JSX.Element => {
  const Link = renderLink ?? DefaultLink;

  return (
    <nav aria-label="Breadcrumb" className={className}>
      <ol className={cn('flex flex-wrap items-center gap-1.5 text-sm')}>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex items-center gap-1.5">
              {index > 0 && (
                <span aria-hidden="true" className="text-text-faint">
                  /
                </span>
              )}
              {isLast || !item.href ? (
                <span aria-current={isLast ? 'page' : undefined} className="font-medium text-text">
                  {item.label}
                </span>
              ) : (
                <Link href={item.href}>{item.label}</Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
};
