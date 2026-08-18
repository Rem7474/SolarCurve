import L from 'leaflet';
import {
  mapHintEl,
  latInput,
  lonInput,
  azimuthInput,
  azimuth2Input,
  compareAzimuthCheckbox,
  mapContainer,
} from '../dom.js';
import { state } from '../state.js';
import { parseDecimal } from '../core/parse.js';
import { bearingBetweenPoints, destinationPoint } from '../core/geo.js';
import {
  azimuthSouthToAzimuthNorthClockwise,
  azimuthNorthClockwiseToAzimuthSouth,
} from '../core/azimuth.js';
import { CHART_COLORS } from './chart-colors.js';
import { setAutoOppositeAzimuth } from './form.js';

export function initMap() {
  const defaultLat = parseDecimal(latInput.value) || 46.5;
  const defaultLon = parseDecimal(lonInput.value) || 2.5;

  state.map = L.map('map').setView([defaultLat, defaultLon], 6);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
    crossOrigin: 'anonymous',
  }).addTo(state.map);

  state.map.on('click', (event) => {
    if (state.suppressMapClick) {
      state.suppressMapClick = false;
      return;
    }

    const { lat, lng } = event.latlng;
    const isCtrlClick = Boolean(event.originalEvent?.ctrlKey);

    if (isCtrlClick && state.marker) {
      const ml = state.marker.getLatLng();
      const bearing = bearingBetweenPoints(ml.lat, ml.lng, lat, lng);
      azimuthInput.value = String(azimuthNorthClockwiseToAzimuthSouth(bearing));
      setAutoOppositeAzimuth();
      updateAzimuthArrowFromInputs();
      if (mapHintEl)
        mapHintEl.textContent = `Azimut ajusté depuis la carte (${azimuthInput.value}°)`;
      return;
    }

    latInput.value = lat.toFixed(5);
    lonInput.value = lng.toFixed(5);
    placeOrMoveMarker(lat, lng);
    updateAzimuthArrowFromInputs();
    if (mapHintEl)
      mapHintEl.textContent = `Point sélectionné : ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  });

  if (!Number.isNaN(parseDecimal(latInput.value)) && !Number.isNaN(parseDecimal(lonInput.value))) {
    updateMapFromInputs();
  }
}

function createMapMarkerIcon() {
  return L.divIcon({
    className: 'sc-map-marker',
    html: '<span style="display:block;width:16px;height:16px;border-radius:50%;background:#f59e0b;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></span>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

export function placeOrMoveMarker(lat, lon) {
  if (!state.map) return;
  if (!state.marker)
    state.marker = L.marker([lat, lon], { icon: createMapMarkerIcon() }).addTo(state.map);
  else state.marker.setLatLng([lat, lon]);
}

export function updateMapFromInputs(centerMap = false) {
  if (!state.map) return;
  const lat = parseDecimal(latInput.value);
  const lon = parseDecimal(lonInput.value);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return;

  placeOrMoveMarker(lat, lon);
  updateAzimuthArrowFromInputs();
  if (mapHintEl) mapHintEl.textContent = `Point sélectionné : ${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  if (centerMap) state.map.setView([lat, lon], 10);
}

export function updateAzimuthArrowFromInputs() {
  if (!state.map) return;
  const lat = parseDecimal(latInput.value);
  const lon = parseDecimal(lonInput.value);
  const azS = Number(azimuthInput.value);
  const azS2 = Number(azimuth2Input.value);
  const compareEnabled = compareAzimuthCheckbox.checked && !azimuth2Input.disabled;

  if (Number.isNaN(lat) || Number.isNaN(lon) || Number.isNaN(azS)) {
    clearAzimuthArrow();
    return;
  }

  const prim = updateArrowLayer(
    lat,
    lon,
    azS,
    CHART_COLORS.primary,
    state.azimuthShaft,
    state.azimuthHead,
    state.azimuthHandle
  );
  state.azimuthShaft = prim.shaft;
  state.azimuthHead = prim.head;
  state.azimuthHandle = prim.handle;

  if (compareEnabled && !Number.isNaN(azS2)) {
    const sec = updateArrowLayer(
      lat,
      lon,
      azS2,
      CHART_COLORS.secondary,
      state.azimuthSecondaryShaft,
      state.azimuthSecondaryHead,
      state.azimuthSecondaryHandle
    );
    state.azimuthSecondaryShaft = sec.shaft;
    state.azimuthSecondaryHead = sec.head;
    state.azimuthSecondaryHandle = sec.handle;
  } else {
    clearSecondaryAzimuthArrow();
  }
}

function clearAzimuthArrow() {
  [state.azimuthShaft, state.azimuthHead, state.azimuthHandle].forEach((l) => {
    if (l) state.map.removeLayer(l);
  });
  state.azimuthShaft = state.azimuthHead = state.azimuthHandle = null;
  clearSecondaryAzimuthArrow();
}

function clearSecondaryAzimuthArrow() {
  [state.azimuthSecondaryShaft, state.azimuthSecondaryHead, state.azimuthSecondaryHandle].forEach(
    (l) => {
      if (l) state.map.removeLayer(l);
    }
  );
  state.azimuthSecondaryShaft = state.azimuthSecondaryHead = state.azimuthSecondaryHandle = null;
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
    handleMarker = L.marker([tip.lat, tip.lon], { icon, interactive: true }).addTo(state.map);
    handleCreated = true;
  } else {
    handleMarker.setLatLng([tip.lat, tip.lon]);
  }

  const shaftLL = [
    [lat, lon],
    [tip.lat, tip.lon],
  ];
  const headLL = [
    [leftHead.lat, leftHead.lon],
    [tip.lat, tip.lon],
    [rightHead.lat, rightHead.lon],
  ];

  if (!shaftLayer)
    shaftLayer = L.polyline(shaftLL, {
      color,
      weight: 4.5,
      opacity: 0.92,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(state.map);
  else shaftLayer.setLatLngs(shaftLL);

  if (!headLayer)
    headLayer = L.polyline(headLL, {
      color,
      weight: 4.5,
      opacity: 0.92,
      lineCap: 'round',
      lineJoin: 'round',
    }).addTo(state.map);
  else headLayer.setLatLngs(headLL);

  if (handleCreated) {
    const el = handleMarker.getElement && handleMarker.getElement();
    if (el) {
      L.DomEvent.on(el, 'pointerdown', function (e) {
        if (!state.map) return;
        try {
          L.DomEvent.stopPropagation(e);
          L.DomEvent.preventDefault(e);
        } catch {
          /* ignore */
        }
        state.suppressMapClick = true;
        try {
          state.map.dragging.disable();
          state.map.doubleClickZoom?.disable();
          state.map.boxZoom?.disable();
        } catch {
          /* ignore */
        }
        const markerLL = state.marker.getLatLng();

        function onPointerMove(ev) {
          try {
            L.DomEvent.stopPropagation(ev);
            L.DomEvent.preventDefault(ev);
          } catch {
            /* ignore */
          }
          const ll = state.map.mouseEventToLatLng(ev);
          const b = bearingBetweenPoints(markerLL.lat, markerLL.lng, ll.lat, ll.lng);
          azimuthInput.value = String(azimuthNorthClockwiseToAzimuthSouth(b));
          setAutoOppositeAzimuth();
          updateAzimuthArrowFromInputs();
          handleMarker.setLatLng([ll.lat, ll.lng]);
          if (mapHintEl) mapHintEl.textContent = `Azimut en cours : ${azimuthInput.value}°`;
        }

        function onPointerUp() {
          setTimeout(() => {
            try {
              state.map.dragging.enable();
              state.map.doubleClickZoom?.enable();
              state.map.boxZoom?.enable();
            } catch {
              /* ignore */
            }
          }, 50);
          try {
            handleMarker.setLatLng([tip.lat, tip.lon]);
            updateAzimuthArrowFromInputs();
          } catch {
            /* ignore */
          }
          setTimeout(() => {
            state.suppressMapClick = false;
          }, 300);
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

function waitForMapTiles(mapElement, timeoutMs = 3500) {
  const pendingTiles = Array.from(
    mapElement.querySelectorAll('.leaflet-tile-pane img.leaflet-tile')
  ).filter((tile) => !tile.classList.contains('leaflet-tile-loaded'));

  if (pendingTiles.length === 0) return Promise.resolve();

  return new Promise((resolve) => {
    let remaining = pendingTiles.length;
    let finished = false;
    let timer = null;

    const done = () => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      resolve();
    };

    const onTileSettled = () => {
      remaining -= 1;
      if (remaining <= 0) done();
    };

    timer = setTimeout(done, timeoutMs);
    pendingTiles.forEach((tile) => {
      tile.addEventListener('load', onTileSettled, { once: true });
      tile.addEventListener('error', onTileSettled, { once: true });
    });
  });
}

export async function captureMapForPDF() {
  if (!state.map) return null;
  const mapElement = mapContainer;
  if (!mapElement) return null;

  const targetZoom = 16;

  try {
    // Centre la carte sur le marker pour le PDF
    if (state.marker) {
      const markerPos = state.marker.getLatLng();
      state.map.setView(markerPos, targetZoom, { animate: false });
    } else {
      state.map.setZoom(targetZoom, { animate: false });
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
    state.map.invalidateSize();
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Force le repositionnement des overlays
    updateAzimuthArrowFromInputs();

    // Attente des tuiles
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await waitForMapTiles(mapElement, 5000);
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Canvas manuel car html2canvas ne peut pas capturer les tuiles cross-origin
    const scale = 2;
    const width = mapElement.offsetWidth;
    const height = mapElement.offsetHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;

    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const tiles = mapElement.querySelectorAll('.leaflet-tile-pane img.leaflet-tile');
    const mapRect = mapElement.getBoundingClientRect();

    for (const tile of tiles) {
      if (!tile.complete || !tile.naturalWidth) continue;

      const tileRect = tile.getBoundingClientRect();
      const x = (tileRect.left - mapRect.left) * scale;
      const y = (tileRect.top - mapRect.top) * scale;
      const w = tileRect.width * scale;
      const h = tileRect.height * scale;

      try {
        ctx.drawImage(tile, x, y, w, h);
      } catch (e) {
        console.warn('Could not draw tile:', e);
      }
    }

    const drawArrow = (polylineShaft, polylineHead, color, width) => {
      if (!polylineShaft || !polylineHead) return;

      try {
        const shaftLatLngs = polylineShaft.getLatLngs();
        const headLatLngs = polylineHead.getLatLngs();

        if (shaftLatLngs.length < 2 || headLatLngs.length < 2) return;

        ctx.strokeStyle = color;
        ctx.lineWidth = width * scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        ctx.beginPath();
        const shaftStart = state.map.latLngToContainerPoint(shaftLatLngs[0]);
        ctx.moveTo(shaftStart.x * scale, shaftStart.y * scale);
        for (let i = 1; i < shaftLatLngs.length; i++) {
          const pt = state.map.latLngToContainerPoint(shaftLatLngs[i]);
          ctx.lineTo(pt.x * scale, pt.y * scale);
        }
        ctx.stroke();

        ctx.beginPath();
        const headStart = state.map.latLngToContainerPoint(headLatLngs[0]);
        ctx.moveTo(headStart.x * scale, headStart.y * scale);
        for (let i = 1; i < headLatLngs.length; i++) {
          const pt = state.map.latLngToContainerPoint(headLatLngs[i]);
          ctx.lineTo(pt.x * scale, pt.y * scale);
        }
        ctx.stroke();
      } catch (e) {
        console.error('Failed to draw arrow:', e);
      }
    };

    if (state.azimuthShaft && state.azimuthHead) {
      drawArrow(state.azimuthShaft, state.azimuthHead, CHART_COLORS.primary, 3);
    }

    if (state.azimuthSecondaryShaft && state.azimuthSecondaryHead) {
      drawArrow(state.azimuthSecondaryShaft, state.azimuthSecondaryHead, CHART_COLORS.secondary, 3);
    }

    if (state.marker) {
      try {
        const pos = state.marker.getLatLng();
        const point = state.map.latLngToContainerPoint(pos);
        const canvasX = point.x * scale;
        const canvasY = point.y * scale;

        ctx.save();
        ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
        ctx.shadowBlur = 4 * scale;
        ctx.shadowOffsetY = 1 * scale;

        ctx.beginPath();
        ctx.arc(canvasX, canvasY, 8 * scale, 0, 2 * Math.PI);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();

        ctx.shadowColor = 'transparent';
        ctx.lineWidth = 2 * scale;
        ctx.strokeStyle = '#ffffff';
        ctx.stroke();
        ctx.restore();
      } catch (e) {
        console.error('Failed to draw marker:', e);
      }
    }

    return canvas.toDataURL('image/png', 0.95);
  } catch (err) {
    console.error('Map capture error:', err);
    return null;
  }
}
