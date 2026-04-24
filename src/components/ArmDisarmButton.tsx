import { Show, createSignal, onCleanup, onMount } from 'solid-js';
import { appState } from '../store';
import { useCommandSender } from '../services';

const LONG_PRESS_MS = 800;

export default function ArmDisarmButton() {
  const commandSender = useCommandSender();
  const [showConfirm, setShowConfirm] = createSignal(false);
  const [isLongPress, setIsLongPress] = createSignal(false);
  const [pending, setPending] = createSignal(false);
  const [resultMsg, setResultMsg] = createSignal<string | null>(null);

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let resultTimer: ReturnType<typeof setTimeout> | null = null;

  onCleanup(() => {
    if (longPressTimer) clearTimeout(longPressTimer);
    if (resultTimer) clearTimeout(resultTimer);
  });

  const isArmed = () => appState.armedState === 'armed';
  const isConnected = () => appState.connectionStatus === 'connected' || appState.connectionStatus === 'no_data';

  function showResult(msg: string) {
    setResultMsg(msg);
    if (resultTimer) clearTimeout(resultTimer);
    resultTimer = setTimeout(() => setResultMsg(null), 3000);
  }

  async function doArmDisarm(force = false) {
    if (!isConnected() || pending()) return;
    setPending(true);
    try {
      const result = await commandSender.armDisarm(!isArmed(), force);
      if (result.success) {
        showResult(isArmed() ? 'Disarming...' : 'Arming...');
      } else {
        showResult(result.error ?? 'Command failed');
      }
    } catch (err) {
      showResult(err instanceof Error ? err.message : 'Command error');
    } finally {
      setPending(false);
    }
  }

  function handlePointerDown(e: PointerEvent) {
    if (!isArmed()) return;
    setIsLongPress(false);
    longPressTimer = setTimeout(() => {
      setIsLongPress(true);
      doArmDisarm(true);
    }, LONG_PRESS_MS);
  }

  function handlePointerUp(e: PointerEvent) {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  function handleClick(e: MouseEvent) {
    if (pending()) return;

    // Shift+click = emergency disarm
    if (isArmed() && e.shiftKey) {
      e.preventDefault();
      doArmDisarm(true);
      return;
    }

    if (isArmed()) {
      // Disarm requires confirmation
      setShowConfirm(true);
      return;
    }

    // Arm requires confirmation when safe
    setShowConfirm(true);
  }

  function confirmAction() {
    setShowConfirm(false);
    doArmDisarm(isLongPress());
  }

  return (
    <>
      <button
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
        disabled={!isConnected() || pending()}
        class="relative px-3 py-1 rounded text-sm font-semibold uppercase tracking-wider transition-colors select-none"
        style={{
          'background-color': isArmed() ? '#dcfce7' : '#fee2e2',
          color: isArmed() ? '#166534' : '#991b1b',
          border: `1px solid ${isArmed() ? '#bbf7d0' : '#fecaca'}`,
          opacity: isConnected() ? 1 : 0.5,
          cursor: isConnected() ? 'pointer' : 'not-allowed',
        }}
        title={isArmed() ? 'Click to disarm, Shift+click or long-press for emergency disarm' : 'Click to arm'}
      >
        <Show when={pending()} fallback={isArmed() ? 'Disarm' : 'Arm'}>
          <span class="inline-block animate-pulse">{isArmed() ? 'Disarming...' : 'Arming...'}</span>
        </Show>
      </button>

      <Show when={resultMsg()}>
        <span class="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          {resultMsg()}
        </span>
      </Show>

      <Show when={showConfirm()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center"
          style={{ 'background-color': 'rgba(0,0,0,0.4)' }}
          onClick={() => setShowConfirm(false)}
        >
          <div
            class="rounded-lg p-5 max-w-sm w-full mx-4 shadow-lg"
            style={{
              'background-color': 'var(--bg-panel)',
              'border-color': 'var(--border-subtle)',
              border: '1px solid var(--border-subtle)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              class="text-base font-semibold mb-2"
              style={{ color: 'var(--text-primary)' }}
            >
              {isArmed() ? 'Confirm Disarm' : 'Confirm Arm'}
            </h3>
            <p class="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              {isArmed()
                ? 'The vehicle will be disarmed and motors will stop. Ensure it is safe to do so.'
                : 'The vehicle will be armed and motors may spin. Ensure all safety checks are complete.'}
            </p>
            <div class="flex justify-end gap-2">
              <button
                onClick={() => setShowConfirm(false)}
                class="px-3 py-1.5 rounded text-sm font-medium transition-colors"
                style={{
                  color: 'var(--text-primary)',
                  'background-color': 'var(--bg-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmAction}
                class="px-3 py-1.5 rounded text-sm font-medium transition-colors"
                style={{
                  'background-color': isArmed() ? '#ef4444' : '#22c55e',
                  color: '#ffffff',
                }}
              >
                {isArmed() ? 'Disarm' : 'Arm'}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}
