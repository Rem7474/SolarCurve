const form = document.getElementById('pv-form');
const sourceSelect = document.getElementById('source');
const pvwattsKeyWrapper = document.getElementById('pvwatts-key-wrapper');
const geoBtn = document.getElementById('geo-btn');
const estimateBtn = document.getElementById('estimate-btn');
const statusEl = document.getElementById('status');
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
const exportPdfBtn = document.getElementById('exportPdfBtn');

sourceSelect.addEventListener('change', () => {
  pvwattsKeyWrapper.classList.toggle('hidden', sourceSelect.value !== 'pvwatts');
});

compareAzimuthCheckbox.addEventListener('change', () => {
  const enabled = compareAzimuthCheckbox.checked;
  azimuth2Wrapper.classList.toggle('hidden', !enabled);
  azimuth2Input.disabled = !enabled;
  if (enabled) {
    setAutoOppositeAzimuth(true);
  }
  updateAzimuthArrowFromInputs();
});

daySlider.addEventListener('input', () => {
  updateSelectedDayChart();
  updateDayButtonsState();
});

if (monthSelect) {
  monthSelect.addEventListener('change', () => {
    updateMonthlyChart();
  });
}

latInput.addEventListener('change', () => {
  updateMapFromInputs();
});

lonInput.addEventListener('change', () => {
  updateMapFromInputs();
});

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
    setStatus('Géolocalisation non supportée par ce navigateur.', true);
    return;
  }

  setStatus('Récupération de votre position GPS...');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      latInput.value = position.coords.latitude.toFixed(5);
      lonInput.value = position.coords.longitude.toFixed(5);
      updateMapFromInputs(true);
      setStatus('Position GPS récupérée.');
    },
    (error) => {
      setStatus(`Impossible de récupérer la position (${error.message}).`, true);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const params = getInputs();
  if (!params) {
    return;
  }

  // hide previous outputs while computing
  hideResults();
  toggleLoading(true);
  setStatus('Calcul en cours...');

  try {
    const primaryResult = await fetchFromSource(params);

    let secondaryResult = null;
    if (params.compareAzimuth) {
      secondaryResult = await fetchFromSource({
        ...params,
        azimuth: params.azimuth2,
      });
    }

    const { dailyData, hourlyEntries } = primaryResult;

    if (!dailyData.length) {
      throw new Error('Aucune donnée de production reçue.');
    }

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
    setStatus(`Estimation terminée (${params.source.toUpperCase()}).`);
  } catch (error) {
    console.error(error);
    setStatus(`Erreur: ${error.message}`, true);
  } finally {
    toggleLoading(false);
  }
});

function parseDecimal(val) {
  return Number(String(val).replace(',', '.'));
}

function getInputs() {
  const lat = parseDecimal(latInput.value);
  const lon = parseDecimal(lonInput.value);
  // Input is expressed in Wc (Watts-peak). Convert to kW for API calls.
  const peakPowerInputW = Number(document.getElementById('peakPower').value);
  const peakPower = peakPowerInputW / 1000; // kW
  const tilt = Number(document.getElementById('tilt').value);
  const azimuth = Number(document.getElementById('azimuth').value);
  const compareAzimuth = compareAzimuthCheckbox.checked;
  const azimuth2 = Number(azimuth2Input.value);
  const losses = Number(document.getElementById('losses').value);
  const source = sourceSelect.value;
  const pvwattsKey = document.getElementById('pvwattsKey').value.trim();

  if ([lat, lon, peakPowerInputW, tilt, azimuth, losses].some((value) => Number.isNaN(value))) {
    setStatus('Merci de renseigner des valeurs numériques valides.', true);
    return null;
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    setStatus('Latitude/longitude hors limites.', true);
    return null;
  }

  if (tilt < 0 || tilt > 90 || azimuth < -180 || azimuth > 180) {
    setStatus('Inclinaison ou azimut hors limites.', true);
    return null;
  }

  if (peakPowerInputW <= 0 || losses < 0 || losses > 100) {
    setStatus('Puissance/pertes invalides.', true);
    return null;
  }

  if (source === 'pvwatts' && !pvwattsKey) {
    setStatus('Merci de saisir une clé API PVWatts.', true);
    return null;
  }

  if (compareAzimuth && (Number.isNaN(azimuth2) || azimuth2 < -180 || azimuth2 > 180)) {
    setStatus('Azimut 2 hors limites.', true);
    return null;
  }

  return {
    lat,
    lon,
    peakPower,
    tilt,
    azimuth,
    compareAzimuth,
    azimuth2,
    losses,
    source,
    pvwattsKey,
  };
}

async function fetchFromSource(params) {
  return params.source === 'pvgis' ? fetchFromPVGIS(params) : fetchFromPVWatts(params);
}

