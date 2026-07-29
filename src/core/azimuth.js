// Convention SolarCurve : 0° = Sud, -90° = Est, +90° = Ouest, ±180° = Nord (voir readme.md).
// PVWatts attend un azimut "nord, sens horaire" (0° = Nord) — d'où les conversions ci-dessous.

export function azimuthSouthToAzimuthNorthClockwise(azimuthSouth) {
  const result = 180 - azimuthSouth;
  return ((result % 360) + 360) % 360;
}

export function azimuthNorthClockwiseToAzimuthSouth(bearing) {
  return normalizeAzimuthSouth(180 - bearing);
}

export function normalizeAzimuthSouth(value) {
  const n = ((((value + 180) % 360) + 360) % 360) - 180;
  return n === -180 ? 180 : n;
}

export function getOppositeAzimuth(azimuthSouth) {
  return normalizeAzimuthSouth(azimuthSouth + 180);
}
