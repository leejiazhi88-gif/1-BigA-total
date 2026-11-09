const latestCss = `
    .module-chart-shell { position: relative; }
    .module-chart-latest {
      position: absolute; z-index: 1; top: 16px; left: 20px; right: 24px;
      display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
      pointer-events: none;
    }
    .module-chart-heading { min-width: 0; }
    .module-chart-heading strong { display: block; font-size: 13px; line-height: 1.4; }
    .module-chart-date, .module-chart-item-date, .module-chart-item-status {
      margin-top: 5px; color: var(--muted); font-size: 11px; line-height: 1.4;
    }
    .module-chart-values { display: flex; flex-wrap: wrap; gap: 10px 20px; max-width: 100%; }
    .module-chart-item { min-width: 0; }
    .module-chart-item[hidden] { display: none; }
    .module-chart-name { display: flex; align-items: center; gap: 6px; font-size: 12px; line-height: 1.4; }
    .module-chart-name::before { content: ""; width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: currentColor; }
    .module-chart-value { margin-top: 3px; font-size: 13px; font-weight: 650; line-height: 1.4; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .module-chart-value small { margin-left: 4px; color: var(--muted); font-size: 12px; font-weight: 400; }
    @media (max-width: 620px) {
      .module-chart-latest { right: 20px; flex-direction: column; gap: 10px; }
      .module-chart-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
      .module-chart-date { margin-top: 0; }
    }
`.trim();

function chartShell(chartId, readingId, className = "") {
  return `<div class="module-chart-shell">
    <div class="module-chart-latest" id="${readingId}" aria-live="polite"></div>
    <div id="${chartId}"${className ? ` class="${className}"` : ""}></div>
  </div>`;
}

const latestScript = `
    function renderChartLatest(id, title, items, context = "") {
      const root = document.getElementById(id);
      const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
      })[char]);
      const dates = [...new Set(items.map(item => item.date).filter(Boolean))];
      const sameDate = dates.length === 1;
      const caption = ["最新数据", sameDate ? dates[0] : dates.length ? "各曲线日期见读数" : "暂无数据", context].filter(Boolean).join(" · ");
      const reading = item => Number.isFinite(item.value) ? fmt(item.value, item.digits ?? 2) : "--";
      root.innerHTML = '<div class="module-chart-heading"><strong>' + escape(title) +
        '</strong><div class="module-chart-date">' + escape(caption) + '</div></div>' +
        '<div class="module-chart-values">' + items.map(item =>
          '<div class="module-chart-item" data-latest-series="' + escape(item.name) + '" style="color:' + escape(item.color) + '">' +
          '<div class="module-chart-name">' + escape(item.name) + '</div>' +
          '<div class="module-chart-value">' + escape(reading(item)) + '<small>' + escape(item.unit) + '</small></div>' +
          (!sameDate && item.date ? '<div class="module-chart-item-date">' + escape(item.date) + '</div>' : '') +
          (item.status ? '<div class="module-chart-item-status">' + escape(item.status) + '</div>' : '') +
          '</div>').join('') + '</div>';
    }
    function chartLatestTop(id) {
      return Math.ceil(document.getElementById(id).offsetHeight || 64) + 48;
    }
    function layoutChartLatest(chart, id, legend = false) {
      const top = chartLatestTop(id);
      chart.setOption({ grid: { top: top + (legend ? 30 : 0) },
        ...(legend ? { legend: { top: top - 2 } } : {}) });
    }
    function bindLatestLegend(chart, id) {
      chart.on("legendselectchanged", event => {
        document.getElementById(id).querySelectorAll("[data-latest-series]").forEach(item => {
          item.hidden = event.selected[item.dataset.latestSeries] === false;
        });
        layoutChartLatest(chart, id, true);
      });
    }
`.trim();

module.exports = { latestCss, chartShell, latestScript };
