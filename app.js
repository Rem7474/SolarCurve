/* ============================================================
   SolarCurve — Application Logic
   ============================================================ */

// ─── DOM References ────────────────────────────────────────
const form = document.getElementById('pv-form');
const sourceSelect = document.getElementById('source');
const pvwattsKeyWrapper = document.getElementById('pvwatts-key-wrapper');
const geoBtn = document.getElementById('geo-btn');
const estimateBtn = document.getElementById('estimate-btn');
const statusEl = document.getElementById('status');
const statusTextEl = document.getElementById('statusText');
const statsEl = document.getElementById('stats');
const dailyProfileChartCanvas = document.getElementById('dailyProfileChart');
const monthlyProfileChartCanvas = document.getElementById('monthlyProfileChart');
const monthSelect = document.getElementById('monthSelect');
const prevDayBtn = document.getElementById('prevDay');
const nextDayBtn = document.getElementById('nextDay');
const daySlider = document.getElementById('daySlider');
const dayLabel = document.getElementById('dayLabel');
const latInput = document.getElementById('lat');
const lonInput = document.getElementById('lon');
const azimuthInput = document.getElementById('azimuth');
const compareAzimuthCheckbox = document.getElementById('compareAzimuth');
const azimuth2Wrapper = document.getElementById('azimuth2-wrapper');
const azimuth2Input = document.getElementById('azimuth2');
const mapHintEl = document.getElementById('mapHint');
const exportPdfBtn = document.getElementById('exportPdfBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarEl = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const peakShavingSection = document.getElementById('peakShavingSection');
const peakShavingStatsEl = document.getElementById('peakShavingStats');
const peakShavingChartCanvas = document.getElementById('peakShavingChart');

// ─── State ─────────────────────────────────────────────────
let dailyProfileChart;
let monthlyProfileChart;
let peakShavingChart;
let currentPrimaryHourlyEntries = [];
let currentPrimaryDailyData = [];
let currentSecondaryHourlyEntries = [];
let currentSecondaryDailyData = [];
let currentPrimaryAzimuth = null;
let currentSecondaryAzimuth = null;
let map;
let marker;
let azimuthShaft;
let azimuthHead;
let azimuthSecondaryShaft;
let azimuthSecondaryHead;
let azimuthHandle = null;
let azimuthSecondaryHandle = null;
let suppressMapClick = false;

// ─── Sidebar Toggle (mobile) ──────────────────────────────
if (sidebarToggle && sidebarEl) {
  sidebarToggle.addEventListener('click', () => {
    sidebarEl.classList.toggle('open');
    sidebarOverlay.classList.toggle('active');
  });
}
if (sidebarOverlay) {
  sidebarOverlay.addEventListener('click', () => {
    sidebarEl.classList.remove('open');
    sidebarOverlay.classList.remove('active');
  });
}

// ─── Event Listeners ───────────────────────────────────────
sourceSelect.addEventListener('change', () => {
  pvwattsKeyWrapper.classList.toggle('hidden', sourceSelect.value !== 'pvwatts');
});

compareAzimuthCheckbox.addEventListener('change', () => {
  const enabled = compareAzimuthCheckbox.checked;
  azimuth2Wrapper.classList.toggle('hidden', !enabled);
  azimuth2Input.disabled = !enabled;
  if (enabled) setAutoOppositeAzimuth(true);
  updateAzimuthArrowFromInputs();
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
});

azimuth2Input.addEventListener('input', () => {
  azimuth2Input.dataset.auto = 'false';
  updateAzimuthArrowFromInputs();
});

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
    exportPdfBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline; animation:spin 1s linear infinite; margin-right:6px;"><circle cx="12" cy="12" r="10"/><path d="M8 12a4 4 0 1 0 8 0"/></svg> Export…';
    try {
      await exportToPDF();
    } finally {
      exportPdfBtn.disabled = false;
      exportPdfBtn.innerHTML = originalHTML;
    }
  });
}

