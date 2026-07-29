import { Chart } from 'chart.js/auto';
import {
  latInput,
  lonInput,
  tiltInput,
  lossesInput,
  azimuthInput,
  peakPowerInputEl,
  consumptionPowerInputEl,
  mapContainer,
} from '../dom.js';
import { state } from '../state.js';
import {
  computeMonthlyTotalsFromDaily,
  buildMonthlyAverageProfile,
  sumProfiles,
} from '../core/solar-data.js';
import { captureMapForPDF } from './map.js';

// jsPDF (~350 Ko) n'est chargé qu'au moment où l'utilisateur clique sur "Exporter le PDF",
// pas au chargement initial de la page (voir docs/AUDIT.md — perf §3).
export async function exportToPDF() {
  try {
    const { jsPDF } = await import('jspdf');

    const MONTHS = [
      'Janvier',
      'Février',
      'Mars',
      'Avril',
      'Mai',
      'Juin',
      'Juillet',
      'Août',
      'Septembre',
      'Octobre',
      'Novembre',
      'Décembre',
    ];
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

    const primaryMonthly = computeMonthlyTotalsFromDaily(state.primaryDailyData);
    const secondaryMonthly = state.secondaryDailyData.length
      ? computeMonthlyTotalsFromDaily(state.secondaryDailyData)
      : null;
    const hasSecondary = Boolean(secondaryMonthly);

    const totalPrimary = primaryMonthly.reduce((a, b) => a + b, 0);
    const totalSecondary = hasSecondary ? secondaryMonthly.reduce((a, b) => a + b, 0) : 0;
    const totalCombined = totalPrimary + totalSecondary;
    const peakWc = peakPowerInputEl.value;

    // ─── Graphique en barres (rendu hors-écran) ───
    const barCanvas = document.createElement('canvas');
    barCanvas.width = 1400;
    barCanvas.height = 700;
    barCanvas.style.display = 'none';
    document.body.appendChild(barCanvas);

    const barDatasets = [
      {
        label: `Azimut ${state.primaryAzimuth}°`,
        data: primaryMonthly,
        backgroundColor: '#f87171',
        borderColor: '#ef4444',
        borderWidth: 1,
        borderRadius: 4,
      },
    ];
    if (hasSecondary) {
      barDatasets.push({
        label: `Azimut ${state.secondaryAzimuth}°`,
        data: secondaryMonthly,
        backgroundColor: '#60a5fa',
        borderColor: '#2563eb',
        borderWidth: 1,
        borderRadius: 4,
      });
    }

    const barChart = new Chart(barCanvas.getContext('2d'), {
      type: 'bar',
      data: { labels: MONTHS_SHORT, datasets: barDatasets },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: true, position: 'top', labels: { font: { size: 14 }, padding: 14 } },
        },
        scales: {
          x: { stacked: hasSecondary, grid: { display: false }, ticks: { font: { size: 12 } } },
          y: {
            stacked: hasSecondary,
            title: { display: true, text: 'kWh', font: { size: 12 } },
            grid: { color: 'rgba(0,0,0,.06)' },
            ticks: { font: { size: 11 } },
          },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 350));
    const barImg = barCanvas.toDataURL('image/png', 1.0);
    barChart.destroy();
    document.body.removeChild(barCanvas);

    // ─── 12 graphiques de profil horaire (avec somme et talon conso) ───
    const chartImages = [];
    const consumptionPowerW = Number(consumptionPowerInputEl.value);
    const consumptionPowerKW = consumptionPowerW / 1000;

    for (let m = 1; m <= 12; m++) {
      const pm = buildMonthlyAverageProfile(state.primaryHourlyEntries, m);
      const sm =
        hasSecondary && state.secondaryHourlyEntries.length
          ? buildMonthlyAverageProfile(state.secondaryHourlyEntries, m)
          : null;

      const consumptionLine = Array(24).fill(consumptionPowerKW);
      let totalSelfConsumption = 0;
      let totalSurplus = 0;

      if (consumptionPowerW > 0) {
        for (let h = 0; h < 24; h++) {
          const totalProd = pm[h] + (sm ? sm[h] : 0);
          const selfConsumed = Math.min(totalProd, consumptionPowerKW);
          const surplus = Math.max(0, totalProd - consumptionPowerKW);
          totalSelfConsumption += selfConsumed;
          totalSurplus += surplus;
        }
      }

      const avgSelfConsumptionPerDay = consumptionPowerW > 0 ? totalSelfConsumption : 0;
      const avgSurplusPerDay = consumptionPowerW > 0 ? totalSurplus : 0;

      const totalProdPerDay = avgSelfConsumptionPerDay + avgSurplusPerDay;
      const selfConsumptionRate =
        totalProdPerDay > 0 ? (avgSelfConsumptionPerDay / totalProdPerDay) * 100 : 0;

      const c = document.createElement('canvas');
      c.width = 900;
      c.height = 500;
      c.style.display = 'none';
      document.body.appendChild(c);

      const ds = [
        {
          label: `Az ${state.primaryAzimuth}°`,
          data: pm,
          borderColor: '#ef4444',
          fill: false,
          tension: 0.3,
          pointRadius: 0,
          borderWidth: 2,
        },
      ];
      if (sm) {
        ds.push(
          {
            label: `Az ${state.secondaryAzimuth}°`,
            data: sm,
            borderColor: '#2563eb',
            borderDash: [6, 3],
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 1.8,
          },
          {
            label: 'Somme',
            data: sumProfiles(pm, sm),
            borderColor: '#059669',
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2.2,
          }
        );
      }

      if (consumptionPowerW > 0) {
        ds.push({
          label: 'Talon conso',
          data: consumptionLine,
          borderColor: '#d97706',
          borderDash: [4, 4],
          fill: false,
          tension: 0,
          pointRadius: 0,
          borderWidth: 1.5,
        });
      }

      const ch = new Chart(c.getContext('2d'), {
        type: 'line',
        data: { labels: Array.from({ length: 24 }, (_, h) => `${h}h`), datasets: ds },
        options: {
          responsive: false,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'bottom',
              labels: { font: { size: 10 }, padding: 8, usePointStyle: true },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 9 } } },
            y: {
              title: { display: true, text: 'kWh', font: { size: 9 } },
              grid: { color: 'rgba(0,0,0,.04)' },
              ticks: { font: { size: 9 } },
            },
          },
        },
      });

      await new Promise((r) => setTimeout(r, 200));
      chartImages.push({
        month: m,
        src: c.toDataURL('image/png', 1.0),
        avgSelfConsumption: avgSelfConsumptionPerDay,
        avgSurplus: avgSurplusPerDay,
        selfConsumptionRate,
      });
      ch.destroy();
      document.body.removeChild(c);
    }

    // ─── Capture de la carte Leaflet ───
    let mapImg = null;
    if (state.map && mapContainer) {
      try {
        mapImg = await captureMapForPDF();
      } catch (err) {
        console.warn('Map capture failed', err);
        mapImg = null;
      }
    }

    // ─────────────────── Page 1 : Synthèse ───────────────────
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 15;
    const contentW = W - M * 2;
    let y = 50;
    let pageNum = 0;

    pageNum++;
    doc.setFillColor(15, 23, 42);
    doc.rect(0, 0, W, 36, 'F');
    doc.setFillColor(245, 158, 11);
    doc.rect(0, 36, W, 2.5, 'F');

    doc.setTextColor(245, 158, 11);
    doc.setFontSize(24);
    doc.text('SolarCurve', M, 17);
    doc.setFontSize(10);
    doc.setTextColor(148, 163, 184);
    doc.text('Rapport de production photovoltaïque estimée', M, 26);
    doc.setFontSize(8);
    doc.setTextColor(200, 200, 200);
    doc.text(
      `${new Date().toLocaleDateString('fr-FR')} · ${new Date().toLocaleTimeString('fr-FR')}`,
      W - M,
      26,
      { align: 'right' }
    );

    y = 46;

    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text("Paramètres de l'installation", M, y);
    y += 5;

    doc.setFillColor(248, 250, 252);
    doc.setDrawColor(226, 232, 240);
    const pCardH = hasSecondary ? 32 : 26;
    doc.roundedRect(M, y, contentW, pCardH, 3, 3, 'FD');

    doc.setFontSize(8.5);
    const pX = M + 5;
    const pCol2 = M + contentW / 2;
    const pY1 = y + 7;
    const pY2 = y + 15;
    const pY3 = y + 23;

    doc.setTextColor(100, 116, 139);
    doc.text('Position', pX, pY1);
    doc.text('Puissance crête', pCol2, pY1);
    doc.text('Inclinaison', pX, pY2);
    doc.text('Pertes', pCol2, pY2);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.text(`${latInput.value || '-'}, ${lonInput.value || '-'}`, pX + 28, pY1);
    doc.text(`${peakWc} Wc (${(Number(peakWc) / 1000).toFixed(2)} kWc)`, pCol2 + 32, pY1);
    doc.text(`${tiltInput.value}°`, pX + 28, pY2);
    doc.text(`${lossesInput.value} %`, pCol2 + 32, pY2);

    if (hasSecondary) {
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(8.5);
      doc.text('Azimut 1', pX, pY3);
      doc.text('Azimut 2', pCol2, pY3);
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(9);
      doc.text(`${state.primaryAzimuth}°`, pX + 28, pY3);
      doc.text(`${state.secondaryAzimuth}°`, pCol2 + 32, pY3);
    } else {
      doc.setTextColor(100, 116, 139);
      doc.setFontSize(8.5);
      doc.text('Azimut', pX, pY3 - 8);
      doc.setTextColor(15, 23, 42);
      doc.setFontSize(9);
      doc.text(`${state.primaryAzimuth ?? azimuthInput.value}°`, pX + 28, pY3 - 8);
    }

    y += pCardH + 8;

    if (mapImg) {
      doc.setFontSize(11);
      doc.setTextColor(15, 23, 42);
      doc.text('Localisation', M, y);
      y += 5;

      const mapCardH = 90;
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(M, y, contentW, mapCardH, 3, 3, 'FD');

      const mapImgPad = 2;
      doc.addImage(
        mapImg,
        'PNG',
        M + mapImgPad,
        y + mapImgPad,
        contentW - mapImgPad * 2,
        mapCardH - mapImgPad * 2
      );

      y += mapCardH + 8;
    }

    const boxCount = hasSecondary ? 3 : 1;
    const boxGap = 5;
    const boxW = (contentW - boxGap * (boxCount - 1)) / boxCount;
    const boxH = 20;
    const boxItems = [
      {
        label: hasSecondary ? `TOTAL AZ. ${state.primaryAzimuth}°` : 'TOTAL ANNUEL',
        value: `${totalPrimary.toFixed(1)} kWh`,
        accent: [239, 68, 68],
      },
    ];
    if (hasSecondary) {
      boxItems.push(
        {
          label: `TOTAL AZ. ${state.secondaryAzimuth}°`,
          value: `${totalSecondary.toFixed(1)} kWh`,
          accent: [37, 99, 235],
        },
        { label: 'TOTAL COMBINÉ', value: `${totalCombined.toFixed(1)} kWh`, accent: [5, 150, 105] }
      );
    }

    for (let i = 0; i < boxItems.length; i++) {
      const bx = M + i * (boxW + boxGap);
      const item = boxItems[i];
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
      doc.roundedRect(bx, y, boxW, boxH, 2, 2, 'FD');
      doc.setFillColor(item.accent[0], item.accent[1], item.accent[2]);
      doc.rect(bx, y, boxW, 2.5, 'F');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 116, 139);
      doc.text(item.label, bx + 4, y + 9);
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text(item.value, bx + 4, y + 17);
    }

    if (hasSecondary) {
      y += boxH + 3;
      const pct1 = totalCombined > 0 ? (totalPrimary / totalCombined) * 100 : 0;
      const pct2 = totalCombined > 0 ? (totalSecondary / totalCombined) * 100 : 0;
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      doc.text(
        `Répartition : ${pct1.toFixed(1)}% (az. ${state.primaryAzimuth}°) / ${pct2.toFixed(1)}% (az. ${state.secondaryAzimuth}°)`,
        M,
        y + 3
      );
      y += 8;
    } else {
      y += boxH + 6;
    }

    const chartImgW = contentW;
    let chartImgH = chartImgW * (700 / 1400);
    const maxChartH = H - y - 18;
    if (chartImgH > maxChartH) chartImgH = Math.max(50, maxChartH);
    doc.addImage(barImg, 'PNG', M, y, chartImgW, chartImgH);

    pdfFooter(doc, W, H, M, pageNum);

    // ─────────────────── Page 2 : Tableau mensuel ───────────────────
    doc.addPage();
    pageNum++;
    pdfPageHeader(doc, W, M, 'Détail mensuel de la production');
    y = 44;

    const colCount = hasSecondary ? 4 : 2;
    const monthColW = 36;
    const dataColW = (contentW - monthColW) / (colCount - 1);
    const colWidths = [monthColW];
    for (let c = 1; c < colCount; c++) colWidths.push(dataColW);

    const headerH = 12;
    const rowH = 10;

    const tblHeaders = ['Mois', `Az. ${state.primaryAzimuth}° (kWh)`];
    if (hasSecondary) tblHeaders.push(`Az. ${state.secondaryAzimuth}° (kWh)`, 'Total (kWh)');

    let xCursor = M;
    for (let c = 0; c < colCount; c++) {
      const cw = colWidths[c];
      doc.setFillColor(15, 23, 42);
      doc.rect(xCursor, y, cw, headerH, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(9);
      if (c === 0) {
        doc.text(tblHeaders[c], xCursor + 4, y + 8);
      } else {
        doc.text(tblHeaders[c], xCursor + cw - 4, y + 8, { align: 'right' });
      }
      xCursor += cw;
    }
    y += headerH;

    let tRowPrim = 0;
    let tRowSec = 0;

    for (let i = 0; i < 12; i++) {
      const stripe = i % 2 === 0;
      const a1 = primaryMonthly[i] || 0;
      const a2 = hasSecondary ? secondaryMonthly[i] || 0 : 0;
      tRowPrim += a1;
      tRowSec += a2;

      xCursor = M;
      for (let c = 0; c < colCount; c++) {
        const cw = colWidths[c];
        doc.setFillColor(stripe ? 248 : 255, stripe ? 250 : 255, stripe ? 252 : 255);
        doc.setDrawColor(226, 232, 240);
        doc.rect(xCursor, y, cw, rowH, 'FD');
        xCursor += cw;
      }

      xCursor = M;
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(9);
      doc.text(MONTHS[i], xCursor + 4, y + 7);
      xCursor += colWidths[0];
      doc.text(a1.toFixed(1), xCursor + colWidths[1] - 6, y + 7, { align: 'right' });
      if (hasSecondary) {
        xCursor += colWidths[1];
        doc.text(a2.toFixed(1), xCursor + colWidths[2] - 6, y + 7, { align: 'right' });
        xCursor += colWidths[2];
        doc.text((a1 + a2).toFixed(1), xCursor + colWidths[3] - 6, y + 7, { align: 'right' });
      }
      y += rowH;
    }

    xCursor = M;
    for (let c = 0; c < colCount; c++) {
      const cw = colWidths[c];
      doc.setFillColor(245, 158, 11);
      doc.rect(xCursor, y, cw, headerH, 'F');
      xCursor += cw;
    }
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    xCursor = M;
    doc.text('TOTAL', xCursor + 4, y + 8);
    xCursor += colWidths[0];
    doc.text(tRowPrim.toFixed(1), xCursor + colWidths[1] - 6, y + 8, { align: 'right' });
    if (hasSecondary) {
      xCursor += colWidths[1];
      doc.text(tRowSec.toFixed(1), xCursor + colWidths[2] - 6, y + 8, { align: 'right' });
      xCursor += colWidths[2];
      doc.text((tRowPrim + tRowSec).toFixed(1), xCursor + colWidths[3] - 6, y + 8, {
        align: 'right',
      });
    }

    if (hasSecondary) {
      y += headerH + 12;
      doc.setFontSize(9);
      doc.setTextColor(30, 41, 59);
      doc.text('Répartition de la production', M, y);
      y += 4;
      const barH = 8;
      const pct1 = totalCombined > 0 ? totalPrimary / totalCombined : 0.5;
      doc.setFillColor(239, 68, 68);
      doc.roundedRect(M, y, contentW * pct1, barH, 2, 2, 'F');
      doc.setFillColor(37, 99, 235);
      doc.roundedRect(M + contentW * pct1, y, contentW * (1 - pct1), barH, 2, 2, 'F');
      y += barH + 5;
      doc.setFontSize(8);
      doc.setTextColor(239, 68, 68);
      doc.text(`Az. ${state.primaryAzimuth}° : ${(pct1 * 100).toFixed(1)}%`, M, y);
      doc.setTextColor(37, 99, 235);
      doc.text(`Az. ${state.secondaryAzimuth}° : ${((1 - pct1) * 100).toFixed(1)}%`, W - M, y, {
        align: 'right',
      });
    }

    pdfFooter(doc, W, H, M, pageNum);

    // ─────────────────── Pages 3-4 : Profils horaires (6 par page) ───────────────────
    const chartsPerPage = 6;
    const gridCols = 2;
    const gridRows = 3;
    const gridGap = 6;

    for (let page = 0; page < 2; page++) {
      doc.addPage();
      pageNum++;
      const pageTitle =
        page === 0 ? 'Profils horaires moyens (Jan – Jun)' : 'Profils horaires moyens (Jul – Déc)';
      pdfPageHeader(doc, W, M, pageTitle);

      const topY = 44;
      const gridAvailW = contentW;
      const gridAvailH = H - topY - 18;
      const cellW = (gridAvailW - gridGap * (gridCols - 1)) / gridCols;
      const cellH = (gridAvailH - gridGap * (gridRows - 1)) / gridRows;

      for (let idx = 0; idx < chartsPerPage; idx++) {
        const globalIdx = page * chartsPerPage + idx;
        if (globalIdx >= chartImages.length) break;

        const col = idx % gridCols;
        const row = Math.floor(idx / gridCols);
        const cx = M + col * (cellW + gridGap);
        const cy = topY + row * (cellH + gridGap);

        doc.setFillColor(248, 250, 252);
        doc.setDrawColor(226, 232, 240);
        doc.roundedRect(cx, cy, cellW, cellH, 2, 2, 'FD');

        doc.setFontSize(9);
        doc.setTextColor(15, 23, 42);
        doc.text(MONTHS[chartImages[globalIdx].month - 1], cx + 4, cy + 6);

        const imgPad = 2;
        const titleH = 8;
        const imgH = cellH - titleH - 16;
        doc.addImage(
          chartImages[globalIdx].src,
          'PNG',
          cx + imgPad,
          cy + titleH,
          cellW - imgPad * 2,
          imgH
        );

        if (
          chartImages[globalIdx].avgSelfConsumption > 0 ||
          chartImages[globalIdx].avgSurplus > 0
        ) {
          const statsY = cy + cellH - 13;
          doc.setFontSize(6.5);
          doc.setTextColor(100, 116, 139);
          const rate = chartImages[globalIdx].selfConsumptionRate;
          doc.text(
            `Autoconso. : ${chartImages[globalIdx].avgSelfConsumption.toFixed(2)} kWh/j (${rate.toFixed(1)}%) | Surplus : ${chartImages[globalIdx].avgSurplus.toFixed(2)} kWh/j`,
            cx + 4,
            statsY
          );
        }
      }

      pdfFooter(doc, W, H, M, pageNum);
    }

    doc.save(`SolarCurve_rapport_${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (err) {
    console.error('Export PDF failed', err);
    alert('Erreur lors de la génération du PDF. Consultez la console.');
  }
}

function pdfPageHeader(doc, W, M, title) {
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 30, 'F');
  doc.setFillColor(245, 158, 11);
  doc.rect(0, 30, W, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text(title, M, 19);
}

function pdfFooter(doc, W, H, M, pageNum) {
  doc.setDrawColor(226, 232, 240);
  doc.line(M, H - 12, W - M, H - 12);
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text('SolarCurve — Données fournies à titre indicatif', M, H - 7);
  doc.text(`Page ${pageNum}`, W - M, H - 7, { align: 'right' });
}
