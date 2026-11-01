const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "large_money_sentiment_data.json");

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
      display: grid; grid-template-columns: minmax(0, 1fr);
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
      <div class="module-status">大宗交易自2002年 / 股东增减持自2000年 / 北向净流入至2024年8月</div>
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
            <button class="range-tab" data-years="10">10年</button>
            <button class="range-tab" data-years="20">20年</button>
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

    </div>

    <div class="valuation-foot single-note">
      <div class="note" aria-live="polite"><strong>当前指标说明：</strong><span id="largeMoneyMetricExplanation">沪深A股大宗交易的已披露成交金额，按自然周汇总。</span></div>
    </div>
  </section>
`;

const script = `
  <script id="large-money-sentiment-script">
  (() => {
    const largeMoneyData = __LARGE_MONEY_DATA__;
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
        note: "大宗交易放量代表大额筹码交换活跃，需要结合机构席位净方向判断。",
        explanation: "大宗交易额反映已披露的大额股票交易活跃度，不直接代表机构净买入。来源为Tushare大宗交易记录，仅统计沪深A股，排除B股、北交所、债券和基金；按自然周汇总，金额由万元换算为亿元，并与成交价×成交量核对。历史包含后来退市的股票；早年记录较稀疏，未披露不等于没有交易。"
      },
      institutionBlockNet: {
        title: "机构大宗净买入", unit: "亿元", digits: 1,
        subtitle: "沪深A股机构专用席位大宗交易周净买入额",
        note: "正值表示机构席位净买入，负值表示净卖出；极端负值可辅助识别机构撤退。",
        explanation: "机构大宗净买入＝买方为“机构专用”的成交金额－卖方为“机构专用”的成交金额；买卖双方都是机构专用时净额为零。来源为Tushare沪深A股大宗交易席位记录，按自然周汇总，单位亿元。它只覆盖披露的机构专用席位，不代表机构通过普通交易账户的全部买卖。"
      },
      holderNetShares: {
        title: "产业资本净增减持", unit: "亿股", digits: 2,
        subtitle: "重要股东公告口径的周净增减持股数",
        note: "正值为净增持，负值为净减持；该指标按股数汇总，不等同于交易金额。",
        explanation: "产业资本净增减持按重要股东公告中的变动股数汇总：增持记正、减持记负，单位亿股。来源为Tushare stk_holdertrade，按公告日期归入自然周，按公告主体和变动记录去重。它不是成交金额，也不是所有大股东的实时持仓；公告缺失或延后会影响曲线。"
      },
      northMoney: {
        title: "北向资金净流入", unit: "亿元", digits: 1,
        subtitle: "沪深股通日净流入，周末值；序列截至2024年8月16日",
        note: "披露机制变化后不再与旧口径拼接，因此选择最近3年时曲线会在2024年8月结束。",
        explanation: "北向资金净流入采用Tushare moneyflow_hsgt的历史north_money字段。图上每周取最后一个可得交易日的单日值，单位亿元，不是整周净流入合计。旧口径仅保留至2024年8月16日；披露机制变化后不与新口径成交数据拼接，之后留空不表示北向资金为零。"
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
      document.getElementById("largeMoneyMetricExplanation").textContent = cfg.explanation;
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

    window.addEventListener("resize", () => chart.resize());
    renderChart();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing large_money_sentiment_data.json.");
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
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
  .replace("__LARGE_MONEY_DATA__", JSON.stringify(data));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", largeMoneyScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