// ─── Form Submit ───────────────────────────────────────────
form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const params = getInputs();
  if (!params) return;

  // Close sidebar on mobile
  if (sidebarEl) sidebarEl.classList.remove('open');
  if (sidebarOverlay) sidebarOverlay.classList.remove('active');

  hideResults();
  toggleLoading(true);
  setStatus('Calcul en cours…');

  try {
    const primaryResult = await fetchFromSource(params);

    let secondaryResult = null;
    if (params.compareAzimuth) {
      secondaryResult = await fetchFromSource({ ...params, azimuth: params.azimuth2 });
    }

    const { dailyData, hourlyEntries } = primaryResult;

    if (!dailyData.length) throw new Error('Aucune donnée de production reçue.');
    if (secondaryResult && !secondaryResult.dailyData.length) {
      throw new Error('Aucune donnée de production reçue pour le 2e azimut.');
    }

    currentPrimaryHourlyEntries = hourlyEntries;
    currentPrimaryDailyData = dailyData;
    currentSecondaryHourlyEntries = secondaryResult?.hourlyEntries ?? [];
    currentSecondaryDailyData = secondaryResult?.dailyData ?? [];
    currentPrimaryAzimuth = params.azimuth;
    currentSecondaryAzimuth = params.compareAzimuth ? params.azimuth2 : null;

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

// ─── Input Parsing ─────────────────────────────────────────
function parseDecimal(val) {
  return Number(String(val).replace(',', '.'));
}

function getInputs() {
  const lat = parseDecimal(latInput.value);
  const lon = parseDecimal(lonInput.value);
  const peakPowerInputW = Number(document.getElementById('peakPower').value);
  const peakPower = peakPowerInputW / 1000; // kWp for API
  const tilt = Number(document.getElementById('tilt').value);
  const azimuth = Number(document.getElementById('azimuth').value);
  const compareAzimuth = compareAzimuthCheckbox.checked;
  const azimuth2 = Number(azimuth2Input.value);
  const losses = Number(document.getElementById('losses').value);
  const source = sourceSelect.value;
  const pvwattsKey = document.getElementById('pvwattsKey').value.trim();

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

  return { lat, lon, peakPower, tilt, azimuth, compareAzimuth, azimuth2, losses, source, pvwattsKey };
}

// ─── API Fetching ──────────────────────────────────────────
async function fetchFromSource(params) {
  if (params.source === 'pvwatts') return fetchFromPVWatts(params);
  return fetchFromPVGIS(params);
}

async function fetchFromPVGIS({ lat, lon, peakPower, tilt, azimuth, losses }) {
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

async function fetchFromPVWatts({ lat, lon, peakPower, tilt, azimuth, losses, pvwattsKey }) {
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
  // Distribute AC data across 2 years (2019 and 2020)
  // 2019 = 365 days, 2020 = 366 days (leap) = 17544 hours total
  const maxHours = Math.min(ac.length, 17544);
  const year2019Hours = 8760; // 365 * 24
  
  for (let i = 0; i < maxHours; i += 1) {
    const powerW = Number(ac[i]);
    if (Number.isNaN(powerW)) continue;
    
    // Map to 2019 or 2020
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

async function fetchJSONFromAPI(apiUrl, sourceName) {
  let response;
  try {
    response = await fetch(apiUrl);
  } catch {
    throw new Error(`${sourceName}: endpoint ${apiUrl} inaccessible.`);
  }
  if (!response.ok) {
    throw new Error(`${sourceName} indisponible via ${apiUrl} (${response.status}).`);
  }
  return response;
}

function parsePVGISTime(time) {
  if (typeof time !== 'string') return null;
  const match = time.match(/^(\d{4})(\d{2})(\d{2}):?(\d{2})/);
  if (!match) return null;
  const [, yyyy, mm, dd, hh] = match;
  return { dayKey: `${yyyy}-${mm}-${dd}`, month: Number(mm), hour: Number(hh) };
}

// ─── Data Processing ───────────────────────────────────────
function aggregateDailyData(hourlyEntries) {
  const byDay = new Map();
  for (const entry of hourlyEntries) {
    byDay.set(entry.dayKey, (byDay.get(entry.dayKey) ?? 0) + entry.kwh);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({ day, kwh: Number(value.toFixed(3)) }));
}

function buildMonthlyAverageProfile(hourlyEntries, month) {
  const sums = Array.from({ length: 24 }, () => 0);
  const days = new Set();
  for (const e of hourlyEntries) {
    if (e.month === month) {
      sums[e.hour] += e.kwh;
      days.add(e.dayKey);
    }
  }
  const count = Math.max(1, days.size);
  return sums.map((v) => Number((v / count).toFixed(3)));
}

function buildSpecificDayProfile(hourlyEntries, dayKey) {
  const profile = Array.from({ length: 24 }, () => 0);
  for (const entry of hourlyEntries) {
    if (entry.dayKey === dayKey) profile[entry.hour] += entry.kwh;
  }
  return profile.map((v) => Number(v.toFixed(3)));
}

function sumProfiles(profileA, profileB) {
  const size = Math.min(profileA.length, profileB.length);
  const output = [];
  for (let i = 0; i < size; i++) output.push(Number((profileA[i] + profileB[i]).toFixed(3)));
  return output;
}

function computeMonthlyTotalsFromDaily(dailyArray) {
  const months = Array.from({ length: 12 }, () => 0);
  const monthCounts = Array.from({ length: 12 }, () => 0);
  for (const row of dailyArray) {
    const parts = String(row.day).split('-');
    if (parts.length >= 2) {
      const month = Number(parts[1]);
      if (!Number.isNaN(month) && month >= 1 && month <= 12) {
        months[month - 1] += row.kwh;
        monthCounts[month - 1]++;
      }
    }
  }
  // If data spans multiple years (e.g., 2+ month entries per month), average them
  return months.map((total, idx) => {
    const count = monthCounts[idx];
    return count > 1 ? Number((total / 2).toFixed(3)) : Number(total.toFixed(3));
  });
}

// ─── Azimuth Conversion ────────────────────────────────────
function azimuthSouthToAzimuthNorthClockwise(azimuthSouth) {
  const result = 180 - azimuthSouth;
  return ((result % 360) + 360) % 360;
}

function azimuthNorthClockwiseToAzimuthSouth(bearing) {
  return normalizeAzimuthSouth(180 - bearing);
}

function normalizeAzimuthSouth(value) {
  const n = ((value + 180) % 360 + 360) % 360 - 180;
  return n === -180 ? 180 : n;
}

function getOppositeAzimuth(azimuthSouth) {
  return normalizeAzimuthSouth(azimuthSouth + 180);
}

function setAutoOppositeAzimuth(force = false) {
  if (!compareAzimuthCheckbox.checked && !force) return;
  if (!force && azimuth2Input.dataset.auto === 'false') return;
  const azimuthSouth = Number(azimuthInput.value);
  if (Number.isNaN(azimuthSouth)) return;
  azimuth2Input.value = String(getOppositeAzimuth(azimuthSouth));
  azimuth2Input.dataset.auto = 'true';
}

// ─── Chart Rendering ───────────────────────────────────────
const CHART_COLORS = {
  primary: '#ef4444',
  secondary: '#2563eb',
  sum: '#059669',
  sumFill: 'rgba(5,150,105,.08)',
  june: '#f59e0b',
  december: '#94a3b8',
};

function updateSelectedDayChart() {
  const selectedIndex = Number(daySlider.value) - 1;
  if (!currentPrimaryHourlyEntries.length || !currentPrimaryDailyData.length || Number.isNaN(selectedIndex)) return;

  const selectedDay = currentPrimaryDailyData[selectedIndex];
  if (!selectedDay) return;

  dayLabel.textContent = formatDayLabel(selectedDay.day);

  const selectedProfile = buildSpecificDayProfile(currentPrimaryHourlyEntries, selectedDay.day);
  const secondaryProfile = currentSecondaryHourlyEntries.length
    ? buildSpecificDayProfile(currentSecondaryHourlyEntries, selectedDay.day)
    : null;
  const juneLimit = buildSpecificDayProfile(currentPrimaryHourlyEntries, '2020-06-21');
  const decemberLimit = buildSpecificDayProfile(currentPrimaryHourlyEntries, '2020-12-21');
  const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}h`);
  const datasets = buildDailyDatasets(selectedProfile, secondaryProfile, juneLimit, decemberLimit);

  if (dailyProfileChart) {
    dailyProfileChart.data.labels = labels;
    dailyProfileChart.data.datasets = datasets;
    dailyProfileChart.update();
    return;
  }

  dailyProfileChart = new Chart(dailyProfileChartCanvas, {
    type: 'line',
    data: { labels, datasets },
    options: chartOptions('kWh / heure'),
  });
}

function buildDailyDatasets(selectedProfile, secondaryProfile, juneLimit, decemberLimit) {
  const datasets = [
    {
      label: `Azimut ${currentPrimaryAzimuth}° (${dayLabel.textContent})`,
      data: selectedProfile,
      borderWidth: 2.5,
      borderColor: CHART_COLORS.primary,
      backgroundColor: 'rgba(239,68,68,.06)',
      fill: true,
      tension: 0.3,
      pointRadius: 0,
    },
  ];

  if (secondaryProfile) {
    datasets.push(
      {
        label: `Azimut ${currentSecondaryAzimuth}° (${dayLabel.textContent})`,
        data: secondaryProfile,
        borderWidth: 2,
        borderColor: CHART_COLORS.secondary,
        borderDash: [10, 4],
        tension: 0.3,
        pointRadius: 0,
        fill: false,
      },
      {
        label: `Somme (${currentPrimaryAzimuth}° + ${currentSecondaryAzimuth}°)`,
        data: sumProfiles(selectedProfile, secondaryProfile),
        borderWidth: 2.5,
        borderColor: CHART_COLORS.sum,
        backgroundColor: CHART_COLORS.sumFill,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      }
    );
  } else {
    datasets.push(
      {
        label: 'Limite été (21 juin)',
        data: juneLimit,
        borderWidth: 1.5,
        borderColor: CHART_COLORS.june,
        borderDash: [8, 4],
        tension: 0.3,
        pointRadius: 0,
        fill: false,
      },
      {
        label: 'Limite hiver (21 déc.)',
        data: decemberLimit,
        borderWidth: 1.5,
        borderColor: CHART_COLORS.december,
        borderDash: [4, 4],
        tension: 0.3,
        pointRadius: 0,
        fill: false,
      }
    );
  }

  return datasets;
}

function updateMonthlyChart() {
  if (!monthlyProfileChartCanvas) return;
  const selectedMonth = Number(monthSelect?.value) || 6;

  const primaryMonthly = buildMonthlyAverageProfile(currentPrimaryHourlyEntries, selectedMonth);
  const secondaryMonthly = currentSecondaryHourlyEntries.length
    ? buildMonthlyAverageProfile(currentSecondaryHourlyEntries, selectedMonth)
    : null;

  const datasets = [
    {
      label: `Azimut ${currentPrimaryAzimuth}° (mois ${selectedMonth})`,
      data: primaryMonthly,
      borderWidth: 2.5,
      borderColor: CHART_COLORS.primary,
      backgroundColor: 'rgba(239,68,68,.06)',
      fill: true,
      tension: 0.3,
      pointRadius: 0,
    },
  ];

  if (secondaryMonthly) {
    datasets.push(
      {
        label: `Azimut ${currentSecondaryAzimuth}° (mois ${selectedMonth})`,
        data: secondaryMonthly,
        borderWidth: 2,
        borderColor: CHART_COLORS.secondary,
        borderDash: [10, 4],
        tension: 0.3,
        pointRadius: 0,
        fill: false,
      },
      {
        label: `Somme (${currentPrimaryAzimuth}° + ${currentSecondaryAzimuth}°)`,
        data: sumProfiles(primaryMonthly, secondaryMonthly),
        borderWidth: 2.5,
        borderColor: CHART_COLORS.sum,
        backgroundColor: CHART_COLORS.sumFill,
        fill: true,
        tension: 0.3,
        pointRadius: 0,
      }
    );
  }

  const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}h`);

  if (monthlyProfileChart) {
    monthlyProfileChart.data.labels = labels;
    monthlyProfileChart.data.datasets = datasets;
    monthlyProfileChart.update();
    return;
  }

  monthlyProfileChart = new Chart(monthlyProfileChartCanvas, {
    type: 'line',
    data: { labels, datasets },
    options: chartOptions('kWh / heure'),
  });
}

function chartOptions(yLabel) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        position: 'bottom',
        labels: { padding: 16, usePointStyle: true, pointStyleWidth: 12, font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: '#0f172a',
        titleFont: { size: 13 },
        bodyFont: { size: 12 },
        padding: 10,
        cornerRadius: 8,
        displayColors: true,
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: '#64748b' },
      },
      y: {
        title: { display: true, text: yLabel, font: { size: 12 }, color: '#64748b' },
        grid: { color: 'rgba(0,0,0,.05)' },
        ticks: { font: { size: 11 }, color: '#64748b' },
      },
    },
  };
}

