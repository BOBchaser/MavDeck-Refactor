import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { setAppState, createInitialAppState } from '../../store';
import GuidedActionsStrip from '../GuidedActionsStrip';

const mockTakeoff = vi.fn().mockResolvedValue({ success: true });
const mockLand = vi.fn().mockResolvedValue({ success: true });
const mockRTL = vi.fn().mockResolvedValue({ success: true });
const mockDoReposition = vi.fn().mockResolvedValue({ success: true });

let updateCallbacks: Array<(buffers: Map<string, { timestamps: Float64Array; values: Float64Array }>) => void> = [];

const mockWorkerBridge = {
  onUpdate: (cb: (buffers: Map<string, { timestamps: Float64Array; values: Float64Array }>) => void) => {
    updateCallbacks.push(cb);
    return () => {
      updateCallbacks = updateCallbacks.filter(c => c !== cb);
    };
  },
};

vi.mock('../../services', async () => {
  const actual = await vi.importActual<typeof import('../../services')>('../../services');
  return {
    ...actual,
    useCommandSender: () => ({
      takeoff: mockTakeoff,
      land: mockLand,
      returnToLaunch: mockRTL,
      doReposition: mockDoReposition,
    }),
    useWorkerBridge: () => mockWorkerBridge,
  };
});

describe('GuidedActionsStrip', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    mockTakeoff.mockClear();
    mockLand.mockClear();
    mockRTL.mockClear();
    mockDoReposition.mockClear();
    updateCallbacks = [];

    const initial = createInitialAppState();
    for (const key of Object.keys(initial) as Array<keyof typeof initial>) {
      setAppState(key as any, initial[key] as any);
    }
  });

  it('shows action buttons when connected', () => {
    setAppState('connectionStatus', 'connected');

    render(() => <GuidedActionsStrip />, document.body);
    expect(document.body.textContent).toContain('Takeoff');
    expect(document.body.textContent).toContain('Land');
    expect(document.body.textContent).toContain('RTL');
    expect(document.body.textContent).toContain('Pause');
  });

  it('is disabled when disconnected', () => {
    setAppState('connectionStatus', 'disconnected');

    render(() => <GuidedActionsStrip />, document.body);
    const buttons = document.body.querySelectorAll('button');
    for (const btn of buttons) {
      expect(btn.hasAttribute('disabled')).toBe(true);
    }
  });

  it('sends land command on click', async () => {
    setAppState('connectionStatus', 'connected');

    render(() => <GuidedActionsStrip />, document.body);
    const landBtn = Array.from(document.body.querySelectorAll('button')).find(
      b => b.textContent === 'Land',
    );
    expect(landBtn).toBeTruthy();
    landBtn!.click();

    await vi.waitFor(() => expect(mockLand).toHaveBeenCalledTimes(1));
  });

  it('sends rtl command on click', async () => {
    setAppState('connectionStatus', 'connected');

    render(() => <GuidedActionsStrip />, document.body);
    const rtlBtn = Array.from(document.body.querySelectorAll('button')).find(
      b => b.textContent === 'RTL',
    );
    expect(rtlBtn).toBeTruthy();
    rtlBtn!.click();

    await vi.waitFor(() => expect(mockRTL).toHaveBeenCalledTimes(1));
  });

  it('opens takeoff dialog on click', () => {
    setAppState('connectionStatus', 'connected');

    render(() => <GuidedActionsStrip />, document.body);
    const takeoffBtn = Array.from(document.body.querySelectorAll('button')).find(
      b => b.textContent === 'Takeoff',
    );
    expect(takeoffBtn).toBeTruthy();
    takeoffBtn!.click();

    expect(document.body.textContent).toContain('Target altitude');
    const input = document.body.querySelector('[data-testid="takeoff-altitude-input"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('10');
  });

  it('sends takeoff command with dialog altitude', async () => {
    setAppState('connectionStatus', 'connected');

    render(() => <GuidedActionsStrip />, document.body);
    const takeoffBtn = Array.from(document.body.querySelectorAll('button')).find(
      b => b.textContent === 'Takeoff',
    );
    takeoffBtn!.click();

    const input = document.body.querySelector('[data-testid="takeoff-altitude-input"]') as HTMLInputElement;
    input.value = '25';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // Click the Takeoff button in the dialog (the last one)
    const buttons = document.body.querySelectorAll('button');
    const confirmBtn = buttons[buttons.length - 1];
    expect(confirmBtn.textContent).toBe('Takeoff');
    confirmBtn.click();

    await vi.waitFor(() => expect(mockTakeoff).toHaveBeenCalledWith(25));
  });

  it('sends pause command with current position', async () => {
    setAppState('connectionStatus', 'connected');

    render(() => <GuidedActionsStrip />, document.body);

    // Simulate position update
    const buffers = new Map([
      ['GLOBAL_POSITION_INT.lat', { timestamps: new Float64Array([1]), values: new Float64Array([47.1234567 * 1e7]) }],
      ['GLOBAL_POSITION_INT.lon', { timestamps: new Float64Array([1]), values: new Float64Array([8.7654321 * 1e7]) }],
      ['GLOBAL_POSITION_INT.alt', { timestamps: new Float64Array([1]), values: new Float64Array([5000]) }],
    ]);
    for (const cb of updateCallbacks) {
      cb(buffers);
    }

    const pauseBtn = Array.from(document.body.querySelectorAll('button')).find(
      b => b.textContent === 'Pause',
    );
    expect(pauseBtn).toBeTruthy();
    expect(pauseBtn!.hasAttribute('disabled')).toBe(false);
    pauseBtn!.click();

    await vi.waitFor(() =>
      expect(mockDoReposition).toHaveBeenCalledWith(
        expect.closeTo(47.1234567, 5),
        expect.closeTo(8.7654321, 5),
        expect.closeTo(5, 1),
      ),
    );
  });

  it('disables pause button when no position data', () => {
    setAppState('connectionStatus', 'connected');

    render(() => <GuidedActionsStrip />, document.body);
    const pauseBtn = Array.from(document.body.querySelectorAll('button')).find(
      b => b.textContent === 'Pause',
    );
    expect(pauseBtn).toBeTruthy();
    expect(pauseBtn!.hasAttribute('disabled')).toBe(true);
  });
});
