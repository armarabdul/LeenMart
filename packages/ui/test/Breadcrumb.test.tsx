import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Breadcrumb } from '../src/components/Breadcrumb.js';

const ITEMS = [
  { label: 'Catalogue', href: '/catalogue' },
  { label: 'Vegetables', href: '/catalogue/vegetables' },
  { label: 'Tomatoes' },
];

describe('Breadcrumb', () => {
  it('is a labelled navigation landmark', () => {
    render(<Breadcrumb items={ITEMS} />);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
  });

  it('links every item except the last', () => {
    render(<Breadcrumb items={ITEMS} />);
    expect(screen.getByRole('link', { name: 'Catalogue' })).toHaveAttribute('href', '/catalogue');
    expect(screen.getByRole('link', { name: 'Vegetables' })).toHaveAttribute(
      'href',
      '/catalogue/vegetables',
    );
    expect(screen.queryByRole('link', { name: 'Tomatoes' })).not.toBeInTheDocument();
  });

  it('marks the last item as the current page', () => {
    render(<Breadcrumb items={ITEMS} />);
    expect(screen.getByText('Tomatoes')).toHaveAttribute('aria-current', 'page');
  });

  it('supports a custom link renderer, e.g. a router Link', () => {
    render(
      <Breadcrumb
        items={ITEMS}
        renderLink={({ href, children }) => (
          <a data-testid="router-link" href={href}>
            {children}
          </a>
        )}
      />,
    );
    expect(screen.getAllByTestId('router-link')).toHaveLength(2);
  });
});
