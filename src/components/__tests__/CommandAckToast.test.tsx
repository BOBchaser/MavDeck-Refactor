import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import CommandAckToast from '../CommandAckToast';
import { addToast, onToastChange, clearAllToasts } from '../../services';

let ackCallbacks: Array<(entry: { commandName: string; success: boolean; result?: number; error?: string }) => void> = [];

const mockCommandSender = {
  onCommandResult: (cb: (entry: { commandName: string; success: boolean; result?: number; error?: string }) => void) => {
    ackCallbacks.push(cb);
    return () => {
      ackCallbacks = ackCallbacks.filter(c => c !== cb);
    };
  },
};

vi.mock('../../services', async () => {
  const actual = await vi.importActual<typeof import('../../services')>('../../services');
  return {
    ...actual,
    useCommandSender: () => mockCommandSender,
  };
});

describe('CommandAckToast', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    ackCallbacks = [];
    clearAllToasts();
  });

  it('mounts without error', () => {
    render(() => <CommandAckToast />, document.body);
  });

  it('shows success toast on command ack', async () => {
    const toasts: Array<{ message: string; type: string }> = [];
    const unsub = onToastChange(list => {
      toasts.length = 0;
      for (const t of list) {
        toasts.push({ message: t.message, type: t.type });
      }
    });

    render(() => <CommandAckToast />, document.body);

    for (const cb of ackCallbacks) {
      cb({ commandName: 'Takeoff', success: true, result: 0 });
    }

    await vi.waitFor(() => {
      expect(toasts.length).toBeGreaterThan(0);
      expect(toasts[0].message).toBe('Takeoff accepted');
      expect(toasts[0].type).toBe('success');
    });

    unsub();
  });

  it('shows error toast on failed command ack', async () => {
    const toasts: Array<{ message: string; type: string }> = [];
    const unsub = onToastChange(list => {
      toasts.length = 0;
      for (const t of list) {
        toasts.push({ message: t.message, type: t.type });
      }
    });

    render(() => <CommandAckToast />, document.body);

    for (const cb of ackCallbacks) {
      cb({ commandName: 'Land', success: false, result: 2, error: 'Command denied' });
    }

    await vi.waitFor(() => {
      expect(toasts.length).toBeGreaterThan(0);
      expect(toasts[0].message).toBe('Land failed: Command denied');
      expect(toasts[0].type).toBe('error');
    });

    unsub();
  });

  it('shows generic error toast when no error detail', async () => {
    const toasts: Array<{ message: string; type: string }> = [];
    const unsub = onToastChange(list => {
      toasts.length = 0;
      for (const t of list) {
        toasts.push({ message: t.message, type: t.type });
      }
    });

    render(() => <CommandAckToast />, document.body);

    for (const cb of ackCallbacks) {
      cb({ commandName: 'Arm', success: false, result: 2 });
    }

    await vi.waitFor(() => {
      expect(toasts.length).toBeGreaterThan(0);
      expect(toasts[0].message).toBe('Arm failed');
      expect(toasts[0].type).toBe('error');
    });

    unsub();
  });
});
