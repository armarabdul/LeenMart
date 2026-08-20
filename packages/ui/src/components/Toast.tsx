import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib/cn.js';

export type ToastTone = 'success' | 'warning' | 'danger' | 'info';

export interface ToastOptions {
  readonly title: string;
  readonly description?: string;
  readonly tone?: ToastTone;
  /** Milliseconds before auto-dismiss. */
  readonly duration?: number;
}

interface ToastRecord extends ToastOptions {
  readonly id: number;
}

interface ToastContextValue {
  readonly show: (options: ToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const DEFAULT_DURATION_MS = 5000;

const TONE_CLASSES: Record<ToastTone, string> = {
  success: 'border-success/30 bg-surface text-success',
  warning: 'border-warning/30 bg-surface text-warning',
  danger: 'border-danger/30 bg-surface text-danger',
  info: 'border-info/30 bg-surface text-info',
};

const ToastItem = ({
  toast,
  onDismiss,
}: {
  readonly toast: ToastRecord;
  readonly onDismiss: (id: number) => void;
}): JSX.Element => (
  <div
    role="status"
    className={cn(
      'w-80 max-w-[calc(100vw-2rem)] rounded-md border px-4 py-3 shadow-card',
      TONE_CLASSES[toast.tone ?? 'info'],
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-sm text-text-muted">{toast.description}</p>}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss"
        className="shrink-0 text-text-faint hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
      >
        ×
      </button>
    </div>
  </div>
);

/**
 * Toast host + dispatcher. One provider near the app root; `useToast()`
 * anywhere beneath it. Rendered via a portal so a toast is never clipped by
 * an `overflow-hidden` ancestor the way an in-flow notification would be.
 */
export const ToastProvider = ({ children }: { readonly children: ReactNode }): JSX.Element => {
  const [toasts, setToasts] = useState<readonly ToastRecord[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current, { ...options, id }]);
      const duration = options.duration ?? DEFAULT_DURATION_MS;
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:right-4 sm:left-auto"
          >
            {toasts.map((toast) => (
              <div key={toast.id} className="pointer-events-auto">
                <ToastItem toast={toast} onDismiss={dismiss} />
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
};

/**
 * Throws outside a `ToastProvider` — a toast fired into nothing is a bug
 * worth surfacing immediately, not a silent no-op.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the provider and its hook are one cohesive unit; splitting them into two files for a fast-refresh heuristic would cost more than it saves.
export const useToast = (): ToastContextValue => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast() must be called beneath a <ToastProvider>.');
  }
  return context;
};
