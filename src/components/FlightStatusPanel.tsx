import { Show } from 'solid-js';
import { appState } from '../store';

function getModeColor(mode: string): string {
  const lower = mode.toLowerCase();
  if (lower.includes('manual') || lower.includes('stabilized') || lower.includes('acro')) return '#eab308'; // yellow
  if (lower.includes('auto') || lower.includes('mission') || lower.includes('rtl') || lower.includes('land') || lower.includes('takeoff') || lower.includes('hold') || lower.includes('follow')) return '#3b82f6'; // blue
  if (lower.includes('offboard') || lower.includes('navigator')) return '#8b5cf6'; // purple
  if (lower.includes('disconnected')) return '#9ca3af'; // gray
  return '#6b7280';
}

function ArmedBadge() {
  const isArmed = () => appState.armedState === 'armed';
  const isUnknown = () => appState.armedState === 'unknown';

  return (
    <span
      class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider"
      style={{
        'background-color': isArmed() ? '#dcfce7' : isUnknown() ? '#f3f4f6' : '#fee2e2',
        color: isArmed() ? '#166534' : isUnknown() ? '#6b7280' : '#991b1b',
        border: `1px solid ${isArmed() ? '#bbf7d0' : isUnknown() ? '#e5e7eb' : '#fecaca'}`,
      }}
    >
      <span
        class="mr-1.5 inline-block rounded-full"
        style={{
          width: '6px',
          height: '6px',
          'background-color': isArmed() ? '#22c55e' : isUnknown() ? '#9ca3af' : '#ef4444',
        }}
      />
      {isArmed() ? 'Armed' : isUnknown() ? 'Unknown' : 'Disarmed'}
    </span>
  );
}

function FlightModeBadge() {
  const mode = () => appState.flightMode;
  const color = () => getModeColor(mode());

  return (
    <span
      class="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold uppercase tracking-wider"
      style={{
        'background-color': color() + '1a',
        color: color(),
        border: `1px solid ${color()}33`,
      }}
    >
      {mode()}
    </span>
  );
}

function ConnectionDot() {
  const status = () => appState.connectionStatus;
  const color = () => {
    switch (status()) {
      case 'connected':
        return '#22c55e';
      case 'connecting':
      case 'probing':
        return '#f59e0b';
      case 'no_data':
        return '#f97316';
      case 'error':
        return '#ef4444';
      default:
        return '#9ca3af';
    }
  };

  return (
    <span
      class="inline-block rounded-full"
      style={{
        width: '8px',
        height: '8px',
        'background-color': color(),
      }}
      title={status()}
    />
  );
}

export default function FlightStatusPanel() {
  const isDisconnected = () => appState.connectionStatus === 'disconnected';

  return (
    <div
      class="flex items-center justify-between px-3 py-1.5 border-b"
      style={{
        'background-color': 'var(--bg-panel)',
        'border-color': 'var(--border-subtle)',
        'min-height': '36px',
      }}
    >
      <div class="flex items-center gap-3">
        <ConnectionDot />
        <Show when={!isDisconnected()} fallback={
          <span class="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            Disconnected
          </span>
        }>
          <FlightModeBadge />
          <ArmedBadge />
        </Show>
      </div>

      <Show when={!isDisconnected()}>
        <div class="flex items-center gap-3 text-[10px]" style={{ color: 'var(--text-quiet)' }}>
          <Show when={appState.throughputBytesPerSec > 0}>
            <span>{`${(appState.throughputBytesPerSec / 1024).toFixed(1)} KB/s`}</span>
          </Show>
          <span>{`SYS ${appState.systemStatus}`}</span>
        </div>
      </Show>
    </div>
  );
}
