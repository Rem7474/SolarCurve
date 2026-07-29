import { describe, it, expect } from 'vitest';
import {
  aggregateDailyData,
  buildMonthlyAverageProfile,
  buildSpecificDayProfile,
  sumProfiles,
  computeMonthlyTotalsFromDaily,
  buildHourlyProductionMap,
  evaluateSplitCandidate,
} from '../../src/core/solar-data.js';

function entry(dayKey, hour, kwh, month = Number(dayKey.split('-')[1])) {
  return { dayKey, month, hour, kwh };
}

describe('aggregateDailyData', () => {
  it('somme les kWh par jour et trie chronologiquement', () => {
    const result = aggregateDailyData([
      entry('2020-06-02', 10, 1),
      entry('2020-06-01', 9, 2),
      entry('2020-06-01', 10, 3),
    ]);
    expect(result).toEqual([
      { day: '2020-06-01', kwh: 5 },
      { day: '2020-06-02', kwh: 1 },
    ]);
  });

  it('renvoie un tableau vide pour une entrée vide', () => {
    expect(aggregateDailyData([])).toEqual([]);
  });
});

describe('buildMonthlyAverageProfile', () => {
  it('moyenne la production horaire sur les jours du mois sélectionné', () => {
    const hourly = [
      entry('2020-06-01', 12, 4, 6),
      entry('2020-06-02', 12, 2, 6),
      entry('2020-07-01', 12, 100, 7),
    ];
    const profile = buildMonthlyAverageProfile(hourly, 6);
    expect(profile).toHaveLength(24);
    expect(profile[12]).toBe(3); // (4 + 2) / 2 jours
    expect(profile[11]).toBe(0);
  });
});

describe('buildSpecificDayProfile', () => {
  it("extrait le profil 24h d'un jour précis", () => {
    const hourly = [
      entry('2020-06-01', 8, 1.5),
      entry('2020-06-01', 9, 2.5),
      entry('2020-06-02', 8, 99),
    ];
    const profile = buildSpecificDayProfile(hourly, '2020-06-01');
    expect(profile).toHaveLength(24);
    expect(profile[8]).toBe(1.5);
    expect(profile[9]).toBe(2.5);
    expect(profile[10]).toBe(0);
  });
});

describe('sumProfiles', () => {
  it('additionne deux profils heure par heure', () => {
    expect(sumProfiles([1, 2, 3], [10, 20, 30])).toEqual([11, 22, 33]);
  });

  it('tronque à la longueur la plus courte', () => {
    expect(sumProfiles([1, 2, 3], [10, 20])).toEqual([11, 22]);
  });
});

describe('computeMonthlyTotalsFromDaily', () => {
  it('totalise par mois à partir des données journalières (une entrée par mois)', () => {
    // Une seule entrée par mois : pas de division par 2 (réservée au cas multi-année ci-dessous).
    const totals = computeMonthlyTotalsFromDaily([
      { day: '2020-01-01', kwh: 3 },
      { day: '2020-02-01', kwh: 5 },
    ]);
    expect(totals[0]).toBe(3); // janvier
    expect(totals[1]).toBe(5); // février
    expect(totals[2]).toBe(0); // mars
  });

  it("moyenne sur 2 ans quand un mois a plus d'une entrée par jour multi-année", () => {
    // 2 entrées "janvier" agrégées (ex: 2019 + 2020) -> moyenne /2
    const totals = computeMonthlyTotalsFromDaily([
      { day: '2019-01-01', kwh: 10 },
      { day: '2020-01-01', kwh: 20 },
    ]);
    expect(totals[0]).toBe(15);
  });
});

describe('buildHourlyProductionMap', () => {
  it('indexe la production par clé jour:heure', () => {
    const map = buildHourlyProductionMap([entry('2020-06-01', 10, 2), entry('2020-06-01', 10, 3)]);
    expect(map.get('2020-06-01:10')).toBe(5);
  });
});

describe('evaluateSplitCandidate', () => {
  it('calcule couverture et autoconsommation pour une répartition 100% azimut primaire', () => {
    const primaryMap = new Map([['k1', 2]]); // 2 kWh/kWc
    const secondaryMap = new Map([['k1', 1]]);
    const result = evaluateSplitCandidate(
      ['k1'],
      primaryMap,
      secondaryMap,
      1,
      1 /* kWp */,
      1 /* conso kWh/h */
    );
    // production = 1 * (1*2 + 0*1) = 2 kWh, conso = 1 kWh -> autoconsommé = min(2,1) = 1
    expect(result.selfConsumptionPct).toBeCloseTo(50, 5); // 1/2
    expect(result.coveragePct).toBeCloseTo(100, 5); // 1/1
  });

  it("renvoie 0% partout quand il n'y a aucune production", () => {
    const emptyMap = new Map();
    const result = evaluateSplitCandidate([], emptyMap, emptyMap, 0.5, 1, 1);
    expect(result.selfConsumptionPct).toBe(0);
    expect(result.coveragePct).toBe(0);
    expect(result.score).toBe(0);
  });
});
