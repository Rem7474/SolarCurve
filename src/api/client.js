import { fetchFromPVGIS } from './pvgis.js';
import { fetchFromPVWatts } from './pvwatts.js';

export async function fetchFromSource(params) {
  if (params.source === 'pvwatts') return fetchFromPVWatts(params);
  return fetchFromPVGIS(params);
}