async function fetchFromPVGIS({ lat, lon, peakPower, tilt, azimuth, losses }) {
  const startYear = 2020;
  const endYear = 2020;

  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    pvcalculation: '1',
    peakpower: String(peakPower),
    loss: String(losses),
    angle: String(tilt),
    aspect: String(azimuth),
    outputformat: 'json',
    startyear: String(startYear),
    endyear: String(endYear),
    pvtechchoice: 'crystSi',
    mountingplace: 'free',
  });

  const response = await fetchJSONFromAPI(
    `/api/pvgis?${params.toString()}`,
    'PVGIS'
  );

  const data = await response.json();
  const hourly = data?.outputs?.hourly;

  if (!Array.isArray(hourly) || hourly.length === 0) {
    throw new Error('Réponse PVGIS invalide.');
  }

  const hourlyEntries = [];
  let hasPowerColumn = false;

  for (const row of hourly) {
    const powerW = Number(row.P ?? row.p ?? row['Pdc'] ?? row['Pac']);
    if (!Number.isNaN(powerW)) {
      hasPowerColumn = true;
    }
    if (Number.isNaN(powerW)) {
      continue;
    }

    const parsedTime = parsePVGISTime(row.time);
    if (!parsedTime) {
      continue;
    }

    hourlyEntries.push({
      dayKey: parsedTime.dayKey,
      month: parsedTime.month,
      hour: parsedTime.hour,
      kwh: powerW / 1000,
    });
  }

  if (!hasPowerColumn) {
    throw new Error(
      "PVGIS n'a pas renvoyé de puissance PV (champ P). Vérifie le proxy /api/pvgis et les paramètres de calcul PV."
    );
  }

  return {
    hourlyEntries,
    dailyData: aggregateDailyData(hourlyEntries),
  };
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

  const response = await fetchJSONFromAPI(
    `/api/pvwatts?${params.toString()}`,
    'PVWatts'
  );

  const data = await response.json();
  const errors = data?.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new Error(`PVWatts: ${errors.join(', ')}`);
  }

  const ac = data?.outputs?.ac;
  if (!Array.isArray(ac) || ac.length === 0) {
    throw new Error('Réponse PVWatts invalide.');
  }

  const year = 2020;
  const hourlyEntries = [];

  for (let i = 0; i < ac.length; i += 1) {
    const powerW = Number(ac[i]);
    if (Number.isNaN(powerW)) {
      continue;
    }

    const date = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    date.setUTCHours(i);
    hourlyEntries.push({
      dayKey: date.toISOString().slice(0, 10),
      month: date.getUTCMonth() + 1,
      hour: date.getUTCHours(),
      kwh: powerW / 1000,
    });
  }

  return {
    hourlyEntries,
    dailyData: aggregateDailyData(hourlyEntries),
  };
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
  if (typeof time !== 'string') {
    return null;
  }

  const match = time.match(/^(\d{4})(\d{2})(\d{2}):?(\d{2})/);
  if (!match) {
    return null;
  }

  const [, yyyy, mm, dd, hh] = match;
  return {
    dayKey: `${yyyy}-${mm}-${dd}`,
    month: Number(mm),
    hour: Number(hh),
  };
}

function aggregateDailyData(hourlyEntries) {
  const byDay = new Map();

  for (const entry of hourlyEntries) {
    const previous = byDay.get(entry.dayKey) ?? 0;
    byDay.set(entry.dayKey, previous + entry.kwh);
  }

  return [...byDay.entries()]
    .sort(([dayA], [dayB]) => dayA.localeCompare(dayB))
    .map(([day, value]) => ({ day, kwh: Number(value.toFixed(3)) }));
}

function azimuthSouthToAzimuthNorthClockwise(azimuthSouth) {
  const result = 180 - azimuthSouth;
  return ((result % 360) + 360) % 360;
}

function azimuthNorthClockwiseToAzimuthSouth(bearing) {
  const result = 180 - bearing;
  return normalizeAzimuthSouth(result);
}

function normalizeAzimuthSouth(value) {
  const normalized = ((value + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
}

function getOppositeAzimuth(azimuthSouth) {
  return normalizeAzimuthSouth(azimuthSouth + 180);
}

function setAutoOppositeAzimuth(force = false) {
  if (!compareAzimuthCheckbox.checked && !force) {
    return;
  }

  if (!force && azimuth2Input.dataset.auto === 'false') {
    return;
  }

  const azimuthSouth = Number(azimuthInput.value);
  if (Number.isNaN(azimuthSouth)) {
    return;
  }

  azimuth2Input.value = String(getOppositeAzimuth(azimuthSouth));
  azimuth2Input.dataset.auto = 'true';
}

function updateSelectedDayChart() {
  const selectedIndex = Number(daySlider.value) - 1;
  if (
    !currentPrimaryHourlyEntries.length ||
    !currentPrimaryDailyData.length ||
    Number.isNaN(selectedIndex)
  ) {
    return;
  }

  const selectedDay = currentPrimaryDailyData[selectedIndex];
  if (!selectedDay) {
    return;
  }

  dayLabel.textContent = formatDayLabel(selectedDay.day);

  const selectedProfile = buildSpecificDayProfile(currentPrimaryHourlyEntries, selectedDay.day);
  const secondaryProfile = currentSecondaryHourlyEntries.length
    ? buildSpecificDayProfile(currentSecondaryHourlyEntries, selectedDay.day)
    : null;
  const juneLimit = buildSpecificDayProfile(currentPrimaryHourlyEntries, '2020-06-21');
  const decemberLimit = buildSpecificDayProfile(currentPrimaryHourlyEntries, '2020-12-21');
  const labels = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}h`);
  const datasets = buildDailyDatasets(selectedProfile, secondaryProfile, juneLimit, decemberLimit);

  if (dailyProfileChart) {
    dailyProfileChart.data.labels = labels;
    dailyProfileChart.data.datasets = datasets;
    dailyProfileChart.update();
    return;
  }

  dailyProfileChart = new Chart(dailyProfileChartCanvas, {
    type: 'line',
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          title: {
            display: true,
            text: 'kWh / heure',
          },
        },
      },
    },
  });
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

function updateMonthlyChart() {
  if (!monthlyProfileChartCanvas) return;
  const selectedMonth = Number(monthSelect?.value) || 6;

  const primaryMonthly = buildMonthlyAverageProfile(currentPrimaryHourlyEntries, selectedMonth);
  const secondaryMonthly = currentSecondaryHourlyEntries.length
    ? buildMonthlyAverageProfile(currentSecondaryHourlyEntries, selectedMonth)
    : null;

  const datasets = [];
  datasets.push({
    label: `Azimut ${currentPrimaryAzimuth}° (moyenne mois ${selectedMonth})`,
    data: primaryMonthly,
    borderWidth: 2.2,
    borderColor: '#ef4444',
    tension: 0.2,
    pointRadius: 0,
  });

  if (secondaryMonthly) {
    datasets.push({
      label: `Azimut ${currentSecondaryAzimuth}° (moyenne mois ${selectedMonth})`,
      data: secondaryMonthly,
      borderWidth: 2,
      borderColor: '#2563eb',
      borderDash: [10, 4],
      tension: 0.2,
      pointRadius: 0,
    });

    datasets.push({
      label: `Somme (${currentPrimaryAzimuth}° + ${currentSecondaryAzimuth}°)` ,
      data: sumProfiles(primaryMonthly, secondaryMonthly),
      borderWidth: 2.4,
      borderColor: '#059669',
      tension: 0.2,
      pointRadius: 0,
    });
  }

  const labels = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}h`);

  if (monthlyProfileChart) {
    monthlyProfileChart.data.labels = labels;
    monthlyProfileChart.data.datasets = datasets;
    monthlyProfileChart.update();
    return;
  }

  monthlyProfileChart = new Chart(monthlyProfileChartCanvas, {
    type: 'line',
    data: {
      labels,
      datasets,
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          title: {
            display: true,
            text: 'kWh / heure',
          },
        },
      },
    },
  });
}

