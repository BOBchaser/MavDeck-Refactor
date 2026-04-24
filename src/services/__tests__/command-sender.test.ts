import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CommandSender,
  MAV_CMD_COMPONENT_ARM_DISARM,
  MAV_CMD_DO_SET_MODE,
  MAV_CMD_NAV_TAKEOFF,
  MAV_CMD_NAV_LAND,
  MAV_CMD_NAV_RETURN_TO_LAUNCH,
  MAV_CMD_DO_REPOSITION,
} from '../command-sender';
import type { MavlinkWorkerBridge } from '../worker-bridge';

describe('CommandSender', () => {
  let mockBridge: MavlinkWorkerBridge;
  let ackCallbacks: Array<(ack: { correlationId: number; success: boolean; result?: number; error?: string }) => void>;
  let sentCommands: Array<{ messageName: 'COMMAND_LONG' | 'COMMAND_INT'; fields: Record<string, number>; correlationId: number }>;

  beforeEach(() => {
    ackCallbacks = [];
    sentCommands = [];

    mockBridge = {
      sendCommand: (messageName: 'COMMAND_LONG' | 'COMMAND_INT', fields: Record<string, number>, correlationId: number) => {
        sentCommands.push({ messageName, fields, correlationId });
      },
      onCommandAck: (cb: (ack: { correlationId: number; success: boolean; result?: number; error?: string }) => void) => {
        ackCallbacks.push(cb);
        return () => {};
      },
    } as unknown as MavlinkWorkerBridge;
  });

  function emitAck(correlationId: number, success: boolean, result?: number, error?: string) {
    for (const cb of ackCallbacks) {
      cb({ correlationId, success, result, error });
    }
  }

  it('sendCommandLong emits COMMAND_LONG and resolves on success ack', async () => {
    const sender = new CommandSender(mockBridge);
    const promise = sender.sendCommandLong({ command: MAV_CMD_COMPONENT_ARM_DISARM, param1: 1 });

    expect(sentCommands.length).toBe(1);
    expect(sentCommands[0].messageName).toBe('COMMAND_LONG');
    expect(sentCommands[0].fields.command).toBe(MAV_CMD_COMPONENT_ARM_DISARM);

    emitAck(sentCommands[0].correlationId, true, 0);

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.result).toBe(0);
  });

  it('sendCommandInt emits COMMAND_INT and resolves on success ack', async () => {
    const sender = new CommandSender(mockBridge);
    const promise = sender.sendCommandInt({ command: MAV_CMD_DO_REPOSITION, x: 0, y: 0, z: 10 });

    expect(sentCommands.length).toBe(1);
    expect(sentCommands[0].messageName).toBe('COMMAND_INT');

    emitAck(sentCommands[0].correlationId, true, 0);

    const result = await promise;
    expect(result.success).toBe(true);
  });

  it('resolves with failure on denied ack', async () => {
    const sender = new CommandSender(mockBridge);
    const promise = sender.armDisarm(true);

    emitAck(sentCommands[0].correlationId, false, 2, 'Command denied');

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.result).toBe(2);
    expect(result.error).toBe('Command denied');
  });

  it('armDisarm sends correct fields', async () => {
    const sender = new CommandSender(mockBridge);
    const promise = sender.armDisarm(true);

    expect(sentCommands[0].fields.command).toBe(MAV_CMD_COMPONENT_ARM_DISARM);
    expect(sentCommands[0].fields.param1).toBe(1);
    expect(sentCommands[0].fields.param2).toBe(0);

    emitAck(sentCommands[0].correlationId, true, 0);
    await promise;
  });

  it('armDisarm with force sends emergency disarm code', async () => {
    const sender = new CommandSender(mockBridge);
    const promise = sender.armDisarm(false, true);

    expect(sentCommands[0].fields.param1).toBe(0);
    expect(sentCommands[0].fields.param2).toBe(21196);

    emitAck(sentCommands[0].correlationId, true, 0);
    await promise;
  });

  it('setMode sends correct fields', async () => {
    const sender = new CommandSender(mockBridge);
    const promise = sender.setMode(0x01, 0x00010000);

    expect(sentCommands[0].fields.command).toBe(MAV_CMD_DO_SET_MODE);
    expect(sentCommands[0].fields.param1).toBe(0x01);
    expect(sentCommands[0].fields.param2).toBe(0x00010000);

    emitAck(sentCommands[0].correlationId, true, 0);
    await promise;
  });

  it('takeoff sends altitude in param7', async () => {
    const sender = new CommandSender(mockBridge);
    const promise = sender.takeoff(50);

    expect(sentCommands[0].fields.command).toBe(MAV_CMD_NAV_TAKEOFF);
    expect(sentCommands[0].fields.param7).toBe(50);

    emitAck(sentCommands[0].correlationId, true, 0);
    await promise;
  });

  it('land sends correct command', async () => {
    const sender = new CommandSender(mockBridge);
    const promise = sender.land();

    expect(sentCommands[0].fields.command).toBe(MAV_CMD_NAV_LAND);

    emitAck(sentCommands[0].correlationId, true, 0);
    await promise;
  });

  it('returnToLaunch sends correct command', async () => {
    const sender = new CommandSender(mockBridge);
    const promise = sender.returnToLaunch();

    expect(sentCommands[0].fields.command).toBe(MAV_CMD_NAV_RETURN_TO_LAUNCH);

    emitAck(sentCommands[0].correlationId, true, 0);
    await promise;
  });

  it('doReposition sends lat/lon as integer degrees*1e7', async () => {
    const sender = new CommandSender(mockBridge);
    const promise = sender.doReposition(37.7749, -122.4194, 100);

    expect(sentCommands[0].messageName).toBe('COMMAND_INT');
    expect(sentCommands[0].fields.command).toBe(MAV_CMD_DO_REPOSITION);
    expect(sentCommands[0].fields.x).toBeCloseTo(377749000, 0);
    expect(sentCommands[0].fields.y).toBeCloseTo(-1224194000, 0);
    expect(sentCommands[0].fields.z).toBe(100);

    emitAck(sentCommands[0].correlationId, true, 0);
    await promise;
  });

  it('ignores acks for unknown correlation ids', async () => {
    const sender = new CommandSender(mockBridge);
    const promise = sender.armDisarm(true);

    // Emit ack for a different correlation id
    emitAck(9999, true, 0);

    // Promise should still be pending
    const timeoutPromise = new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error('timeout')), 50);
    });

    await expect(Promise.race([promise, timeoutPromise])).rejects.toThrow('timeout');
  });

  it('assigns unique correlation ids for sequential commands', async () => {
    const sender = new CommandSender(mockBridge);

    sender.armDisarm(true);
    sender.land();
    sender.takeoff(30);

    expect(sentCommands.length).toBe(3);
    expect(sentCommands[0].correlationId).not.toBe(sentCommands[1].correlationId);
    expect(sentCommands[1].correlationId).not.toBe(sentCommands[2].correlationId);
  });

  it('emits command result event on success ack', async () => {
    const sender = new CommandSender(mockBridge);
    const results: Array<{ name: string; success: boolean }> = [];

    sender.onCommandResult(entry => {
      results.push({ name: entry.commandName, success: entry.success });
    });

    const promise = sender.takeoff(50);
    emitAck(sentCommands[0].correlationId, true, 0);
    await promise;

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Takeoff');
    expect(results[0].success).toBe(true);
  });

  it('emits command result event on failure ack', async () => {
    const sender = new CommandSender(mockBridge);
    const results: Array<{ name: string; success: boolean; error?: string }> = [];

    sender.onCommandResult(entry => {
      results.push({ name: entry.commandName, success: entry.success, error: entry.error });
    });

    const promise = sender.land();
    emitAck(sentCommands[0].correlationId, false, 2, 'Denied');
    await promise;

    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Land');
    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Denied');
  });

  it('does not emit command result for unknown correlation ids', async () => {
    const sender = new CommandSender(mockBridge);
    const results: Array<{ name: string; success: boolean }> = [];

    sender.onCommandResult(entry => {
      results.push({ name: entry.commandName, success: entry.success });
    });

    // No command sent — emit ack for unknown id
    emitAck(9999, true, 0);

    expect(results.length).toBe(0);
  });

  it('includes friendly command names for all high-level methods', async () => {
    const sender = new CommandSender(mockBridge);
    const names: string[] = [];

    sender.onCommandResult(entry => {
      names.push(entry.commandName);
    });

    sender.armDisarm(true);
    emitAck(sentCommands[sentCommands.length - 1].correlationId, true, 0);

    sender.armDisarm(false, true);
    emitAck(sentCommands[sentCommands.length - 1].correlationId, true, 0);

    sender.setMode(0x80, 0x00);
    emitAck(sentCommands[sentCommands.length - 1].correlationId, true, 0);

    sender.takeoff(10);
    emitAck(sentCommands[sentCommands.length - 1].correlationId, true, 0);

    sender.land();
    emitAck(sentCommands[sentCommands.length - 1].correlationId, true, 0);

    sender.returnToLaunch();
    emitAck(sentCommands[sentCommands.length - 1].correlationId, true, 0);

    sender.doReposition(0, 0, 0);
    emitAck(sentCommands[sentCommands.length - 1].correlationId, true, 0);

    expect(names).toEqual([
      'Arm',
      'Emergency Disarm',
      'Set Mode',
      'Takeoff',
      'Land',
      'Return to Launch',
      'Reposition',
    ]);
  });
});
