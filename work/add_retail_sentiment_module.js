const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "retail_sentiment_data.json");

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
      display: grid; grid-template-columns: minmax(0, 1fr);
      gap: 15px; align-items: stretch;
    }
    #retailSentimentChart { height: 500px; width: 100%; }
    #retail-sentiment .panel-head { flex-wrap: wrap; gap: 12px; }
    #retail-sentiment .module-status { white-space: normal; overflow-wrap: anywhere; }
    #retailMetricSubtitle { line-height: 1.7; }
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
        <p>用连续数据观察交易热度与杠杆扩张。</p>
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
        </div>
        <div class="metric-note">
          <span id="retailMetricNote">成交额快速放大代表交易热度上升，需结合指数涨幅判断是否出现巨量滞涨。</span>
          <span class="metric-reading" id="retailLatestReading"></span>
        </div>
        <div id="retailSentimentChart"></div>
      </article>

    </div>

    <div class="valuation-foot single-note">
      <div class="note"><strong>连续数据口径：</strong>沪深股票市场含A/B股，不含北交所、基金和债券；成交额单位亿元。两市完整成交额与换手率从2005年起；换手率按沪市主板A股、B股、科创板和深市的流通市值加权。2019年前沪市金额及流通市值由A/B股分项加总。融资为沪深交易所融资余额合计，非融资融券余额。每周取各指标最后可得交易日的单日值，保留实际日期，不是周累计；缺失不补零。融资从2010年3月业务启动后统计。</div>
    </div>
  </section>
`;

const script = `
  <script id="retail-sentiment-script">
  (() => {
    const retailData = __RETAIL_DATA__;
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
      }
    };
    const coverage = Object.fromEntries(Object.keys(metrics).map(key => {
      const rows = retailData.series.filter(row => Number.isFinite(row[key]));
      return [key, { start: rows[0]?.date, end: rows[rows.length - 1]?.date }];
    }));
    const startYear = key => coverage[key].start?.slice(0, 4) || "暂无";
    document.getElementById("retailCoverageStatus").textContent = "成交/换手 " + startYear("amount") + "年起 · 融资 " +
      startYear("marginBalance") + "年起";

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

    window.addEventListener("resize", () => chart.resize());
    renderChart();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing retail_sentiment_data.json.");

const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
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
  .replace("__RETAIL_DATA__", JSON.stringify(data));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", retailScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
