/**
 * Spoof byte source for testing without real MAVLink hardware.
 *
 * Generates realistic MAVLink telemetry frames at configurable rates.
 * Simulates a PX4 vehicle flying a figure-8 pattern over Los Angeles
 * with realistic attitude, position, and system status updates.
 *
 * Enhanced to respond to incoming commands (arm/disarm, mode change,
 * takeoff, land, RTL, reposition) so the full control loop can be tested
 * in software without real hardware.
 */

import type { ByteCallback, IByteSource } from './byte-source';
import { MavlinkFrameBuilder } from '../mavlink/frame-builder';
import { MavlinkFrameParser } from '../mavlink/frame-parser';
import { MavlinkMessageDecoder } from '../mavlink/decoder';
import type { MavlinkMetadataRegistry } from '../mavlink/registry';
import { SpoofParamResponder } from './spoof-param-responder';
import { SpoofFtpResponder } from './spoof-ftp-responder';
import { SpoofCommandResponder, type SpoofVehicleState } from './spoof-command-responder';

/** Status text entries with severity levels. */
const STATUS_MESSAGES: ReadonlyArray<readonly [number, string]> = [
  [6, 'All systems nominal'],
  [6, 'GPS lock acquired'],
  [6, 'Battery voltage nominal'],
  [6, 'Telemetry link stable'],
  [5, 'Altitude hold active'],
  [5, 'Navigation mode enabled'],
  [6, 'Sensor calibration complete'],
  [4, 'Low battery warning'],
  [3, 'Engine temperature high'],
  [2, 'Critical: IMU failure'],
] as const;

/** Degrees-to-radians conversion factor. */
const DEG_TO_RAD = Math.PI / 180;

/** Meters per degree of latitude at equator. */
const METERS_PER_DEG_LAT = 111320;

/** Minimum STATUSTEXT interval in seconds. */
const STATUS_MIN_DELAY_S = 3;

/** Maximum STATUSTEXT interval in seconds. */
const STATUS_MAX_DELAY_S = 8;

/** PX4 AUTO sub-mode encodings (sub_mode << 24 | main_mode << 16). */
const PX4_MODE_AUTO_TAKEOFF = 0x02040000;
const PX4_MODE_AUTO_LOITER = 0x03040000;
const PX4_MODE_AUTO_MISSION = 0x04040000;
const PX4_MODE_AUTO_RTL = 0x05040000;
const PX4_MODE_AUTO_LAND = 0x06040000;

export class SpoofByteSource implements IByteSource {
  private readonly registry: MavlinkMetadataRegistry;
  private readonly frameBuilder: MavlinkFrameBuilder;
  private readonly callbacks = new Set<ByteCallback>();
  private readonly inboundParser: MavlinkFrameParser;
  private readonly inboundDecoder: MavlinkMessageDecoder;
  private readonly paramResponder: SpoofParamResponder;
  private readonly ftpResponder: SpoofFtpResponder;
  private readonly commandResponder: SpoofCommandResponder;

  private readonly systemId: number;
  private readonly componentId: number;

  // Timer handles
  private fastTelemetryTimer: ReturnType<typeof setInterval> | null = null;
  private slowTelemetryTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private statusTextTimer: ReturnType<typeof setTimeout> | null = null;

  private _isConnected = false;
  private sequenceNumber = 0;

  // Simulation state
  private simulationTime = 0;
  private latitude = 34.0522;
  private longitude = -118.2437;
  private altitude = 75.0;     // AMSL
  private groundSpeed = 15.0;
  private heading = 0;
  private roll = 0;            // radians
  private pitch = 0;           // radians
  private yaw = 0;             // radians
  private batteryVoltage = 12.6;
  private throttle = 50;
  private statusTextIndex = 0;

  // PX4 vehicle state (shared with command responder)
  private readonly vehicleState: SpoofVehicleState;

