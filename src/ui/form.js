import {
  latInput,
  lonInput,
  peakPowerInputEl,
  tiltInput,
  azimuthInput,
  compareAzimuthCheckbox,
  azimuth2Input,
  peakPower1InputEl,
  peakPower2InputEl,
  lossesInput,
  sourceSelect,
  pvwattsKeyInput,
  optimizeWcResultEl,
  wcSplitHintEl,
  consumptionPowerInputEl,
} from '../dom.js';
import { state } from '../state.js';
import { parseDecimal } from '../core/parse.js';
import { getOppositeAzimuth } from '../core/azimuth.js';
import { fetchFromSource } from '../api/client.js';
import { buildHourlyProductionMap, evaluateSplitCandidate } from '../core/solar-data.js';
import { setStatus } from './status.js';

export function resetOptimizationResult() {
  state.optimizedSplitResult = null;
  if (optimizeWcResultEl) optimizeWcResultEl.textContent = '';
}

export function syncSplitInputsFromTotal(force = false) {
  if (!peakPowerInputEl || !peakPower1InputEl || !peakPower2InputEl) return;
  if (!compareAzimuthCheckbox.checked) return;
  if (
    !force &&
    (peakPower1InputEl.dataset.auto === 'false' || peakPower2InputEl.dataset.auto === 'false')
  )
    return;

  const totalWc = Math.max(0, Number(peakPowerInputEl.value) || 0);
  const wc1 = Math.max(1, Math.round(totalWc * 0.6));
  const wc2 = Math.max(1, Math.round(totalWc - wc1));

  state.syncingPowerFields = true;
  peakPower1InputEl.value = String(wc1);
  peakPower2InputEl.value = String(wc2);
  peakPower1InputEl.dataset.auto = 'true';
  peakPower2InputEl.dataset.auto = 'true';
  state.syncingPowerFields = false;
}

export function syncTotalInputFromSplit() {
  if (!peakPowerInputEl || !peakPower1InputEl || !peakPower2InputEl) return;
  if (!compareAzimuthCheckbox.checked) return;

  const wc1 = Math.max(0, Number(peakPower1InputEl.value) || 0);
  const wc2 = Math.max(0, Number(peakPower2InputEl.value) || 0);
  const total = Math.round(wc1 + wc2);

  state.syncingPowerFields = true;
  peakPowerInputEl.value = String(total);
  state.syncingPowerFields = false;

  if (wcSplitHintEl) {
    wcSplitHintEl.textContent = `Total réparti: ${total} Wc`;
  }
}

export function setAutoOppositeAzimuth(force = false) {
  if (!compareAzimuthCheckbox.checked && !force) return;
  if (!force && azimuth2Input.dataset.auto === 'false') return;
  const azimuthSouth = Number(azimuthInput.value);
  if (Number.isNaN(azimuthSouth)) return;
  azimuth2Input.value = String(getOppositeAzimuth(azimuthSouth));
  azimuth2Input.dataset.auto = 'true';
}

export function getInputs() {
  const lat = parseDecimal(latInput.value);
  const lon = parseDecimal(lonInput.value);
  const peakPowerInputW = Number(peakPowerInputEl.value);
  const peakPower = peakPowerInputW / 1000; // kWp pour l'API
  const tilt = Number(tiltInput.value);
  const azimuth = Number(azimuthInput.value);
  const compareAzimuth = compareAzimuthCheckbox.checked;
  const azimuth2 = Number(azimuth2Input.value);
  const peakPower1InputW = Number(peakPower1InputEl?.value ?? 0);
  const peakPower2InputW = Number(peakPower2InputEl?.value ?? 0);
  const losses = Number(lossesInput.value);
  const source = sourceSelect.value;
  const pvwattsKey = pvwattsKeyInput.value.trim();

  if ([lat, lon, peakPowerInputW, tilt, azimuth, losses].some((v) => Number.isNaN(v))) {
    setStatus('Merci de renseigner des valeurs numériques valides.', 'error');
    return null;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    setStatus('Latitude/longitude hors limites.', 'error');
    return null;
  }
  if (tilt < 0 || tilt > 90 || azimuth < -180 || azimuth > 180) {
    setStatus('Inclinaison ou azimut hors limites.', 'error');
    return null;
  }
  if (peakPowerInputW <= 0 || losses < 0 || losses > 100) {
    setStatus('Puissance/pertes invalides.', 'error');
    return null;
  }
  if (source === 'pvwatts' && !pvwattsKey) {
    setStatus('Merci de saisir une clé API PVWatts.', 'error');
    return null;
  }
  if (compareAzimuth && (Number.isNaN(azimuth2) || azimuth2 < -180 || azimuth2 > 180)) {
    setStatus('Azimut 2 hors limites.', 'error');
    return null;
  }

  let peakPower1 = peakPower;
  let peakPower2 = 0;
  if (compareAzimuth) {
    if ([peakPower1InputW, peakPower2InputW].some((v) => Number.isNaN(v) || v <= 0)) {
      setStatus('Merci de renseigner des Wc valides pour les 2 azimuts.', 'error');
      return null;
    }
    peakPower1 = peakPower1InputW / 1000;
    peakPower2 = peakPower2InputW / 1000;
  }

  return {
    lat,
    lon,
    peakPower,
    peakPower1,
    peakPower2,
    tilt,
    azimuth,
    compareAzimuth,
    azimuth2,
    losses,
    source,
    pvwattsKey,
  };
}

export async function optimizeWcSplit() {
  const params = getInputs();
  if (!params) return null;

  if (!params.compareAzimuth) {
    setStatus('Activez "Ajouter un 2e azimut" pour optimiser la répartition des Wc.', 'error');
    return null;
  }

  const consumptionPowerW = Number(consumptionPowerInputEl.value);
  if (!consumptionPowerW || consumptionPowerW <= 0) {
    setStatus(
      'Renseignez "Charge moyenne (W)" (> 0) pour optimiser couverture et autoconsommation.',
      'error'
    );
    return null;
  }

  const totalWc = Number(peakPowerInputEl.value);
  if (!totalWc || totalWc <= 0) {
    setStatus('Puissance crête invalide.', 'error');
    return null;
  }

  setStatus('Optimisation en cours (simulation de plusieurs répartitions)…');

  const baseParams = { ...params, peakPower: 1 };
  const primary = await fetchFromSource({ ...baseParams, azimuth: params.azimuth });
  const secondary = await fetchFromSource({ ...baseParams, azimuth: params.azimuth2 });

  const primaryMap = buildHourlyProductionMap(primary.hourlyEntries);
  const secondaryMap = buildHourlyProductionMap(secondary.hourlyEntries);
  const keys = [...new Set([...primaryMap.keys(), ...secondaryMap.keys()])];
  const hourlyConsumptionKwh = consumptionPowerW / 1000;

  let best = null;
  for (let i = 0; i <= 100; i += 2) {
    const splitPrimary = i / 100;
    const candidate = evaluateSplitCandidate(
      keys,
      primaryMap,
      secondaryMap,
      splitPrimary,
      totalWc / 1000,
      hourlyConsumptionKwh
    );

    if (!best || candidate.score > best.score) best = candidate;
  }

  if (!best) throw new Error('Impossible de calculer une répartition optimale.');

  return {
    az1: params.azimuth,
    az2: params.azimuth2,
    totalWc,
    wc1: totalWc * best.splitPrimary,
    wc2: totalWc * (1 - best.splitPrimary),
    splitPrimary: best.splitPrimary,
    selfConsumptionPct: best.selfConsumptionPct,
    coveragePct: best.coveragePct,
    score: best.score,
  };
}
