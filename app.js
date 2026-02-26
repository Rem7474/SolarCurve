const form = document.getElementById('pv-form');
const sourceSelect = document.getElementById('source');
const pvwattsKeyWrapper = document.getElementById('pvwatts-key-wrapper');
const geoBtn = document.getElementById('geo-btn');
const estimateBtn = document.getElementById('estimate-btn');
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const dailyProfileChartCanvas = document.getElementById('dailyProfileChart');
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
});

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
  const peakPower = Number(document.getElementById('peakPower').value);
  const tilt = Number(document.getElementById('tilt').value);
  const azimuth = Number(document.getElementById('azimuth').value);
  const compareAzimuth = compareAzimuthCheckbox.checked;
  const azimuth2 = Number(azimuth2Input.value);
  const losses = Number(document.getElementById('losses').value);
  const source = sourceSelect.value;
  const pvwattsKey = document.getElementById('pvwattsKey').value.trim();

  if ([lat, lon, peakPower, tilt, azimuth, losses].some((value) => Number.isNaN(value))) {
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

  if (peakPower <= 0 || losses < 0 || losses > 100) {
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

function buildDailyDatasets(selectedProfile, secondaryProfile, juneLimit, decemberLimit) {
  const datasets = [
    {
      label: `Azimut ${currentPrimaryAzimuth}° (${dayLabel.textContent})`,
      data: selectedProfile,
      borderWidth: 2.2,
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
      borderDash: [10, 4],
      tension: 0.2,
      pointRadius: 0,
    });

    datasets.push({
      label: `Somme (${currentPrimaryAzimuth}° + ${currentSecondaryAzimuth}°)`,
      data: summedProfile,
      borderWidth: 2.4,
      tension: 0.2,
      pointRadius: 0,
    });
  }

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

  if (secondaryDailyData?.length) {
    const total2 = secondaryDailyData.reduce((acc, row) => acc + row.kwh, 0);
    const delta = total2 - total;
    cards.push(
      statCard(
        `Écart annuel (azimut ${currentSecondaryAzimuth}° - ${currentPrimaryAzimuth}°)`,
        `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} kWh`
      )
    );
  }

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
  estimateBtn.textContent = isLoading ? 'Calcul...' : 'Estimer la courbe journalière';
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

  const defaultLat = Number(latInput.value) || 42.7;
  const defaultLon = Number(lonInput.value) || 9.45;

  map = L.map('map').setView([defaultLat, defaultLon], 8);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  map.on('click', (event) => {
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
    map.setView([lat, lon], 12);
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
    azimuthHead
  );
  azimuthShaft = primaryLayers.shaft;
  azimuthHead = primaryLayers.head;

  if (compareEnabled && !Number.isNaN(azimuthSouth2)) {
    const secondaryLayers = updateArrowLayer(
      lat,
      lon,
      azimuthSouth2,
      '#2563eb',
      azimuthSecondaryShaft,
      azimuthSecondaryHead
    );
    azimuthSecondaryShaft = secondaryLayers.shaft;
    azimuthSecondaryHead = secondaryLayers.head;
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
}

function updateArrowLayer(lat, lon, azimuthSouth, color, shaftLayer, headLayer) {
  const bearing = azimuthSouthToAzimuthNorthClockwise(azimuthSouth);
  const tip = destinationPoint(lat, lon, bearing, 220);
  const leftHead = destinationPoint(tip.lat, tip.lon, bearing + 150, 70);
  const rightHead = destinationPoint(tip.lat, tip.lon, bearing - 150, 70);

  const shaftLatLngs = [
    [lat, lon],
    [tip.lat, tip.lon],
  ];

  const headLatLngs = [
    [leftHead.lat, leftHead.lon],
    [tip.lat, tip.lon],
    [rightHead.lat, rightHead.lon],
  ];

  if (!shaftLayer) {
    shaftLayer = L.polyline(shaftLatLngs, {
      color,
      weight: 3,
      opacity: 0.95,
    }).addTo(map);
    // Ajout d'un event pour rotation par drag
    shaftLayer.on('mousedown', function (e) {
      if (!map) return;
      map.dragging.disable();
      const markerLatLng = marker.getLatLng();
      function onMouseMove(ev) {
        const latlng = map.mouseEventToLatLng(ev.originalEvent || ev);
        const bearing = bearingBetweenPoints(
          markerLatLng.lat,
          markerLatLng.lng,
          latlng.lat,
          latlng.lng
        );
        azimuthInput.value = String(azimuthNorthClockwiseToAzimuthSouth(bearing));
        setAutoOppositeAzimuth();
        updateAzimuthArrowFromInputs();
      }
      function onMouseUp(ev) {
        map.dragging.enable();
        map.off('mousemove', onMouseMove);
        map.off('mouseup', onMouseUp);
      }
      map.on('mousemove', onMouseMove);
      map.on('mouseup', onMouseUp);
    });
  } else {
    shaftLayer.setLatLngs(shaftLatLngs);
  }

  if (!headLayer) {
    headLayer = L.polyline(headLatLngs, {
      color,
      weight: 3,
      opacity: 0.95,
    }).addTo(map);
  } else {
    headLayer.setLatLngs(headLatLngs);
  }

  return { shaft: shaftLayer, head: headLayer };
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
