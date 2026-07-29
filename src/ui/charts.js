import { Chart } from 'chart.js/auto';
import {
  dailyProfileChartCanvas,
  monthlyProfileChartCanvas,
  daySlider,
  dayLabel,
  monthSelect,
  prevDayBtn,
  nextDayBtn,
} from '../dom.js';
import { state } from '../state.js';
import {
  buildSpecificDayProfile,
  buildMonthlyAverageProfile,
  sumProfiles,
} from '../core/solar-data.js';
import { CHART_COLORS } from './chart-colors.js';

export function chartOptions(yLabel) {
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

export function formatDayLabel(dayKey) {
  const [year, month, day] = dayKey.split('-').map(Number);
  if (!year || !month || !day) return dayKey;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export function updateDayButtonsState() {
  if (!daySlider) return;
  const min = Number(daySlider.min || 1);
  const max = Number(daySlider.max || 1);
  const val = Number(daySlider.value || min);
  if (prevDayBtn) prevDayBtn.disabled = val <= min || daySlider.disabled;
  if (nextDayBtn) nextDayBtn.disabled = val >= max || daySlider.disabled;
}

function buildDailyDatasets(selectedProfile, secondaryProfile, juneLimit, decemberLimit) {
  const datasets = [
    {
      label: `Azimut ${state.primaryAzimuth}° (${dayLabel.textContent})`,
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
        label: `Azimut ${state.secondaryAzimuth}° (${dayLabel.textContent})`,
        data: secondaryProfile,
        borderWidth: 2,
        borderColor: CHART_COLORS.secondary,
        borderDash: [10, 4],
        tension: 0.3,
        pointRadius: 0,
        fill: false,
      },
      {
        label: `Somme (${state.primaryAzimuth}° + ${state.secondaryAzimuth}°)`,
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

export function updateSelectedDayChart() {
  const selectedIndex = Number(daySlider.value) - 1;
  if (
    !state.primaryHourlyEntries.length ||
    !state.primaryDailyData.length ||
    Number.isNaN(selectedIndex)
  )
    return;

  const selectedDay = state.primaryDailyData[selectedIndex];
  if (!selectedDay) return;

  dayLabel.textContent = formatDayLabel(selectedDay.day);

  const selectedProfile = buildSpecificDayProfile(state.primaryHourlyEntries, selectedDay.day);
  const secondaryProfile = state.secondaryHourlyEntries.length
    ? buildSpecificDayProfile(state.secondaryHourlyEntries, selectedDay.day)
    : null;
  const juneLimit = buildSpecificDayProfile(state.primaryHourlyEntries, '2020-06-21');
  const decemberLimit = buildSpecificDayProfile(state.primaryHourlyEntries, '2020-12-21');
  const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}h`);
  const datasets = buildDailyDatasets(selectedProfile, secondaryProfile, juneLimit, decemberLimit);

  if (state.dailyProfileChart) {
    state.dailyProfileChart.data.labels = labels;
    state.dailyProfileChart.data.datasets = datasets;
    state.dailyProfileChart.update();
    return;
  }

  state.dailyProfileChart = new Chart(dailyProfileChartCanvas, {
    type: 'line',
    data: { labels, datasets },
    options: chartOptions('kWh / heure'),
  });
}

export function updateMonthlyChart() {
  if (!monthlyProfileChartCanvas) return;
  const selectedMonth = Number(monthSelect?.value) || 6;

  const primaryMonthly = buildMonthlyAverageProfile(state.primaryHourlyEntries, selectedMonth);
  const secondaryMonthly = state.secondaryHourlyEntries.length
    ? buildMonthlyAverageProfile(state.secondaryHourlyEntries, selectedMonth)
    : null;

  const datasets = [
    {
      label: `Azimut ${state.primaryAzimuth}° (mois ${selectedMonth})`,
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
        label: `Azimut ${state.secondaryAzimuth}° (mois ${selectedMonth})`,
        data: secondaryMonthly,
        borderWidth: 2,
        borderColor: CHART_COLORS.secondary,
        borderDash: [10, 4],
        tension: 0.3,
        pointRadius: 0,
        fill: false,
      },
      {
        label: `Somme (${state.primaryAzimuth}° + ${state.secondaryAzimuth}°)`,
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

  if (state.monthlyProfileChart) {
    state.monthlyProfileChart.data.labels = labels;
    state.monthlyProfileChart.data.datasets = datasets;
    state.monthlyProfileChart.update();
    return;
  }

  state.monthlyProfileChart = new Chart(monthlyProfileChartCanvas, {
    type: 'line',
    data: { labels, datasets },
    options: chartOptions('kWh / heure'),
  });
}