function computeMonthlyTotalsFromDaily(dailyArray) {
  const months = Array.from({ length: 12 }, () => 0);
  for (const row of dailyArray) {
    const parts = String(row.day).split('-');
    if (parts.length >= 2) {
      const month = Number(parts[1]);
      if (!Number.isNaN(month) && month >= 1 && month <= 12) {
        months[month - 1] += row.kwh;
      }
    }
  }
  return months.map((v) => Number(v.toFixed(3)));
}

async function exportToPDF() {
  try {
    // Build monthly totals
    const primaryMonthly = computeMonthlyTotalsFromDaily(currentPrimaryDailyData);
    const secondaryMonthly = currentSecondaryDailyData.length
      ? computeMonthlyTotalsFromDaily(currentSecondaryDailyData)
      : null;

    const monthsLabels = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

    // Create offscreen canvas for chart (higher resolution)
    const canvas = document.createElement('canvas');
    const canvasW = 1600;
    const canvasH = 800;
    canvas.width = canvasW;
    canvas.height = canvasH;
    canvas.style.display = 'none';
    document.body.appendChild(canvas);

    const datasets = [
      {
        label: `Azimut ${currentPrimaryAzimuth}°`,
        data: primaryMonthly,
        backgroundColor: '#ef6a6a',
        borderColor: '#ef4444',
        borderWidth: 1
      }
    ];
    if (secondaryMonthly) {
      datasets.push({
        label: `Azimut ${currentSecondaryAzimuth}°`,
        data: secondaryMonthly,
        backgroundColor: '#6aa6ff',
        borderColor: '#2563eb',
        borderWidth: 1
      });
    }

    const tmpChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: { labels: monthsLabels, datasets },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: { legend: { display: true, position: 'top' } },
        scales: { y: { title: { display: true, text: 'kWh' } } }
      }
    });

    await new Promise((r) => setTimeout(r, 300));
    const imgData = canvas.toDataURL('image/png', 1.0);
    tmpChart.destroy();
    document.body.removeChild(canvas);

    // Prepare PDF (A4 landscape)
    // Support different UMD/global shapes for jsPDF
    const jsPDFGlobal = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || (window.jspdf || null);
    if (!jsPDFGlobal) {
      throw new Error('jsPDF library not found. Ensure jspdf.umd.min.js is loaded.');
    }
    const DocConstructor = typeof jsPDFGlobal === 'function' ? jsPDFGlobal : jsPDFGlobal.jsPDF || jsPDFGlobal;
    const doc = new DocConstructor({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;
    let y = margin;

    // Header block
    doc.setFillColor(15,23,42); // #0f172a
    doc.rect(0, 0, pageW, 28, 'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(18);
    doc.text('Récapitulatif SolarCurve', margin, 18);
    doc.setFontSize(10);
    doc.text(`Export : ${new Date().toLocaleString()}`, pageW - margin, 18, { align: 'right' });
    y = 34;

    // Inputs card
    doc.setFillColor(243,244,246); // light gray
    doc.setDrawColor(226,232,240);
    const cardH = 16;
    doc.rect(margin, y, pageW - margin * 2, cardH, 'FD');
    doc.setTextColor(15,23,42);
    doc.setFontSize(10);
    const inputs = [];
    inputs.push(`Position: ${latInput.value || '-'} , ${lonInput.value || '-'}`);
    inputs.push(`Puissance (Wc): ${document.getElementById('peakPower').value} W`);
    inputs.push(`Inclinaison: ${document.getElementById('tilt').value}°`);
    inputs.push(`Azimut 1: ${currentPrimaryAzimuth ?? document.getElementById('azimuth').value}°`);
    if (currentSecondaryAzimuth !== null) inputs.push(`Azimut 2: ${currentSecondaryAzimuth}°`);
    inputs.push(`Pertes: ${document.getElementById('losses').value} %`);
    doc.text(inputs.join(' · '), margin + 4, y + 10);
    y += cardH + 8;

    // Chart image - scale down if it would overflow the first page
    const imgWmm = pageW - margin * 2;
    let imgHmm = (imgWmm * (canvasH / canvasW));
    // compute remaining vertical space on page for stats and margin
    const reservedForStats = 40; // space for stats text
    const maxImgHmm = pageH - y - reservedForStats - margin;
    if (imgHmm > maxImgHmm) imgHmm = Math.max(40, maxImgHmm);
    doc.addImage(imgData, 'PNG', margin, y, imgWmm, imgHmm);
    y += imgHmm + 8;

    // Summary stats under chart
    const totalYearPrimary = primaryMonthly.reduce((a,b) => a + b, 0);
    const totalYearSecondary = secondaryMonthly ? secondaryMonthly.reduce((a,b) => a + b, 0) : 0;
    const totalCombined = totalYearPrimary + totalYearSecondary;
    doc.setFontSize(11);
    doc.text(`Total annuel Azimut ${currentPrimaryAzimuth}°: ${totalYearPrimary.toFixed(1)} kWh`, margin, y);
    y += 6;
    if (secondaryMonthly) {
      doc.text(`Total annuel Azimut ${currentSecondaryAzimuth}°: ${totalYearSecondary.toFixed(1)} kWh`, margin, y);
      y += 6;
      const pct1 = totalCombined > 0 ? (totalYearPrimary / totalCombined) * 100 : 0;
      const pct2 = totalCombined > 0 ? (totalYearSecondary / totalCombined) * 100 : 0;
      doc.text(`% production ${currentPrimaryAzimuth}°: ${pct1.toFixed(1)} %`, margin, y);
      doc.text(`% production ${currentSecondaryAzimuth}°: ${pct2.toFixed(1)} %`, pageW - margin - 60, y);
      y += 8;
    }

    // Page break
    doc.addPage();

    // Page 2 - Detailed monthly table
    doc.setFillColor(15,23,42);
    doc.rect(0, 0, pageW, 22, 'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(14);
    doc.text('Détails mensuels', margin, 14);
    y = 28;

    const colX = margin;
    const hasSecondary = Boolean(secondaryMonthly);
    const colsCount = hasSecondary ? 4 : 2; // Mois, Az1, (Az2), (Total)
    const colW = Math.min(70, Math.floor((pageW - margin * 2) / colsCount));
    doc.setFontSize(10);
    doc.setFillColor(14,165,233); // bluish header
    doc.setTextColor(255,255,255);
    const headerH = 8;
    const headers = ['Mois', `Production estimée (${currentPrimaryAzimuth}°) (kWh)`];
    if (hasSecondary) headers.push(`Production estimée (${currentSecondaryAzimuth}°) (kWh)`, 'Total (kWh)');
    // draw header
    let xPos = colX;
    for (let i = 0; i < headers.length; i++) {
      doc.rect(xPos, y, colW, headerH, 'F');
      doc.text(headers[i], xPos + 3, y + 6);
      xPos += colW;
    }
    y += headerH + 4;

    // rows for 12 months
    const rowH = 10;
    doc.setFontSize(10);
    doc.setTextColor(15,23,42);
    for (let i = 0; i < 12; i++) {
      xPos = colX;
      const mLabel = monthsLabels[i] || `Mois ${i+1}`;
      const a1 = primaryMonthly[i] || 0;

      // Month
      doc.rect(xPos, y, colW, rowH, 'S');
      doc.text(mLabel, xPos + 3, y + 7);
      xPos += colW;

      // Azimut 1 / Production estimée
      doc.rect(xPos, y, colW, rowH, 'S');
      doc.text(String(a1.toFixed(1)), xPos + 3, y + 7);
      xPos += colW;

      if (hasSecondary) {
        const a2 = (secondaryMonthly && secondaryMonthly[i]) ? secondaryMonthly[i] : 0;
        // Azimut 2 / Production estimée
        doc.rect(xPos, y, colW, rowH, 'S');
        doc.text(String(a2.toFixed(1)), xPos + 3, y + 7);
        xPos += colW;

        // Total
        const tot = Number((a1 + a2).toFixed(1));
        doc.rect(xPos, y, colW, rowH, 'S');
        doc.text(String(tot.toFixed(1)), xPos + 3, y + 7);
      }

      y += rowH + 4;
      if (y > pageH - margin - 20) {
        doc.addPage();
        // redraw header on new page
        y = margin + 4;
        xPos = colX;
        doc.setFillColor(14,165,233);
        doc.setTextColor(255,255,255);
        for (let h = 0; h < headers.length; h++) {
          doc.rect(xPos, y, colW, headerH, 'F');
          doc.text(headers[h], xPos + 3, y + 6);
          xPos += colW;
        }
        y += headerH + 4;
        doc.setTextColor(15,23,42);
      }
    }

    // --- Additional pages: hourly monthly average charts (4 per page) ---
    // Helper to compute hourly average for a month
    function monthlyHourly(hoursArray, month) {
      // reuse buildMonthlyAverageProfile but operate on current data arrays
      return buildMonthlyAverageProfile(hoursArray, month);
    }

    const chartCols = 3;
    const chartRows = 4;
    const chartMargin = 8;
    const monthsToRender = 12;
    let chartImages = [];

    for (let m = 1; m <= monthsToRender; m++) {
      const pm = monthlyHourly(currentPrimaryHourlyEntries, m);
      const sm = currentSecondaryHourlyEntries.length ? monthlyHourly(currentSecondaryHourlyEntries, m) : null;

      // create canvas per chart
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 600;
      c.style.display = 'none';
      document.body.appendChild(c);

      const dsets = [
        {
          label: `Azimut ${currentPrimaryAzimuth}°`,
          data: pm,
          borderColor: '#ef4444',
          backgroundColor: '#ef9a9a',
          fill: false,
          tension: 0.2,
        }
      ];
      if (sm) {
        dsets.push({
          label: `Azimut ${currentSecondaryAzimuth}°`,
          data: sm,
          borderColor: '#2563eb',
          backgroundColor: '#9ec6ff',
          fill: false,
          tension: 0.2,
        });
      }

      const ch = new Chart(c.getContext('2d'), {
        type: 'line',
        data: { labels: Array.from({length:24},(_,h)=>`${h}h`), datasets: dsets },
        options: { responsive:false, maintainAspectRatio:false, plugins:{ legend:{ display: false } }, scales:{ y:{ title:{ display:true, text:'kWh' } } } }
      });

      // allow rendering
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 200));
      const im = c.toDataURL('image/png',1.0);
      ch.destroy();
      document.body.removeChild(c);
      chartImages.push({ month: m, src: im });
    }

    // Draw all 12 charts on a single page in a 3x4 grid
    doc.addPage();
    const topSpace = margin + 8;
    const availableW = pageW - margin * 2 - chartMargin * (chartCols - 1);
    const availableH = pageH - topSpace - margin - 18; // leave bottom margin for footer
    const chartWmm = availableW / chartCols;
    const chartHmm = availableH / chartRows - 8; // small vertical padding

    for (let idx = 0; idx < chartImages.length; idx++) {
      const col = idx % chartCols;
      const row = Math.floor(idx / chartCols);
      const x = margin + col * (chartWmm + chartMargin);
      const yPos = topSpace + row * (chartHmm + chartMargin + 8);
      // title
      doc.setFontSize(10);
      doc.setTextColor(15,23,42);
      const monthName = monthsLabels[chartImages[idx].month - 1] || `Mois ${chartImages[idx].month}`;
      const title = `${monthName} - Profil horaire moyen`;
      doc.text(title, x, yPos);
      // image below title
      const imgY = yPos + 4;
      doc.addImage(chartImages[idx].src, 'PNG', x, imgY, chartWmm, chartHmm - 12);
    }

    // Footer note
    doc.setFontSize(9);
    doc.setTextColor(120,120,120);
    doc.text('Export généré par SolarCurve — données fournies à titre indicatif', margin, pageH - 10);

    const filename = `SolarCurve_recap_${new Date().toISOString().slice(0,10)}.pdf`;
    doc.save(filename);
  } catch (err) {
    console.error('Export PDF failed', err);
    alert('Erreur lors de la génération du PDF. Voir la console.');
  }
}

