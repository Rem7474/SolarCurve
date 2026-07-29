import { fetchJSONFromAPI } from './http.js';
import { aggregateDailyData } from '../core/solar-data.js';

export function parsePVGISTime(time) {
  if (typeof time !== 'string') return null;
  const match = time.match(/^(\d{4})(\d{2})(\d{2}):?(\d{2})/);
  if (!match) return null;
  const [, yyyy, mm, dd, hh] = match;
  return { dayKey: `${yyyy}-${mm}-${dd}`, month: Number(mm), hour: Number(hh) };
}

export async function fetchFromPVGIS({ lat, lon, peakPower, tilt, azimuth, losses }) {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    peakpower: String(peakPower),
    angle: String(tilt),
    aspect: String(azimuth),
    loss: String(losses),
    outputformat: 'json',
    pvcalculation: '1',
    startyear: '2019',
    endyear: '2020',
  });

  const response = await fetchJSONFromAPI(`/api/pvgis?${params.toString()}`, 'PVGIS');
  const data = await response.json();
  const hourlyData = data?.outputs?.hourly;

  if (!Array.isArray(hourlyData) || hourlyData.length === 0) {
    throw new Error('PVGIS : pas de données horaires reçues.');
  }

  const hourlyEntries = [];
  let hasPowerColumn = false;

  for (const row of hourlyData) {
    const powerW = Number(row.P);
    if (row.P !== undefined) hasPowerColumn = true;
    if (Number.isNaN(powerW)) continue;

    const parsedTime = parsePVGISTime(row.time);
    if (!parsedTime) continue;

    hourlyEntries.push({
      dayKey: parsedTime.dayKey,
      month: parsedTime.month,
      hour: parsedTime.hour,
      kwh: powerW / 1000,
    });
  }

  if (!hasPowerColumn) {
    throw new Error(
      "PVGIS n'a pas renvoyé de puissance PV (champ P). Vérifie le proxy /api/pvgis et les paramètres."
    );
  }

  const dailyData = aggregateDailyData(hourlyEntries);
  return { hourlyEntries, dailyData };
}
