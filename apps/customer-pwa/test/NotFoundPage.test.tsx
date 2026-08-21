import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NotFoundPage } from '@/pages/NotFoundPage';

const renderPage = (): void => {
  render(
    <MemoryRouter>
      <NotFoundPage />
    </MemoryRouter>,
  );
};

describe('NotFoundPage', () => {
  it('renders exactly one main landmark', () => {
    renderPage();

    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('shows the 404 heading and explanation', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('The page you are looking for does not exist.')).toBeInTheDocument();
  });

  it('offers a way back to the home page', () => {
    renderPage();

    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });

  it('does not invent policy, contact or help content', () => {
    renderPage();

    expect(document.body.textContent).not.toMatch(/privacy|terms|contact us|support@/i);
  });
});
