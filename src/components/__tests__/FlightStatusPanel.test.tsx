import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from 'solid-js/web';
import { setAppState, createInitialAppState } from '../../store';
import FlightStatusPanel from '../FlightStatusPanel';

describe('FlightStatusPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    const initial = createInitialAppState();
    for (const key of Object.keys(initial) as Array<keyof typeof initial>) {
      setAppState(key as any, initial[key] as any);
    }
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows "Disconnected" when connectionStatus is disconnected', () => {
    render(() => <FlightStatusPanel />, document.body);
    expect(document.body.textContent).toContain('Disconnected');
  });

  it('shows flight mode and disarmed when connected but not armed', () => {
    setAppState('connectionStatus', 'connected');
    setAppState('flightMode', 'Position');
    setAppState('armedState', 'disarmed');
    render(() => <FlightStatusPanel />, document.body);
    expect(document.body.textContent).toContain('Position');
    expect(document.body.textContent).toContain('Disarmed');
  });

  it('shows flight mode and armed when connected and armed', () => {
    setAppState('connectionStatus', 'connected');
    setAppState('flightMode', 'Mission');
    setAppState('armedState', 'armed');
    render(() => <FlightStatusPanel />, document.body);
    expect(document.body.textContent).toContain('Mission');
    expect(document.body.textContent).toContain('Armed');
  });

  it('shows throughput when connected and data is flowing', () => {
    setAppState('connectionStatus', 'connected');
    setAppState('flightMode', 'Hold');
    setAppState('armedState', 'armed');
    setAppState('throughputBytesPerSec', 1536);
    render(() => <FlightStatusPanel />, document.body);
    expect(document.body.textContent).toContain('1.5 KB/s');
  });

  it('shows system status code', () => {
    setAppState('connectionStatus', 'connected');
    setAppState('flightMode', 'RTL');
    setAppState('systemStatus', 4);
    render(() => <FlightStatusPanel />, document.body);
    expect(document.body.textContent).toContain('SYS 4');
  });
});
