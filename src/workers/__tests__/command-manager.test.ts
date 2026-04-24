import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandManager } from '../command-manager';
import type { MavlinkMessage } from '../../mavlink/decoder';

function createMockMessage(name: string, values: Record<string, unknown>): MavlinkMessage {
  return {
    name,
    systemId: 1,
    componentId: 1,
    values,
  };
}

describe('CommandManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a COMMAND_LONG frame immediately', () => {
    const sentFrames: Array<{ name: string; values: Record<string, number | string | number[]> }> = [];
    const sendFrame = (name: string, values: Record<string, number | string | number[]>) => {
      sentFrames.push({ name, values });
    };

    const getVehicleTarget = () => ({ systemId: 7, componentId: 8 });
    const manager = new CommandManager(sendFrame, getVehicleTarget);
    manager.sendCommand('COMMAND_LONG', { command: 400, param1: 1 }, 1);

    expect(sentFrames.length).toBe(1);
    expect(sentFrames[0].name).toBe('COMMAND_LONG');
    expect(sentFrames[0].values.command).toBe(400);
    expect(sentFrames[0].values.target_system).toBe(7);
    expect(sentFrames[0].values.target_component).toBe(8);
  });

  it('emits success ack when COMMAND_ACK with result=0 arrives', () => {
    const sendFrame = vi.fn();
    const getVehicleTarget = () => ({ systemId: 1, componentId: 1 });
    const manager = new CommandManager(sendFrame, getVehicleTarget);

    const acks: Array<{ correlationId: number; success: boolean; result?: number; error?: string }> = [];
    manager.onAck(ack => acks.push(ack));

    manager.sendCommand('COMMAND_LONG', { command: 400, param1: 1 }, 42);

    const ackMessage = createMockMessage('COMMAND_ACK', { command: 400, result: 0 });
    manager.handleMessage(ackMessage);

    expect(acks.length).toBe(1);
    expect(acks[0].correlationId).toBe(42);
    expect(acks[0].success).toBe(true);
    expect(acks[0].result).toBe(0);
    expect(acks[0].error).toBeUndefined();
  });

  it('emits failure ack when COMMAND_ACK with non-zero result arrives', () => {
    const sendFrame = vi.fn();
    const getVehicleTarget = () => ({ systemId: 1, componentId: 1 });
    const manager = new CommandManager(sendFrame, getVehicleTarget);

    const acks: Array<{ correlationId: number; success: boolean; result?: number; error?: string }> = [];
    manager.onAck(ack => acks.push(ack));

    manager.sendCommand('COMMAND_LONG', { command: 400, param1: 1 }, 1);

    const ackMessage = createMockMessage('COMMAND_ACK', { command: 400, result: 2 });
    manager.handleMessage(ackMessage);

    expect(acks.length).toBe(1);
    expect(acks[0].success).toBe(false);
    expect(acks[0].result).toBe(2);
    expect(acks[0].error).toContain('denied');
  });

  it('retries up to 3 times on timeout', () => {
    const sendFrame = vi.fn();
    const getVehicleTarget = () => ({ systemId: 1, componentId: 1 });
    const manager = new CommandManager(sendFrame, getVehicleTarget);

    const acks: Array<{ correlationId: number; success: boolean; error?: string }> = [];
    manager.onAck(ack => acks.push(ack));

    manager.sendCommand('COMMAND_LONG', { command: 400, param1: 1 }, 1);
    expect(sendFrame).toHaveBeenCalledTimes(1);

    // Timeout 1 → retry 1
    vi.advanceTimersByTime(5000);
    expect(sendFrame).toHaveBeenCalledTimes(2);

    // Timeout 2 → retry 2
    vi.advanceTimersByTime(5000);
    expect(sendFrame).toHaveBeenCalledTimes(3);

    // Timeout 3 → retry 3
    vi.advanceTimersByTime(5000);
    expect(sendFrame).toHaveBeenCalledTimes(4);

    // Timeout 4 → give up
    vi.advanceTimersByTime(5000);
    expect(sendFrame).toHaveBeenCalledTimes(4);
    expect(acks.length).toBe(1);
    expect(acks[0].success).toBe(false);
    expect(acks[0].error).toContain('Timeout');
  });

  it('stops retrying when COMMAND_ACK arrives', () => {
    const sendFrame = vi.fn();
    const getVehicleTarget = () => ({ systemId: 1, componentId: 1 });
    const manager = new CommandManager(sendFrame, getVehicleTarget);

    const acks: Array<{ correlationId: number; success: boolean }> = [];
    manager.onAck(ack => acks.push(ack));

    manager.sendCommand('COMMAND_LONG', { command: 400, param1: 1 }, 1);
    expect(sendFrame).toHaveBeenCalledTimes(1);

    // Advance partially
    vi.advanceTimersByTime(3000);

    // ACK arrives
    manager.handleMessage(createMockMessage('COMMAND_ACK', { command: 400, result: 0 }));
    expect(acks.length).toBe(1);
    expect(acks[0].success).toBe(true);

    // Ensure no further retries fire
    vi.advanceTimersByTime(10000);
    expect(sendFrame).toHaveBeenCalledTimes(1);
  });

  it('replaces pending command with same command id', () => {
    const sendFrame = vi.fn();
    const getVehicleTarget = () => ({ systemId: 1, componentId: 1 });
    const manager = new CommandManager(sendFrame, getVehicleTarget);

    const acks: Array<{ correlationId: number; success: boolean }> = [];
    manager.onAck(ack => acks.push(ack));

    manager.sendCommand('COMMAND_LONG', { command: 400, param1: 1 }, 1);
    manager.sendCommand('COMMAND_LONG', { command: 400, param1: 0 }, 2);

    // Only the second command should receive the ACK
    manager.handleMessage(createMockMessage('COMMAND_ACK', { command: 400, result: 0 }));
    expect(acks.length).toBe(1);
    expect(acks[0].correlationId).toBe(2);
  });

  it('ignores COMMAND_ACK for unknown command ids', () => {
    const sendFrame = vi.fn();
    const getVehicleTarget = () => ({ systemId: 1, componentId: 1 });
    const manager = new CommandManager(sendFrame, getVehicleTarget);

    const acks: Array<{ correlationId: number; success: boolean }> = [];
    manager.onAck(ack => acks.push(ack));

    manager.sendCommand('COMMAND_LONG', { command: 400, param1: 1 }, 1);
    manager.handleMessage(createMockMessage('COMMAND_ACK', { command: 401, result: 0 }));

    expect(acks.length).toBe(0);
  });

  it('emits error immediately when command field is missing', () => {
    const sendFrame = vi.fn();
    const getVehicleTarget = () => ({ systemId: 1, componentId: 1 });
    const manager = new CommandManager(sendFrame, getVehicleTarget);

    const acks: Array<{ correlationId: number; success: boolean; error?: string }> = [];
    manager.onAck(ack => acks.push(ack));

    manager.sendCommand('COMMAND_LONG', { param1: 1 }, 1);

    expect(sendFrame).not.toHaveBeenCalled();
    expect(acks.length).toBe(1);
    expect(acks[0].success).toBe(false);
    expect(acks[0].error).toContain('Missing');
  });

  it('clears all timers on dispose', () => {
    const sendFrame = vi.fn();
    const getVehicleTarget = () => ({ systemId: 1, componentId: 1 });
    const manager = new CommandManager(sendFrame, getVehicleTarget);

    const acks: Array<{ correlationId: number; success: boolean }> = [];
    manager.onAck(ack => acks.push(ack));

    manager.sendCommand('COMMAND_LONG', { command: 400, param1: 1 }, 1);
    manager.dispose();

    vi.advanceTimersByTime(20000);
    expect(acks.length).toBe(0);
  });
});
