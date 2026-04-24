/**
 * Lightweight global toast notification system.
 *
 * Used by CommandAckToast and any other component that needs
 * ephemeral visual feedback without local state.
 */

import { EventEmitter } from '../core';

export interface ToastEntry {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

const toastEmitter = new EventEmitter<(toasts: ToastEntry[]) => void>();
let activeToasts: ToastEntry[] = [];

let idCounter = 0;
function nextId(): string {
  return `toast-${Date.now()}-${++idCounter}`;
}

/** Add a toast. Returns the toast id. Auto-removes after durationMs. */
export function addToast(
  message: string,
  type: ToastEntry['type'] = 'info',
  durationMs = 3000,
): string {
  const id = nextId();
  const toast: ToastEntry = { id, message, type };
  activeToasts = [...activeToasts, toast];
  toastEmitter.emit(activeToasts);

  setTimeout(() => {
    removeToast(id);
  }, durationMs);

  return id;
}

/** Remove a toast by id. */
export function removeToast(id: string): void {
  const next = activeToasts.filter(t => t.id !== id);
  if (next.length === activeToasts.length) return;
  activeToasts = next;
  toastEmitter.emit(activeToasts);
}

/** Subscribe to toast list changes. Callback receives current list immediately. */
export function onToastChange(callback: (toasts: ToastEntry[]) => void): () => void {
  callback(activeToasts);
  return toastEmitter.on(callback);
}

/** Clear all active toasts (useful in tests). */
export function clearAllToasts(): void {
  if (activeToasts.length === 0) return;
  activeToasts = [];
  toastEmitter.emit(activeToasts);
}
