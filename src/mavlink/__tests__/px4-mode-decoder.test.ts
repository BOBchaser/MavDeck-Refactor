import { describe, expect, it } from 'vitest';
import {
  decodePx4CustomModeComponents,
  decodePx4FlightMode,
  decodePx4ModeInfo,
  isArmedFromBaseMode,
  PX4_SETTABLE_MODES,
} from '../px4-mode-decoder';

describe('decodePx4CustomModeComponents', () => {
  it('decodes pure main modes', () => {
    expect(decodePx4CustomModeComponents(0x00010000)).toEqual({ mainMode: 1, subMode: 0 });
    expect(decodePx4CustomModeComponents(0x00020000)).toEqual({ mainMode: 2, subMode: 0 });
    expect(decodePx4CustomModeComponents(0x00070000)).toEqual({ mainMode: 7, subMode: 0 });
  });

  it('decodes auto sub-modes', () => {
    expect(decodePx4CustomModeComponents(0x04040000)).toEqual({ mainMode: 4, subMode: 4 });
    expect(decodePx4CustomModeComponents(0x05040000)).toEqual({ mainMode: 4, subMode: 5 });
    expect(decodePx4CustomModeComponents(0x03040000)).toEqual({ mainMode: 4, subMode: 3 });
  });

  it('decodes posctl sub-modes', () => {
    expect(decodePx4CustomModeComponents(0x00030000)).toEqual({ mainMode: 3, subMode: 0 });
    expect(decodePx4CustomModeComponents(0x01030000)).toEqual({ mainMode: 3, subMode: 1 });
  });
});

describe('decodePx4FlightMode', () => {
  it('returns Unknown when custom mode bit is not set', () => {
    expect(decodePx4FlightMode(0x00, 0x00010000)).toBe('Unknown');
    expect(decodePx4FlightMode(0x40, 0x00010000)).toBe('Unknown');
  });

  it('decodes all known pure main modes', () => {
    const base = 0x80; // MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
    expect(decodePx4FlightMode(base, 0x00010000)).toBe('Manual');
    expect(decodePx4FlightMode(base, 0x00070000)).toBe('Stabilized');
    expect(decodePx4FlightMode(base, 0x00050000)).toBe('Acro');
    expect(decodePx4FlightMode(base, 0x00080000)).toBe('Rattitude');
    expect(decodePx4FlightMode(base, 0x00020000)).toBe('Altitude');
    expect(decodePx4FlightMode(base, 0x00060000)).toBe('Offboard');
    expect(decodePx4FlightMode(base, 0x00090000)).toBe('Simple');
  });

  it('decodes all known auto sub-modes', () => {
    const base = 0x80;
    expect(decodePx4FlightMode(base, 0x01040000)).toBe('Ready');
    expect(decodePx4FlightMode(base, 0x02040000)).toBe('Takeoff');
    expect(decodePx4FlightMode(base, 0x03040000)).toBe('Hold');
    expect(decodePx4FlightMode(base, 0x04040000)).toBe('Mission');
    expect(decodePx4FlightMode(base, 0x05040000)).toBe('Return');
    expect(decodePx4FlightMode(base, 0x06040000)).toBe('Land');
    expect(decodePx4FlightMode(base, 0x07040000)).toBe('Return to Groundstation');
    expect(decodePx4FlightMode(base, 0x08040000)).toBe('Follow Me');
    expect(decodePx4FlightMode(base, 0x09040000)).toBe('Precision Land');
  });

  it('decodes posctl sub-modes', () => {
    const base = 0x80;
    expect(decodePx4FlightMode(base, 0x00030000)).toBe('Position');
    expect(decodePx4FlightMode(base, 0x01030000)).toBe('Orbit');
  });

  it('returns formatted unknown for unrecognized custom modes', () => {
    expect(decodePx4FlightMode(0x80, 0xdeadbeef)).toBe('Unknown 128:3735928559');
  });
});

describe('decodePx4ModeInfo', () => {
  it('returns structured info for a known mode', () => {
    expect(decodePx4ModeInfo(0x80, 0x04040000)).toEqual({
      mainMode: 4,
      subMode: 4,
      modeName: 'Mission',
    });
  });
});

describe('isArmedFromBaseMode', () => {
  it('returns true when armed bit is set', () => {
    expect(isArmedFromBaseMode(0x80)).toBe(true);
    expect(isArmedFromBaseMode(0xc0)).toBe(true);
  });

  it('returns false when armed bit is not set', () => {
    expect(isArmedFromBaseMode(0x00)).toBe(false);
    expect(isArmedFromBaseMode(0x40)).toBe(false);
  });
});

describe('PX4_SETTABLE_MODES', () => {
  it('contains only modes that QGC considers settable', () => {
    // Verify all entries have known mode names
    for (const mode of PX4_SETTABLE_MODES) {
      expect(decodePx4FlightMode(0x80, mode.customMode)).toBe(mode.name);
    }
  });

  it('does not contain non-settable modes', () => {
    const customModes = PX4_SETTABLE_MODES.map((m) => m.customMode);
    expect(customModes).not.toContain(0x00090000); // Simple
    expect(customModes).not.toContain(0x01030000); // Orbit
    expect(customModes).not.toContain(0x06040000); // Land
    expect(customModes).not.toContain(0x01040000); // Ready
    expect(customModes).not.toContain(0x07040000); // RTGS
    expect(customModes).not.toContain(0x02040000); // Takeoff
    expect(customModes).not.toContain(0x08040000); // Follow Me
  });
});
