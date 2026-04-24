import { Show, createSignal, onCleanup } from 'solid-js';
import { appState } from '../store';
import { useCommandSender, useWorkerBridge } from '../services';
import type { CommandResult } from '../services';

export default function GuidedActionsStrip() {
  const commandSender = useCommandSender();
  const workerBridge = useWorkerBridge();

  const [pendingAction, setPendingAction] = createSignal<string | null>(null);
  const [resultMsg, setResultMsg] = createSignal<string | null>(null);
  const [showTakeoffDialog, setShowTakeoffDialog] = createSignal(false);
  const [takeoffAltMeters, setTakeoffAltMeters] = createSignal(10);

  const [hasPosition, setHasPosition] = createSignal(false);
  let latestLat: number | null = null;
  let latestLon: number | null = null;
  let latestAlt: number | null = null;
  let resultTimer: ReturnType<typeof setTimeout> | null = null;

  const unsub = workerBridge.onUpdate(buffers => {
    const latBuf = buffers.get('GLOBAL_POSITION_INT.lat');
    const lonBuf = buffers.get('GLOBAL_POSITION_INT.lon');
    const altBuf = buffers.get('GLOBAL_POSITION_INT.alt');
    let gotPosition = false;
    if (latBuf && latBuf.values.length > 0) {
      latestLat = latBuf.values[latBuf.values.length - 1] / 1e7;
      gotPosition = true;
    }
    if (lonBuf && lonBuf.values.length > 0) {
      latestLon = lonBuf.values[lonBuf.values.length - 1] / 1e7;
      gotPosition = true;
    }
    if (altBuf && altBuf.values.length > 0) {
      latestAlt = altBuf.values[altBuf.values.length - 1] / 1000;
    }
    if (gotPosition && !hasPosition()) {
      setHasPosition(true);
    }
  });
  onCleanup(() => unsub());

  onCleanup(() => {
    if (resultTimer) clearTimeout(resultTimer);
  });

  const isConnected = () =>
    appState.connectionStatus === 'connected' || appState.connectionStatus === 'no_data';

  function showResult(msg: string) {
    setResultMsg(msg);
    if (resultTimer) clearTimeout(resultTimer);
    resultTimer = setTimeout(() => setResultMsg(null), 3000);
  }

  async function sendAction(action: string, fn: () => Promise<CommandResult>) {
    if (!isConnected() || pendingAction()) return;
    setPendingAction(action);
    try {
      const result = await fn();
      if (result.success) {
        showResult(`${action} accepted`);
      } else {
        showResult(result.error ?? `${action} failed`);
      }
    } catch (err) {
      showResult(err instanceof Error ? err.message : `${action} error`);
    } finally {
      setPendingAction(null);
    }
  }

  function handleTakeoff() {
    setTakeoffAltMeters(10);
    setShowTakeoffDialog(true);
  }

  function confirmTakeoff() {
    setShowTakeoffDialog(false);
    void sendAction('Takeoff', () => commandSender.takeoff(takeoffAltMeters()));
  }

  function handleLand() {
    void sendAction('Land', () => commandSender.land());
  }

  function handleRTL() {
    void sendAction('RTL', () => commandSender.returnToLaunch());
  }

  function handlePause() {
    if (latestLat == null || latestLon == null) {
      showResult('No position data available');
      return;
    }
    void sendAction('Pause', () =>
      commandSender.doReposition(latestLat!, latestLon!, latestAlt ?? 0),
    );
  }

  return (
    <>
      <div class="flex items-center gap-1.5">
        <ActionButton
          label="Takeoff"
          onClick={handleTakeoff}
          disabled={!isConnected() || pendingAction() !== null}
          pending={pendingAction() === 'Takeoff'}
        />
        <ActionButton
          label="Land"
          onClick={handleLand}
          disabled={!isConnected() || pendingAction() !== null}
          pending={pendingAction() === 'Land'}
        />
        <ActionButton
          label="RTL"
          onClick={handleRTL}
          disabled={!isConnected() || pendingAction() !== null}
          pending={pendingAction() === 'RTL'}
        />
        <ActionButton
          label="Pause"
          onClick={handlePause}
          disabled={!isConnected() || pendingAction() !== null || !hasPosition()}
          pending={pendingAction() === 'Pause'}
        />

        <Show when={resultMsg()}>
          <span class="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            {resultMsg()}
          </span>
        </Show>
      </div>

      {/* Takeoff Dialog */}
      <Show when={showTakeoffDialog()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center"
          style={{ 'background-color': 'rgba(0,0,0,0.4)' }}
          onClick={() => setShowTakeoffDialog(false)}
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
              class="text-base font-semibold mb-3"
              style={{ color: 'var(--text-primary)' }}
            >
              Takeoff
            </h3>
            <label
              class="block text-sm mb-1"
              style={{ color: 'var(--text-secondary)' }}
            >
              Target altitude (meters)
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={takeoffAltMeters()}
              onInput={(e) => setTakeoffAltMeters(Number(e.currentTarget.value))}
              class="console-input w-full text-sm rounded px-2 py-1.5 mb-4"
              style={{ color: 'var(--text-primary)' }}
              data-testid="takeoff-altitude-input"
            />
            <div class="flex justify-end gap-2">
              <button
                onClick={() => setShowTakeoffDialog(false)}
                class="px-3 py-1.5 rounded text-sm font-medium transition-colors"
                style={{
                  color: 'var(--text-primary)',
                  'background-color': 'var(--bg-secondary)',
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmTakeoff}
                class="px-3 py-1.5 rounded text-sm font-medium transition-colors"
                style={{
                  'background-color': '#22c55e',
                  color: '#ffffff',
                }}
              >
                Takeoff
              </button>
            </div>
          </div>
        </div>
      </Show>
    </>
  );
}

function ActionButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      class="console-button px-2.5 py-1 rounded text-xs font-medium transition-colors"
      style={{
        color: 'var(--text-primary)',
        opacity: props.disabled ? 0.5 : 1,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
      }}
      title={props.label}
    >
      {props.pending ? '...' : props.label}
    </button>
  );
}
