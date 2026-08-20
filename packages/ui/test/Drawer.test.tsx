import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Drawer } from '../src/components/Drawer.js';

describe('Drawer', () => {
  it('renders nothing when closed', () => {
    render(
      <Drawer open={false} onClose={() => undefined} title="Filters">
        content
      </Drawer>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders as a labelled dialog anchored per its placement, defaulting to bottom', () => {
    render(
      <Drawer open onClose={() => undefined} title="Filters">
        content
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.className).toContain('bottom-0');
  });

  it('anchors to the right edge when placement="right"', () => {
    render(
      <Drawer open onClose={() => undefined} title="Filters" placement="right">
        content
      </Drawer>,
    );
    expect(screen.getByRole('dialog').className).toContain('right-0');
  });

  it('calls onClose on Escape', async () => {
    const onClose = vi.fn();
    render(
      <Drawer open onClose={onClose} title="Filters">
        content
      </Drawer>,
    );
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
