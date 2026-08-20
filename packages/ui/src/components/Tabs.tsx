import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface TabItem {
  readonly value: string;
  readonly label: string;
  readonly content: ReactNode;
  readonly disabled?: boolean;
}

export interface TabsProps {
  readonly items: readonly TabItem[];
  /** Omit for uncontrolled use (defaults to the first non-disabled tab); pass both `value`/`onChange` to control it. */
  readonly value?: string;
  readonly onChange?: (value: string) => void;
  readonly className?: string;
}

/** Full WAI-ARIA tabs pattern: roving tabindex, arrow-key navigation between tabs, Home/End to jump to the first/last. */
export const Tabs = ({ items, value, onChange, className }: TabsProps): JSX.Element => {
  const baseId = useId();
  const firstEnabled = items.find((item) => !item.disabled)?.value ?? items[0]?.value ?? '';
  const [internalValue, setInternalValue] = useState(firstEnabled);
  const activeValue = value ?? internalValue;

  const select = (next: string): void => {
    setInternalValue(next);
    onChange?.(next);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const enabled = items.filter((item) => !item.disabled);
    const currentIndex = enabled.findIndex((item) => item.value === activeValue);
    if (currentIndex === -1) return;

    const focusAt = (index: number): void => {
      const target = enabled[index];
      if (!target) return;
      select(target.value);
      document.getElementById(`${baseId}-tab-${target.value}`)?.focus();
    };

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusAt((currentIndex + 1) % enabled.length);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusAt((currentIndex - 1 + enabled.length) % enabled.length);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusAt(enabled.length - 1);
    }
  };

  const activeItem = items.find((item) => item.value === activeValue);

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className="flex gap-1 border-b border-border"
      >
        {items.map((item) => {
          const selected = item.value === activeValue;
          return (
            <button
              key={item.value}
              id={`${baseId}-tab-${item.value}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${item.value}`}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => select(item.value)}
              className={cn(
                'border-b-2 px-3 py-2 text-sm font-medium -mb-px',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:rounded',
                'disabled:cursor-not-allowed disabled:opacity-50',
                selected
                  ? 'border-primary text-primary'
                  : 'border-transparent text-text-muted hover:text-text',
              )}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {activeItem && (
        <div
          id={`${baseId}-panel-${activeItem.value}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${activeItem.value}`}
          tabIndex={0}
          className="pt-4 focus-visible:outline-none"
        >
          {activeItem.content}
        </div>
      )}
    </div>
  );
};