if (exportPdfBtn) {
  exportPdfBtn.addEventListener('click', () => {
    exportToPDF();
  });
}

function updateDayButtonsState() {
  if (!daySlider) return;
  const min = Number(daySlider.min || 1);
  const max = Number(daySlider.max || 1);
  const val = Number(daySlider.value || min);
  if (prevDayBtn) prevDayBtn.disabled = val <= min || daySlider.disabled;
  if (nextDayBtn) nextDayBtn.disabled = val >= max || daySlider.disabled;
}

if (prevDayBtn) {
  prevDayBtn.addEventListener('click', () => {
    if (!daySlider || daySlider.disabled) return;
    const min = Number(daySlider.min || 1);
    let v = Number(daySlider.value || min);
    if (v > min) v -= 1;
    daySlider.value = String(v);
    updateSelectedDayChart();
    updateDayButtonsState();
  });
}

if (nextDayBtn) {
  nextDayBtn.addEventListener('click', () => {
    if (!daySlider || daySlider.disabled) return;
    const max = Number(daySlider.max || 1);
    let v = Number(daySlider.value || 1);
    if (v < max) v += 1;
    daySlider.value = String(v);
    updateSelectedDayChart();
    updateDayButtonsState();
  });
}

function buildDailyDatasets(selectedProfile, secondaryProfile, juneLimit, decemberLimit) {
  const datasets = [
    {
      label: `Azimut ${currentPrimaryAzimuth}° (${dayLabel.textContent})`,
      data: selectedProfile,
      borderWidth: 2.2,
      borderColor: '#ef4444',
      tension: 0.2,
      pointRadius: 0,
    },
  ];

  if (secondaryProfile) {
    const summedProfile = sumProfiles(selectedProfile, secondaryProfile);

    datasets.push({
      label: `Azimut ${currentSecondaryAzimuth}° (${dayLabel.textContent})`,
      data: secondaryProfile,
      borderWidth: 2,
      borderColor: '#2563eb',
      borderDash: [10, 4],
      tension: 0.2,
      pointRadius: 0,
    });

    datasets.push({
      label: `Somme (${currentPrimaryAzimuth}° + ${currentSecondaryAzimuth}°)`,
      data: summedProfile,
      borderWidth: 2.4,
      borderColor: '#059669',
      tension: 0.2,
      pointRadius: 0,
    });
  }
  // Affiche les limites été/hiver uniquement quand on n'affiche pas la comparaison
  if (!secondaryProfile) {
    datasets.push(
      {
        label: 'Limite été (21 juin)',
        data: juneLimit,
        borderWidth: 1.6,
        borderDash: [8, 4],
        tension: 0.2,
        pointRadius: 0,
      },
      {
        label: 'Limite hiver (21 décembre)',
        data: decemberLimit,
        borderWidth: 1.6,
        borderDash: [4, 4],
        tension: 0.2,
        pointRadius: 0,
      }
    );
  }

  return datasets;
}

