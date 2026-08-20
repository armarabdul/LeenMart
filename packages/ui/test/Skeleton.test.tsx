import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from '../src/components/Skeleton.js';

describe('Skeleton', () => {
  it('is hidden from assistive technology — it carries no content of its own', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('pulses via the reduced-motion-aware animate-pulse utility', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstChild).toHaveClass('animate-pulse');
  });
});
