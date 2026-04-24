import { Show, createSignal } from 'solid-js';
import { appState } from '../store';
import { useCommandSender } from '../services';
import { PX4_SETTABLE_MODES } from '../mavlink/px4-mode-decoder';

const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 0x01;

export default function FlightModeSelector() {
  const commandSender = useCommandSender();
  const [pending, setPending] = createSignal(false);
  const [resultMsg, setResultMsg] = createSignal<string | null>(null);

  const isConnected = () =>
    appState.connectionStatus === 'connected' || appState.connectionStatus === 'no_data';

  function showResult(msg: string) {
    setResultMsg(msg);
    setTimeout(() => setResultMsg(null), 3000);
  }

  async function handleChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    const customMode = Number(select.value);
    if (!isConnected() || Number.isNaN(customMode)) return;

    setPending(true);
    try {
      const result = await commandSender.setMode(
        MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
        customMode,
      );
      if (result.success) {
        showResult('Mode change accepted');
      } else {
        showResult(result.error ?? 'Mode change failed');
      }
    } catch (err) {
      showResult(err instanceof Error ? err.message : 'Mode change error');
    } finally {
      setPending(false);
    }
  }

  const currentCustomMode = () => {
    // Derive current custom mode from flightMode name
    const mode = PX4_SETTABLE_MODES.find(m => m.name === appState.flightMode);
    return mode?.customMode ?? '';
  };

  return (
    <div class="flex items-center gap-2">
      <select
        onChange={handleChange}
        disabled={!isConnected() || pending()}
        class="console-input text-xs rounded px-2 py-1"
        style={{
          color: 'var(--text-primary)',
          'min-width': '120px',
        }}
        value={currentCustomMode()}
      >
        <option value="" disabled>
          {pending() ? 'Changing...' : 'Select Mode'}
        </option>
        {PX4_SETTABLE_MODES.map(mode => (
          <option value={mode.customMode}>{mode.name}</option>
        ))}
      </select>
      <Show when={resultMsg()}>
        <span class="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          {resultMsg()}
        </span>
      </Show>
    </div>
  );
}
