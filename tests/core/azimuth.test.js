import { describe, it, expect } from 'vitest';
import {
  azimuthSouthToAzimuthNorthClockwise,
  azimuthNorthClockwiseToAzimuthSouth,
  normalizeAzimuthSouth,
  getOppositeAzimuth,
} from '../../src/core/azimuth.js';

describe('azimuthSouthToAzimuthNorthClockwise', () => {
  it('0° (sud) devient 180° (convention nord)', () => {
    expect(azimuthSouthToAzimuthNorthClockwise(0)).toBe(180);
  });

  it('-90° (est) devient 270°', () => {
    expect(azimuthSouthToAzimuthNorthClockwise(-90)).toBe(270);
  });

  it('90° (ouest) devient 90°', () => {
    expect(azimuthSouthToAzimuthNorthClockwise(90)).toBe(90);
  });

  it('180° (nord) devient 0°', () => {
    expect(azimuthSouthToAzimuthNorthClockwise(180)).toBe(0);
  });
});

describe('azimuthNorthClockwiseToAzimuthSouth', () => {
  it("est l'inverse de azimuthSouthToAzimuthNorthClockwise pour des valeurs typiques", () => {
    for (const azS of [0, 45, -90, 90, 135, -135]) {
      const north = azimuthSouthToAzimuthNorthClockwise(azS);
      expect(azimuthNorthClockwiseToAzimuthSouth(north)).toBeCloseTo(azS, 5);
    }
  });
});

describe('normalizeAzimuthSouth', () => {
  it('laisse les valeurs déjà dans [-180, 180] inchangées', () => {
    expect(normalizeAzimuthSouth(45)).toBe(45);
    expect(normalizeAzimuthSouth(-45)).toBe(-45);
  });

  it('ramène 190° à -170°', () => {
    expect(normalizeAzimuthSouth(190)).toBe(-170);
  });

  it('normalise -180 et 180 vers 180 (convention nord = borne haute)', () => {
    expect(normalizeAzimuthSouth(-180)).toBe(180);
    expect(normalizeAzimuthSouth(180)).toBe(180);
  });
});

describe('getOppositeAzimuth', () => {
  it('0° (sud) a pour opposé 180° (nord)', () => {
    expect(getOppositeAzimuth(0)).toBe(180);
  });

  it('-90° (est) a pour opposé 90° (ouest)', () => {
    expect(getOppositeAzimuth(-90)).toBe(90);
  });

  it('est involutif (appliqué deux fois, revient à la valeur initiale)', () => {
    for (const az of [0, 45, -90, 90, 135, -135, 180]) {
      expect(getOppositeAzimuth(getOppositeAzimuth(az))).toBeCloseTo(az === -180 ? 180 : az, 5);
    }
  });
});
