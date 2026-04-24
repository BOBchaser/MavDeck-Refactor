/**
 * Typed MAVLink command sender for the main thread.
 *
 * Wraps MavlinkWorkerBridge with Promise-based methods for common
 * flight commands. Generates correlation IDs and matches COMMAND_ACKs.
 * Emits command result events for global UI feedback (toast notifications).
 */

import { EventEmitter } from '../core';
import type { MavlinkWorkerBridge } from './worker-bridge';

// ---------------------------------------------------------------------------
// MAV_CMD constants (from common.xml)
// ---------------------------------------------------------------------------

export const MAV_CMD_COMPONENT_ARM_DISARM = 400;
export const MAV_CMD_DO_SET_MODE = 176;
export const MAV_CMD_NAV_TAKEOFF = 22;
export const MAV_CMD_NAV_LAND = 21;
export const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
export const MAV_CMD_DO_REPOSITION = 192;

/** MAV_RESULT codes from COMMAND_ACK. */
export const MAV_RESULT_ACCEPTED = 0;
export const MAV_RESULT_TEMPORARILY_REJECTED = 1;
export const MAV_RESULT_DENIED = 2;
export const MAV_RESULT_UNSUPPORTED = 3;
export const MAV_RESULT_FAILED = 4;
export const MAV_RESULT_IN_PROGRESS = 5;
export const MAV_RESULT_CANCELLED = 6;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandResult {
  success: boolean;
  result?: number;
  error?: string;
}

/** Event emitted when a command ACK is received, carrying the human-readable command name. */
export interface CommandAckEntry {
  commandName: string;
  success: boolean;
  result?: number;
  error?: string;
}

type PendingCommand = {
  resolve: (result: CommandResult) => void;
  reject: (reason: Error) => void;
};

// ---------------------------------------------------------------------------
// CommandSender
// ---------------------------------------------------------------------------

export class CommandSender {
  private correlationId = 0;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly commandNames = new Map<number, string>();
  private readonly resultEmitter = new EventEmitter<(entry: CommandAckEntry) => void>();

  constructor(private readonly bridge: MavlinkWorkerBridge) {
    this.bridge.onCommandAck(ack => {
      const pending = this.pending.get(ack.correlationId);
      if (!pending) return;
      this.pending.delete(ack.correlationId);
      const result: CommandResult = {
        success: ack.success,
        result: ack.result,
        error: ack.error,
      };
      pending.resolve(result);

      const name = this.commandNames.get(ack.correlationId);
      if (name) {
        this.resultEmitter.emit({ commandName: name, ...result });
        this.commandNames.delete(ack.correlationId);
      }
    });
  }

  /** Subscribe to command ACK results (for toast / global feedback). */
  onCommandResult(callback: (entry: CommandAckEntry) => void): () => void {
    return this.resultEmitter.on(callback);
  }

  /** Internal send helper that tracks a human-readable name per correlation ID. */
  private send(
    messageName: 'COMMAND_LONG' | 'COMMAND_INT',
    name: string,
    fields: Record<string, number>,
  ): Promise<CommandResult> {
    const id = ++this.correlationId;
    this.commandNames.set(id, name);
    return new Promise<CommandResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.bridge.sendCommand(messageName, fields, id);
    });
  }

  /** Send a raw COMMAND_LONG and return a Promise that resolves on ACK. */
  sendCommandLong(fields: Record<string, number>, name = 'Command'): Promise<CommandResult> {
    return this.send('COMMAND_LONG', name, fields);
  }

  /** Send a raw COMMAND_INT and return a Promise that resolves on ACK. */
  sendCommandInt(fields: Record<string, number>, name = 'Command'): Promise<CommandResult> {
    return this.send('COMMAND_INT', name, fields);
  }

  /** Arm or disarm the vehicle. */
  armDisarm(arm: boolean, force = false): Promise<CommandResult> {
    return this.send('COMMAND_LONG', force ? 'Emergency Disarm' : (arm ? 'Arm' : 'Disarm'), {
      command: MAV_CMD_COMPONENT_ARM_DISARM,
      confirmation: 0,
      param1: arm ? 1 : 0,
      param2: force ? 21196 : 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
  }

  /** Set the vehicle flight mode. */
  setMode(baseMode: number, customMode: number): Promise<CommandResult> {
    return this.send('COMMAND_LONG', 'Set Mode', {
      command: MAV_CMD_DO_SET_MODE,
      confirmation: 0,
      param1: baseMode,
      param2: customMode,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
  }

  /** Trigger takeoff to the given altitude (metres). */
  takeoff(altitude: number): Promise<CommandResult> {
    return this.send('COMMAND_LONG', 'Takeoff', {
      command: MAV_CMD_NAV_TAKEOFF,
      confirmation: 0,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: altitude,
    });
  }

  /** Trigger landing at the current position. */
  land(): Promise<CommandResult> {
    return this.send('COMMAND_LONG', 'Land', {
      command: MAV_CMD_NAV_LAND,
      confirmation: 0,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
  }

  /** Trigger return-to-launch. */
  returnToLaunch(): Promise<CommandResult> {
    return this.send('COMMAND_LONG', 'Return to Launch', {
      command: MAV_CMD_NAV_RETURN_TO_LAUNCH,
      confirmation: 0,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
    });
  }

  /** Send a DO_REPOSITION command to move to lat/lon/alt. */
  doReposition(lat: number, lon: number, alt: number, groundSpeed = -1): Promise<CommandResult> {
    return this.send('COMMAND_INT', 'Reposition', {
      command: MAV_CMD_DO_REPOSITION,
      frame: 0,
      current: 0,
      autocontinue: 0,
      param1: groundSpeed,
      param2: 0,
      param3: 0,
      param4: 0,
      x: lat * 1e7,
      y: lon * 1e7,
      z: alt,
    });
  }
}
