import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchInput } from '../src/components/SearchInput.js';

describe('SearchInput', () => {
  it('has an accessible name even with the visible label hidden', () => {
    render(<SearchInput value="" onChange={() => undefined} />);
    expect(screen.getByRole('searchbox', { name: 'Search' })).toBeInTheDocument();
  });

  it('shows the clear button only once there is a value, and it clears on click', async () => {
    const onClear = vi.fn();
    const { rerender } = render(
      <SearchInput value="" onChange={() => undefined} onClear={onClear} />,
    );
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();

    rerender(<SearchInput value="milk" onChange={() => undefined} onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('never renders a clear button when no onClear is given', () => {
    render(<SearchInput value="milk" onChange={() => undefined} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