// ─── Stats Rendering ───────────────────────────────────────
function renderStats(dailyData, secondaryDailyData = null) {
  if (secondaryDailyData?.length) {
    const mapByDay = new Map();
    for (const row of dailyData) mapByDay.set(row.day, (mapByDay.get(row.day) || 0) + row.kwh);
    for (const row of secondaryDailyData) mapByDay.set(row.day, (mapByDay.get(row.day) || 0) + row.kwh);

    const combined = [...mapByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, kwh]) => ({ day, kwh: Number(kwh.toFixed(3)) }));

    const totalCombined = combined.reduce((a, r) => a + r.kwh, 0);
    const avgCombined = totalCombined / combined.length;
    const sorted = [...combined].sort((a, b) => a.kwh - b.kwh);
    const minC = sorted[0];
    const maxC = sorted[sorted.length - 1];

    const totalPrimary = dailyData.reduce((a, r) => a + r.kwh, 0);
    const totalSecondary = secondaryDailyData.reduce((a, r) => a + r.kwh, 0);
    const total = totalPrimary + totalSecondary;
    const pct1 = total > 0 ? (totalPrimary / total) * 100 : 0;
    const pct2 = total > 0 ? (totalSecondary / total) * 100 : 0;

    statsEl.innerHTML = [
      statCard('Total annuel (2 azimuts)', `${totalCombined.toFixed(1)} kWh`),
      statCard('Moyenne / jour', `${avgCombined.toFixed(2)} kWh`),
      statCard('Jour le plus faible', `${minC.day} · ${minC.kwh.toFixed(2)} kWh`),
      statCard('Jour le plus productif', `${maxC.day} · ${maxC.kwh.toFixed(2)} kWh`),
      statCard(`Part azimut ${currentPrimaryAzimuth}°`, `${pct1.toFixed(1)} %`),
      statCard(`Part azimut ${currentSecondaryAzimuth}°`, `${pct2.toFixed(1)} %`),
    ].join('');
    return;
  }

  const total = dailyData.reduce((a, r) => a + r.kwh, 0);
  const avg = total / dailyData.length;
  const sorted = [...dailyData].sort((a, b) => a.kwh - b.kwh);

  statsEl.innerHTML = [
    statCard('Total annuel', `${total.toFixed(1)} kWh`),
    statCard('Moyenne / jour', `${avg.toFixed(2)} kWh`),
    statCard('Jour le plus faible', `${sorted[0].day} · ${sorted[0].kwh.toFixed(2)} kWh`),
    statCard('Jour le plus productif', `${sorted[sorted.length - 1].day} · ${sorted[sorted.length - 1].kwh.toFixed(2)} kWh`),
  ].join('');
}

function statCard(title, value) {
  return `<div class="stat-item"><strong>${title}</strong><span class="stat-value">${value}</span></div>`;
}

