const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "retail_sentiment_data.json");
const EVENTS_FILE = path.join(ROOT, "work", "retail_sentiment_events.json");

function stripExisting(html) {
  return html
    .replace(/\s*<section class="module-shell" id="retail-sentiment">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="retail-sentiment-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="retail-sentiment-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<a href="#retail-sentiment"[^>]*>情绪-散户<\/a>/g, "");
}

const css = `
  <style id="retail-sentiment-style">
    .retail-grid {
      display: grid; grid-template-columns: minmax(0, 1.68fr) minmax(360px, .82fr);
      gap: 15px; align-items: stretch;
    }
    #retailSentimentChart { height: 500px; width: 100%; }
    #retail-sentiment .panel-head { flex-wrap: wrap; gap: 12px; }
    #retail-sentiment .module-status { white-space: normal; overflow-wrap: anywhere; }
    #retailMetricSubtitle { line-height: 1.7; }
    .retail-source {
      display: inline-block; margin-top: 8px; color: #65c7ff;
      font-size: 11px; font-weight: 700; text-decoration: none;
    }
    .retail-source:hover { text-decoration: underline; }
    @media (max-width: 980px) {
      .retail-grid { grid-template-columns: 1fr; }
      #retailSentimentChart { height: 450px; }
    }
  </style>
`;

const moduleHtml = `
  <section class="module-shell" id="retail-sentiment">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 02 / Retail Sentiment</div>
        <h2>情绪-散户</h2>
        <p>连续数据观察交易热度与杠杆扩张，季度事件复盘散户情绪如何形成和逆转。</p>
      </div>
      <div class="module-status" id="retailCoverageStatus"></div>
    </div>

    <div class="retail-grid">
      <article class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">连续走势图</div>
            <div class="panel-subtitle" id="retailMetricSubtitle">沪深两市股票成交额，周频展示</div>
          </div>
          <div class="range-tabs" id="retailRangeTabs">
            <button class="range-tab" data-years="3">3年</button>
            <button class="range-tab" data-years="5">5年</button>
            <button class="range-tab" data-years="10">10年</button>
            <button class="range-tab" data-years="20">20年</button>
            <button class="range-tab active" data-years="0">全部</button>
          </div>
        </div>
        <div class="metric-tabs" id="retailMetricTabs">
          <button class="metric-tab active" data-metric="amount">两市成交额</button>
          <button class="metric-tab" data-metric="turnover">换手率</button>
          <button class="metric-tab" data-metric="marginBalance">融资余额</button>
          <button class="metric-tab" data-metric="marginFloatRatio">融资余额/流通市值</button>
          <button class="metric-tab" data-metric="limitUpCount">涨停数量</button>
          <button class="metric-tab" disabled title="股票开户周度数据已停止更新">新增开户数</button>
          <button class="metric-tab" disabled title="待接公募基金发行规模数据源">新基金发行规模</button>
          <button class="metric-tab" disabled title="需要全市场个股历史行情截面计算">创新高股票占比</button>
          <button class="metric-tab" disabled title="需要全市场个股历史行情截面计算">年线以上股票比例</button>
        </div>
        <div class="metric-note">
          <span id="retailMetricNote">成交额快速放大代表交易热度上升，需结合指数涨幅判断是否出现巨量滞涨。</span>
          <span class="metric-reading" id="retailLatestReading"></span>
        </div>
        <div id="retailSentimentChart"></div>
      </article>

      <aside class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">散户情绪事件 List</div>
            <div class="panel-subtitle">按年份和季度切换；分类严格对应飞书“A股指数”表</div>
          </div>
          <div class="event-controls">
            <select id="retailEventYear" class="event-select" aria-label="散户事件年份"></select>
            <select id="retailEventQuarter" class="event-select" aria-label="散户事件季度">
              <option value="Q1">Q1</option><option value="Q2">Q2</option>
              <option value="Q3">Q3</option><option value="Q4">Q4</option>
            </select>
          </div>
        </div>
        <div class="event-body">
          <div class="quarter-summary">
            <div class="quarter-label" id="retailEventPeriod"></div>
            <div class="event-count" id="retailEventCount"></div>
          </div>
          <div class="quarter-dashboard" id="retailQuarterDashboard"></div>
          <ul class="event-list" id="retailEventList"></ul>
        </div>
      </aside>
    </div>

    <div class="valuation-foot">
      <div class="note"><strong>连续数据口径：</strong>沪深股票市场含A/B股，不含北交所、基金和债券；成交额单位亿元。换手率统一按沪市主板A股、B股、科创板和深市的流通市值加权。2019年前沪市金额及流通市值由A/B股分项加总。融资为沪深交易所融资余额合计，非融资融券余额。每周取各指标最后可得交易日的单日值，保留实际日期，不是周累计；缺失不补零。融资从2010年3月业务启动后统计，非ST涨停家数的数据源从2020年开始。</div>
      <div class="note"><strong>事件库口径：</strong>仅收录新增开户创新高、爆款基金、融资监管、场外配资整顿、市场极端情绪事件、巨量滞涨六类。没有可靠来源的季度保持为空。</div>
    </div>
  </section>
`;