  constructor(
    registry: MavlinkMetadataRegistry,
    systemId = 1,
    componentId = 1,
    metadataJson = '',
  ) {
    this.registry = registry;
    this.frameBuilder = new MavlinkFrameBuilder(registry);
    this.systemId = systemId;
    this.componentId = componentId;

    this.vehicleState = {
      armed: true,
      customMode: 0x00030000, // Position mode on startup
      homeLat: this.latitude,
      homeLon: this.longitude,
      homeAlt: this.altitude,
      targetAlt: this.altitude,
      targetLat: this.latitude,
      targetLon: this.longitude,
      flightPhase: 'cruise',
    };

    // Loopback pipeline: parse outbound frames, decode, dispatch to responders
    this.inboundParser = new MavlinkFrameParser(registry);
    this.inboundDecoder = new MavlinkMessageDecoder(registry);
    this.paramResponder = new SpoofParamResponder(registry, systemId, componentId);
    this.ftpResponder = new SpoofFtpResponder(registry, metadataJson, systemId, componentId);
    this.commandResponder = new SpoofCommandResponder(registry, this.vehicleState, systemId, componentId);

    this.inboundParser.onFrame(frame => {
      const msg = this.inboundDecoder.decode(frame);
      if (!msg) return;

      // Collect responses from all responders
      const responses = [
        ...this.paramResponder.handleMessage(msg),
        ...this.ftpResponder.handleMessage(msg),
        ...this.commandResponder.handleMessage(msg),
      ];

      for (const responseFrame of responses) {
        // Emit response frames through the normal data path
        // Use setTimeout to avoid synchronous re-entry
        setTimeout(() => {
          for (const cb of this.callbacks) {
            cb(responseFrame);
          }
        }, 0);
      }
    });
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  onData(callback: ByteCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  async connect(): Promise<void> {
    if (this._isConnected) {
      await this.disconnect();
    }

    this._isConnected = true;

    // Reset home position on each connect
    this.vehicleState.homeLat = this.latitude;
    this.vehicleState.homeLon = this.longitude;
    this.vehicleState.homeAlt = this.altitude;
    this.vehicleState.targetLat = this.latitude;
    this.vehicleState.targetLon = this.longitude;
    this.vehicleState.targetAlt = this.altitude;

    // Fast telemetry at 10 Hz: ATTITUDE, GLOBAL_POSITION_INT, VFR_HUD
    this.fastTelemetryTimer = setInterval(
      () => this.generateFastTelemetry(),
      100,
    );

    // Slow telemetry at 1 Hz: SYS_STATUS
    this.slowTelemetryTimer = setInterval(
      () => this.generateSlowTelemetry(),
      1000,
    );

    // Heartbeat at 1 Hz
    this.heartbeatTimer = setInterval(
      () => this.generateHeartbeat(),
      1000,
    );

    // STATUSTEXT at random 3-8s intervals
    this.scheduleNextStatusText();
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this._isConnected) return;
    // Feed outbound bytes through the inbound parser for loopback
    this.inboundParser.parse(data);
  }

  async disconnect(): Promise<void> {
    if (this.fastTelemetryTimer !== null) {
      clearInterval(this.fastTelemetryTimer);
      this.fastTelemetryTimer = null;
    }
    if (this.slowTelemetryTimer !== null) {
      clearInterval(this.slowTelemetryTimer);
      this.slowTelemetryTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.statusTextTimer !== null) {
      clearTimeout(this.statusTextTimer);
      this.statusTextTimer = null;
    }
    this._isConnected = false;
  }

  // -------------------------------------------------------------------
  // Private: frame emission
  // -------------------------------------------------------------------

  private emitMessage(
    messageName: string,
    values: Record<string, number | string | number[]>,
  ): void {
    if (!this._isConnected) return;

    const frame = this.frameBuilder.buildFrame({
      messageName,
      values,
      systemId: this.systemId,
      componentId: this.componentId,
      sequence: this.nextSequence(),
    });

    for (const cb of this.callbacks) {
      cb(frame);
    }
  }

  private nextSequence(): number {
    const seq = this.sequenceNumber;
    this.sequenceNumber = (this.sequenceNumber + 1) & 0xFF;
    return seq;
  }

  // -------------------------------------------------------------------
  // Private: telemetry generation
  // -------------------------------------------------------------------

  private generateFastTelemetry(): void {
    if (!this._isConnected) return;

    this.simulationTime += 100;
    const timeBootMs = this.simulationTime;
    const timeInSeconds = this.simulationTime / 1000;

    // Update simulation state
    this.updateSimulationState(timeInSeconds);

    const headingRad = this.heading * DEG_TO_RAD;

    // GLOBAL_POSITION_INT (#33)
    this.emitMessage('GLOBAL_POSITION_INT', {
      time_boot_ms: timeBootMs,
      lat: Math.round(this.latitude * 1e7),
      lon: Math.round(this.longitude * 1e7),
      alt: Math.round(this.altitude * 1000),
      relative_alt: Math.round((this.altitude - this.vehicleState.homeAlt) * 1000),
      vx: Math.round(this.groundSpeed * Math.cos(headingRad) * 100),
      vy: Math.round(this.groundSpeed * Math.sin(headingRad) * 100),
      vz: 0,
      hdg: Math.round(this.heading * 100),
    });

    // ATTITUDE (#30)
    this.emitMessage('ATTITUDE', {
      time_boot_ms: timeBootMs,
      roll: this.roll,
      pitch: this.pitch,
      yaw: this.yaw,
      rollspeed: 0,
      pitchspeed: 0,
      yawspeed: 0,
    });

    // VFR_HUD (#74)
    this.emitMessage('VFR_HUD', {
      airspeed: this.groundSpeed,
      groundspeed: this.groundSpeed,
      heading: Math.round(this.heading),
      throttle: this.throttle,
      alt: this.altitude,
      climb: this.computeClimbRate(),
    });
  }

  private generateSlowTelemetry(): void {
    if (!this._isConnected) return;

    // Battery slow drain
    this.batteryVoltage -= 0.001;
    this.batteryVoltage = clamp(this.batteryVoltage, 10.0, 13.0);

    this.emitMessage('SYS_STATUS', {
      onboard_control_sensors_present: 0x7FF,
      onboard_control_sensors_enabled: 0x7FF,
      onboard_control_sensors_health: 0x7FF,
      load: 100,
      voltage_battery: Math.round(this.batteryVoltage * 1000),
      current_battery: -1,
      battery_remaining: 85,
      drop_rate_comm: 0,
      errors_comm: 0,
      errors_count1: 0,
      errors_count2: 0,
      errors_count3: 0,
      errors_count4: 0,
    });
  }

  private generateHeartbeat(): void {
    if (!this._isConnected) return;

    this.emitMessage('HEARTBEAT', {
      type: 2,              // MAV_TYPE_QUADROTOR
      autopilot: 12,        // MAV_AUTOPILOT_PX4
      base_mode: this.computeBaseMode(),
      custom_mode: this.vehicleState.customMode,
      system_status: 4,     // MAV_STATE_ACTIVE
      mavlink_version: 3,
    });
  }

  private scheduleNextStatusText(): void {
    if (!this._isConnected) return;

    const delayMs = (STATUS_MIN_DELAY_S +
      Math.floor(Math.random() * (STATUS_MAX_DELAY_S - STATUS_MIN_DELAY_S + 1))) * 1000;

    this.statusTextTimer = setTimeout(() => {
      this.generateStatusText();
      this.scheduleNextStatusText();
    }, delayMs);
  }

  private generateStatusText(): void {
    if (!this._isConnected) return;

    const [severity, text] = STATUS_MESSAGES[this.statusTextIndex % STATUS_MESSAGES.length];
    this.statusTextIndex++;

    this.emitMessage('STATUSTEXT', {
      severity,
      text,
    });
  }

  // -------------------------------------------------------------------
  // Private: simulation model
  // -------------------------------------------------------------------

  private updateSimulationState(timeInSeconds: number): void {
    const vs = this.vehicleState;

    switch (vs.flightPhase) {
      case 'takeoff':
        this.updateTakeoff();
        break;
      case 'land':
        this.updateLand();
        break;
      case 'rtl':
        this.updateRTL();
        break;
      case 'hold':
        this.updateHold();
        break;
      default:
        this.updateCruise(timeInSeconds);
        break;
    }

    // Yaw follows heading for all phases
    this.yaw = this.heading * DEG_TO_RAD;
  }

  private updateTakeoff(): void {
    const climbRate = 0.3; // 3 m/s at 10 Hz
    if (this.altitude < this.vehicleState.targetAlt - 0.5) {
      this.altitude += climbRate;
      this.throttle = clamp(this.throttle + 2, 50, 100);
    } else {
      // Reached target — switch to Hold
      this.vehicleState.flightPhase = 'hold';
      this.vehicleState.customMode = PX4_MODE_AUTO_LOITER;
      this.vehicleState.targetLat = this.latitude;
      this.vehicleState.targetLon = this.longitude;
      this.vehicleState.targetAlt = this.altitude;
    }
  }

  private updateLand(): void {
    const descentRate = 0.2; // 2 m/s at 10 Hz
    const groundAlt = this.vehicleState.homeAlt;

    if (this.altitude > groundAlt + 0.5) {
      this.altitude -= descentRate;
      this.throttle = clamp(this.throttle - 3, 10, 100);
    } else {
      // Touchdown
      this.altitude = groundAlt;
      this.groundSpeed = 0;
      this.throttle = 0;
      this.vehicleState.armed = false;
      this.vehicleState.flightPhase = 'hold';
      this.vehicleState.customMode = PX4_MODE_AUTO_LOITER;
    }
  }

  private updateRTL(): void {
    const vs = this.vehicleState;
    const rtlCruiseAlt = Math.max(vs.homeAlt + 20, this.altitude);

    // First climb to safe RTL altitude
    if (this.altitude < rtlCruiseAlt - 0.5) {
      this.altitude += 0.25;
      this.throttle = 70;
      return;
    }

    // Fly toward home
    const dx = (vs.homeLon - this.longitude) * METERS_PER_DEG_LAT * Math.cos(this.latitude * DEG_TO_RAD);
    const dy = (vs.homeLat - this.latitude) * METERS_PER_DEG_LAT;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist > 10) {
      const speed = 15; // m/s
      this.groundSpeed = speed;
      const desiredHeading = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
      this.heading = smoothHeading(this.heading, desiredHeading);

      const headingRad = this.heading * DEG_TO_RAD;
      this.latitude += (speed * Math.cos(headingRad) * 0.1) / METERS_PER_DEG_LAT;
      this.longitude += (speed * Math.sin(headingRad) * 0.1) / (METERS_PER_DEG_LAT * Math.cos(this.latitude * DEG_TO_RAD));
      this.throttle = 60;
    } else {
      // Arrived at home — start landing
      this.vehicleState.flightPhase = 'land';
      this.vehicleState.customMode = PX4_MODE_AUTO_LAND;
    }
  }

