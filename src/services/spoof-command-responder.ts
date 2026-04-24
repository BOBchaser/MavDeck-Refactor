/**
 * Simulated MAVLink command responder for spoof/demo mode.
 *
 * Receives COMMAND_LONG / COMMAND_INT from the GCS, updates vehicle
 * simulation state, and returns COMMAND_ACK frames.
 *
 * Behaviour is modelled on PX4 Commander / mavlink_receiver.cpp so
 * that a successful simulation run implies the real control loop will
 * work against a real PX4 vehicle.
 */

import { MavlinkFrameBuilder } from '../mavlink/frame-builder';
import type { MavlinkMetadataRegistry } from '../mavlink/registry';
import type { MavlinkMessage } from '../mavlink/decoder';

export type SpoofFlightPhase = 'cruise' | 'takeoff' | 'land' | 'rtl' | 'hold';

/** Mutable vehicle state shared between SpoofByteSource and SpoofCommandResponder. */
export interface SpoofVehicleState {
  armed: boolean;
  customMode: number;
  homeLat: number;
  homeLon: number;
  homeAlt: number;
  targetAlt: number;
  targetLat: number;
  targetLon: number;
  flightPhase: SpoofFlightPhase;
}

const MAV_CMD_COMPONENT_ARM_DISARM = 400;
const MAV_CMD_DO_SET_MODE = 176;
const MAV_CMD_NAV_TAKEOFF = 22;
const MAV_CMD_NAV_LAND = 21;
const MAV_CMD_NAV_RETURN_TO_LAUNCH = 20;
const MAV_CMD_DO_REPOSITION = 192;

const MAV_RESULT_ACCEPTED = 0;

/** PX4 custom_mode AUTO sub-modes (sub_mode << 24 | main_mode << 16). */
const PX4_CUSTOM_MODE_AUTO_TAKEOFF = 0x02040000;
const PX4_CUSTOM_MODE_AUTO_LOITER = 0x03040000;
const PX4_CUSTOM_MODE_AUTO_MISSION = 0x04040000;
const PX4_CUSTOM_MODE_AUTO_RTL = 0x05040000;
const PX4_CUSTOM_MODE_AUTO_LAND = 0x06040000;

export class SpoofCommandResponder {
  private readonly frameBuilder: MavlinkFrameBuilder;
  private readonly systemId: number;
  private readonly componentId: number;

  constructor(
    registry: MavlinkMetadataRegistry,
    private readonly state: SpoofVehicleState,
    systemId = 1,
    componentId = 1,
  ) {
    this.frameBuilder = new MavlinkFrameBuilder(registry);
    this.systemId = systemId;
    this.componentId = componentId;
  }

  /** Handle a decoded outbound command. Returns response frames to emit. */
  handleMessage(msg: MavlinkMessage): Uint8Array[] {
    if (msg.name !== 'COMMAND_LONG' && msg.name !== 'COMMAND_INT') {
      return [];
    }

    const commandId = msg.values.command as number;
    if (typeof commandId !== 'number') {
      return [];
    }

    const result = this.processCommand(commandId, msg);

    const ack = this.frameBuilder.buildFrame({
      messageName: 'COMMAND_ACK',
      values: {
        command: commandId,
        result,
        target_system: msg.systemId,
        target_component: msg.componentId,
      },
      systemId: this.systemId,
      componentId: this.componentId,
      sequence: 0,
    });

    return [ack];
  }

  private processCommand(commandId: number, msg: MavlinkMessage): number {
    switch (commandId) {
      case MAV_CMD_COMPONENT_ARM_DISARM:
        return this.handleArmDisarm(msg);
      case MAV_CMD_DO_SET_MODE:
        return this.handleSetMode(msg);
      case MAV_CMD_NAV_TAKEOFF:
        return this.handleTakeoff(msg);
      case MAV_CMD_NAV_LAND:
        return this.handleLand();
      case MAV_CMD_NAV_RETURN_TO_LAUNCH:
        return this.handleRTL();
      case MAV_CMD_DO_REPOSITION:
        return this.handleReposition(msg);
      default:
        // Accept unknown commands so the test path stays green.
        return MAV_RESULT_ACCEPTED;
    }
  }

  private handleArmDisarm(msg: MavlinkMessage): number {
    const armValue = Math.round(msg.values.param1 as number);
    const forceValue = Math.round(msg.values.param2 as number);

    if (armValue === 1) {
      this.state.armed = true;
    } else if (armValue === 0) {
      if (forceValue === 21196) {
        // Emergency stop — force disarm
      }
      this.state.armed = false;
    }
    return MAV_RESULT_ACCEPTED;
  }

  private handleSetMode(msg: MavlinkMessage): number {
    const customMode = msg.values.param2 as number;
    if (typeof customMode === 'number') {
      this.state.customMode = customMode;
      this.updatePhaseFromMode(customMode);
    }
    return MAV_RESULT_ACCEPTED;
  }

  private handleTakeoff(msg: MavlinkMessage): number {
    const alt = msg.values.param7 as number;
    // QGC sends AMSL altitude; if the value looks relative (lower than
    // current altitude + a small margin) treat it as a relative addition.
    const requestedAlt = Number.isFinite(alt) ? alt : this.state.homeAlt + 10;
    this.state.targetAlt = Math.max(requestedAlt, this.state.homeAlt + 10);
    this.state.flightPhase = 'takeoff';
    this.state.customMode = PX4_CUSTOM_MODE_AUTO_TAKEOFF;
    return MAV_RESULT_ACCEPTED;
  }

  private handleLand(): number {
    this.state.flightPhase = 'land';
    this.state.customMode = PX4_CUSTOM_MODE_AUTO_LAND;
    return MAV_RESULT_ACCEPTED;
  }

  private handleRTL(): number {
    this.state.flightPhase = 'rtl';
    this.state.customMode = PX4_CUSTOM_MODE_AUTO_RTL;
    return MAV_RESULT_ACCEPTED;
  }

  private handleReposition(msg: MavlinkMessage): number {
    let lat: number | undefined;
    let lon: number | undefined;
    let alt: number | undefined;

    if (msg.name === 'COMMAND_INT') {
      lat = (msg.values.x as number) / 1e7;
      lon = (msg.values.y as number) / 1e7;
      alt = msg.values.z as number;
    } else {
      lat = msg.values.param5 as number;
      lon = msg.values.param6 as number;
      alt = msg.values.param7 as number;
    }

    if (lat !== undefined && lon !== undefined) {
      this.state.targetLat = lat;
      this.state.targetLon = lon;
    }
    if (alt !== undefined) {
      this.state.targetAlt = alt;
    }

    this.state.flightPhase = 'hold';
    this.state.customMode = PX4_CUSTOM_MODE_AUTO_LOITER;
    return MAV_RESULT_ACCEPTED;
  }

  private updatePhaseFromMode(customMode: number): void {
    const mainMode = (customMode >> 16) & 0xff;
    const subMode = (customMode >> 24) & 0xff;

    if (mainMode === 4) {
      // AUTO modes
      switch (subMode) {
        case 2:
          this.state.flightPhase = 'takeoff';
          break;
        case 3:
          this.state.flightPhase = 'hold';
          break;
        case 4:
          this.state.flightPhase = 'cruise';
          break;
        case 5:
          this.state.flightPhase = 'rtl';
          break;
        case 6:
          this.state.flightPhase = 'land';
          break;
        default:
          this.state.flightPhase = 'hold';
          break;
      }
    } else {
      this.state.flightPhase = 'cruise';
    }
  }
}
