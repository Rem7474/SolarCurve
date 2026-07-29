import { describe, it, expect } from 'vitest';
import { bearingBetweenPoints, destinationPoint } from '../../src/core/geo.js';

describe('bearingBetweenPoints', () => {
  it('returns 0° (nord) quand le point 2 est directement au nord', () => {
    const bearing = bearingBetweenPoints(45, 5, 46, 5);
    expect(bearing).toBeCloseTo(0, 5);
  });

  it("returns 90° (est) quand le point 2 est directement à l'est sur l'équateur", () => {
    const bearing = bearingBetweenPoints(0, 5, 0, 6);
    expect(bearing).toBeCloseTo(90, 5);
  });

  it('returns 180° (sud) quand le point 2 est directement au sud', () => {
    const bearing = bearingBetweenPoints(45, 5, 44, 5);
    expect(bearing).toBeCloseTo(180, 5);
  });

  it("returns 270° (ouest) quand le point 2 est directement à l'ouest sur l'équateur", () => {
    const bearing = bearingBetweenPoints(0, 5, 0, 4);
    expect(bearing).toBeCloseTo(270, 5);
  });
});

describe('destinationPoint', () => {
  it('déplacer de 0 mètre revient au point de départ', () => {
    const p = destinationPoint(45, 5, 90, 0);
    expect(p.lat).toBeCloseTo(45, 5);
    expect(p.lon).toBeCloseTo(5, 5);
  });

  it('est réversible avec bearingBetweenPoints (aller-retour cohérent)', () => {
    const start = { lat: 45, lon: 5 };
    const dest = destinationPoint(start.lat, start.lon, 90, 10000);
    const bearingBack = bearingBetweenPoints(dest.lat, dest.lon, start.lat, start.lon);
    // Partis plein est, le chemin retour doit pointer approximativement plein ouest (270°)
    expect(bearingBack).toBeCloseTo(270, 0);
  });

  it('se déplacer plein nord augmente la latitude et laisse la longitude quasi inchangée', () => {
    const p = destinationPoint(45, 5, 0, 1000);
    expect(p.lat).toBeGreaterThan(45);
    expect(p.lon).toBeCloseTo(5, 3);
  });
});
