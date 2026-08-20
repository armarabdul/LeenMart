import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from '../src/components/Tabs.js';

const ITEMS = [
  { value: 'details', label: 'Details', content: <p>Product details</p> },
  { value: 'reviews', label: 'Reviews', content: <p>Product reviews</p> },
  { value: 'shipping', label: 'Shipping', content: <p>Shipping info</p> },
];

describe('Tabs', () => {
  it('shows the first tab’s panel by default', () => {
    render(<Tabs items={ITEMS} />);
    expect(screen.getByText('Product details')).toBeInTheDocument();
    expect(screen.queryByText('Product reviews')).not.toBeInTheDocument();
  });

  it('switches panels on click, and marks the active tab selected', async () => {
    render(<Tabs items={ITEMS} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Reviews' }));

    expect(screen.getByText('Product reviews')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reviews' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'false');
  });

  it('moves selection with ArrowRight/ArrowLeft, wrapping at the ends', async () => {
    render(<Tabs items={ITEMS} />);
    const details = screen.getByRole('tab', { name: 'Details' });
    details.focus();

    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Reviews' })).toHaveFocus();

    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Shipping' })).toHaveFocus();
  });

  it('jumps to the first/last tab with Home/End', async () => {
    render(<Tabs items={ITEMS} />);
    screen.getByRole('tab', { name: 'Reviews' }).focus();

    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Shipping' })).toHaveFocus();

    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'Details' })).toHaveFocus();
  });

  it('supports controlled usage via value/onChange', async () => {
    const ControlledHarness = (): JSX.Element => {
      const [value, setValue] = useState('details');
      return <Tabs items={ITEMS} value={value} onChange={setValue} />;
    };
    render(<ControlledHarness />);
    await userEvent.click(screen.getByRole('tab', { name: 'Shipping' }));
    expect(screen.getByText('Shipping info')).toBeInTheDocument();
  });
});
