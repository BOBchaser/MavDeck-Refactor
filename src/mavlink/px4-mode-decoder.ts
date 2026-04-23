/**
 * Decode PX4 HEARTBEAT.custom_mode into human-readable flight mode names.
 *
 * Encoding matches QGroundControl's PX4FirmwarePlugin and PX4's px4_custom_mode.h.
 * On little-endian systems, px4_custom_mode union layout is:
 *   byte 0-1: reserved
 *   byte 2:   main_mode (bits 16-23)
 *   byte 3:   sub_mode  (bits 24-31)
 *
 * QGC's PX4CustomMode::Mode enum computes the uint32_t key as:
 *   main_mode << 16 | sub_mode << 24
 *
 * Source: qgroundcontrol-master/src/FirmwarePlugin/PX4/px4_custom_mode.h
 */

const PX4_MODE_NAME_MAP: Readonly<Record<number, string>> = {
  // Pure main modes (no sub_mode)
  0x00010000: 'Manual',
  0x00070000: 'Stabilized',
  0x00050000: 'Acro',
  0x00080000: 'Rattitude',
  0x00020000: 'Altitude',
  0x00060000: 'Offboard',
  0x00090000: 'Simple',

  // POSCTL sub-modes
  0x00030000: 'Position',
  0x01030000: 'Orbit',

  // AUTO sub-modes
  0x01040000: 'Ready',
  0x02040000: 'Takeoff',
  0x03040000: 'Hold',
  0x04040000: 'Mission',
  0x05040000: 'Return',
  0x06040000: 'Land',
  0x07040000: 'Return to Groundstation',
  0x08040000: 'Follow Me',
  0x09040000: 'Precision Land',
};

export interface Px4ModeInfo {
  readonly mainMode: number;
  readonly subMode: number;
  readonly modeName: string;
}

/**
 * Decode a PX4 custom_mode uint32_t into main/sub mode components.
 *
 * On little-endian the wire bytes are [reserved_lo, reserved_hi, main, sub],
 * so as a uint32_t: main_mode occupies bits 16-23 and sub_mode bits 24-31.
 */
export function decodePx4CustomModeComponents(customMode: number): {
  mainMode: number;
  subMode: number;
} {
  return {
    mainMode: (customMode >> 16) & 0xff,
    subMode: (customMode >> 24) & 0xff,
  };
}

/**
 * Return the human-readable PX4 flight mode name for a given HEARTBEAT pair.
 *
 * @param baseMode    HEARTBEAT.base_mode
 * @param customMode  HEARTBEAT.custom_mode
 * @returns mode name, or "Unknown" if custom mode bit is not set
 */
export function decodePx4FlightMode(baseMode: number, customMode: number): string {
  const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 0x80;

  if ((baseMode & MAV_MODE_FLAG_CUSTOM_MODE_ENABLED) === 0) {
    return 'Unknown';
  }

  return PX4_MODE_NAME_MAP[customMode] ?? `Unknown ${baseMode}:${customMode}`;
}

/**
 * Full decode returning structured info.
 */
export function decodePx4ModeInfo(baseMode: number, customMode: number): Px4ModeInfo {
  const components = decodePx4CustomModeComponents(customMode);
  return {
    mainMode: components.mainMode,
    subMode: components.subMode,
    modeName: decodePx4FlightMode(baseMode, customMode),
  };
}

/**
 * Extract armed state from HEARTBEAT.base_mode.
 */
export function isArmedFromBaseMode(baseMode: number): boolean {
  const MAV_MODE_FLAG_SAFETY_ARMED = 0x80;
  return (baseMode & MAV_MODE_FLAG_SAFETY_ARMED) !== 0;
}

/**
 * Ordered list of PX4 modes that can be set by the user.
 * Matches QGC's PX4FirmwarePlugin._flightModeList filtered by canBeSet=true.
 */
export const PX4_SETTABLE_MODES: ReadonlyArray<{ name: string; customMode: number }> = [
  { name: 'Manual', customMode: 0x00010000 },
  { name: 'Stabilized', customMode: 0x00070000 },
  { name: 'Acro', customMode: 0x00050000 },
  { name: 'Rattitude', customMode: 0x00080000 },
  { name: 'Altitude', customMode: 0x00020000 },
  { name: 'Offboard', customMode: 0x00060000 },
  { name: 'Position', customMode: 0x00030000 },
  { name: 'Hold', customMode: 0x03040000 },
  { name: 'Mission', customMode: 0x04040000 },
  { name: 'Return', customMode: 0x05040000 },
  { name: 'Precision Land', customMode: 0x09040000 },
];
