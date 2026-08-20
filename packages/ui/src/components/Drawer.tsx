import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';

export type DrawerPlacement = 'bottom' | 'right';

export interface DrawerProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly hideTitle?: boolean;
  /** `bottom` — the mobile sheet pattern (filters, quick actions). `right` — the desktop side-panel pattern. Callers typically choose one responsively via a `useMediaQuery`-style check rather than rendering both. */
  readonly placement?: DrawerPlacement;
  readonly children: ReactNode;
  readonly className?: string;
}

const PLACEMENT_CLASSES: Record<DrawerPlacement, string> = {
  bottom: 'inset-x-0 bottom-0 max-h-[85vh] rounded-t-card border-t',
  right: 'inset-y-0 right-0 h-full w-full max-w-sm border-l',
};

/**
 * Same open/close/focus contract as `Modal`, anchored to an edge instead of
 * centred — the mobile bottom-sheet and desktop side-panel primitive the
 * Phase A audit called for.
 */
export const Drawer = ({
  open,
  onClose,
  title,
  hideTitle = false,
  placement = 'bottom',
  children,
  className,
}: DrawerProps): JSX.Element | null => {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!open) return;
    triggerRef.current = document.activeElement;
    panelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (triggerRef.current instanceof HTMLElement) triggerRef.current.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div aria-hidden="true" className="absolute inset-0 bg-text/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={hideTitle ? title : undefined}
        aria-labelledby={hideTitle ? undefined : 'ui-drawer-title'}
        tabIndex={-1}
        className={cn(
          'absolute overflow-y-auto border-border bg-surface p-6 shadow-card focus:outline-none',
          PLACEMENT_CLASSES[placement],
          className,
        )}
      >
        {!hideTitle && (
          <h2 id="ui-drawer-title" className="mb-4 text-lg font-semibold text-text">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
};
