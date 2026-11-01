const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const VALUATION_DATA_FILE = path.join(ROOT, "work", "valuation_data.json");
const START_MARKER = "<!-- VALUATION_MODULE_START -->";
const END_MARKER = "<!-- VALUATION_MODULE_END -->";

function stripExistingModule(html) {
  return html
    .replace(/\s*<!-- VALUATION_MODULE_(?:START|END) -->/g, "")
    .replace(/\s*<nav class="page-nav"[\s\S]*?<\/nav>/g, "")
    .replace(/\s*<section class="module-shell" id="valuation">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="valuation-module-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="valuation-module-script">[\s\S]*?<\/script>/g, "")
    .replace('<main class="wrap" id="overview">', '<main class="wrap">');
}

const css = `
  <style id="valuation-module-style">
    .page-nav {
      position: sticky; top: 0; z-index: 20; display: flex; gap: 8px;
      width: fit-content; max-width: 100%; overflow-x: auto; margin: 0 0 20px; padding: 6px;
      border: 1px solid var(--line); border-radius: 12px;
      background: rgba(7,17,31,.92); backdrop-filter: blur(12px);
    }
    .page-nav a {
      color: var(--muted); padding: 8px 14px; border-radius: 8px;
      text-decoration: none; font-size: 13px; font-weight: 700; white-space: nowrap; flex-shrink: 0;
    }
    .page-nav a:hover, .page-nav a.active { color: #07111f; background: var(--accent); }
    .module-shell { margin-top: 54px; scroll-margin-top: 72px; }
    .module-head {
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 18px; margin-bottom: 16px;
    }
    .module-kicker {
      color: var(--accent); font-size: 12px; font-weight: 800;
      letter-spacing: .16em; text-transform: uppercase;
    }
    .module-head h2 { margin: 7px 0 5px; font-size: 30px; }
    .module-head p { margin: 0; color: var(--muted); font-size: 13px; }
    .module-status {
      color: var(--muted); border: 1px solid var(--line); border-radius: 999px;
      padding: 7px 11px; font-size: 11px; white-space: nowrap;
    }
    .valuation-grid {
      display: grid; grid-template-columns: minmax(0, 1fr);
      gap: 15px; align-items: stretch;
    }
    .valuation-panel {
      min-width: 0; overflow: hidden; border: 1px solid var(--line);
      border-radius: 15px; background: rgba(9,20,34,.94);
    }
    .panel-head {
      min-height: 70px; display: flex; justify-content: space-between;
      align-items: center; gap: 14px; padding: 14px 16px;
      border-bottom: 1px solid var(--line); background: rgba(13,25,41,.9);
    }
    .panel-title { font-size: 15px; font-weight: 800; }
    .panel-subtitle { color: var(--muted); font-size: 11px; margin-top: 4px; }
    .metric-tabs, .range-tabs { display: flex; gap: 7px; flex-wrap: wrap; }
    .metric-tabs { padding: 13px 15px 0; }
    .metric-tab, .range-tab { padding: 7px 10px; font-size: 12px; }
    .range-tab { padding: 5px 8px; }
    .metric-tab[disabled] {
      cursor: not-allowed; opacity: .42; color: var(--muted);
      background: #101c2d; border-color: #203149;
    }
    .metric-note {
      display: flex; justify-content: space-between; gap: 12px; align-items: center;
      color: var(--muted); font-size: 11px; padding: 9px 16px 0;
    }
    .metric-reading { color: var(--text); font-weight: 700; }
    #valuationChart { height: 500px; width: 100%; }
    .valuation-foot.single-note { grid-template-columns: 1fr; }
    .valuation-foot {
      display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px;
    }
    @media (max-width: 1050px) {
      .valuation-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 620px) {
      .module-head, .panel-head, .metric-note { align-items: flex-start; flex-direction: column; }
      .valuation-foot { grid-template-columns: 1fr; }
      #valuationChart { height: 450px; }
    }
  </style>
`;

const nav = `
${START_MARKER}
  <nav class="page-nav" aria-label="研究模块导航">
    <a href="#overview" class="active">总览</a>
    <a href="#valuation">估值</a>
  </nav>
`;

const moduleHtml = `
  <section class="module-shell" id="valuation">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 01 / Valuation</div>
        <h2>估值</h2>
        <p>用连续数据观察估值水平及其历史位置。</p>
      </div>
      <div class="module-status">PE/PB 自2004年 / 股债收益差按国债数据可用日</div>
    </div>

    <div class="valuation-grid">
      <article class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">连续走势图</div>
            <div class="panel-subtitle" id="valuationMetricSubtitle">上证与深证 PE(TTM)，周频展示</div>
          </div>
          <div class="range-tabs" id="valuationRangeTabs">
            <button class="range-tab" data-years="3">3年</button>
            <button class="range-tab" data-years="5">5年</button>
            <button class="range-tab" data-years="10">10年</button>
            <button class="range-tab" data-years="20">20年</button>
            <button class="range-tab active" data-years="0">全部</button>
          </div>
        </div>
        <div class="metric-tabs" id="valuationMetricTabs">
          <button class="metric-tab active" data-metric="pe">PE(TTM)</button>
          <button class="metric-tab" data-metric="pePercentile">PE历史分位</button>
          <button class="metric-tab" data-metric="pbPercentile">PB历史分位</button>
          <button class="metric-tab" data-metric="equityBondSpread">股债收益差</button>
          <button class="metric-tab" disabled title="需要全市场个股与行业截面数据">行业分位 / 高估值占比</button>
        </div>
        <div class="metric-note">
          <span id="valuationMetricNote">PE越高，市场对未来盈利增长的要求越高。</span>
          <span class="metric-reading" id="valuationLatestReading"></span>
        </div>
        <div id="valuationChart"></div>
      </article>

    </div>

    <div class="valuation-foot single-note">
      <div class="note"><strong>连续数据口径：</strong>PE(TTM)与PB来自指数每日指标，可追溯至2004年；PE与PB分位按当前选择的3年、5年、10年或全部可用样本动态重算。股债收益差为100/PE减10年期国债收益率，仅显示同日国债数据可得的观测。</div>
    </div>
  </section>
${END_MARKER}
`;

const js = `
  <script id="valuation-module-script">
  (() => {
    const valuationExtra = __VALUATION_EXTRA__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);

    const valuationData = Object.fromEntries(["sh", "sz"].map(market => [market, [
      ...valuationExtra[market].filter(row => row.date < DATA[market][0].date && Number.isFinite(row.pe)),
      ...DATA[market]
    ]]));
    const metricConfig = {
      pe: {
        title: "PE(TTM)", unit: "倍", subtitle: "上证与深证 PE(TTM)，周频展示",
        note: "PE越高，市场对未来盈利增长的要求越高。"
      },
      pePercentile: {
        title: "PE历史分位", unit: "%", subtitle: "各时点相对当前所选时间跨度的位置",
        note: "80%以上通常属于样本高位，20%以下通常属于样本低位。", fixedRange: true
      },
      pbPercentile: {
        title: "PB历史分位", unit: "%", subtitle: "指数市净率相对当前所选时间跨度的位置",
        note: "PB更适合观察金融、周期及资产密集型指数的估值位置。", fixedRange: true, extra: true
      },
      equityBondSpread: {
        title: "股债收益差", unit: "%", subtitle: "盈利收益率减10年期国债收益率",
        note: "数值越低，股票相对债券的估值补偿越薄。", extra: true, inverseRisk: true
      }
    };

    function metricRows(market, field) {
      return metricConfig[field].extra ? valuationExtra[market] : valuationData[market];
    }
    const valuationChart = echarts.init(document.getElementById("valuationChart"), null, { renderer: "canvas" });
    let activeMetric = "pe";
    let activeYears = 0;

    function rowsForActiveRange(market, field) {
      const sourceField = field === "pePercentile" ? "pe"
        : field === "pbPercentile" ? "pb" : field;
      const rows = metricRows(market, field).filter(row => Number.isFinite(row[sourceField]));
      if (!activeYears || !rows.length) return rows;
      const end = new Date(rows[rows.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      return rows.filter(row => new Date(row.date + "T00:00:00Z") >= cutoff);
    }

    function percentileRank(sorted, value) {
      let low = 0, high = sorted.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (sorted[mid] <= value) low = mid + 1; else high = mid;
      }
      return sorted.length ? low / sorted.length * 100 : NaN;
    }

    function valuationPoints(market, field) {
      const rows = rowsForActiveRange(market, field);
      if (field === "pePercentile" || field === "pbPercentile") {
        const sourceField = field === "pePercentile" ? "pe" : "pb";
        const sorted = rows.map(row => row[sourceField]).sort((a, b) => a - b);
        return rows.map(row => [row.date, percentileRank(sorted, row[sourceField])]);
      }
      return rows.map(row => [row.date, row[field]]);
    }

    function renderValuationChart() {
      const cfg = metricConfig[activeMetric];
      const shPoints = valuationPoints("sh", activeMetric);
      const szPoints = valuationPoints("sz", activeMetric);
      const shLatest = shPoints[shPoints.length - 1]?.[1];
      const szLatest = szPoints[szPoints.length - 1]?.[1];
      const latestDate = shPoints[shPoints.length - 1]?.[0] || "暂无";
      const rangeLabel = activeYears ? activeYears + "年" : "全部可用";
      document.getElementById("valuationMetricSubtitle").textContent =
        cfg.fixedRange ? cfg.subtitle + "（" + rangeLabel + "样本动态计算）" : cfg.subtitle;
      document.getElementById("valuationMetricNote").textContent = cfg.note +
        (activeMetric === "equityBondSpread" && valuationExtra.meta.bondStatus !== "refreshed"
          ? " 部分日期的国债收益率缺失，收益差仅显示同日数据齐全的观测，最新为 " + latestDate + "。PE与PB独立更新。" : "") +
        (activeMetric === "equityBondSpread" ? " 10年期国债收益率取中债到期收益率曲线；接口不可用时由中债官方公开数据补充。" : "");
      document.getElementById("valuationLatestReading").textContent =
        latestDate + "：上证 " + fmt(shLatest, 2) + cfg.unit + " / 深证 " + fmt(szLatest, 2) + cfg.unit;

      const riskArea = cfg.fixedRange ? {
        silent: true,
        data: [
          [{ yAxis: 80, itemStyle: { color: "rgba(255,93,115,.07)" } }, { yAxis: 100 }],
          [{ yAxis: 0, itemStyle: { color: "rgba(54,194,255,.05)" } }, { yAxis: 20 }]
        ]
      } : undefined;

      valuationChart.setOption({
        animation: false,
        backgroundColor: "transparent",
        grid: { left: 66, right: 28, top: 42, bottom: 64 },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            const lines = params.map(item => item.marker + item.seriesName + "：<b>" +
              fmt(Number(item.value[1]), 2) + cfg.unit + "</b>");
            return "<b>" + (params[0]?.axisValueLabel || "") + "</b><br>" + lines.join("<br>");
          }
        },
        legend: { show: false },
        xAxis: {
          type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false }
        },
        yAxis: {
          type: "value", scale: !cfg.fixedRange,
          min: cfg.fixedRange ? 0 : undefined,
          max: cfg.fixedRange ? 100 : undefined,
          axisLabel: { color: "#7890aa", formatter: "{value}" + cfg.unit },
          splitLine: { lineStyle: { color: "#17283d" } }
        },
        dataZoom: [
          { type: "inside", filterMode: "none", start: 0, end: 100 },
          { type: "slider", bottom: 12, height: 22, start: 0, end: 100, borderColor: "#263b58",
            backgroundColor: "#0d1929", fillerColor: "rgba(246,200,95,.18)",
            handleStyle: { color: "#f6c85f" }, textStyle: { color: "#8fa5bf" } }
        ],
        series: [
          {
            name: "上证" + cfg.title, type: "line", data: shPoints, showSymbol: false,
            sampling: "lttb", lineStyle: { width: 2, color: COLORS.sh },
            itemStyle: { color: COLORS.sh }, emphasis: { focus: "series" }, markArea: riskArea
          },
          {
            name: "深证" + cfg.title, type: "line", data: szPoints, showSymbol: false,
            sampling: "lttb", lineStyle: { width: 2, color: COLORS.sz },
            itemStyle: { color: COLORS.sz }, emphasis: { focus: "series" }
          }
        ]
      }, true);
    }

    document.querySelectorAll("#valuationMetricTabs [data-metric]").forEach(button => {
      button.addEventListener("click", () => {
        activeMetric = button.dataset.metric;
        document.querySelectorAll("#valuationMetricTabs [data-metric]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderValuationChart();
      });
    });
    document.querySelectorAll("#valuationRangeTabs [data-years]").forEach(button => {
      button.addEventListener("click", () => {
        activeYears = Number(button.dataset.years);
        document.querySelectorAll("#valuationRangeTabs [data-years]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderValuationChart();
      });
    });

    const navLinks = document.querySelectorAll(".page-nav a");
    navLinks.forEach(link => link.addEventListener("click", () => {
      navLinks.forEach(item => item.classList.remove("active"));
      link.classList.add("active");
    }));
    window.addEventListener("resize", () => valuationChart.resize());
    renderValuationChart();
  })();
  </script>
`;

if (!fs.existsSync(VALUATION_DATA_FILE)) {
  throw new Error("Missing valuation_data.json. Run fetch_valuation_data.py first.");
}
const valuationExtra = JSON.parse(fs.readFileSync(VALUATION_DATA_FILE, "utf8"));
const valuationJs = js
  .replace("__VALUATION_EXTRA__", JSON.stringify(valuationExtra));
let html = stripExistingModule(fs.readFileSync(OUTPUT, "utf8"));

function insertBeforeLast(source, marker, content) {
  const index = source.lastIndexOf(marker);
  if (index === -1) throw new Error(`Marker not found: ${marker}`);
  return source.slice(0, index) + content + source.slice(index);
}

html = insertBeforeLast(html, "</head>", css + "\n");
html = html.replace('<main class="wrap">', '<main class="wrap" id="overview">' + nav);
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", valuationJs + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");

console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
