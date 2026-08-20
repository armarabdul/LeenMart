import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';

export interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  /** Visually hides `title` while keeping it as the dialog's accessible name — set when the panel already shows its own heading. */
  readonly hideTitle?: boolean;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * A centred dialog: overlay, Escape-to-close, click-outside-to-close, and
 * focus moved onto the panel on open and back to whatever triggered it on
 * close — the minimum a modal needs to be operable by keyboard, not a full
 * focus-trap implementation (no library pulled in for it; nothing here
 * currently nests a second focusable region deep enough to need one).
 */
export const Modal = ({
  open,
  onClose,
  title,
  hideTitle = false,
  children,
  className,
}: ModalProps): JSX.Element | null => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-text/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={hideTitle ? title : undefined}
        aria-labelledby={hideTitle ? undefined : 'ui-modal-title'}
        tabIndex={-1}
        className={cn(
          'relative w-full max-w-lg rounded-card border border-border bg-surface p-6 shadow-card focus:outline-none',
          className,
        )}
      >
        {!hideTitle && (
          <h2 id="ui-modal-title" className="mb-4 text-lg font-semibold text-text">
            {title}
          </h2>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
};
