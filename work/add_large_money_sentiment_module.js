const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "large_money_sentiment_data.json");
const EVENTS_FILE = path.join(ROOT, "work", "large_money_sentiment_events.json");

function stripExisting(html) {
  return html
    .replace(/\s*<section class="module-shell" id="large-money-sentiment">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="large-money-sentiment-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="large-money-sentiment-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<a href="#large-money-sentiment"[^>]*>情绪-大资金<\/a>/g, "");
}

const css = `
  <style id="large-money-sentiment-style">
    .large-money-grid {
      display: grid; grid-template-columns: minmax(0, 1.68fr) minmax(360px, .82fr);
      gap: 15px; align-items: stretch;
    }
    #largeMoneyChart { height: 500px; width: 100%; }
    #large-money-sentiment .panel-head { flex-wrap: wrap; gap: 12px; }
    @media (max-width: 980px) {
      .large-money-grid { grid-template-columns: 1fr; }
      #largeMoneyChart { height: 450px; }
    }
  </style>
`;

const moduleHtml = `
  <section class="module-shell" id="large-money-sentiment">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 03 / Institutional Sentiment</div>
        <h2>情绪-大资金</h2>
        <p>观察机构交易、北向资金和产业资本行为，识别资金集中进入与撤退的阶段。</p>
      </div>
      <div class="module-status">大宗与增减持 2018年至今 / 北向净流入至2024年8月</div>
    </div>

    <div class="large-money-grid">
      <article class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">连续走势图</div>
            <div class="panel-subtitle" id="largeMoneyMetricSubtitle">沪深A股大宗交易周成交额</div>
          </div>
          <div class="range-tabs" id="largeMoneyRangeTabs">
            <button class="range-tab" data-years="3">3年</button>
            <button class="range-tab" data-years="5">5年</button>
            <button class="range-tab active" data-years="0">全部</button>
          </div>
        </div>
        <div class="metric-tabs" id="largeMoneyMetricTabs">
          <button class="metric-tab active" data-metric="blockAmount">大宗交易额</button>
          <button class="metric-tab" data-metric="institutionBlockNet">机构大宗净买入</button>
          <button class="metric-tab" data-metric="holderNetShares">产业资本净增减持</button>
          <button class="metric-tab" data-metric="northMoney">北向资金净流入</button>
          <button class="metric-tab" disabled title="基金持仓按季度披露，待完成统一仓位估算">主动权益基金仓位</button>
          <button class="metric-tab" disabled title="需要公募持仓全市场截面聚合">机构持仓集中度</button>
          <button class="metric-tab" disabled title="ETF全市场历史快照待接入">ETF份额变化</button>
        </div>
        <div class="metric-note">
          <span id="largeMoneyMetricNote">大宗交易放量代表大额筹码交换活跃，需要结合机构席位净方向判断。</span>
          <span class="metric-reading" id="largeMoneyLatestReading"></span>
        </div>
        <div id="largeMoneyChart"></div>
      </article>

      <aside class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">大资金事件 List</div>
            <div class="panel-subtitle">按年份和季度切换；分类对应飞书“A股指数”表</div>
          </div>
          <div class="event-controls">
            <select id="largeMoneyEventYear" class="event-select" aria-label="大资金事件年份"></select>
            <select id="largeMoneyEventQuarter" class="event-select" aria-label="大资金事件季度">
              <option value="Q1">Q1</option><option value="Q2">Q2</option>
              <option value="Q3">Q3</option><option value="Q4">Q4</option>
            </select>
          </div>
        </div>
        <div class="event-body">
          <div class="quarter-summary">
            <div class="quarter-label" id="largeMoneyEventPeriod"></div>
            <div class="event-count" id="largeMoneyEventCount"></div>
          </div>
          <div class="quarter-dashboard" id="largeMoneyQuarterDashboard"></div>
          <ul class="event-list" id="largeMoneyEventList"></ul>
        </div>
      </aside>
    </div>

    <div class="valuation-foot">
      <div class="note"><strong>连续数据口径：</strong>大宗交易仅统计沪深A股，按周汇总，排除债券、基金、B股和北交所；金额由万元换算为亿元，并与成交价×成交量核对。历史包含当时上市、后来退市的股票。机构净买入＝“机构专用”买入额－卖出额，双方均为机构的交易净额为零；不按金额大小删去真实交易。产业资本净增减持按公告股数汇总，正值为净增持、负值为净减持。</div>
      <div class="note"><strong>北向口径提示：</strong>北向净流入序列保留至2024年8月16日。此后披露机制发生变化，页面不把新口径成交数据与旧口径净流入强行拼接。</div>
    </div>
  </section>
`;

