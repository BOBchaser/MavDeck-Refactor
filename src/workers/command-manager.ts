/**
 * MAVLink command protocol state machine.
 *
 * Runs inside the Web Worker. Handles COMMAND_LONG / COMMAND_INT
 * transmission and COMMAND_ACK tracking with timeout and retry.
 */

import { EventEmitter } from '../core/event-emitter';
import type { MavlinkMessage } from '../mavlink/decoder';

const MAV_RESULT_ACCEPTED = 0;
const COMMAND_RETRY_TIMEOUT_MS = 5000;
const MAX_COMMAND_RETRIES = 3;

export interface CommandAckInfo {
  correlationId: number;
  success: boolean;
  result?: number;
  error?: string;
}

interface PendingCommand {
  correlationId: number;
  messageName: string;
  fields: Record<string, number>;
  retries: number;
  timer: ReturnType<typeof setTimeout>;
}

export class CommandManager {
  private readonly pending = new Map<number, PendingCommand>();
  private readonly ackEmitter = new EventEmitter<(ack: CommandAckInfo) => void>();

  constructor(
    private readonly sendFrame: (messageName: string, values: Record<string, number | string | number[]>) => void,
    private readonly getVehicleTarget: () => { systemId: number; componentId: number },
  ) {}

  /** Subscribe to command ACK events. */
  onAck(callback: (ack: CommandAckInfo) => void): () => void {
    return this.ackEmitter.on(callback);
  }

  /** Send a command and begin ACK tracking. */
  sendCommand(messageName: 'COMMAND_LONG' | 'COMMAND_INT', fields: Record<string, number>, correlationId: number): void {
    const commandId = fields['command'];
    if (typeof commandId !== 'number') {
      this.ackEmitter.emit({
        correlationId,
        success: false,
        error: 'Missing "command" field in command frame',
      });
      return;
    }

    // Cancel any existing pending command with the same MAV_CMD id
    const existing = this.findPendingByCommandId(commandId);
    if (existing) {
      clearTimeout(existing.timer);
      this.pending.delete(existing.correlationId);
    }

    const vehicle = this.getVehicleTarget();
    const enrichedFields = {
      target_system: vehicle.systemId,
      target_component: vehicle.componentId,
      ...fields,
    };

    const pending: PendingCommand = {
      correlationId,
      messageName,
      fields: enrichedFields,
      retries: 0,
      timer: setTimeout(() => this.handleTimeout(correlationId), COMMAND_RETRY_TIMEOUT_MS),
    };
    this.pending.set(correlationId, pending);

    this.sendFrame(messageName, enrichedFields);
  }

  /** Process a decoded MAVLink message. Only acts on COMMAND_ACK. */
  handleMessage(msg: MavlinkMessage): void {
    if (msg.name !== 'COMMAND_ACK') return;

    const commandId = msg.values['command'] as number | undefined;
    const result = msg.values['result'] as number | undefined;
    if (typeof commandId !== 'number' || typeof result !== 'number') return;

    const pending = this.findPendingByCommandId(commandId);
    if (!pending) return;

    clearTimeout(pending.timer);
    this.pending.delete(pending.correlationId);

    const success = result === MAV_RESULT_ACCEPTED;
    this.ackEmitter.emit({
      correlationId: pending.correlationId,
      success,
      result,
      error: success ? undefined : `Command denied (result=${result})`,
    });
  }

  /** Clean up all pending timers. */
  dispose(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
    }
    this.pending.clear();
    this.ackEmitter.clear();
  }

  private findPendingByCommandId(commandId: number): PendingCommand | undefined {
    for (const pending of this.pending.values()) {
      if (pending.fields['command'] === commandId) {
        return pending;
      }
    }
    return undefined;
  }

  private handleTimeout(correlationId: number): void {
    const pending = this.pending.get(correlationId);
    if (!pending) return;

    pending.retries++;
    if (pending.retries > MAX_COMMAND_RETRIES) {
      this.pending.delete(correlationId);
      this.ackEmitter.emit({
        correlationId,
        success: false,
        error: `Timeout after ${MAX_COMMAND_RETRIES} retries`,
      });
      return;
    }

    // Retry: re-send the frame
    this.sendFrame(pending.messageName, pending.fields);
    pending.timer = setTimeout(() => this.handleTimeout(correlationId), COMMAND_RETRY_TIMEOUT_MS);
  }
}
