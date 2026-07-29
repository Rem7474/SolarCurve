// Trigonométrie sphérique (grand cercle) pour la flèche d'azimut sur la carte.

export function bearingBetweenPoints(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLon = (lon2 - lon1) * r;
  const y = Math.sin(dLon) * Math.cos(lat2 * r);
  const x =
    Math.cos(lat1 * r) * Math.sin(lat2 * r) -
    Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function destinationPoint(lat, lon, bearingDeg, distanceMeters) {
  const R = 6371000;
  const r = Math.PI / 180;
  const br = bearingDeg * r;
  const latR = lat * r;
  const lonR = lon * r;
  const d = distanceMeters / R;
  const destLat = Math.asin(
    Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(br)
  );
  const destLon =
    lonR +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(latR),
      Math.cos(d) - Math.sin(latR) * Math.sin(destLat)
    );
  return { lat: destLat / r, lon: destLon / r };
}
