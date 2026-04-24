import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import ToastContainer from '../ToastContainer';
import { addToast, removeToast, clearAllToasts } from '../../services';

describe('ToastContainer', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    clearAllToasts();
  });

  it('renders nothing when no toasts', () => {
    render(() => <ToastContainer />, document.body);
    expect(document.body.textContent?.trim()).toBe('');
  });

  it('displays a toast after addToast is called', async () => {
    render(() => <ToastContainer />, document.body);

    addToast('Test message', 'info');

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Test message');
    });
  });

  it('displays multiple toasts', async () => {
    render(() => <ToastContainer />, document.body);

    addToast('First', 'success');
    addToast('Second', 'error');

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('First');
      expect(document.body.textContent).toContain('Second');
    });
  });

  it('removes a toast when dismiss button is clicked', async () => {
    render(() => <ToastContainer />, document.body);

    const id = addToast('Dismiss me', 'info');

    await vi.waitFor(() => {
      expect(document.body.textContent).toContain('Dismiss me');
    });

    removeToast(id);

    await vi.waitFor(() => {
      expect(document.body.textContent).not.toContain('Dismiss me');
    });
  });
});