function sumProfiles(profileA, profileB) {
  const size = Math.min(profileA.length, profileB.length);
  const output = [];

  for (let index = 0; index < size; index += 1) {
    output.push(Number((profileA[index] + profileB[index]).toFixed(3)));
  }

  return output;
}

function buildSpecificDayProfile(hourlyEntries, dayKey) {
  const profile = Array.from({ length: 24 }, () => 0);

  for (const entry of hourlyEntries) {
    if (entry.dayKey === dayKey) {
      profile[entry.hour] += entry.kwh;
    }
  }

  return profile.map((value) => Number(value.toFixed(3)));
}

function renderStats(dailyData, secondaryDailyData = null) {
  // If there's a secondary dataset, compute aggregated stats (sum per day) across both azimuths
  if (secondaryDailyData?.length) {
    const mapByDay = new Map();

    for (const row of dailyData) {
      mapByDay.set(row.day, (mapByDay.get(row.day) || 0) + row.kwh);
    }
    for (const row of secondaryDailyData) {
      mapByDay.set(row.day, (mapByDay.get(row.day) || 0) + row.kwh);
    }

    const combined = [...mapByDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, kwh]) => ({ day, kwh: Number(kwh.toFixed(3)) }));

    const totalCombined = combined.reduce((acc, r) => acc + r.kwh, 0);
    const avgCombined = totalCombined / combined.length;

    const sortedCombined = [...combined].sort((a, b) => a.kwh - b.kwh);
    const minCombined = sortedCombined[0];
    const maxCombined = sortedCombined[sortedCombined.length - 1];

    const cards = [
      statCard('Total annuel (2 azimuts)', `${totalCombined.toFixed(1)} kWh`),
      statCard('Moyenne/jour (2 azimuts)', `${avgCombined.toFixed(2)} kWh`),
      statCard('Jour le plus faible (2 azimuts)', `${minCombined.day} · ${minCombined.kwh.toFixed(2)} kWh`),
      statCard('Jour le plus productif (2 azimuts)', `${maxCombined.day} · ${maxCombined.kwh.toFixed(2)} kWh`),
    ];

    // Show percentage contribution of each azimuth to the combined production
    const totalPrimary = dailyData.reduce((acc, r) => acc + r.kwh, 0);
    const totalSecondary = secondaryDailyData.reduce((acc, r) => acc + r.kwh, 0);
    const totalBothAzimuts = totalPrimary + totalSecondary;
    const pctPrimary = totalBothAzimuts > 0 ? (totalPrimary / totalBothAzimuts) * 100 : 0;
    const pctSecondary = totalBothAzimuts > 0 ? (totalSecondary / totalBothAzimuts) * 100 : 0;
    cards.push(
      statCard(`% production azimut ${currentPrimaryAzimuth}°`, `${pctPrimary.toFixed(1)} %`),
      statCard(`% production azimut ${currentSecondaryAzimuth}°`, `${pctSecondary.toFixed(1)} %`)
    );

    statsEl.innerHTML = cards.join('');
    return;
  }

  // Fallback when only primary is available
  const total = dailyData.reduce((acc, row) => acc + row.kwh, 0);
  const avg = total / dailyData.length;

  const sortedByKwh = [...dailyData].sort((a, b) => a.kwh - b.kwh);
  const min = sortedByKwh[0];
  const max = sortedByKwh[sortedByKwh.length - 1];

  const cards = [
    statCard('Total annuel', `${total.toFixed(1)} kWh`),
    statCard('Moyenne/jour', `${avg.toFixed(2)} kWh`),
    statCard('Jour le plus faible', `${min.day} · ${min.kwh.toFixed(2)} kWh`),
    statCard('Jour le plus productif', `${max.day} · ${max.kwh.toFixed(2)} kWh`),
  ];

  statsEl.innerHTML = cards.join('');
}

