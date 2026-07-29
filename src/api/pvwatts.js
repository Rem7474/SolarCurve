import { fetchJSONFromAPI } from './http.js';
import { azimuthSouthToAzimuthNorthClockwise } from '../core/azimuth.js';
import { aggregateDailyData } from '../core/solar-data.js';

export async function fetchFromPVWatts({ lat, lon, peakPower, tilt, azimuth, losses, pvwattsKey }) {
  const normalizedAzimuth = azimuthSouthToAzimuthNorthClockwise(azimuth);
  const params = new URLSearchParams({
    api_key: pvwattsKey,
    lat: String(lat),
    lon: String(lon),
    system_capacity: String(peakPower),
    module_type: '0',
    losses: String(losses),
    array_type: '0',
    tilt: String(tilt),
    azimuth: String(normalizedAzimuth),
    timeframe: 'hourly',
  });

  const response = await fetchJSONFromAPI(`/api/pvwatts?${params.toString()}`, 'PVWatts');
  const data = await response.json();
  const errors = data?.errors;
  if (Array.isArray(errors) && errors.length > 0) throw new Error(`PVWatts: ${errors.join(', ')}`);

  const ac = data?.outputs?.ac;
  if (!Array.isArray(ac) || ac.length === 0) throw new Error('Réponse PVWatts invalide.');

  const hourlyEntries = [];
  // Distribution des données AC sur 2 années (2019 et 2020)
  // 2019 = 365 jours, 2020 = 366 jours (bissextile) = 17544 heures au total
  const maxHours = Math.min(ac.length, 17544);
  const year2019Hours = 8760; // 365 * 24

  for (let i = 0; i < maxHours; i += 1) {
    const powerW = Number(ac[i]);
    if (Number.isNaN(powerW)) continue;

    // Répartition sur 2019 ou 2020
    const year = i < year2019Hours ? 2019 : 2020;
    const hourInYear = i % year2019Hours;
    const date = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    date.setUTCHours(hourInYear);
    hourlyEntries.push({
      dayKey: date.toISOString().slice(0, 10),
      month: date.getUTCMonth() + 1,
      hour: date.getUTCHours(),
      kwh: powerW / 1000,
    });
  }

  const dailyData = aggregateDailyData(hourlyEntries);
  return { hourlyEntries, dailyData };
}