// ─── Peak Shaving / Demand Response ────────────────────────
function updatePeakShavingDisplay() {
  const consumptionPowerW = Number(document.getElementById('consumptionPower').value);
  if (!consumptionPowerW || consumptionPowerW <= 0) {
    peakShavingSection.classList.add('hidden');
    return;
  }

  const consumptionPowerKW = consumptionPowerW / 1000; // Convert W to kW
  peakShavingSection.classList.remove('hidden');

  // Combine hourly data from both azimuths if available
  const hourlyData = [...currentPrimaryHourlyEntries];
  if (currentSecondaryHourlyEntries.length) {
    const map = new Map();
    for (const e of hourlyData) {
      const key = `${e.dayKey}:${e.hour}`;
      map.set(key, (map.get(key) ?? 0) + e.kwh);
    }
    for (const e of currentSecondaryHourlyEntries) {
      const key = `${e.dayKey}:${e.hour}`;
      map.set(key, (map.get(key) ?? 0) + e.kwh);
    }
    // Rebuild hourly array from map
    hourlyData.length = 0;
    for (const [key, kwh] of map) {
      const [dayKey, hour] = key.split(':');
      const month = Number(dayKey.split('-')[1]);
      hourlyData.push({ dayKey, month, hour: Number(hour), kwh });
    }
  }

  // Calculate monthly peak shaving (production used to offset consumption) and surplus
  const shavingByMonth = Array.from({ length: 12 }, () => 0);
  const surplusByMonth = Array.from({ length: 12 }, () => 0);
  for (const e of hourlyData) {
    const hourlyConsumption = consumptionPowerKW; // kW
    const hourlyProduction = e.kwh; // already in kWh per hour, so equals kW for hourly rate
    const shaved = Math.min(hourlyProduction, hourlyConsumption);
    const surplus = Math.max(0, hourlyProduction - hourlyConsumption);
    shavingByMonth[e.month - 1] += shaved;
    surplusByMonth[e.month - 1] += surplus;
  }

  // Compute remaining consumption (not offset by production)
  const remainingByMonth = Array.from({ length: 12 }, () => 0);
  for (let m = 0; m < 12; m++) {
    const daysInMonth = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m];
    const totalConsumption = consumptionPowerKW * 24 * daysInMonth;
    remainingByMonth[m] = Math.max(0, totalConsumption - shavingByMonth[m]);
  }

  const totalShaved = shavingByMonth.reduce((a, b) => a + b, 0);
  const totalSurplus = surplusByMonth.reduce((a, b) => a + b, 0);
  const totalConsumption = consumptionPowerKW * 24 * 365.25;
  const totalProduction = totalShaved + totalSurplus; // Total production
  const shavingPct = totalConsumption > 0 ? (totalShaved / totalConsumption * 100) : 0;

  // Calculate monthly self-consumption rates
  const MONTHS_SHORT = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];
  const monthlyRatesHtml = MONTHS_SHORT.map((month, idx) => {
    const prodMonth = shavingByMonth[idx] + surplusByMonth[idx];
    const rateMonth = prodMonth > 0 ? (shavingByMonth[idx] / prodMonth * 100) : 0;
    return `<span style="display:inline-block; margin-right:12px; margin-bottom:6px; padding:4px 8px; background:#f0fdf4; border-radius:4px; font-size:11px;"><strong>${month}</strong> ${rateMonth.toFixed(1)}%</span>`;
  }).join('');

  peakShavingStatsEl.innerHTML = [
    statCard('Autoconsommé', `${totalShaved.toFixed(1)} kWh`),
    statCard('Taux d\'autoconsommation', `${shavingPct.toFixed(1)} %`),
    statCard('Surplus (non utilisé)', `${totalSurplus.toFixed(1)} kWh`),
    `<div style="margin-top:12px; padding-top:12px; border-top:1px solid #e2e8f0;"><p style="margin:0 0 8px 0; font-size:12px; color:#64748b;"><strong>Taux d'autoconsommation mensuel:</strong></p><div>${monthlyRatesHtml}</div></div>`,
  ].join('');

  // Render stacked bar chart for monthly peak shaving
  // Use setTimeout to ensure DOM is ready
  setTimeout(() => {
    renderPeakShavingChart(shavingByMonth, remainingByMonth);
  }, 100);
}

function renderPeakShavingChart(shavingByMonth, remainingByMonth) {
  if (!peakShavingChartCanvas) {
    console.warn('peakShavingChartCanvas not found');
    return;
  }

  if (peakShavingChart) {
    peakShavingChart.destroy();
  }

  const MONTHS_SHORT = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

  peakShavingChart = new Chart(peakShavingChartCanvas, {
    type: 'bar',
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        { label: 'Effacement', data: shavingByMonth, backgroundColor: '#059669', borderRadius: 0, borderWidth: 0 },
        { label: 'Consommation restante', data: remainingByMonth, backgroundColor: '#cbd5e1', borderRadius: 0, borderWidth: 0 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top', labels: { font: { size: 13 }, padding: 14 } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        x: { stacked: true, grid: { display: false }, ticks: { font: { size: 12 } } },
        y: { stacked: true, title: { display: true, text: 'kWh', font: { size: 12 } }, grid: { color: 'rgba(0,0,0,.06)' }, ticks: { font: { size: 11 } } },
      },
    },
  });
}
function setStatus(message, type = '') {
  if (statusTextEl) statusTextEl.textContent = message;
  statusEl.classList.remove('is-error', 'is-success');
  if (type === 'error') statusEl.classList.add('is-error');
  else if (type === 'success') statusEl.classList.add('is-success');
}

function toggleLoading(isLoading) {
  estimateBtn.disabled = isLoading;
  const span = estimateBtn.querySelector('span');
  if (span) span.textContent = isLoading ? 'Calcul…' : 'Estimer la production';
  if (loadingOverlay) loadingOverlay.classList.toggle('hidden', !isLoading);
}

function hideResults() {
  try {
    const resultsArea = document.getElementById('resultsArea');
    if (resultsArea) resultsArea.classList.add('hidden');
    if (statsEl) statsEl.classList.add('hidden');
    const exportArea = document.getElementById('exportArea');
    if (exportArea) exportArea.classList.add('hidden');
  } catch { /* ignore */ }
}

function showResults() {
  try {
    const resultsArea = document.getElementById('resultsArea');
    if (resultsArea) resultsArea.classList.remove('hidden');
    if (statsEl) statsEl.classList.remove('hidden');
    const exportArea = document.getElementById('exportArea');
    if (exportArea) exportArea.classList.remove('hidden');
  } catch { /* ignore */ }
}

function updateDayButtonsState() {
  if (!daySlider) return;
  const min = Number(daySlider.min || 1);
  const max = Number(daySlider.max || 1);
  const val = Number(daySlider.value || min);
  if (prevDayBtn) prevDayBtn.disabled = val <= min || daySlider.disabled;
  if (nextDayBtn) nextDayBtn.disabled = val >= max || daySlider.disabled;
}

