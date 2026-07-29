import { statsEl } from '../dom.js';
import { state } from '../state.js';

export function statCard(title, value) {
  return `<div class="stat-item"><strong>${title}</strong><span class="stat-value">${value}</span></div>`;
}

export function renderStats(dailyData, secondaryDailyData = null) {
  if (secondaryDailyData?.length) {
    const mapByDay = new Map();
    for (const row of dailyData) mapByDay.set(row.day, (mapByDay.get(row.day) || 0) + row.kwh);
    for (const row of secondaryDailyData)
      mapByDay.set(row.day, (mapByDay.get(row.day) || 0) + row.kwh);

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
      statCard(`Part azimut ${state.primaryAzimuth}°`, `${pct1.toFixed(1)} %`),
      statCard(`Part azimut ${state.secondaryAzimuth}°`, `${pct2.toFixed(1)} %`),
    ].join('');

    if (state.optimizedSplitResult) {
      statsEl.innerHTML += statCard(
        'Répartition Wc optimisée',
        `${Math.round(state.optimizedSplitResult.wc1)} Wc (${state.optimizedSplitResult.az1}°) · ${Math.round(state.optimizedSplitResult.wc2)} Wc (${state.optimizedSplitResult.az2}°)`
      );
    }
    return;
  }

  const total = dailyData.reduce((a, r) => a + r.kwh, 0);
  const avg = total / dailyData.length;
  const sorted = [...dailyData].sort((a, b) => a.kwh - b.kwh);

  statsEl.innerHTML = [
    statCard('Total annuel', `${total.toFixed(1)} kWh`),
    statCard('Moyenne / jour', `${avg.toFixed(2)} kWh`),
    statCard('Jour le plus faible', `${sorted[0].day} · ${sorted[0].kwh.toFixed(2)} kWh`),
    statCard(
      'Jour le plus productif',
      `${sorted[sorted.length - 1].day} · ${sorted[sorted.length - 1].kwh.toFixed(2)} kWh`
    ),
  ].join('');

  if (state.optimizedSplitResult) {
    statsEl.innerHTML += statCard(
      'Répartition Wc optimisée',
      `${Math.round(state.optimizedSplitResult.wc1)} Wc (${state.optimizedSplitResult.az1}°) · ${Math.round(state.optimizedSplitResult.wc2)} Wc (${state.optimizedSplitResult.az2}°)`
    );
  }
}
