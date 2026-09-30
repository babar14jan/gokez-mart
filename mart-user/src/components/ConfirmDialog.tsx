import { useEffect, useId, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Extra detail rendered under the message, e.g. a reopening time. */
  children?: React.ReactNode;
}

/**
 * Modal confirmation.
 *
 * The accessibility behaviour here is not decoration: without role="dialog" and
 * aria-modal, a screen reader keeps reading the page behind the overlay and
 * gives no hint that focus is trapped, so the dialog is effectively invisible to
 * assistive tech. Escape-to-dismiss and a scroll lock are what a keyboard or
 * trackpad user expects from anything that covers the page.
 */
export default function ConfirmDialog({
  title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel',
  danger = true, onConfirm, onCancel, children,
}: ConfirmDialogProps) {
  const titleId = useId();
  const messageId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Move focus into the dialog so the next Tab stays inside it and the confirm
  // action is reachable without hunting for it.
  useEffect(() => { confirmRef.current?.focus(); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); }
    };
    // capture, so this still fires if a child stops propagation on bubble.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onCancel]);

  // The page behind must not scroll while the overlay is up. Restoring the
  // previous value rather than clearing it avoids yanking the page if this ever
  // nests inside another lock.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4 bg-slate-900/60 backdrop-blur-sm"
      onClick={onCancel}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId}
        className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-sm p-5"
        onClick={e => e.stopPropagation()}>
        <h3 id={titleId} className="text-sm font-bold text-gray-900 dark:text-white mb-1">{title}</h3>
        <p id={messageId} className="text-sm text-gray-500 dark:text-slate-400">{message}</p>
        {children && <div className="mt-3">{children}</div>}
        <div className="flex gap-3 mt-5">
          <button onClick={onCancel}
            className="flex-1 py-2.5 text-sm font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 rounded-xl hover:bg-gray-200 dark:hover:bg-slate-600 transition-colors">
            {cancelLabel}
          </button>
          <button ref={confirmRef} onClick={onConfirm}
            className={`flex-1 py-2.5 text-sm font-semibold text-white rounded-xl transition-colors ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'
            }`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
