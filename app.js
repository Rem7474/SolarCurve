const form = document.getElementById('pv-form');
const sourceSelect = document.getElementById('source');
const pvwattsKeyWrapper = document.getElementById('pvwatts-key-wrapper');
const geoBtn = document.getElementById('geo-btn');
const estimateBtn = document.getElementById('estimate-btn');
const statusEl = document.getElementById('status');
const statsEl = document.getElementById('stats');
const chartCanvas = document.getElementById('productionChart');

let chart;

sourceSelect.addEventListener('change', () => {
  pvwattsKeyWrapper.classList.toggle('hidden', sourceSelect.value !== 'pvwatts');
});

geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Géolocalisation non supportée par ce navigateur.', true);
    return;
  }

  setStatus('Récupération de votre position GPS...');
  navigator.geolocation.getCurrentPosition(
    (position) => {
      document.getElementById('lat').value = position.coords.latitude.toFixed(5);
      document.getElementById('lon').value = position.coords.longitude.toFixed(5);
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
    const dailyData =
      params.source === 'pvgis' ? await fetchFromPVGIS(params) : await fetchFromPVWatts(params);

    if (!dailyData.length) {
      throw new Error('Aucune donnée de production reçue.');
    }

    renderChart(dailyData);
    renderStats(dailyData);
    setStatus(`Estimation terminée (${params.source.toUpperCase()}).`);
  } catch (error) {
    console.error(error);
    setStatus(`Erreur: ${error.message}`, true);
  } finally {
    toggleLoading(false);
  }
});

function getInputs() {
  const lat = Number(document.getElementById('lat').value);
  const lon = Number(document.getElementById('lon').value);
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

  const url = `https://re.jrc.ec.europa.eu/api/v5_3/seriescalc?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`PVGIS indisponible (${response.status}).`);
  }

  const data = await response.json();
  const hourly = data?.outputs?.hourly;

  if (!Array.isArray(hourly) || hourly.length === 0) {
    throw new Error('Réponse PVGIS invalide.');
  }

  const byDay = new Map();

  for (const row of hourly) {
    const time = row.time;
    const powerW = Number(row.P);
    if (!time || Number.isNaN(powerW)) {
      continue;
    }

    const dayKey = parsePVGISTimeToDayKey(time);
    const prev = byDay.get(dayKey) ?? 0;
    byDay.set(dayKey, prev + powerW / 1000);
  }

  return mapToSortedArray(byDay);
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

  const url = `https://developer.nrel.gov/api/pvwatts/v8.json?${params.toString()}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`PVWatts indisponible (${response.status}).`);
  }

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
  const byDay = new Map();

  for (let i = 0; i < ac.length; i += 1) {
    const powerW = Number(ac[i]);
    if (Number.isNaN(powerW)) {
      continue;
    }

    const date = new Date(Date.UTC(year, 0, 1, 0, 0, 0));
    date.setUTCHours(i);
    const dayKey = date.toISOString().slice(0, 10);

    const prev = byDay.get(dayKey) ?? 0;
    byDay.set(dayKey, prev + powerW / 1000);
  }

  return mapToSortedArray(byDay);
}

function parsePVGISTimeToDayKey(time) {
  if (typeof time === 'string' && time.length >= 8) {
    const yyyy = time.slice(0, 4);
    const mm = time.slice(4, 6);
    const dd = time.slice(6, 8);
    return `${yyyy}-${mm}-${dd}`;
  }
  throw new Error('Format de date PVGIS inattendu.');
}

function mapToSortedArray(dayMap) {
  return [...dayMap.entries()]
    .sort(([dayA], [dayB]) => dayA.localeCompare(dayB))
    .map(([day, value]) => ({ day, kwh: Number(value.toFixed(3)) }));
}

function azimuthSouthToAzimuthNorthClockwise(azimuthSouth) {
  const result = 180 - azimuthSouth;
  return ((result % 360) + 360) % 360;
}

function renderChart(dailyData) {
  const labels = dailyData.map((row) => row.day);
  const values = dailyData.map((row) => row.kwh);

  if (chart) {
    chart.destroy();
  }

  chart = new Chart(chartCanvas, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Production journalière (kWh)',
          data: values,
          borderWidth: 2,
          tension: 0.2,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { maxTicksLimit: 12 },
        },
        y: {
          title: {
            display: true,
            text: 'kWh/jour',
          },
        },
      },
      plugins: {
        legend: {
          display: true,
        },
      },
    },
  });
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
  estimateBtn.textContent = isLoading ? 'Calcul...' : 'Estimer la courbe annuelle';
}