function statCard(title, value) {
  return `<div class="stat-item"><strong>${title}</strong><span>${value}</span></div>`;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? '#b91c1c' : '#111827';
}

function toggleLoading(isLoading) {
  estimateBtn.disabled = isLoading;
  estimateBtn.textContent = isLoading ? 'Calcul...' : 'Estimer la production';
}

function hideResults() {
  try {
    const resultsArea = document.getElementById('resultsArea');
    if (resultsArea) resultsArea.classList.add('hidden');
    statsEl.classList.add('hidden');
    const mcont = monthlyProfileChartCanvas && monthlyProfileChartCanvas.closest('.chart-container');
    const dcont = dailyProfileChartCanvas && dailyProfileChartCanvas.closest('.chart-container');
    if (mcont) mcont.classList.add('hidden');
    if (dcont) dcont.classList.add('hidden');
    const mrow = document.querySelector('.month-row');
    const srow = document.querySelector('.slider-row');
    const darrow = document.querySelector('.day-arrow-row');
    if (mrow) mrow.classList.add('hidden');
    if (srow) srow.classList.add('hidden');
    if (darrow) darrow.classList.add('hidden');
    const exportArea = document.getElementById('exportArea');
    if (exportArea) exportArea.classList.add('hidden');
  } catch {}
}

