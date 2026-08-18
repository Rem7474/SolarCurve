import 'leaflet/dist/leaflet.css';

import {
  form,
  sourceSelect,
  pvwattsKeyWrapper,
  geoBtn,
  daySlider,
  monthSelect,
  prevDayBtn,
  nextDayBtn,
  latInput,
  lonInput,
  azimuthInput,
  compareAzimuthCheckbox,
  azimuth2Wrapper,
  azimuth2Input,
  exportPdfBtn,
  optimizeWcBtn,
  optimizeWcResultEl,
  peakPowerInputEl,
  consumptionPowerInputEl,
  wcSplitWrapper,
  peakPower1InputEl,
  peakPower2InputEl,
  wcSplitHintEl,
} from './dom.js';
import { state } from './state.js';
import { fetchFromSource } from './api/client.js';
import {
  getInputs,
  optimizeWcSplit,
  resetOptimizationResult,
  syncSplitInputsFromTotal,
  syncTotalInputFromSplit,
  setAutoOppositeAzimuth,
} from './ui/form.js';
import { setStatus, toggleLoading, hideResults, showResults } from './ui/status.js';
import { initSidebarToggle, closeSidebar } from './ui/sidebar.js';
import { updateSelectedDayChart, updateMonthlyChart, updateDayButtonsState } from './ui/charts.js';
import { renderStats } from './ui/stats.js';
import { updatePeakShavingDisplay } from './ui/peak-shaving.js';
import { initMap, updateMapFromInputs, updateAzimuthArrowFromInputs } from './ui/map.js';
import { exportToPDF } from './ui/pdf-export.js';

// ─── Sidebar (mobile) ──────────────────────────────────────
initSidebarToggle();

// ─── Event Listeners ───────────────────────────────────────
sourceSelect.addEventListener('change', () => {
  pvwattsKeyWrapper.classList.toggle('hidden', sourceSelect.value !== 'pvwatts');
});

compareAzimuthCheckbox.addEventListener('change', () => {
  const enabled = compareAzimuthCheckbox.checked;
  azimuth2Wrapper.classList.toggle('hidden', !enabled);
  azimuth2Input.disabled = !enabled;
  if (wcSplitWrapper) wcSplitWrapper.classList.toggle('hidden', !enabled);
  if (peakPower1InputEl) peakPower1InputEl.disabled = !enabled;
  if (peakPower2InputEl) peakPower2InputEl.disabled = !enabled;
  if (enabled) setAutoOppositeAzimuth(true);
  if (enabled) syncSplitInputsFromTotal(true);
  updateAzimuthArrowFromInputs();
  resetOptimizationResult();
});

daySlider.addEventListener('input', () => {
  updateSelectedDayChart();
  updateDayButtonsState();
});

if (monthSelect) {
  monthSelect.addEventListener('change', () => updateMonthlyChart());
}

latInput.addEventListener('change', () => updateMapFromInputs());
lonInput.addEventListener('change', () => updateMapFromInputs());

azimuthInput.addEventListener('input', () => {
  setAutoOppositeAzimuth();
  updateAzimuthArrowFromInputs();
  resetOptimizationResult();
});

azimuth2Input.addEventListener('input', () => {
  azimuth2Input.dataset.auto = 'false';
  updateAzimuthArrowFromInputs();
  resetOptimizationResult();
});

if (peakPowerInputEl) {
  peakPowerInputEl.addEventListener('input', () => {
    if (!state.syncingPowerFields) syncSplitInputsFromTotal();
    resetOptimizationResult();
  });
}

if (consumptionPowerInputEl) {
  consumptionPowerInputEl.addEventListener('input', () => resetOptimizationResult());
}

if (peakPower1InputEl) {
  peakPower1InputEl.addEventListener('input', () => {
    if (!state.syncingPowerFields) {
      peakPower1InputEl.dataset.auto = 'false';
      syncTotalInputFromSplit();
    }
    resetOptimizationResult();
  });
}

if (peakPower2InputEl) {
  peakPower2InputEl.addEventListener('input', () => {
    if (!state.syncingPowerFields) {
      peakPower2InputEl.dataset.auto = 'false';
      syncTotalInputFromSplit();
    }
    resetOptimizationResult();
  });
}

geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Géolocalisation non supportée par ce navigateur.', 'error');
    return;
  }
  setStatus('Récupération de votre position GPS…');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      latInput.value = position.coords.latitude.toFixed(5);
      lonInput.value = position.coords.longitude.toFixed(5);
      updateMapFromInputs(true);
      setStatus('Position GPS récupérée.', 'success');
    },
    (error) => {
      setStatus(`Impossible de récupérer la position (${error.message}).`, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

if (prevDayBtn) {
  prevDayBtn.addEventListener('click', () => {
    if (!daySlider || daySlider.disabled) return;
    let v = Number(daySlider.value || 1);
    if (v > Number(daySlider.min || 1)) v -= 1;
    daySlider.value = String(v);
    updateSelectedDayChart();
    updateDayButtonsState();
  });
}

if (nextDayBtn) {
  nextDayBtn.addEventListener('click', () => {
    if (!daySlider || daySlider.disabled) return;
    let v = Number(daySlider.value || 1);
    if (v < Number(daySlider.max || 1)) v += 1;
    daySlider.value = String(v);
    updateSelectedDayChart();
    updateDayButtonsState();
  });
}

if (exportPdfBtn) {
  exportPdfBtn.addEventListener('click', async () => {
    exportPdfBtn.disabled = true;
    const originalHTML = exportPdfBtn.innerHTML;
    exportPdfBtn.innerHTML =
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline; animation:spin 1s linear infinite; margin-right:6px;"><circle cx="12" cy="12" r="10"/><path d="M8 12a4 4 0 1 0 8 0"/></svg> Export…';
    try {
      await exportToPDF();
    } finally {
      exportPdfBtn.disabled = false;
      exportPdfBtn.innerHTML = originalHTML;
    }
  });
}

if (optimizeWcBtn) {
  optimizeWcBtn.addEventListener('click', async () => {
    const originalLabel = optimizeWcBtn.textContent;
    optimizeWcBtn.disabled = true;
    optimizeWcBtn.textContent = 'Optimisation…';

    try {
      const result = await optimizeWcSplit();
      if (!result) return;

      state.optimizedSplitResult = result;
      if (peakPower1InputEl && peakPower2InputEl && peakPowerInputEl) {
        state.syncingPowerFields = true;
        peakPower1InputEl.value = String(Math.round(result.wc1));
        peakPower2InputEl.value = String(Math.round(result.wc2));
        peakPowerInputEl.value = String(Math.round(result.wc1 + result.wc2));
        peakPower1InputEl.dataset.auto = 'false';
        peakPower2InputEl.dataset.auto = 'false';
        state.syncingPowerFields = false;
        if (wcSplitHintEl)
          wcSplitHintEl.textContent = `Total réparti: ${Math.round(result.wc1 + result.wc2)} Wc`;
      }
      if (optimizeWcResultEl) {
        optimizeWcResultEl.textContent =
          `Recommandé (${Math.round(result.totalWc)} Wc total) : ` +
          `${Math.round(result.wc1)} Wc à ${result.az1}° et ${Math.round(result.wc2)} Wc à ${result.az2}° ` +
          `· Couverture ${result.coveragePct.toFixed(1)}% · Autoconso ${result.selfConsumptionPct.toFixed(1)}%`;
      }

      setStatus('Répartition Wc optimisée et appliquée aux champs.', 'success');
    } catch (error) {
      console.error(error);
      setStatus(`Erreur optimisation : ${error.message}`, 'error');
    } finally {
      optimizeWcBtn.disabled = false;
      optimizeWcBtn.textContent = originalLabel;
    }
  });
}

// ─── Form Submit ───────────────────────────────────────────
form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const params = getInputs();
  if (!params) return;

  closeSidebar();

  hideResults();
  toggleLoading(true);
  setStatus('Calcul en cours…');

  try {
    const primaryResult = await fetchFromSource({
      ...params,
      peakPower: params.compareAzimuth ? params.peakPower1 : params.peakPower,
    });

    let secondaryResult = null;
    if (params.compareAzimuth) {
      secondaryResult = await fetchFromSource({
        ...params,
        azimuth: params.azimuth2,
        peakPower: params.peakPower2,
      });
    }

    const { dailyData, hourlyEntries } = primaryResult;

    if (!dailyData.length) throw new Error('Aucune donnée de production reçue.');
    if (secondaryResult && !secondaryResult.dailyData.length) {
      throw new Error('Aucune donnée de production reçue pour le 2e azimut.');
    }

    state.primaryHourlyEntries = hourlyEntries;
    state.primaryDailyData = dailyData;
    state.secondaryHourlyEntries = secondaryResult?.hourlyEntries ?? [];
    state.secondaryDailyData = secondaryResult?.dailyData ?? [];
    state.primaryAzimuth = params.azimuth;
    state.secondaryAzimuth = params.compareAzimuth ? params.azimuth2 : null;

    renderStats(dailyData, secondaryResult?.dailyData ?? null);
    daySlider.disabled = false;
    daySlider.min = '1';
    daySlider.max = String(
      params.compareAzimuth
        ? Math.min(dailyData.length, secondaryResult.dailyData.length)
        : dailyData.length
    );
    daySlider.value = '1';
    updateSelectedDayChart();
    updateMonthlyChart();
    updatePeakShavingDisplay();
    updateDayButtonsState();
    showResults();
    setStatus(`Estimation terminée (${params.source.toUpperCase()}).`, 'success');
  } catch (error) {
    console.error(error);
    setStatus(`Erreur : ${error.message}`, 'error');
  } finally {
    toggleLoading(false);
  }
});

// ─── Init ──────────────────────────────────────────────────
azimuth2Input.dataset.auto = 'true';
if (peakPower1InputEl) peakPower1InputEl.dataset.auto = 'true';
if (peakPower2InputEl) peakPower2InputEl.dataset.auto = 'true';
setAutoOppositeAzimuth(true);
syncSplitInputsFromTotal(true);
syncTotalInputFromSplit();
initMap();