  private updateHold(): void {
    const vs = this.vehicleState;
    const dx = (vs.targetLon - this.longitude) * METERS_PER_DEG_LAT * Math.cos(this.latitude * DEG_TO_RAD);
    const dy = (vs.targetLat - this.latitude) * METERS_PER_DEG_LAT;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Vertical guidance
    const altError = vs.targetAlt - this.altitude;
    if (Math.abs(altError) > 0.5) {
      this.altitude += clamp(altError * 0.05, -0.2, 0.2);
    }

    if (dist > 5) {
      const speed = 12;
      this.groundSpeed = speed;
      const desiredHeading = (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
      this.heading = smoothHeading(this.heading, desiredHeading);

      const headingRad = this.heading * DEG_TO_RAD;
      this.latitude += (speed * Math.cos(headingRad) * 0.1) / METERS_PER_DEG_LAT;
      this.longitude += (speed * Math.sin(headingRad) * 0.1) / (METERS_PER_DEG_LAT * Math.cos(this.latitude * DEG_TO_RAD));
      this.throttle = 55;
    } else {
      // Close enough — loiter with small drift
      this.groundSpeed = 8;
      this.updateCruiseHeading(0.1);
      this.throttle = 45;
    }
  }

  private updateCruise(timeInSeconds: number): void {
    // Altitude random walk bounded [50, 100]m AMSL
    this.altitude += (Math.random() - 0.5) * 0.1;
    this.altitude = clamp(this.altitude, this.vehicleState.homeAlt, this.vehicleState.homeAlt + 100);

    // Groundspeed random walk bounded [5, 25] m/s
    this.groundSpeed += (Math.random() - 0.5) * 0.6;
    this.groundSpeed = clamp(this.groundSpeed, 5, 25);

    // Figure-8 heading pattern
    const baseHeading = (timeInSeconds * 15) % 360;
    const headingVariation = 30 * Math.sin(timeInSeconds * 0.5);
    this.heading = ((baseHeading + headingVariation) % 360 + 360) % 360;

    // Roll random walk bounded [-20deg, 20deg] in radians
    this.roll += (Math.random() - 0.5) * 0.1;
    this.roll = clamp(this.roll, -20 * DEG_TO_RAD, 20 * DEG_TO_RAD);

    // Pitch random walk bounded [-15deg, 15deg] in radians
    this.pitch += (Math.random() - 0.5) * 0.1;
    this.pitch = clamp(this.pitch, -15 * DEG_TO_RAD, 15 * DEG_TO_RAD);

    // GPS position update
    const headingRad = this.heading * DEG_TO_RAD;
    const latRad = this.latitude * DEG_TO_RAD;
    this.latitude += (this.groundSpeed * Math.cos(headingRad) * 0.1) / METERS_PER_DEG_LAT;
    this.longitude += (this.groundSpeed * Math.sin(headingRad) * 0.1) / (METERS_PER_DEG_LAT * Math.cos(latRad));

    // Throttle random walk bounded [0, 100]
    this.throttle += Math.round((Math.random() - 0.5) * 10);
    this.throttle = clamp(this.throttle, 0, 100);
  }

  private updateCruiseHeading(timeStep: number): void {
    // Small circular drift when holding position
    this.heading = (this.heading + 15 * timeStep) % 360;
    const headingRad = this.heading * DEG_TO_RAD;
    const latRad = this.latitude * DEG_TO_RAD;
    this.latitude += (this.groundSpeed * Math.cos(headingRad) * 0.1) / METERS_PER_DEG_LAT;
    this.longitude += (this.groundSpeed * Math.sin(headingRad) * 0.1) / (METERS_PER_DEG_LAT * Math.cos(latRad));
  }

  // -------------------------------------------------------------------
  // Private: PX4 mode helpers
  // -------------------------------------------------------------------

  private computeBaseMode(): number {
    const vs = this.vehicleState;
    let mode = 0x01; // MAV_MODE_FLAG_CUSTOM_MODE_ENABLED

    if (vs.armed) {
      mode |= 0x80; // MAV_MODE_FLAG_SAFETY_ARMED
    }

    const mainMode = (vs.customMode >> 16) & 0xff;

    switch (mainMode) {
      case 1: // MANUAL
      case 5: // ACRO
        mode |= 0x40; // MAV_MODE_FLAG_MANUAL_INPUT_ENABLED
        break;
      case 2: // ALTCTL
      case 7: // STABILIZED
        mode |= 0x10; // MAV_MODE_FLAG_STABILIZE_ENABLED
        break;
      case 3: // POSCTL
        mode |= 0x10 | 0x08; // STABILIZE + GUIDED
        break;
      case 4: // AUTO
        mode |= 0x04 | 0x08; // AUTO + GUIDED
        break;
      case 6: // OFFBOARD
        mode |= 0x04 | 0x08; // AUTO + GUIDED
        break;
    }

    return mode;
  }

  private computeClimbRate(): number {
    switch (this.vehicleState.flightPhase) {
      case 'takeoff': return 3;
      case 'land': return -2;
      case 'rtl': {
        const rtlCruiseAlt = Math.max(this.vehicleState.homeAlt + 20, this.altitude);
        return this.altitude < rtlCruiseAlt - 0.5 ? 2.5 : 0;
      }
      default: return 0;
    }
  }
}

/** Clamp a value to the range [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

/** Smoothly rotate current heading toward desired heading (degrees). */
function smoothHeading(current: number, desired: number): number {
  let diff = desired - current;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return (current + clamp(diff, -5, 5) + 360) % 360;
}
