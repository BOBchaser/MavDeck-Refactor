import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { setAppState, createInitialAppState } from '../../store';
import FlightModeSelector from '../FlightModeSelector';

const mockSetMode = vi.fn().mockResolvedValue({ success: true });

vi.mock('../../services', async () => {
  const actual = await vi.importActual<typeof import('../../services')>('../../services');
  return {
    ...actual,
    useCommandSender: () => ({
      setMode: mockSetMode,
    }),
  };
});

describe('FlightModeSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockSetMode.mockClear();

    const initial = createInitialAppState();
    for (const key of Object.keys(initial) as Array<keyof typeof initial>) {
      setAppState(key as any, initial[key] as any);
    }
  });

  it('shows mode options when connected', () => {
    setAppState('connectionStatus', 'connected');

    render(() => <FlightModeSelector />, document.body);
    expect(document.body.textContent).toContain('Manual');
    expect(document.body.textContent).toContain('Position');
  });

  it('sends setMode command on selection change', async () => {
    setAppState('connectionStatus', 'connected');

    render(() => <FlightModeSelector />, document.body);
    const select = document.body.querySelector('select') as HTMLSelectElement;

    select.value = String(0x00030000); // Position
    select.dispatchEvent(new Event('change', { bubbles: true }));

    expect(mockSetMode).toHaveBeenCalledWith(0x01, 0x00030000);
  });

  it('is disabled when disconnected', () => {
    setAppState('connectionStatus', 'disconnected');

    render(() => <FlightModeSelector />, document.body);
    const select = document.body.querySelector('select');
    expect(select?.hasAttribute('disabled')).toBe(true);
  });
});
