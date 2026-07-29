// État mutable partagé — remplace les `let` globaux de l'ancien app.js.
// Les modules mutent directement les propriétés de cet objet (pas de réassignation
// du binding d'export, pour rester compatible avec les imports ES module en lecture seule).

export const state = {
  dailyProfileChart: null,
  monthlyProfileChart: null,
  peakShavingChart: null,
  primaryHourlyEntries: [],
  primaryDailyData: [],
  secondaryHourlyEntries: [],
  secondaryDailyData: [],
  primaryAzimuth: null,
  secondaryAzimuth: null,
  map: null,
  marker: null,
  azimuthShaft: null,
  azimuthHead: null,
  azimuthSecondaryShaft: null,
  azimuthSecondaryHead: null,
  azimuthHandle: null,
  azimuthSecondaryHandle: null,
  suppressMapClick: false,
  optimizedSplitResult: null,
  syncingPowerFields: false,
};
