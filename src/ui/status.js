import {
  statusEl,
  statusTextEl,
  estimateBtn,
  loadingOverlay,
  resultsArea,
  statsEl,
  exportArea,
} from '../dom.js';

export function setStatus(message, type = '') {
  if (statusTextEl) statusTextEl.textContent = message;
  statusEl.classList.remove('is-error', 'is-success');
  if (type === 'error') statusEl.classList.add('is-error');
  else if (type === 'success') statusEl.classList.add('is-success');
}

export function toggleLoading(isLoading) {
  estimateBtn.disabled = isLoading;
  const span = estimateBtn.querySelector('span');
  if (span) span.textContent = isLoading ? 'Calcul…' : 'Estimer la production';
  if (loadingOverlay) loadingOverlay.classList.toggle('hidden', !isLoading);
}

export function hideResults() {
  try {
    if (resultsArea) resultsArea.classList.add('hidden');
    if (statsEl) statsEl.classList.add('hidden');
    if (exportArea) exportArea.classList.add('hidden');
  } catch {
    /* ignore */
  }
}

export function showResults() {
  try {
    if (resultsArea) resultsArea.classList.remove('hidden');
    if (statsEl) statsEl.classList.remove('hidden');
    if (exportArea) exportArea.classList.remove('hidden');
  } catch {
    /* ignore */
  }
}