function formatDayLabel(dayKey) {
  const [year, month, day] = dayKey.split('-').map(Number);
  if (!year || !month || !day) return dayKey;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

// ─── Map ───────────────────────────────────────────────────
function initMap() {
  if (typeof L === 'undefined') {
    if (mapHintEl) mapHintEl.textContent = 'Carte non disponible (Leaflet non chargé).';
    return;
  }

  const defaultLat = Number(latInput.value) || 46.5;
  const defaultLon = Number(lonInput.value) || 2.5;

  map = L.map('map').setView([defaultLat, defaultLon], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  map.on('click', (event) => {
    if (suppressMapClick) { suppressMapClick = false; return; }

    const { lat, lng } = event.latlng;
    const isCtrlClick = Boolean(event.originalEvent?.ctrlKey);

    if (isCtrlClick && marker) {
      const ml = marker.getLatLng();
      const bearing = bearingBetweenPoints(ml.lat, ml.lng, lat, lng);
      azimuthInput.value = String(azimuthNorthClockwiseToAzimuthSouth(bearing));
      setAutoOppositeAzimuth();
      updateAzimuthArrowFromInputs();
      if (mapHintEl) mapHintEl.textContent = `Azimut ajusté depuis la carte (${azimuthInput.value}°)`;
      return;
    }

    latInput.value = lat.toFixed(5);
    lonInput.value = lng.toFixed(5);
    placeOrMoveMarker(lat, lng);
    updateAzimuthArrowFromInputs();
    if (mapHintEl) mapHintEl.textContent = `Point sélectionné : ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  });

  if (!Number.isNaN(Number(latInput.value)) && !Number.isNaN(Number(lonInput.value))) {
    updateMapFromInputs();
  }
}

function placeOrMoveMarker(lat, lon) {
  if (!map) return;
  if (!marker) marker = L.marker([lat, lon]).addTo(map);
  else marker.setLatLng([lat, lon]);
}

function updateMapFromInputs(centerMap = false) {
  if (!map) return;
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return;

  placeOrMoveMarker(lat, lon);
  updateAzimuthArrowFromInputs();
  if (mapHintEl) mapHintEl.textContent = `Point sélectionné : ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  if (centerMap) map.setView([lat, lon], 10);
}

function updateAzimuthArrowFromInputs() {
  if (!map) return;
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  const azS = Number(azimuthInput.value);
  const azS2 = Number(azimuth2Input.value);
  const compareEnabled = compareAzimuthCheckbox.checked && !azimuth2Input.disabled;

  if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(azS)) { clearAzimuthArrow(); return; }

  const prim = updateArrowLayer(lat, lon, azS, CHART_COLORS.primary, azimuthShaft, azimuthHead, azimuthHandle);
  azimuthShaft = prim.shaft;
  azimuthHead = prim.head;
  azimuthHandle = prim.handle;

  if (compareEnabled && !Number.isNaN(azS2)) {
    const sec = updateArrowLayer(lat, lon, azS2, CHART_COLORS.secondary, azimuthSecondaryShaft, azimuthSecondaryHead, azimuthSecondaryHandle);
    azimuthSecondaryShaft = sec.shaft;
    azimuthSecondaryHead = sec.head;
    azimuthSecondaryHandle = sec.handle;
  } else {
    clearSecondaryAzimuthArrow();
  }
}

function clearAzimuthArrow() {
  [azimuthShaft, azimuthHead, azimuthHandle].forEach((l) => { if (l) map.removeLayer(l); });
  azimuthShaft = azimuthHead = azimuthHandle = null;
  clearSecondaryAzimuthArrow();
}

function clearSecondaryAzimuthArrow() {
  [azimuthSecondaryShaft, azimuthSecondaryHead, azimuthSecondaryHandle].forEach((l) => { if (l) map.removeLayer(l); });
  azimuthSecondaryShaft = azimuthSecondaryHead = azimuthSecondaryHandle = null;
}

function updateArrowLayer(lat, lon, azimuthSouth, color, shaftLayer, headLayer, handleMarker) {
  const bearing = azimuthSouthToAzimuthNorthClockwise(azimuthSouth);
  const scale = 0.6;
  const shaftDist = 150;
  const headDist = 55;
  const headAngle = 165;
  const tip = destinationPoint(lat, lon, bearing, shaftDist * scale);
  const leftHead = destinationPoint(tip.lat, tip.lon, bearing + headAngle, headDist * scale);
  const rightHead = destinationPoint(tip.lat, tip.lon, bearing - headAngle, headDist * scale);

  let handleCreated = false;
  if (!handleMarker) {
    const icon = L.divIcon({
      className: 'az-handle-icon',
      html: '<span class="az-handle-dot"></span>',
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    handleMarker = L.marker([tip.lat, tip.lon], { icon, interactive: true }).addTo(map);
    handleCreated = true;
  } else {
    handleMarker.setLatLng([tip.lat, tip.lon]);
  }

  const shaftLL = [[lat, lon], [tip.lat, tip.lon]];
  const headLL = [[leftHead.lat, leftHead.lon], [tip.lat, tip.lon], [rightHead.lat, rightHead.lon]];

  if (!shaftLayer) shaftLayer = L.polyline(shaftLL, { color, weight: 4.5, opacity: 0.92, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  else shaftLayer.setLatLngs(shaftLL);

  if (!headLayer) headLayer = L.polyline(headLL, { color, weight: 4.5, opacity: 0.92, lineCap: 'round', lineJoin: 'round' }).addTo(map);
  else headLayer.setLatLngs(headLL);

  if (handleCreated) {
    const el = handleMarker.getElement && handleMarker.getElement();
    if (el) {
      L.DomEvent.on(el, 'pointerdown', function (e) {
        if (!map) return;
        try { L.DomEvent.stopPropagation(e); L.DomEvent.preventDefault(e); } catch { /* ignore */ }
        suppressMapClick = true;
        try { map.dragging.disable(); map.doubleClickZoom?.disable(); map.boxZoom?.disable(); } catch { /* ignore */ }
        const markerLL = marker.getLatLng();

        function onPointerMove(ev) {
          try { L.DomEvent.stopPropagation(ev); L.DomEvent.preventDefault(ev); } catch { /* ignore */ }
          const ll = map.mouseEventToLatLng(ev);
          const b = bearingBetweenPoints(markerLL.lat, markerLL.lng, ll.lat, ll.lng);
          azimuthInput.value = String(azimuthNorthClockwiseToAzimuthSouth(b));
          setAutoOppositeAzimuth();
          updateAzimuthArrowFromInputs();
          handleMarker.setLatLng([ll.lat, ll.lng]);
          if (mapHintEl) mapHintEl.textContent = `Azimut en cours : ${azimuthInput.value}°`;
        }

        function onPointerUp(ev) {
          try { L.DomEvent.stopPropagation(ev); L.DomEvent.preventDefault(ev); } catch { /* ignore */ }
          setTimeout(() => { try { map.dragging.enable(); map.doubleClickZoom?.enable(); map.boxZoom?.enable(); } catch { /* ignore */ } }, 50);
          try { handleMarker.setLatLng([tip.lat, tip.lon]); updateAzimuthArrowFromInputs(); } catch { /* ignore */ }
          setTimeout(() => { suppressMapClick = false; }, 300);
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          if (mapHintEl) mapHintEl.textContent = `Azimut ajusté : ${azimuthInput.value}°`;
        }

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });
    }
  }

  return { shaft: shaftLayer, head: headLayer, handle: handleMarker };
}

// ─── Geo Utils ─────────────────────────────────────────────
function bearingBetweenPoints(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dLon = (lon2 - lon1) * r;
  const y = Math.sin(dLon) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function destinationPoint(lat, lon, bearingDeg, distanceMeters) {
  const R = 6371000;
  const r = Math.PI / 180;
  const br = bearingDeg * r;
  const latR = lat * r;
  const lonR = lon * r;
  const d = distanceMeters / R;
  const destLat = Math.asin(Math.sin(latR) * Math.cos(d) + Math.cos(latR) * Math.sin(d) * Math.cos(br));
  const destLon = lonR + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(latR), Math.cos(d) - Math.sin(latR) * Math.sin(destLat));
  return { lat: destLat / r, lon: destLon / r };
}

// ─── PDF Export (Professional Portrait Design) ────────────
async function exportToPDF() {
  try {
    const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
    const MONTHS_SHORT = ['Jan','Fév','Mar','Avr','Mai','Jun','Jul','Aoû','Sep','Oct','Nov','Déc'];

    const primaryMonthly = computeMonthlyTotalsFromDaily(currentPrimaryDailyData);
    const secondaryMonthly = currentSecondaryDailyData.length
      ? computeMonthlyTotalsFromDaily(currentSecondaryDailyData)
      : null;
    const hasSecondary = Boolean(secondaryMonthly);

    const totalPrimary = primaryMonthly.reduce((a, b) => a + b, 0);
    const totalSecondary = hasSecondary ? secondaryMonthly.reduce((a, b) => a + b, 0) : 0;
    const totalCombined = totalPrimary + totalSecondary;
    const peakWc = document.getElementById('peakPower').value;

    // ─── Render bar chart image ───
    const barCanvas = document.createElement('canvas');
    barCanvas.width = 1400;
    barCanvas.height = 700;
    barCanvas.style.display = 'none';
    document.body.appendChild(barCanvas);

    const barDatasets = [
      { label: `Azimut ${currentPrimaryAzimuth}°`, data: primaryMonthly, backgroundColor: '#f87171', borderColor: '#ef4444', borderWidth: 1, borderRadius: 4 },
    ];
    if (hasSecondary) {
      barDatasets.push(
        { label: `Azimut ${currentSecondaryAzimuth}°`, data: secondaryMonthly, backgroundColor: '#60a5fa', borderColor: '#2563eb', borderWidth: 1, borderRadius: 4 }
      );
    }

    const barChart = new Chart(barCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels: MONTHS_SHORT, datasets: barDatasets },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'top', labels: { font: { size: 14 }, padding: 14 } } },
        scales: {
          x: { stacked: hasSecondary, grid: { display: false }, ticks: { font: { size: 12 } } },
          y: { stacked: hasSecondary, title: { display: true, text: 'kWh', font: { size: 12 } }, grid: { color: 'rgba(0,0,0,.06)' }, ticks: { font: { size: 11 } } },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 350));
    const barImg = barCanvas.toDataURL('image/png', 1.0);
    barChart.destroy();
    document.body.removeChild(barCanvas);

    // ─── Render 12 hourly profile chart images (with sum curve and consumption) ───
    const chartImages = [];
    const consumptionPowerW = Number(document.getElementById('consumptionPower').value);
    const consumptionPowerKW = consumptionPowerW / 1000; // Convert W to kW
    const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

    for (let m = 1; m <= 12; m++) {
      const pm = buildMonthlyAverageProfile(currentPrimaryHourlyEntries, m);
      const sm = hasSecondary && currentSecondaryHourlyEntries.length
        ? buildMonthlyAverageProfile(currentSecondaryHourlyEntries, m)
        : null;

      // Calculate consumption line and self-consumption
      const consumptionLine = Array(24).fill(consumptionPowerKW);
      let totalSelfConsumption = 0;
      let totalSurplus = 0;
      
      if (consumptionPowerW > 0) {
        // Calculate self-consumption (min of production and consumption) for each hour
        for (let h = 0; h < 24; h++) {
          const totalProd = pm[h] + (sm ? sm[h] : 0);
          const selfConsumed = Math.min(totalProd, consumptionPowerKW);
          const surplus = Math.max(0, totalProd - consumptionPowerKW);
          totalSelfConsumption += selfConsumed;
          totalSurplus += surplus;
        }
      }
      
      // Self-consumption and surplus per day for this month (already from avg profile, no need to divide)
      const avgSelfConsumptionPerDay = consumptionPowerW > 0 ? totalSelfConsumption : 0;
      const avgSurplusPerDay = consumptionPowerW > 0 ? totalSurplus : 0;
      
      // Calculate self-consumption rate for this month
      const totalProdPerDay = avgSelfConsumptionPerDay + avgSurplusPerDay;
      const selfConsumptionRate = totalProdPerDay > 0 ? (avgSelfConsumptionPerDay / totalProdPerDay * 100) : 0;

      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 500;
      c.style.display = 'none';
      document.body.appendChild(c);

      const ds = [
        { label: `Az ${currentPrimaryAzimuth}°`, data: pm, borderColor: '#ef4444', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2 },
      ];
      if (sm) {
        ds.push(
          { label: `Az ${currentSecondaryAzimuth}°`, data: sm, borderColor: '#2563eb', borderDash: [6, 3], fill: false, tension: 0.3, pointRadius: 0, borderWidth: 1.8 },
          { label: 'Somme', data: sumProfiles(pm, sm), borderColor: '#059669', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2.2 }
        );
      }
      
      // Add consumption line if enabled
      if (consumptionPowerW > 0) {
        ds.push(
          { label: 'Talon conso', data: consumptionLine, borderColor: '#d97706', borderDash: [4, 4], fill: false, tension: 0, pointRadius: 0, borderWidth: 1.5 }
        );
      }

      const ch = new Chart(c.getContext('2d'), {
        type: 'line',
        data: { labels: Array.from({ length: 24 }, (_, h) => `${h}h`), datasets: ds },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          plugins: { legend: { display: true, position: 'bottom', labels: { font: { size: 10 }, padding: 8, usePointStyle: true } } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 9 } } },
            y: { title: { display: true, text: 'kWh', font: { size: 9 } }, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 9 } } },
          },
        },
      });

      await new Promise((r) => setTimeout(r, 200));
      chartImages.push({ 
        month: m, 
        src: c.toDataURL('image/png', 1.0),
        avgSelfConsumption: avgSelfConsumptionPerDay,
        avgSurplus: avgSurplusPerDay,
        selfConsumptionRate: selfConsumptionRate
      });
      ch.destroy();
      document.body.removeChild(c);
    }

    //// Capture Leaflet map using html2canvas
    let mapImg = null;
    if (map && document.getElementById('map')) {
      try {
        const canvas = await html2canvas(document.getElementById('map'), { scale: 2, useCORS: true, logging: false });
        mapImg = canvas.toDataURL('image/png', 0.95);
      } catch (err) { console.warn(err); mapImg = null; }
    }

        // ─────────────────── Page 1: Synthèse ───────────────────
    
    // --- Build PDF (A4 portrait) ---
    const jsPDFGlobal = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || (window.jspdf || null);
    if (!jsPDFGlobal) throw new Error('jsPDF introuvable.');
    const DocC = typeof jsPDFGlobal === 'function' ? jsPDFGlobal : jsPDFGlobal.jsPDF || jsPDFGlobal;
    const doc = new DocC({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 15;
    const contentW = W - M * 2;
    let y = 50;
    let pageNum = 0;

    pageNum++;
    // Header banner
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 36, 'F');
    doc.setFillColor(245, 158, 11);
    doc.rect(0, 36, W, 2.5, 'F');

    doc.setTextColor(245, 158, 11);
    doc.setFontSize(24);
    doc.text('SolarCurve', M, 17);
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text('Rapport de production photovoltaïque estimée', M, 26);
    doc.setFontSize(8);
    doc.setTextColor(200, 200, 200);
    doc.text(`${new Date().toLocaleDateString('fr-FR')} · ${new Date().toLocaleTimeString('fr-FR')}`, W - M, 26, { align: 'right' });

    y = 46;

    // ── Parameters Section (full width) ──
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Paramètres de l\'installation', M, y);
    y += 5;

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    const pCardH = hasSecondary ? 32 : 26;
    doc.roundedRect(M, y, contentW, pCardH, 3, 3, 'FD');

    doc.setFontSize(8.5);
    const pX = M + 5;
    const pCol2 = M + contentW / 2;
    const pY1 = y + 7;
    const pY2 = y + 15;
    const pY3 = y + 23;

    doc.setTextColor(100, 116, 139);
    doc.text('Position', pX, pY1);
    doc.text('Puissance crête', pCol2, pY1);
    doc.text('Inclinaison', pX, pY2);
    doc.text('Pertes', pCol2, pY2);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.text(`${latInput.value || '-'}, ${lonInput.value || '-'}`, pX + 28, pY1);
    doc.text(`${peakWc} Wc (${(Number(peakWc)/1000).toFixed(2)} kWc)`, pCol2 + 32, pY1);
    doc.text(`${document.getElementById('tilt').value}°`, pX + 28, pY2);
    doc.text(`${document.getElementById('losses').value} %`, pCol2 + 32, pY2);

    if (hasSecondary) {
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(8.5);
      doc.text('Azimut 1', pX, pY3);
      doc.text('Azimut 2', pCol2, pY3);
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(9);
      doc.text(`${currentPrimaryAzimuth}°`, pX + 28, pY3);
      doc.text(`${currentSecondaryAzimuth}°`, pCol2 + 32, pY3);
    } else {
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(8.5);
      doc.text('Azimut', pX, pY3 - 8);
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(9);
      doc.text(`${currentPrimaryAzimuth ?? azimuthInput.value}°`, pX + 28, pY3 - 8);
    }

    y += pCardH + 8;

    // ── Map Section (full width) ──
    if (mapImg) {
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text('Localisation', M, y);
      y += 5;
      
      const mapCardH = 90;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(M, y, contentW, mapCardH, 3, 3, 'FD');
      
      // Map image with padding
      const mapImgPad = 2;
      doc.addImage(mapImg, 'PNG', M + mapImgPad, y + mapImgPad, contentW - mapImgPad * 2, mapCardH - mapImgPad * 2);
      
      y += mapCardH + 8;
    }


    // ── Summary boxes ──
    const boxCount = hasSecondary ? 3 : 1;
    const boxGap = 5;
    const boxW = (contentW - boxGap * (boxCount - 1)) / boxCount;
    const boxH = 20;
    const boxItems = [
      { label: hasSecondary ? `TOTAL AZ. ${currentPrimaryAzimuth}°` : 'TOTAL ANNUEL', value: `${totalPrimary.toFixed(1)} kWh`, accent: [239, 68, 68] },
    ];
    if (hasSecondary) {
      boxItems.push(
        { label: `TOTAL AZ. ${currentSecondaryAzimuth}°`, value: `${totalSecondary.toFixed(1)} kWh`, accent: [37, 99, 235] },
        { label: 'TOTAL COMBINÉ', value: `${totalCombined.toFixed(1)} kWh`, accent: [5, 150, 105] }
      );
    }

    for (let i = 0; i < boxItems.length; i++) {
      const bx = M + i * (boxW + boxGap);
      const item = boxItems[i];
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(bx, y, boxW, boxH, 2, 2, 'FD');
      doc.setFillColor(item.accent[0], item.accent[1], item.accent[2]);
      doc.rect(bx, y, boxW, 2.5, 'F');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(item.label, bx + 4, y + 9);
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text(item.value, bx + 4, y + 17);
    }

    if (hasSecondary) {
      y += boxH + 3;
      const pct1 = totalCombined > 0 ? (totalPrimary / totalCombined * 100) : 0;
      const pct2 = totalCombined > 0 ? (totalSecondary / totalCombined * 100) : 0;
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Répartition : ${pct1.toFixed(1)}% (az. ${currentPrimaryAzimuth}°) / ${pct2.toFixed(1)}% (az. ${currentSecondaryAzimuth}°)`, M, y + 3);
      y += 8;
    } else {
      y += boxH + 6;
    }

    // ── Bar chart ──
    const chartImgW = contentW;
    let chartImgH = chartImgW * (700 / 1400);
    const maxChartH = H - y - 18;
    if (chartImgH > maxChartH) chartImgH = Math.max(50, maxChartH);
    doc.addImage(barImg, 'PNG', M, y, chartImgW, chartImgH);

    pdfFooter(doc, W, H, M, pageNum);

    // ─────────────────── Page 2: Tableau mensuel ───────────────────
    doc.addPage();
    pageNum++;
    pdfPageHeader(doc, W, M, 'Détail mensuel de la production');
    y = 44;

    // Compute column widths based on content type
    const colCount = hasSecondary ? 4 : 2;
    // Give "Mois" a fixed smaller width ; distribute rest equally
    const monthColW = 36;
    const dataColW = (contentW - monthColW) / (colCount - 1);
    const colWidths = [monthColW];
    for (let c = 1; c < colCount; c++) colWidths.push(dataColW);

    const headerH = 12;
    const rowH = 10;

    // Define header labels
    const tblHeaders = ['Mois', `Az. ${currentPrimaryAzimuth}° (kWh)`];
    if (hasSecondary) tblHeaders.push(`Az. ${currentSecondaryAzimuth}° (kWh)`, 'Total (kWh)');

    // Draw table header
    let xCursor = M;
    for (let c = 0; c < colCount; c++) {
      const cw = colWidths[c];
      // Header fill
      doc.setFillColor(15, 23, 42);
      doc.rect(xCursor, y, cw, headerH, 'F');
      // Header text — always white
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      if (c === 0) {
        doc.text(tblHeaders[c], xCursor + 4, y + 8);
      } else {
        // Right-align data headers
        doc.text(tblHeaders[c], xCursor + cw - 4, y + 8, { align: 'right' });
      }
      xCursor += cw;
    }
    y += headerH;

    // Draw data rows
    let tRowPrim = 0;
    let tRowSec = 0;

    for (let i = 0; i < 12; i++) {
      const stripe = i % 2 === 0;
      const a1 = primaryMonthly[i] || 0;
      const a2 = hasSecondary ? (secondaryMonthly[i] || 0) : 0;
      tRowPrim += a1;
      tRowSec += a2;

      xCursor = M;
      for (let c = 0; c < colCount; c++) {
        const cw = colWidths[c];
        doc.setFillColor(stripe ? 248 : 255, stripe ? 250 : 255, stripe ? 252 : 255);
        doc.setDrawColor(226, 232, 240);
        doc.rect(xCursor, y, cw, rowH, 'FD');
        xCursor += cw;
      }

      xCursor = M;
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(9);
      doc.text(MONTHS[i], xCursor + 4, y + 7);
      xCursor += colWidths[0];
      doc.text(a1.toFixed(1), xCursor + colWidths[1] - 6, y + 7, { align: 'right' });
      if (hasSecondary) {
        xCursor += colWidths[1];
        doc.text(a2.toFixed(1), xCursor + colWidths[2] - 6, y + 7, { align: 'right' });
        xCursor += colWidths[2];
        doc.text((a1 + a2).toFixed(1), xCursor + colWidths[3] - 6, y + 7, { align: 'right' });
      }
      y += rowH;
    }

    // Total row
    xCursor = M;
    for (let c = 0; c < colCount; c++) {
      const cw = colWidths[c];
      doc.setFillColor(245, 158, 11);
      doc.rect(xCursor, y, cw, headerH, 'F');
      xCursor += cw;
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    xCursor = M;
    doc.text('TOTAL', xCursor + 4, y + 8);
    xCursor += colWidths[0];
    doc.text(tRowPrim.toFixed(1), xCursor + colWidths[1] - 6, y + 8, { align: 'right' });
    if (hasSecondary) {
      xCursor += colWidths[1];
      doc.text(tRowSec.toFixed(1), xCursor + colWidths[2] - 6, y + 8, { align: 'right' });
      xCursor += colWidths[2];
      doc.text((tRowPrim + tRowSec).toFixed(1), xCursor + colWidths[3] - 6, y + 8, { align: 'right' });
    }

    // Ratio bar (visual) if secondary
    if (hasSecondary) {
      y += headerH + 12;
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      doc.text('Répartition de la production', M, y);
      y += 4;
      const barH = 8;
      const pct1 = totalCombined > 0 ? totalPrimary / totalCombined : 0.5;
      // Primary portion
      doc.setFillColor(239, 68, 68);
      doc.roundedRect(M, y, contentW * pct1, barH, 2, 2, 'F');
      // Secondary portion
      doc.setFillColor(37, 99, 235);
      doc.roundedRect(M + contentW * pct1, y, contentW * (1 - pct1), barH, 2, 2, 'F');
      // Labels
      y += barH + 5;
      doc.setFontSize(8);
      doc.setTextColor(239, 68, 68);
      doc.text(`Az. ${currentPrimaryAzimuth}° : ${(pct1 * 100).toFixed(1)}%`, M, y);
      doc.setTextColor(37, 99, 235);
      doc.text(`Az. ${currentSecondaryAzimuth}° : ${((1 - pct1) * 100).toFixed(1)}%`, W - M, y, { align: 'right' });
    }

    pdfFooter(doc, W, H, M, pageNum);

    // ─────────────────── Pages 3-4: Profils horaires (6 par page) ───────────────────
    const chartsPerPage = 6;
    const gridCols = 2;
    const gridRows = 3;
    const gridGap = 6;

    for (let page = 0; page < 2; page++) {
      doc.addPage();
      pageNum++;
      const pageTitle = page === 0
        ? 'Profils horaires moyens (Jan – Jun)'
        : 'Profils horaires moyens (Jul – Déc)';
      pdfPageHeader(doc, W, M, pageTitle);

      const topY = 44;
      const gridAvailW = contentW;
      const gridAvailH = H - topY - 18;
      const cellW = (gridAvailW - gridGap * (gridCols - 1)) / gridCols;
      const cellH = (gridAvailH - gridGap * (gridRows - 1)) / gridRows;

      for (let idx = 0; idx < chartsPerPage; idx++) {
        const globalIdx = page * chartsPerPage + idx;
        if (globalIdx >= chartImages.length) break;

        const col = idx % gridCols;
        const row = Math.floor(idx / gridCols);
        const cx = M + col * (cellW + gridGap);
        const cy = topY + row * (cellH + gridGap);

        // Cell background
        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(cx, cy, cellW, cellH, 2, 2, 'FD');

        // Month title
        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        doc.text(MONTHS[chartImages[globalIdx].month - 1], cx + 4, cy + 6);

        // Chart image
        const imgPad = 2;
        const titleH = 8;
        const imgH = cellH - titleH - 16;
        doc.addImage(chartImages[globalIdx].src, 'PNG', cx + imgPad, cy + titleH, cellW - imgPad * 2, imgH);

        // Self-consumption and surplus stats below chart
        if (chartImages[globalIdx].avgSelfConsumption > 0 || chartImages[globalIdx].avgSurplus > 0) {
          const statsY = cy + cellH - 13;
          doc.setFontSize(6.5);
          doc.setTextColor(100, 116, 139);
          const rate = chartImages[globalIdx].selfConsumptionRate;
          doc.text(`Autoconso. : ${chartImages[globalIdx].avgSelfConsumption.toFixed(2)} kWh/j (${rate.toFixed(1)}%) | Surplus : ${chartImages[globalIdx].avgSurplus.toFixed(2)} kWh/j`, cx + 4, statsY);
        }
      }

      pdfFooter(doc, W, H, M, pageNum);
    }

    // Save
    doc.save(`SolarCurve_rapport_${new Date().toISOString().slice(0, 10)}.pdf`);

  } catch (err) {
    console.error('Export PDF failed', err);
    alert('Erreur lors de la génération du PDF. Consultez la console.');
  }
}

function pdfPageHeader(doc, W, M, title) {
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 30, 'F');
  doc.setFillColor(245, 158, 11);
  doc.rect(0, 30, W, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(title, M, 19);
}

function pdfFooter(doc, W, H, M, pageNum) {
  // Separator line
  doc.setDrawColor(226, 232, 240);
  doc.line(M, H - 12, W - M, H - 12);
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text('SolarCurve — Données fournies à titre indicatif', M, H - 7);
  doc.text(`Page ${pageNum}`, W - M, H - 7, { align: 'right' });
}

// ─── Init ──────────────────────────────────────────────────
azimuth2Input.dataset.auto = 'true';
setAutoOppositeAzimuth(true);
initMap();