function showResults() {
  try {
    const resultsArea = document.getElementById('resultsArea');
    if (resultsArea) resultsArea.classList.remove('hidden');
    statsEl.classList.remove('hidden');
    const mcont = monthlyProfileChartCanvas && monthlyProfileChartCanvas.closest('.chart-container');
    const dcont = dailyProfileChartCanvas && dailyProfileChartCanvas.closest('.chart-container');
    if (mcont) mcont.classList.remove('hidden');
    if (dcont) dcont.classList.remove('hidden');
    const mrow = document.querySelector('.month-row');
    const srow = document.querySelector('.slider-row');
    const darrow = document.querySelector('.day-arrow-row');
    if (mrow) mrow.classList.remove('hidden');
    if (srow) srow.classList.remove('hidden');
    if (darrow) darrow.classList.remove('hidden');
    const exportArea = document.getElementById('exportArea');
    if (exportArea) exportArea.classList.remove('hidden');
  } catch {}
}

function formatDayLabel(dayKey) {
  const [year, month, day] = dayKey.split('-').map(Number);
  if (!year || !month || !day) {
    return dayKey;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function initMap() {
  if (typeof L === 'undefined') {
    mapHintEl.textContent = 'Carte non disponible (Leaflet non chargé).';
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
    if (suppressMapClick) {
      // ignore this click because it was generated by a handle drag release
      suppressMapClick = false;
      return;
    }
    const { lat, lng } = event.latlng;
    // Correction: Leaflet gère le shift pour zoom/crop, donc on utilise ctrl+clic pour la rotation azimut
    const isCtrlClick = Boolean(event.originalEvent?.ctrlKey);
    if (isCtrlClick && marker) {
      const markerLatLng = marker.getLatLng();
      const bearing = bearingBetweenPoints(
        markerLatLng.lat,
        markerLatLng.lng,
        lat,
        lng
      );
      azimuthInput.value = String(azimuthNorthClockwiseToAzimuthSouth(bearing));
      setAutoOppositeAzimuth();
      updateAzimuthArrowFromInputs();
      mapHintEl.textContent = `Azimut ajusté depuis la carte (${azimuthInput.value}°). (Ctrl+clic)`;
      return;
    }

    latInput.value = lat.toFixed(5);
    lonInput.value = lng.toFixed(5);
    placeOrMoveMarker(lat, lng);
    updateAzimuthArrowFromInputs();
    mapHintEl.textContent = `Point sélectionné : ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  });

  if (!Number.isNaN(Number(latInput.value)) && !Number.isNaN(Number(lonInput.value))) {
    updateMapFromInputs();
  }
}

function placeOrMoveMarker(lat, lon) {
  if (!map) {
    return;
  }

  if (!marker) {
    marker = L.marker([lat, lon]).addTo(map);
  } else {
    marker.setLatLng([lat, lon]);
  }
}

function updateMapFromInputs(centerMap = false) {
  if (!map) {
    return;
  }

  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);

  if (Number.isNaN(lat) || Number.isNaN(lon)) {
    return;
  }

  placeOrMoveMarker(lat, lon);
  updateAzimuthArrowFromInputs();
  mapHintEl.textContent = `Point sélectionné : ${lat.toFixed(5)}, ${lon.toFixed(5)}`;

  if (centerMap) {
    map.setView([lat, lon], 10);
  }
}

function updateAzimuthArrowFromInputs() {
  if (!map) {
    return;
  }

  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  const azimuthSouth = Number(azimuthInput.value);
  const azimuthSouth2 = Number(azimuth2Input.value);
  const compareEnabled = compareAzimuthCheckbox.checked && !azimuth2Input.disabled;

  if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(azimuthSouth)) {
    clearAzimuthArrow();
    return;
  }

  const primaryLayers = updateArrowLayer(
    lat,
    lon,
    azimuthSouth,
    '#ef4444',
    azimuthShaft,
    azimuthHead,
    azimuthHandle
  );
  azimuthShaft = primaryLayers.shaft;
  azimuthHead = primaryLayers.head;
  azimuthHandle = primaryLayers.handle;

  if (compareEnabled && !Number.isNaN(azimuthSouth2)) {
    const secondaryLayers = updateArrowLayer(
      lat,
      lon,
      azimuthSouth2,
      '#2563eb',
      azimuthSecondaryShaft,
      azimuthSecondaryHead,
      azimuthSecondaryHandle
    );
    azimuthSecondaryShaft = secondaryLayers.shaft;
    azimuthSecondaryHead = secondaryLayers.head;
    azimuthSecondaryHandle = secondaryLayers.handle;
  } else {
    clearSecondaryAzimuthArrow();
  }
}

function clearAzimuthArrow() {
  if (azimuthShaft) {
    map.removeLayer(azimuthShaft);
    azimuthShaft = null;
  }

  if (azimuthHead) {
    map.removeLayer(azimuthHead);
    azimuthHead = null;
  }

  if (azimuthHandle) {
    map.removeLayer(azimuthHandle);
    azimuthHandle = null;
  }

  clearSecondaryAzimuthArrow();
}

function clearSecondaryAzimuthArrow() {
  if (azimuthSecondaryShaft) {
    map.removeLayer(azimuthSecondaryShaft);
    azimuthSecondaryShaft = null;
  }

  if (azimuthSecondaryHead) {
    map.removeLayer(azimuthSecondaryHead);
    azimuthSecondaryHead = null;
  }
  if (azimuthSecondaryHandle) {
    map.removeLayer(azimuthSecondaryHandle);
    azimuthSecondaryHandle = null;
  }
}

function updateArrowLayer(lat, lon, azimuthSouth, color, shaftLayer, headLayer, handleMarker) {
  // Calculs géométriques d'abord (évite l'utilisation de variables non initialisées)
  const bearing = azimuthSouthToAzimuthNorthClockwise(azimuthSouth);
  // Arrow scale: 0.5 = half size
  const arrowScale = 0.5;
  const tip = destinationPoint(lat, lon, bearing, 220 * arrowScale);
  const leftHead = destinationPoint(tip.lat, tip.lon, bearing + 150, 70 * arrowScale);
  const rightHead = destinationPoint(tip.lat, tip.lon, bearing - 150, 70 * arrowScale);

  // Crée le handle une seule fois et le réutilise
  let handleCreated = false;
  if (!handleMarker) {
    // create a DivIcon so we have a small visible dot and a larger clickable area
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

  const shaftLatLngs = [
    [lat, lon],
    [tip.lat, tip.lon],
  ];

  const headLatLngs = [
    [leftHead.lat, leftHead.lon],
    [tip.lat, tip.lon],
    [rightHead.lat, rightHead.lon],
  ];

  // Flèche
  if (!shaftLayer) {
    shaftLayer = L.polyline(shaftLatLngs, {
      color,
      weight: 3,
      opacity: 0.95,
    }).addTo(map);
  } else {
    shaftLayer.setLatLngs(shaftLatLngs);
  }

  // Tête
  if (!headLayer) {
    headLayer = L.polyline(headLatLngs, {
      color,
      weight: 3,
      opacity: 0.95,
    }).addTo(map);
  } else {
    headLayer.setLatLngs(headLatLngs);
  }

  // Handle interactif (éviter de rattacher plusieurs fois les handlers)
  if (handleCreated) {
    const el = handleMarker.getElement && handleMarker.getElement();
    if (el) {
      L.DomEvent.on(el, 'pointerdown', function (e) {
        if (!map) return;
        // Stopper la propagation et le comportement par défaut
        try {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
        } catch {}

        // Indiquer qu'on doit ignorer le prochain clic map (provoqué par le relâchement)
        suppressMapClick = true;
        // Désactiver temporairement les interactions de la carte
        try {
          map.dragging.disable();
          if (map.doubleClickZoom) map.doubleClickZoom.disable();
          if (map.boxZoom) map.boxZoom.disable();
        } catch {}

        const markerLatLng = marker.getLatLng();

        function onPointerMove(ev) {
          try {
            L.DomEvent.stopPropagation(ev);
            L.DomEvent.preventDefault(ev);
          } catch {}

          const latlng = map.mouseEventToLatLng(ev);
          const bearing = bearingBetweenPoints(
            markerLatLng.lat,
            markerLatLng.lng,
            latlng.lat,
            latlng.lng
          );
          azimuthInput.value = String(azimuthNorthClockwiseToAzimuthSouth(bearing));
          setAutoOppositeAzimuth();
          updateAzimuthArrowFromInputs();
          handleMarker.setLatLng([latlng.lat, latlng.lng]);
          mapHintEl.textContent = `Azimut en cours : ${azimuthInput.value}°`;
        }

        function onPointerUp(ev) {
          try {
            L.DomEvent.stopPropagation(ev);
            L.DomEvent.preventDefault(ev);
          } catch {}

          // Réactiver les interactions après un petit délai pour éviter que Leaflet n'interprète le relâchement comme un drag
          setTimeout(() => {
            try {
              map.dragging.enable();
              if (map.doubleClickZoom) map.doubleClickZoom.enable();
              if (map.boxZoom) map.boxZoom.enable();
            } catch {}
          }, 50);

          // Snap handle exactly to arrow tip
          try {
            handleMarker.setLatLng([tip.lat, tip.lon]);
            updateAzimuthArrowFromInputs();
          } catch {}

          // Toujours supprimer le clic carte généré; laisser une petite fenêtre
          setTimeout(() => {
            suppressMapClick = false;
          }, 300);

          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          mapHintEl.textContent = `Azimut ajusté : ${azimuthInput.value}°`;
        }

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });
    }
  }

  return { shaft: shaftLayer, head: headLayer, handle: handleMarker };
}

function bearingBetweenPoints(lat1, lon1, lat2, lon2) {
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;
  const deltaLonRad = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLonRad) * Math.cos(lat2Rad);
  const x =
    Math.cos(lat1Rad) * Math.sin(lat2Rad) -
    Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(deltaLonRad);

  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  return (bearing + 360) % 360;
}

function destinationPoint(lat, lon, bearingDeg, distanceMeters) {
  const earthRadius = 6371000;
  const bearingRad = (bearingDeg * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const angularDistance = distanceMeters / earthRadius;

  const destLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(angularDistance) +
      Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
  );

  const destLonRad =
    lonRad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
      Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(destLatRad)
    );

  return {
    lat: (destLatRad * 180) / Math.PI,
    lon: (destLonRad * 180) / Math.PI,
  };
}

azimuth2Input.dataset.auto = 'true';
setAutoOppositeAzimuth(true);
initMap();
