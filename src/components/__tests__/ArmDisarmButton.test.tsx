import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { setAppState, createInitialAppState } from '../../store';
import ArmDisarmButton from '../ArmDisarmButton';

const mockArmDisarm = vi.fn().mockResolvedValue({ success: true });

vi.mock('../../services', async () => {
  const actual = await vi.importActual<typeof import('../../services')>('../../services');
  return {
    ...actual,
    useCommandSender: () => ({
      armDisarm: mockArmDisarm,
    }),
  };
});

describe('ArmDisarmButton', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockArmDisarm.mockClear();

    const initial = createInitialAppState();
    for (const key of Object.keys(initial) as Array<keyof typeof initial>) {
      setAppState(key as any, initial[key] as any);
    }
  });

  it('shows "Arm" when disarmed', () => {
    setAppState('connectionStatus', 'connected');
    setAppState('armedState', 'disarmed');

    render(() => <ArmDisarmButton />, document.body);
    expect(document.body.textContent).toContain('Arm');
  });

  it('shows "Disarm" when armed', () => {
    setAppState('connectionStatus', 'connected');
    setAppState('armedState', 'armed');

    render(() => <ArmDisarmButton />, document.body);
    expect(document.body.textContent).toContain('Disarm');
  });

  it('is disabled when disconnected', () => {
    setAppState('connectionStatus', 'disconnected');
    setAppState('armedState', 'disarmed');

    render(() => <ArmDisarmButton />, document.body);
    const button = document.body.querySelector('button');
    expect(button?.hasAttribute('disabled')).toBe(true);
  });

  it('opens confirmation dialog on click when disarmed', () => {
    setAppState('connectionStatus', 'connected');
    setAppState('armedState', 'disarmed');

    render(() => <ArmDisarmButton />, document.body);
    const button = document.body.querySelector('button');
    button?.click();

    expect(document.body.textContent).toContain('Confirm Arm');
  });

  it('sends arm command on confirm', async () => {
    setAppState('connectionStatus', 'connected');
    setAppState('armedState', 'disarmed');

    render(() => <ArmDisarmButton />, document.body);
    const button = document.body.querySelector('button');
    button?.click();

    // Find the confirm button inside the modal (the last button after Cancel)
    const buttons = Array.from(document.body.querySelectorAll('button'));
    const confirmBtn = buttons[buttons.length - 1];
    confirmBtn?.click();

    expect(mockArmDisarm).toHaveBeenCalledWith(true, false);
  });

  it('sends emergency disarm on shift+click', () => {
    setAppState('connectionStatus', 'connected');
    setAppState('armedState', 'armed');

    render(() => <ArmDisarmButton />, document.body);
    const button = document.body.querySelector('button');

    const shiftClick = new MouseEvent('click', { shiftKey: true, bubbles: true });
    button?.dispatchEvent(shiftClick);

    expect(mockArmDisarm).toHaveBeenCalledWith(false, true);
  });
});