const script = `
  <script id="large-money-sentiment-script">
  (() => {
    const largeMoneyData = __LARGE_MONEY_DATA__;
    const largeMoneyEvents = __LARGE_MONEY_EVENTS__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
    const metrics = {
      blockAmount: {
        title: "大宗交易额", unit: "亿元", digits: 1,
        subtitle: "沪深A股大宗交易周成交额",
        note: "大宗交易放量代表大额筹码交换活跃，需要结合机构席位净方向判断。"
      },
      institutionBlockNet: {
        title: "机构大宗净买入", unit: "亿元", digits: 1,
        subtitle: "沪深A股机构专用席位大宗交易周净买入额",
        note: "正值表示机构席位净买入，负值表示净卖出；极端负值可辅助识别机构撤退。"
      },
      holderNetShares: {
        title: "产业资本净增减持", unit: "亿股", digits: 2,
        subtitle: "重要股东公告口径的周净增减持股数",
        note: "正值为净增持，负值为净减持；该指标按股数汇总，不等同于交易金额。"
      },
      northMoney: {
        title: "北向资金净流入", unit: "亿元", digits: 1,
        subtitle: "沪深股通日净流入，周末值；序列截至2024年8月16日",
        note: "披露机制变化后不再与旧口径拼接，因此选择最近3年时曲线会在2024年8月结束。"
      }
    };
    let activeMetric = "blockAmount";
    let activeYears = 0;
    let chartPoints = [];
    const chart = echarts.init(document.getElementById("largeMoneyChart"), null, { renderer: "canvas" });

    function axisBounds(points) {
      const values = points.map(point => point[1]).filter(Number.isFinite);
      if (!values.length) return { min: 0, max: 1 };
      const low = Math.min(0, ...values), high = Math.max(0, ...values);
      const padding = Math.max((high - low) * 0.12, 0.1);
      return { min: low < 0 ? low - padding : 0, max: high > 0 ? high + padding : 0.1 };
    }

    function rescaleVisible() {
      if (!chartPoints.length) return;
      const zoom = chart.getOption().dataZoom[0];
      const first = Date.parse(chartPoints[0][0]), last = Date.parse(chartPoints[chartPoints.length - 1][0]);
      const timestamp = value => typeof value === "number" ? value : Date.parse(value);
      const startValue = timestamp(zoom.startValue), endValue = timestamp(zoom.endValue);
      const start = Number.isFinite(startValue) ? startValue : first + (last - first) * zoom.start / 100;
      const end = Number.isFinite(endValue) ? endValue : first + (last - first) * zoom.end / 100;
      const visible = chartPoints.filter(point => Date.parse(point[0]) >= start && Date.parse(point[0]) <= end);
      chart.setOption({ yAxis: axisBounds(visible) });
    }
    chart.on("datazoom", rescaleVisible);

    function activeRows() {
      const rows = largeMoneyData.series.filter(row => Number.isFinite(row[activeMetric]));
      if (!activeYears || !rows.length) return rows;
      const end = new Date(largeMoneyData.series[largeMoneyData.series.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      return rows.filter(row => new Date(row.date + "T00:00:00Z") >= cutoff);
    }
    function renderChart() {
      const cfg = metrics[activeMetric];
      const rows = activeRows();
      const dateField = activeMetric === "northMoney" ? "northDate" : activeMetric === "holderNetShares" ? "holderDate" : "blockDate";
      const points = rows.map(row => [row[dateField] || row.date, row[activeMetric]]);
      chartPoints = points;
      const latest = points[points.length - 1]?.[1];
      document.getElementById("largeMoneyMetricSubtitle").textContent = cfg.subtitle;
      document.getElementById("largeMoneyMetricNote").textContent = cfg.note;
      document.getElementById("largeMoneyLatestReading").textContent =
        (points[points.length - 1]?.[0] || "暂无") + "：" + fmt(latest, cfg.digits) + cfg.unit;
      chart.setOption({
        animation: false, backgroundColor: "transparent",
        grid: { left: 12, right: 24, top: 42, bottom: 64, containLabel: true },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          confine: true, backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            const item = params[0];
            return "<b>" + (item?.axisValueLabel || "") + "</b><br>" +
              item.marker + cfg.title + "：<b>" + fmt(Number(item.value[1]), cfg.digits) + cfg.unit + "</b>";
          }
        },
        xAxis: {
          type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false }
        },
        yAxis: {
          type: "value", scale: true, ...axisBounds(points), name: cfg.unit,
          nameTextStyle: { color: "#7890aa", align: "left" },
          axisLabel: { color: "#7890aa", formatter: value => Math.abs(value) >= 10000 ? fmt(value / 10000, 1) + "万" : fmt(value, Math.abs(value) < 1 && value !== 0 ? 2 : 0) },
          splitLine: { lineStyle: { color: "#17283d" } }
        },
        dataZoom: [
          { type: "inside", filterMode: "none", start: 0, end: 100 },
          { type: "slider", filterMode: "none", bottom: 12, height: 22, start: 0, end: 100,
            borderColor: "#263b58", backgroundColor: "#0d1929",
            fillerColor: "rgba(54,194,255,.17)", handleStyle: { color: "#36c2ff" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series: [{
          name: cfg.title, type: "line", data: points, showSymbol: false,
          sampling: "lttb", lineStyle: { width: 2.2, color: "#36c2ff" },
          areaStyle: { color: "rgba(54,194,255,.08)" }, itemStyle: { color: "#36c2ff" }
        }]
      }, true);
    }
    document.querySelectorAll("#largeMoneyMetricTabs [data-metric]").forEach(button => {
      button.addEventListener("click", () => {
        activeMetric = button.dataset.metric;
        document.querySelectorAll("#largeMoneyMetricTabs [data-metric]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });
    document.querySelectorAll("#largeMoneyRangeTabs [data-years]").forEach(button => {
      button.addEventListener("click", () => {
        activeYears = Number(button.dataset.years);
        document.querySelectorAll("#largeMoneyRangeTabs [data-years]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });

    const yearSelect = document.getElementById("largeMoneyEventYear");
    const quarterSelect = document.getElementById("largeMoneyEventQuarter");
    const latestDate = largeMoneyData.series[largeMoneyData.series.length - 1].date;
    const latestYear = Number(latestDate.slice(0, 4));
    const latestQuarter = "Q" + Math.ceil(Number(latestDate.slice(5, 7)) / 3);
    for (let year = latestYear; year >= 2006; year--) {
      const option = document.createElement("option");
      option.value = String(year); option.textContent = String(year);
      yearSelect.appendChild(option);
    }
    yearSelect.value = String(latestYear);
    quarterSelect.value = latestQuarter;
    function quarterKey(date) {
      return date.slice(0, 4) + "-Q" + Math.ceil(Number(date.slice(5, 7)) / 3);
    }
    function quarterRows(key) {
      return largeMoneyData.series.filter(row => quarterKey(row.date) === key);
    }
    function percentileAbs(values, value) {
      const clean = values.filter(Number.isFinite).map(Math.abs);
      return clean.length ? clean.filter(item => item <= Math.abs(value)).length / clean.length * 100 : NaN;
    }
    function automaticEvents(key, existing) {
      if (existing.some(event => event.type === "机构集中撤退")) return [];
      const rows = quarterRows(key);
      if (!rows.length) return [];
      const worst = rows.reduce(
        (best, row) => Number.isFinite(row.institutionBlockNet) &&
          (!best || row.institutionBlockNet < best.institutionBlockNet) ? row : best,
        null
      );
      if (!worst || worst.institutionBlockNet >= 0) return [];
      const pct = percentileAbs(
        largeMoneyData.series.map(row => row.institutionBlockNet),
        worst.institutionBlockNet
      );
      if (pct < 95) return [];
      return [{
        type: "机构集中撤退",
        title: "机构席位大宗净卖出进入历史极端区间",
        desc: "单周机构专用席位大宗净卖出" + fmt(Math.abs(worst.institutionBlockNet), 1) +
          "亿元，绝对规模处于历史" + fmt(pct, 0) + "%分位。",
        meta: "数据规则：机构大宗净卖出绝对值进入2018年以来前5%；自动识别"
      }];
    }
    function renderEvents() {
      const key = yearSelect.value + "-" + quarterSelect.value;
      const curated = largeMoneyEvents[key] || [];
      const events = curated.concat(automaticEvents(key, curated));
      const rows = quarterRows(key);
      const row = rows[rows.length - 1];
      document.getElementById("largeMoneyEventPeriod").textContent =
        yearSelect.value + " " + quarterSelect.value;
      document.getElementById("largeMoneyEventCount").textContent = events.length + " 条事件";
      document.getElementById("largeMoneyQuarterDashboard").innerHTML = [
        ["大宗交易额", Number.isFinite(row?.blockAmount) ? fmt(row.blockAmount, 1) + "亿元" : "暂无数据"],
        ["机构大宗净买入", Number.isFinite(row?.institutionBlockNet) ? fmt(row.institutionBlockNet, 1) + "亿元" : "暂无数据"],
        ["产业资本净增减持", Number.isFinite(row?.holderNetShares) ? fmt(row.holderNetShares, 2) + "亿股" : "暂无数据"],
        ["北向净流入", Number.isFinite(row?.northMoney) ? fmt(row.northMoney, 1) + "亿元" : "口径已停止"]
      ].map(item => '<div class="quarter-stat"><span>' + item[0] + '</span><strong>' + item[1] + '</strong></div>').join("");
      document.getElementById("largeMoneyEventList").innerHTML = events.length ? events.map(event =>
        '<li class="event-item">' +
        '<div class="event-type">' + escapeHtml(event.type) + '</div>' +
        '<div class="event-title">' + escapeHtml(event.title) + '</div>' +
        '<div class="event-desc">' + escapeHtml(event.desc) + '</div>' +
        '<div class="event-meta">' + escapeHtml(event.meta || "") + '</div></li>'
      ).join("") : '<li class="event-empty">该季度暂无符合大资金事件口径的记录</li>';
    }
    yearSelect.addEventListener("change", renderEvents);
    quarterSelect.addEventListener("change", renderEvents);
    window.addEventListener("resize", () => chart.resize());
    renderChart();
    renderEvents();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing large_money_sentiment_data.json.");
if (!fs.existsSync(EVENTS_FILE)) throw new Error("Missing large_money_sentiment_events.json.");
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const events = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
let html = stripExisting(fs.readFileSync(OUTPUT, "utf8"));
html = html.replace(
  '<a href="#retail-sentiment">情绪-散户</a>',
  '<a href="#retail-sentiment">情绪-散户</a><a href="#large-money-sentiment">情绪-大资金</a>'
);
function insertBeforeLast(source, marker, content) {
  const index = source.lastIndexOf(marker);
  if (index === -1) throw new Error(`Marker not found: ${marker}`);
  return source.slice(0, index) + content + source.slice(index);
}
const largeMoneyScript = script
  .replace("__LARGE_MONEY_DATA__", JSON.stringify(data))
  .replace("__LARGE_MONEY_EVENTS__", JSON.stringify(events.quarters));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", largeMoneyScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
