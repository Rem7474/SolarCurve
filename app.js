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
const mapHintEl = document.getElementById('mapHint');

let dailyProfileChart;
let currentHourlyEntries = [];
let currentDailyData = [];
let map;
let marker;
let azimuthShaft;
let azimuthHead;

sourceSelect.addEventListener('change', () => {
  pvwattsKeyWrapper.classList.toggle('hidden', sourceSelect.value !== 'pvwatts');
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
    const result =
      params.source === 'pvgis' ? await fetchFromPVGIS(params) : await fetchFromPVWatts(params);
    const { dailyData, hourlyEntries } = result;

    if (!dailyData.length) {
      throw new Error('Aucune donnée de production reçue.');
    }

    currentHourlyEntries = hourlyEntries;
    currentDailyData = dailyData;
    renderStats(dailyData);
    daySlider.disabled = false;
    daySlider.min = '1';
    daySlider.max = String(dailyData.length);
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

function getInputs() {
  const lat = Number(latInput.value);
  const lon = Number(lonInput.value);
  const peakPower = Number(document.getElementById('peakPower').value);
  const tilt = Number(document.getElementById('tilt').value);
  const azimuth = Number(document.getElementById('azimuth').value);
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

  return {
    lat,
    lon,
    peakPower,
    tilt,
    azimuth,
    losses,
    source,
    pvwattsKey,
  };
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

function updateSelectedDayChart() {
  const selectedIndex = Number(daySlider.value) - 1;
  if (!currentHourlyEntries.length || !currentDailyData.length || Number.isNaN(selectedIndex)) {
    return;
  }

  const selectedDay = currentDailyData[selectedIndex];
  if (!selectedDay) {
    return;
  }

  dayLabel.textContent = formatDayLabel(selectedDay.day);

  const selectedProfile = buildSpecificDayProfile(currentHourlyEntries, selectedDay.day);
  const juneLimit = buildSpecificDayProfile(currentHourlyEntries, '2020-06-21');
  const decemberLimit = buildSpecificDayProfile(currentHourlyEntries, '2020-12-21');
  const labels = Array.from({ length: 24 }, (_, hour) => `${String(hour).padStart(2, '0')}h`);

  if (dailyProfileChart) {
    dailyProfileChart.data.labels = labels;
    dailyProfileChart.data.datasets[0].data = selectedProfile;
    dailyProfileChart.data.datasets[0].label = `Jour sélectionné (${dayLabel.textContent})`;
    dailyProfileChart.data.datasets[1].data = juneLimit;
    dailyProfileChart.data.datasets[2].data = decemberLimit;
    dailyProfileChart.update();
    return;
  }

  dailyProfileChart = new Chart(dailyProfileChartCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: `Jour sélectionné (${dayLabel.textContent})`,
          data: selectedProfile,
          borderWidth: 2.2,
          tension: 0.2,
          pointRadius: 0,
        },
        {
          label: 'Limite été (21 juin)',
          data: juneLimit,
          borderWidth: 1.8,
          borderDash: [8, 4],
          tension: 0.2,
          pointRadius: 0,
        },
        {
          label: 'Limite hiver (21 décembre)',
          data: decemberLimit,
          borderWidth: 1.8,
          borderDash: [4, 4],
          tension: 0.2,
          pointRadius: 0,
        },
      ],
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

function buildSpecificDayProfile(hourlyEntries, dayKey) {
  const profile = Array.from({ length: 24 }, () => 0);

  for (const entry of hourlyEntries) {
    if (entry.dayKey === dayKey) {
      profile[entry.hour] += entry.kwh;
    }
  }

  return profile.map((value) => Number(value.toFixed(3)));
}

function renderStats(dailyData) {
  const total = dailyData.reduce((acc, row) => acc + row.kwh, 0);
  const avg = total / dailyData.length;

  const sortedByKwh = [...dailyData].sort((a, b) => a.kwh - b.kwh);
  const min = sortedByKwh[0];
  const max = sortedByKwh[sortedByKwh.length - 1];

  statsEl.innerHTML = [
    statCard('Total annuel', `${total.toFixed(1)} kWh`),
    statCard('Moyenne/jour', `${avg.toFixed(2)} kWh`),
    statCard('Jour le plus faible', `${min.day} · ${min.kwh.toFixed(2)} kWh`),
    statCard('Jour le plus productif', `${max.day} · ${max.kwh.toFixed(2)} kWh`),
  ].join('');
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

  if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(azimuthSouth)) {
    clearAzimuthArrow();
    return;
  }

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

  if (!azimuthShaft) {
    azimuthShaft = L.polyline(shaftLatLngs, {
      color: '#ef4444',
      weight: 3,
      opacity: 0.95,
    }).addTo(map);
  } else {
    azimuthShaft.setLatLngs(shaftLatLngs);
  }

  if (!azimuthHead) {
    azimuthHead = L.polyline(headLatLngs, {
      color: '#ef4444',
      weight: 3,
      opacity: 0.95,
    }).addTo(map);
  } else {
    azimuthHead.setLatLngs(headLatLngs);
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

initMap();
