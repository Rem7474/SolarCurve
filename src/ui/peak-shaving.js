import { Chart } from 'chart.js/auto';
import {
  peakShavingSection,
  peakShavingStatsEl,
  peakShavingChartCanvas,
  consumptionPowerInputEl,
} from '../dom.js';
import { state } from '../state.js';
import { statCard } from './stats.js';

export function updatePeakShavingDisplay() {
  const consumptionPowerW = Number(consumptionPowerInputEl.value);
  if (!consumptionPowerW || consumptionPowerW <= 0) {
    peakShavingSection.classList.add('hidden');
    return;
  }

  const consumptionPowerKW = consumptionPowerW / 1000; // W -> kW
  peakShavingSection.classList.remove('hidden');

  // Combine les données horaires des deux azimuts si présentes
  const hourlyData = [...state.primaryHourlyEntries];
  if (state.secondaryHourlyEntries.length) {
    const map = new Map();
    for (const e of hourlyData) {
      const key = `${e.dayKey}:${e.hour}`;
      map.set(key, (map.get(key) ?? 0) + e.kwh);
    }
    for (const e of state.secondaryHourlyEntries) {
      const key = `${e.dayKey}:${e.hour}`;
      map.set(key, (map.get(key) ?? 0) + e.kwh);
    }
    hourlyData.length = 0;
    for (const [key, kwh] of map) {
      const [dayKey, hour] = key.split(':');
      const month = Number(dayKey.split('-')[1]);
      hourlyData.push({ dayKey, month, hour: Number(hour), kwh });
    }
  }

  const yearSet = new Set();
  for (const e of hourlyData) {
    const year = Number(String(e.dayKey).slice(0, 4));
    if (!Number.isNaN(year)) yearSet.add(year);
  }
  const yearsFactor = Math.max(1, yearSet.size);

  // Effacement (production utilisée pour couvrir la conso) et surplus, par mois
  const shavingByMonth = Array.from({ length: 12 }, () => 0);
  const surplusByMonth = Array.from({ length: 12 }, () => 0);
  for (const e of hourlyData) {
    const hourlyConsumption = consumptionPowerKW; // kW
    const hourlyProduction = e.kwh; // déjà en kWh/heure donc équivalent kW
    const shaved = Math.min(hourlyProduction, hourlyConsumption);
    const surplus = Math.max(0, hourlyProduction - hourlyConsumption);
    shavingByMonth[e.month - 1] += shaved;
    surplusByMonth[e.month - 1] += surplus;
  }

  if (yearsFactor > 1) {
    for (let m = 0; m < 12; m++) {
      shavingByMonth[m] /= yearsFactor;
      surplusByMonth[m] /= yearsFactor;
    }
  }

  // Consommation restante (non couverte par la production)
  const DAYS_IN_MONTH = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const consumptionByMonth = Array.from(
    { length: 12 },
    (_, m) => consumptionPowerKW * 24 * DAYS_IN_MONTH[m]
  );
  const remainingByMonth = Array.from({ length: 12 }, () => 0);
  for (let m = 0; m < 12; m++) {
    remainingByMonth[m] = Math.max(0, consumptionByMonth[m] - shavingByMonth[m]);
  }

  const totalShaved = shavingByMonth.reduce((a, b) => a + b, 0);
  const totalSurplus = surplusByMonth.reduce((a, b) => a + b, 0);
  const totalConsumption = consumptionPowerKW * 24 * 365.25;
  const totalProduction = totalShaved + totalSurplus;
  const shavingPct = totalProduction > 0 ? (totalShaved / totalProduction) * 100 : 0;
  const coveragePct = totalConsumption > 0 ? (totalShaved / totalConsumption) * 100 : 0;

  const MONTHS_SHORT = [
    'Jan',
    'Fév',
    'Mar',
    'Avr',
    'Mai',
    'Jun',
    'Jul',
    'Aoû',
    'Sep',
    'Oct',
    'Nov',
    'Déc',
  ];
  const monthlyRatesHtml = MONTHS_SHORT.map((month, idx) => {
    const prodMonth = shavingByMonth[idx] + surplusByMonth[idx];
    const rateMonth = prodMonth > 0 ? (shavingByMonth[idx] / prodMonth) * 100 : 0;
    return `<span style="display:inline-block; margin-right:12px; margin-bottom:6px; padding:4px 8px; background:#f0fdf4; border-radius:4px; font-size:11px;"><strong>${month}</strong> ${rateMonth.toFixed(1)}%</span>`;
  }).join('');

  const monthlyCoverageHtml = MONTHS_SHORT.map((month, idx) => {
    const coverageMonth =
      consumptionByMonth[idx] > 0 ? (shavingByMonth[idx] / consumptionByMonth[idx]) * 100 : 0;
    return `<span style="display:inline-block; margin-right:12px; margin-bottom:6px; padding:4px 8px; background:#eff6ff; border-radius:4px; font-size:11px;"><strong>${month}</strong> ${coverageMonth.toFixed(1)}%</span>`;
  }).join('');

  peakShavingStatsEl.innerHTML = [
    statCard('Autoconsommé', `${totalShaved.toFixed(1)} kWh`),
    statCard("Taux d'autoconsommation", `${shavingPct.toFixed(1)} %`),
    statCard('Taux de couverture solaire', `${coveragePct.toFixed(1)} %`),
    statCard('Surplus (non utilisé)', `${totalSurplus.toFixed(1)} kWh`),
    `<div style="margin-top:12px; padding-top:12px; border-top:1px solid #e2e8f0;"><p style="margin:0 0 8px 0; font-size:12px; color:#64748b;"><strong>Taux d'autoconsommation mensuel:</strong></p><div>${monthlyRatesHtml}</div><p style="margin:10px 0 8px 0; font-size:12px; color:#64748b;"><strong>Taux de couverture solaire mensuel:</strong></p><div>${monthlyCoverageHtml}</div></div>`,
  ].join('');

  // Le canvas doit être visible (section démasquée juste au-dessus) avant que Chart.js
  // ne mesure ses dimensions ; on laisse le navigateur terminer le reflow d'abord.
  setTimeout(() => {
    renderPeakShavingChart(shavingByMonth, remainingByMonth);
  }, 100);
}

function renderPeakShavingChart(shavingByMonth, remainingByMonth) {
  if (!peakShavingChartCanvas) {
    console.warn('peakShavingChartCanvas not found');
    return;
  }

  if (state.peakShavingChart) {
    state.peakShavingChart.destroy();
  }

  const MONTHS_SHORT = [
    'Jan',
    'Fév',
    'Mar',
    'Avr',
    'Mai',
    'Jun',
    'Jul',
    'Aoû',
    'Sep',
    'Oct',
    'Nov',
    'Déc',
  ];

  state.peakShavingChart = new Chart(peakShavingChartCanvas, {
    type: 'bar',
    data: {
      labels: MONTHS_SHORT,
      datasets: [
        {
          label: 'Effacement',
          data: shavingByMonth,
          backgroundColor: '#059669',
          borderRadius: 0,
          borderWidth: 0,
        },
        {
          label: 'Consommation restante',
          data: remainingByMonth,
          backgroundColor: '#cbd5e1',
          borderRadius: 0,
          borderWidth: 0,
        },
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
        y: {
          stacked: true,
          title: { display: true, text: 'kWh', font: { size: 12 } },
          grid: { color: 'rgba(0,0,0,.06)' },
          ticks: { font: { size: 11 } },
        },
      },
    },
  });
}
