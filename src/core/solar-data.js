// Agrégation des séries horaires PVGIS/PVWatts en profils journaliers/mensuels,
// et évaluation de la répartition Wc entre deux azimuts. Fonctions pures, sans DOM.

export function aggregateDailyData(hourlyEntries) {
  const byDay = new Map();
  for (const entry of hourlyEntries) {
    byDay.set(entry.dayKey, (byDay.get(entry.dayKey) ?? 0) + entry.kwh);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({ day, kwh: Number(value.toFixed(3)) }));
}

export function buildMonthlyAverageProfile(hourlyEntries, month) {
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

export function buildSpecificDayProfile(hourlyEntries, dayKey) {
  const profile = Array.from({ length: 24 }, () => 0);
  for (const entry of hourlyEntries) {
    if (entry.dayKey === dayKey) profile[entry.hour] += entry.kwh;
  }
  return profile.map((v) => Number(v.toFixed(3)));
}

export function sumProfiles(profileA, profileB) {
  const size = Math.min(profileA.length, profileB.length);
  const output = [];
  for (let i = 0; i < size; i++) output.push(Number((profileA[i] + profileB[i]).toFixed(3)));
  return output;
}

export function computeMonthlyTotalsFromDaily(dailyArray) {
  const months = Array.from({ length: 12 }, () => 0);
  const monthCounts = Array.from({ length: 12 }, () => 0);
  for (const row of dailyArray) {
    const parts = String(row.day).split('-');
    if (parts.length >= 2) {
      const month = Number(parts[1]);
      if (!Number.isNaN(month) && month >= 1 && month <= 12) {
        months[month - 1] += row.kwh;
        monthCounts[month - 1]++;
      }
    }
  }
  // Si les données couvrent plusieurs années (2+ entrées par mois), on moyenne.
  return months.map((total, idx) => {
    const count = monthCounts[idx];
    return count > 1 ? Number((total / 2).toFixed(3)) : Number(total.toFixed(3));
  });
}

export function buildHourlyProductionMap(hourlyEntries) {
  const map = new Map();
  for (const entry of hourlyEntries) {
    const key = `${entry.dayKey}:${entry.hour}`;
    map.set(key, (map.get(key) ?? 0) + entry.kwh);
  }
  return map;
}

export function evaluateSplitCandidate(
  keys,
  primaryMap,
  secondaryMap,
  splitPrimary,
  totalKwp,
  hourlyConsumptionKwh
) {
  let totalSelfConsumed = 0;
  let totalProduction = 0;
  let totalConsumption = 0;

  const splitSecondary = 1 - splitPrimary;

  for (const key of keys) {
    const p1 = primaryMap.get(key) ?? 0;
    const p2 = secondaryMap.get(key) ?? 0;
    const production = totalKwp * (splitPrimary * p1 + splitSecondary * p2);
    const selfConsumed = Math.min(production, hourlyConsumptionKwh);

    totalProduction += production;
    totalSelfConsumed += selfConsumed;
    totalConsumption += hourlyConsumptionKwh;
  }

  const selfConsumptionPct = totalProduction > 0 ? (totalSelfConsumed / totalProduction) * 100 : 0;
  const coveragePct = totalConsumption > 0 ? (totalSelfConsumed / totalConsumption) * 100 : 0;
  const score = coveragePct * 0.6 + selfConsumptionPct * 0.4;

  return { splitPrimary, selfConsumptionPct, coveragePct, score };
}
