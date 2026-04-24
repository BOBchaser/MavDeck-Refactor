import { createSignal, For, onCleanup, onMount } from 'solid-js';
import { onToastChange, removeToast, type ToastEntry } from '../services';

export default function ToastContainer() {
  const [toasts, setToasts] = createSignal<ToastEntry[]>([]);

  onMount(() => {
    const unsub = onToastChange(next => {
      setToasts(next);
    });
    onCleanup(unsub);
  });

  return (
    <div
      class="fixed top-3 right-3 z-[9999] flex flex-col gap-2 pointer-events-none"
      aria-live="polite"
      aria-atomic="true"
    >
      <For each={toasts()}>
        {(toast) => (
          <div
            class="pointer-events-auto rounded-md px-4 py-2.5 text-sm font-medium shadow-lg transition-all"
            style={{
              'background-color': toastBgColor(toast.type),
              color: toastTextColor(toast.type),
              'border-left': `4px solid ${toastBorderColor(toast.type)}`,
              'min-width': '200px',
              'max-width': '320px',
            }}
            role="status"
          >
            <div class="flex items-center justify-between gap-3">
              <span>{toast.message}</span>
              <button
                onClick={() => removeToast(toast.id)}
                class="opacity-70 hover:opacity-100 transition-opacity"
                style={{ color: toastTextColor(toast.type) }}
                aria-label="Dismiss notification"
              >
                <CloseIcon />
              </button>
            </div>
          </div>
        )}
      </For>
    </div>
  );
}

function toastBgColor(type: ToastEntry['type']): string {
  switch (type) {
    case 'success': return 'var(--toast-success-bg, #dcfce7)';
    case 'error': return 'var(--toast-error-bg, #fee2e2)';
    default: return 'var(--toast-info-bg, #e0f2fe)';
  }
}

function toastTextColor(type: ToastEntry['type']): string {
  switch (type) {
    case 'success': return 'var(--toast-success-text, #166534)';
    case 'error': return 'var(--toast-error-text, #991b1b)';
    default: return 'var(--toast-info-text, #0c4a6e)';
  }
}

function toastBorderColor(type: ToastEntry['type']): string {
  switch (type) {
    case 'success': return 'var(--toast-success-border, #22c55e)';
    case 'error': return 'var(--toast-error-border, #ef4444)';
    default: return 'var(--toast-info-border, #38bdf8)';
  }
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
