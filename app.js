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

// ─── State ─────────────────────────────────────────────────
let dailyProfileChart;
let monthlyProfileChart;
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
  exportPdfBtn.addEventListener('click', () => exportToPDF());
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

  return { hourlyEntries, dailyData: aggregateDailyData(hourlyEntries) };
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

  const year = 2020;
  const hourlyEntries = [];
  for (let i = 0; i < ac.length; i += 1) {
    const powerW = Number(ac[i]);
    if (Number.isNaN(powerW)) continue;
    const date = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    date.setUTCHours(i);
    hourlyEntries.push({
      dayKey: date.toISOString().slice(0, 10),
      month: date.getUTCMonth() + 1,
      hour: date.getUTCHours(),
      kwh: powerW / 1000,
    });
  }

  return { hourlyEntries, dailyData: aggregateDailyData(hourlyEntries) };
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
  for (const row of dailyArray) {
    const parts = String(row.day).split('-');
    if (parts.length >= 2) {
      const month = Number(parts[1]);
      if (!Number.isNaN(month) && month >= 1 && month <= 12) months[month - 1] += row.kwh;
    }
  }
  return months.map((v) => Number(v.toFixed(3)));
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

// ─── UI Helpers ────────────────────────────────────────────
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
  const scale = 0.5;
  const tip = destinationPoint(lat, lon, bearing, 220 * scale);
  const leftHead = destinationPoint(tip.lat, tip.lon, bearing + 150, 70 * scale);
  const rightHead = destinationPoint(tip.lat, tip.lon, bearing - 150, 70 * scale);

  let handleCreated = false;
  if (!handleMarker) {
    const icon = L.divIcon({
      className: 'az-handle-icon',
      html: '<span class="az-handle-dot"></span>',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    handleMarker = L.marker([tip.lat, tip.lon], { icon, interactive: true }).addTo(map);
    handleCreated = true;
  } else {
    handleMarker.setLatLng([tip.lat, tip.lon]);
  }

  const shaftLL = [[lat, lon], [tip.lat, tip.lon]];
  const headLL = [[leftHead.lat, leftHead.lon], [tip.lat, tip.lon], [rightHead.lat, rightHead.lon]];

  if (!shaftLayer) shaftLayer = L.polyline(shaftLL, { color, weight: 3, opacity: .95 }).addTo(map);
  else shaftLayer.setLatLngs(shaftLL);

  if (!headLayer) headLayer = L.polyline(headLL, { color, weight: 3, opacity: .95 }).addTo(map);
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

// ─── PDF Export (Professional Design) ──────────────────────
async function exportToPDF() {
  try {
    const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

    const primaryMonthly = computeMonthlyTotalsFromDaily(currentPrimaryDailyData);
    const secondaryMonthly = currentSecondaryDailyData.length
      ? computeMonthlyTotalsFromDaily(currentSecondaryDailyData)
      : null;
    const hasSecondary = Boolean(secondaryMonthly);

    // ─── Render bar chart to image ───
    const barCanvas = document.createElement('canvas');
    barCanvas.width = 1600;
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
      data: { labels: MONTHS, datasets: barDatasets },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', labels: { font: { size: 14 }, padding: 16 } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 13 } } },
          y: { title: { display: true, text: 'kWh', font: { size: 13 } }, grid: { color: 'rgba(0,0,0,.06)' }, ticks: { font: { size: 12 } } },
        },
      },
    });

    await new Promise((r) => setTimeout(r, 350));
    const barImg = barCanvas.toDataURL('image/png', 1.0);
    barChart.destroy();
    document.body.removeChild(barCanvas);

    // ─── Render hourly profile charts ───
    const chartImages = [];
    for (let m = 1; m <= 12; m++) {
      const pm = buildMonthlyAverageProfile(currentPrimaryHourlyEntries, m);
      const sm = hasSecondary && currentSecondaryHourlyEntries.length
        ? buildMonthlyAverageProfile(currentSecondaryHourlyEntries, m)
        : null;

      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 600;
      c.style.display = 'none';
      document.body.appendChild(c);

      const ds = [
        { label: `Az ${currentPrimaryAzimuth}°`, data: pm, borderColor: '#ef4444', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2 },
      ];
      if (sm) {
        ds.push({ label: `Az ${currentSecondaryAzimuth}°`, data: sm, borderColor: '#2563eb', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2 });
      }

      const ch = new Chart(c.getContext('2d'), {
        type: 'line',
        data: { labels: Array.from({ length: 24 }, (_, h) => `${h}h`), datasets: ds },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 11 } } },
            y: { title: { display: true, text: 'kWh', font: { size: 11 } }, grid: { color: 'rgba(0,0,0,.04)' }, ticks: { font: { size: 10 } } },
          },
        },
      });

      await new Promise((r) => setTimeout(r, 200));
      chartImages.push({ month: m, src: c.toDataURL('image/png', 1.0) });
      ch.destroy();
      document.body.removeChild(c);
    }

    // ─── Build PDF ───
    const jsPDFGlobal = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || (window.jspdf || null);
    if (!jsPDFGlobal) throw new Error('jsPDF introuvable.');
    const DocC = typeof jsPDFGlobal === 'function' ? jsPDFGlobal : jsPDFGlobal.jsPDF || jsPDFGlobal;
    const doc = new DocC({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 14;
    let y;

    const totalPrimary = primaryMonthly.reduce((a, b) => a + b, 0);
    const totalSecondary = hasSecondary ? secondaryMonthly.reduce((a, b) => a + b, 0) : 0;
    const totalCombined = totalPrimary + totalSecondary;

    // ─────── Page 1: Overview ───────
    // Header gradient
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 32, 'F');
    // Amber accent line
    doc.setFillColor(245, 158, 11);
    doc.rect(0, 32, W, 2, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.text('SolarCurve', M, 16);
    doc.setFontSize(11);
    doc.setTextColor(148, 163, 184);
    doc.text('Rapport d\'estimation de production photovoltaïque', M, 24);
    doc.setFontSize(9);
    doc.setTextColor(200, 200, 200);
    doc.text(`Généré le ${new Date().toLocaleDateString('fr-FR')} à ${new Date().toLocaleTimeString('fr-FR')}`, W - M, 24, { align: 'right' });

    y = 42;

    // Parameters card
    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    const paramCardH = 20;
    doc.roundedRect(M, y, W - M * 2, paramCardH, 3, 3, 'FD');
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(9);

    const paramCols = [];
    paramCols.push(`Position : ${latInput.value || '-'}, ${lonInput.value || '-'}`);
    paramCols.push(`Puissance : ${document.getElementById('peakPower').value} Wc`);
    paramCols.push(`Inclinaison : ${document.getElementById('tilt').value}°`);
    paramCols.push(`Azimut 1 : ${currentPrimaryAzimuth ?? azimuthInput.value}°`);
    if (hasSecondary) paramCols.push(`Azimut 2 : ${currentSecondaryAzimuth}°`);
    paramCols.push(`Pertes : ${document.getElementById('losses').value}%`);

    const paramText = paramCols.join('   ·   ');
    doc.text(paramText, M + 6, y + 12);
    y += paramCardH + 6;

    // Bar chart
    const imgW = W - M * 2;
    let imgH = imgW * (700 / 1600);
    const maxImgH = H - y - 50 - M;
    if (imgH > maxImgH) imgH = Math.max(40, maxImgH);
    doc.addImage(barImg, 'PNG', M, y, imgW, imgH);
    y += imgH + 6;

    // Annual summary boxes
    const boxW = hasSecondary ? (W - M * 2 - 8) / 3 : (W - M * 2);
    const boxH = 14;
    const boxColors = [[239, 68, 68], [37, 99, 235], [5, 150, 105]];
    const summaryItems = [];
    summaryItems.push({ label: `Total az. ${currentPrimaryAzimuth}°`, value: `${totalPrimary.toFixed(1)} kWh`, color: boxColors[0] });
    if (hasSecondary) {
      summaryItems.push({ label: `Total az. ${currentSecondaryAzimuth}°`, value: `${totalSecondary.toFixed(1)} kWh`, color: boxColors[1] });
      summaryItems.push({ label: 'Total combiné', value: `${totalCombined.toFixed(1)} kWh`, color: boxColors[2] });
    }

    for (let i = 0; i < summaryItems.length; i++) {
      const bx = M + i * (boxW + 4);
      const item = summaryItems[i];
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(bx, y, boxW, boxH, 2, 2, 'FD');
      // Color accent top
      doc.setFillColor(item.color[0], item.color[1], item.color[2]);
      doc.rect(bx, y, boxW, 1.8, 'F');
      // Text
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(item.label.toUpperCase(), bx + 4, y + 6);
      doc.setFontSize(12);
      doc.setTextColor(15, 23, 42);
      doc.text(item.value, bx + 4, y + 12);
    }

    if (hasSecondary) {
      y += boxH + 2;
      const pct1 = totalCombined > 0 ? (totalPrimary / totalCombined * 100) : 0;
      const pct2 = totalCombined > 0 ? (totalSecondary / totalCombined * 100) : 0;
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(`Répartition : ${pct1.toFixed(1)}% (az. ${currentPrimaryAzimuth}°) / ${pct2.toFixed(1)}% (az. ${currentSecondaryAzimuth}°)`, M, y + 4);
    }

    // Footer page 1
    pdfFooter(doc, W, H, M, 1);

    // ─────── Page 2: Monthly Table ───────
    doc.addPage();
    pdfPageHeader(doc, W, M, 'Détail mensuel de la production');
    y = 38;

    const colCount = hasSecondary ? 4 : 2;
    const tableW = W - M * 2;
    const colW = tableW / colCount;
    const rowH = 9;
    const headerH = 10;

    // Table header
    doc.setFillColor(15, 23, 42);
    const headers = ['Mois', `Production (${currentPrimaryAzimuth}°) kWh`];
    if (hasSecondary) headers.push(`Production (${currentSecondaryAzimuth}°) kWh`, 'Total kWh');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    for (let i = 0; i < headers.length; i++) {
      doc.rect(M + i * colW, y, colW, headerH, 'F');
      doc.text(headers[i], M + i * colW + 4, y + 7);
    }
    y += headerH;

    // Table rows
    let totalRowPrimary = 0, totalRowSecondary = 0;

    for (let i = 0; i < 12; i++) {
      const isEven = i % 2 === 0;
      if (isEven) { doc.setFillColor(248, 250, 252); } else { doc.setFillColor(255, 255, 255); }
      doc.setDrawColor(226, 232, 240);

      const a1 = primaryMonthly[i] || 0;
      const a2 = hasSecondary ? (secondaryMonthly[i] || 0) : 0;
      totalRowPrimary += a1;
      totalRowSecondary += a2;

      for (let c = 0; c < colCount; c++) {
        doc.rect(M + c * colW, y, colW, rowH, 'FD');
      }

      doc.setTextColor(30, 41, 59);
      doc.setFontSize(9);
      doc.text(MONTHS[i], M + 4, y + 6.5);
      doc.text(a1.toFixed(1), M + colW + colW - 6, y + 6.5, { align: 'right' });

      if (hasSecondary) {
        doc.text(a2.toFixed(1), M + 2 * colW + colW - 6, y + 6.5, { align: 'right' });
        doc.text((a1 + a2).toFixed(1), M + 3 * colW + colW - 6, y + 6.5, { align: 'right' });
      }

      y += rowH;
    }

    // Total row
    doc.setFillColor(245, 158, 11);
    for (let c = 0; c < colCount; c++) {
      doc.rect(M + c * colW, y, colW, headerH, 'F');
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text('TOTAL ANNUEL', M + 4, y + 7);
    doc.text(totalRowPrimary.toFixed(1), M + colW + colW - 6, y + 7, { align: 'right' });
    if (hasSecondary) {
      doc.text(totalRowSecondary.toFixed(1), M + 2 * colW + colW - 6, y + 7, { align: 'right' });
      doc.text((totalRowPrimary + totalRowSecondary).toFixed(1), M + 3 * colW + colW - 6, y + 7, { align: 'right' });
    }

    pdfFooter(doc, W, H, M, 2);

    // ─────── Page 3: Hourly Profile Charts ───────
    doc.addPage();
    pdfPageHeader(doc, W, M, 'Profils horaires mensuels moyens');

    const chartCols = 3;
    const chartRows = 4;
    const gap = 6;
    const topY = 40;
    const avW = (W - M * 2 - gap * (chartCols - 1)) / chartCols;
    const avH = (H - topY - M - 16 - gap * (chartRows - 1)) / chartRows;

    for (let idx = 0; idx < chartImages.length; idx++) {
      const col = idx % chartCols;
      const row = Math.floor(idx / chartCols);
      const cx = M + col * (avW + gap);
      const cy = topY + row * (avH + gap);

      // Month label background
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(cx, cy, avW, avH, 2, 2, 'FD');

      // Month name
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      const mName = MONTHS[chartImages[idx].month - 1];
      doc.text(mName, cx + 3, cy + 5);

      // Chart image
      doc.addImage(chartImages[idx].src, 'PNG', cx + 1, cy + 7, avW - 2, avH - 9);
    }

    pdfFooter(doc, W, H, M, 3);

    // Save
    doc.save(`SolarCurve_rapport_${new Date().toISOString().slice(0, 10)}.pdf`);

  } catch (err) {
    console.error('Export PDF failed', err);
    alert('Erreur lors de la génération du PDF. Consultez la console.');
  }
}

function pdfPageHeader(doc, W, M, title) {
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 28, 'F');
  doc.setFillColor(245, 158, 11);
  doc.rect(0, 28, W, 1.5, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text(title, M, 18);
}

function pdfFooter(doc, W, H, M, pageNum) {
  doc.setFontSize(8);
  doc.setTextColor(148, 163, 184);
  doc.text('SolarCurve — Données fournies à titre indicatif', M, H - 6);
  doc.text(`Page ${pageNum}`, W - M, H - 6, { align: 'right' });
}

// ─── Init ──────────────────────────────────────────────────
azimuth2Input.dataset.auto = 'true';
setAutoOppositeAzimuth(true);
initMap();