const script = `
  <script id="retail-sentiment-script">
  (() => {
    const retailData = __RETAIL_DATA__;
    const retailEvents = __RETAIL_EVENTS__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);

    const metrics = {
      amount: {
        title: "两市成交额", unit: "亿元", digits: 0,
        subtitle: "沪深两市股票成交额",
        note: "成交额快速放大代表交易热度上升，需结合指数涨幅判断是否出现巨量滞涨。"
      },
      turnover: {
        title: "市场换手率", unit: "%", digits: 2,
        subtitle: "沪市各股票板块与深市换手率，按流通市值加权",
        note: "换手率越高，筹码交换越快；高位持续高换手通常意味着分歧显著扩大。"
      },
      marginBalance: {
        title: "融资余额", unit: "亿元", digits: 0,
        subtitle: "沪深交易所融资余额合计",
        note: "融资余额持续抬升表示杠杆资金扩张；融资融券业务于2010年3月启动，更早年份不适用。"
      },
      marginFloatRatio: {
        title: "融资余额/流通市值", unit: "%", digits: 2,
        subtitle: "融资余额占沪深市场流通市值比例",
        note: "融资余额除以同期沪深股票流通市值，反映杠杆拥挤度；2010年3月以前不适用。"
      },
      limitUpCount: {
        title: "涨停数量", unit: "家", digits: 0,
        subtitle: "当日非ST股票涨停数量，数据自2020年起",
        note: "涨停家数反映短线风险偏好，但极高值也可能意味着情绪进入亢奋区。"
      }
    };
    const coverage = Object.fromEntries(Object.keys(metrics).map(key => {
      const rows = retailData.series.filter(row => Number.isFinite(row[key]));
      return [key, { start: rows[0]?.date, end: rows[rows.length - 1]?.date }];
    }));
    const startYear = key => coverage[key].start?.slice(0, 4) || "暂无";
    document.getElementById("retailCoverageStatus").textContent = "成交/换手 " + startYear("amount") + "年起 · 融资 " +
      startYear("marginBalance") + "年起 · 涨停 " + startYear("limitUpCount") + "年起";

    let activeMetric = "amount";
    let activeYears = 0;
    const chart = echarts.init(document.getElementById("retailSentimentChart"), null, { renderer: "canvas" });

    function activeRows() {
      const rows = retailData.series.filter(row => Number.isFinite(row[activeMetric]));
      if (!activeYears || !rows.length) return rows;
      const end = new Date(rows[rows.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      return rows.filter(row => new Date(row.date + "T00:00:00Z") >= cutoff);
    }

    function renderChart() {
      const cfg = metrics[activeMetric];
      const rows = activeRows();
      const points = rows.map(row => [row.date, row[activeMetric]]);
      const latest = points[points.length - 1]?.[1];
      const span = coverage[activeMetric];
      document.getElementById("retailMetricSubtitle").textContent = cfg.subtitle + " · 周频 · 可用历史 " +
        (span.start ? span.start + " 至 " + span.end : "暂无");
      document.getElementById("retailMetricNote").textContent = cfg.note;
      document.getElementById("retailLatestReading").textContent =
        (points[points.length - 1]?.[0] || "暂无") + "：" + fmt(latest, cfg.digits) + cfg.unit;
      chart.setOption({
        animation: false,
        backgroundColor: "transparent",
        grid: { left: 72, right: 28, top: 42, bottom: 64 },
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
          type: "value", scale: true,
          axisLabel: { color: "#7890aa", formatter: "{value}" + cfg.unit },
          splitLine: { lineStyle: { color: "#17283d" } }
        },
        dataZoom: [
          { type: "inside", filterMode: "none", start: 0, end: 100 },
          { type: "slider", bottom: 12, height: 22, start: 0, end: 100,
            borderColor: "#263b58", backgroundColor: "#0d1929",
            fillerColor: "rgba(246,200,95,.18)", handleStyle: { color: "#f6c85f" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series: [{
          name: cfg.title, type: "line", data: points, showSymbol: false,
          sampling: "lttb", lineStyle: { width: 2.2, color: "#f6c85f" },
          areaStyle: { color: "rgba(246,200,95,.08)" },
          itemStyle: { color: "#f6c85f" }
        }]
      }, true);
    }

    document.querySelectorAll("#retailMetricTabs [data-metric]").forEach(button => {
      button.addEventListener("click", () => {
        activeMetric = button.dataset.metric;
        document.querySelectorAll("#retailMetricTabs [data-metric]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });
    document.querySelectorAll("#retailRangeTabs [data-years]").forEach(button => {
      button.addEventListener("click", () => {
        activeYears = Number(button.dataset.years);
        document.querySelectorAll("#retailRangeTabs [data-years]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });

    const yearSelect = document.getElementById("retailEventYear");
    const quarterSelect = document.getElementById("retailEventQuarter");
    const latestDate = retailData.series[retailData.series.length - 1].date;
    const latestYear = Number(latestDate.slice(0, 4));
    const latestQuarter = "Q" + Math.ceil(Number(latestDate.slice(5, 7)) / 3);
    for (let year = latestYear; year >= 2006; year--) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      yearSelect.appendChild(option);
    }
    yearSelect.value = String(latestYear);
    quarterSelect.value = latestQuarter;

    function quarterKey(date) {
      return date.slice(0, 4) + "-Q" + Math.ceil(Number(date.slice(5, 7)) / 3);
    }
    function latestQuarterRow(key, field) {
      const rows = retailData.series.filter(row => quarterKey(row.date) === key);
      return rows.findLast(row => Number.isFinite(row[field]));
    }
    function percentile(values, value) {
      const clean = values.filter(Number.isFinite);
      return clean.length
        ? clean.filter(item => item <= value).length / clean.length * 100
        : NaN;
    }
    function automaticQuarterEvents(key, existing) {
      if (existing.some(event => event.type === "市场极端情绪事件")) return [];
      const rows = retailData.series.filter(row => quarterKey(row.date) === key);
      if (!rows.length) return [];
      const peak = field => rows.reduce(
        (best, row) => Number.isFinite(row[field]) && (!best || row[field] > best[field]) ? row : best,
        null
      );
      const amountPeak = peak("amount");
      const turnoverPeak = peak("turnover");
      const limitPeak = peak("limitUpCount");
      const amountPct = amountPeak ? percentile(retailData.series.map(row => row.amount), amountPeak.amount) : NaN;
      const turnoverPct = turnoverPeak ? percentile(retailData.series.map(row => row.turnover), turnoverPeak.turnover) : NaN;
      const limitPct = limitPeak ? percentile(retailData.series.map(row => row.limitUpCount), limitPeak.limitUpCount) : NaN;
      const maxPct = Math.max(amountPct || 0, turnoverPct || 0, limitPct || 0);
      if (maxPct < 90) return [];
      const details = [];
      if (amountPct >= 90) details.push("成交额峰值" + fmt(amountPeak.amount, 0) + "亿元（历史" + fmt(amountPct, 0) + "%分位）");
      if (turnoverPct >= 90) details.push("换手率峰值" + fmt(turnoverPeak.turnover, 2) + "%（历史" + fmt(turnoverPct, 0) + "%分位）");
      if (limitPct >= 90) details.push("涨停峰值" + fmt(limitPeak.limitUpCount, 0) + "家（历史" + fmt(limitPct, 0) + "%分位）");
      return [{
        type: "市场极端情绪事件",
        title: "交易热度进入历史高位区间",
        desc: details.join("；") + "。",
        meta: "数据规则：季度峰值进入各指标可用历史样本前10%；成交/换手自" + startYear("amount") +
          "年、涨停自" + startYear("limitUpCount") + "年起；由连续数据自动识别",
        auto: true
      }];
    }
    function renderEvents() {
      const key = yearSelect.value + "-" + quarterSelect.value;
      const curated = retailEvents[key] || [];
      const events = curated.concat(automaticQuarterEvents(key, curated));
      document.getElementById("retailEventPeriod").textContent =
        yearSelect.value + " " + quarterSelect.value;
      document.getElementById("retailEventCount").textContent = events.length + " 条事件";
      document.getElementById("retailQuarterDashboard").innerHTML = [
        ["两市成交额", "amount"], ["换手率", "turnover"], ["融资余额", "marginBalance"], ["涨停数量", "limitUpCount"]
      ].map(([label, field]) => {
        const row = latestQuarterRow(key, field), cfg = metrics[field];
        return '<div class="quarter-stat"><span>' + label + (row ? ' · ' + row.date : '') + '</span><strong>' +
          (row ? fmt(row[field], cfg.digits) + cfg.unit : "暂无数据") + '</strong></div>';
      }).join("");
      document.getElementById("retailEventList").innerHTML = events.length ? events.map(event =>
        '<li class="event-item">' +
        '<div class="event-type">' + escapeHtml(event.type) + '</div>' +
        '<div class="event-title">' + escapeHtml(event.title) + '</div>' +
        '<div class="event-desc">' + escapeHtml(event.desc) + '</div>' +
        '<div class="event-meta">' + escapeHtml(event.meta || "") + '</div>' +
        (event.sourceUrl
          ? '<a class="retail-source" href="' + escapeHtml(event.sourceUrl) + '" target="_blank" rel="noopener noreferrer">查看' + escapeHtml(event.source || "来源") + '</a>'
          : '') +
        '</li>'
      ).join("") : '<li class="event-empty">该季度暂无符合散户情绪事件口径的记录</li>';
    }
    yearSelect.addEventListener("change", renderEvents);
    quarterSelect.addEventListener("change", renderEvents);
    window.addEventListener("resize", () => chart.resize());
    renderChart();
    renderEvents();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing retail_sentiment_data.json.");
if (!fs.existsSync(EVENTS_FILE)) throw new Error("Missing retail_sentiment_events.json.");

const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const events = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
let html = stripExisting(fs.readFileSync(OUTPUT, "utf8"));
html = html.replace(
  '<a href="#valuation">估值</a>',
  '<a href="#valuation">估值</a><a href="#retail-sentiment">情绪-散户</a>'
);

function insertBeforeLast(source, marker, content) {
  const index = source.lastIndexOf(marker);
  if (index === -1) throw new Error(`Marker not found: ${marker}`);
  return source.slice(0, index) + content + source.slice(index);
}

const retailScript = script
  .replace("__RETAIL_DATA__", JSON.stringify(data))
  .replace("__RETAIL_EVENTS__", JSON.stringify(events.quarters));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", retailScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
