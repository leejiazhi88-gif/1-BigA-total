const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "official_sentiment_data.json");
const EVENTS_FILE = path.join(ROOT, "work", "official_sentiment_events.json");

function stripExisting(html) {
  return html
    .replace(/\s*<section class="module-shell" id="official-sentiment">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="official-sentiment-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="official-sentiment-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<a href="#official-sentiment"[^>]*>情绪-官方<\/a>/g, "");
}

const css = `
  <style id="official-sentiment-style">
    .official-grid {
      display: grid; grid-template-columns: minmax(0, 1.68fr) minmax(360px, .82fr);
      gap: 15px; align-items: stretch;
    }
    #officialSentimentChart { height: 500px; width: 100%; }
    .official-methodology {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px; margin-top: 10px;
    }
    .official-method {
      border: 1px solid var(--line); border-radius: 8px;
      background: rgba(8, 18, 32, .62); padding: 11px 12px;
    }
    .official-method strong {
      display: block; color: var(--text); font-size: 13px; margin-bottom: 5px;
    }
    .official-method span {
      display: block; color: var(--muted); font-size: 12px; line-height: 1.62;
    }
    @media (max-width: 980px) {
      .official-grid { grid-template-columns: 1fr; }
      #officialSentimentChart { height: 450px; }
      .official-methodology { grid-template-columns: 1fr; }
    }
  </style>
`;

const moduleHtml = `
  <section class="module-shell" id="official-sentiment">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 04 / Official Sentiment</div>
        <h2>情绪-官方</h2>
        <p>观察发行融资、产业资本、货币信用与监管政策，识别官方对市场温度的调节方向。</p>
      </div>
      <div class="module-status">IPO/政策利率 2006年至今 / 宏观月度至最新披露</div>
    </div>

    <div class="official-grid">
      <article class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">连续走势图</div>
            <div class="panel-subtitle" id="officialMetricSubtitle">A股IPO募集资金，按周汇总</div>
          </div>
          <div class="range-tabs" id="officialRangeTabs">
            <button class="range-tab" data-years="3">3年</button>
            <button class="range-tab" data-years="5">5年</button>
            <button class="range-tab active" data-years="0">全部</button>
          </div>
        </div>
        <div class="metric-tabs" id="officialMetricTabs">
          <button class="metric-tab active" data-metric="ipoFunds">IPO融资额</button>
          <button class="metric-tab" disabled title="当前未接入可靠再融资全量数据源">再融资额</button>
          <button class="metric-tab" data-metric="netReduceAmount">产业资本净减持额</button>
          <button class="metric-tab" data-metric="stampTaxRate">印花税率</button>
          <button class="metric-tab" data-metric="policyRate">政策利率</button>
          <button class="metric-tab" data-metric="socialFinancing">社融增量</button>
          <button class="metric-tab" data-metric="m2Yoy">M2增速</button>
          <button class="metric-tab" disabled title="国家队持仓需人工定义机构名单与持仓口径">国家队持仓规模</button>
        </div>
        <div class="metric-note">
          <span id="officialMetricNote">IPO融资额反映一级市场供给节奏，过快扩容可能压制二级市场风险偏好。</span>
          <span class="metric-reading" id="officialLatestReading"></span>
        </div>
        <div id="officialSentimentChart"></div>
      </article>

      <aside class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">官方情绪事件 List</div>
            <div class="panel-subtitle">加息/降息、降准、IPO节奏、印花税、减持、汇金与监管政策</div>
          </div>
          <div class="event-controls">
            <select id="officialEventYear" class="event-select" aria-label="官方事件年份"></select>
            <select id="officialEventQuarter" class="event-select" aria-label="官方事件季度">
              <option value="Q1">Q1</option><option value="Q2">Q2</option>
              <option value="Q3">Q3</option><option value="Q4">Q4</option>
            </select>
          </div>
        </div>
        <div class="event-body">
          <div class="quarter-summary">
            <div class="quarter-label" id="officialEventPeriod"></div>
            <div class="event-count" id="officialEventCount"></div>
          </div>
          <div class="quarter-dashboard" id="officialQuarterDashboard"></div>
          <ul class="event-list" id="officialEventList"></ul>
        </div>
      </aside>
    </div>

    <div class="valuation-foot">
      <div class="note"><strong>连续数据口径总览：</strong>周频指标按自然周汇总并落在该周最后一个可用日期；月度宏观指标落在月末；印花税率按政策生效日做阶梯序列，不做线性插值。</div>
      <div class="note"><strong>国家队持仓规模为什么暂缺：</strong>没有官方统一的连续披露口径。若把中央汇金、证金、社保、外汇局、险资、公募ETF申购或稳定市场工具混在一起，结果会高度依赖人工机构名单和持仓范围，容易画出看似精确但不可复核的曲线，所以当前只保留事件记录，不绘制连续指标。</div>
      <div class="official-methodology" aria-label="官方情绪指标统计口径">
        <div class="official-method"><strong>IPO融资额</strong><span>来源为 Tushare new_share 的 funds 字段，按 IPO 日期或发行日期归入自然周求和，单位亿元；用于观察一级市场供给节奏。</span></div>
        <div class="official-method"><strong>再融资额</strong><span>暂未接入。定增、配股、可转债、优先股等口径需要统一发行日、募资额和失败/撤回处理规则，当前不画不完整曲线。</span></div>
        <div class="official-method"><strong>产业资本净减持额</strong><span>来源为 Tushare stk_holdertrade；仅统计公告中有均价的增减持记录，金额=变动股数×均价，减持记正、增持记负，按周汇总，单位亿元。</span></div>
        <div class="official-method"><strong>印花税率</strong><span>手工维护证券交易印花税政策生效日与税率，单位%；图上按阶梯线展示，表示税率在下一次政策调整前保持不变。</span></div>
        <div class="official-method"><strong>政策利率</strong><span>用 1年期 SHIBOR 作为资金利率环境代理，取每周最后一个可用值，单位%；它不是央行政策利率本身，但可观察银行间资金价格趋势。</span></div>
        <div class="official-method"><strong>社融增量</strong><span>来源为 Tushare sf_month 的 inc_month，月度社会融资规模增量，落在月末，单位亿元；用于观察信用扩张或收缩。</span></div>
        <div class="official-method"><strong>M2增速</strong><span>来源为 Tushare cn_m 的 m2_yoy，月度 M2 同比增速，落在月末，单位%；需结合社融和利率判断流动性状态。</span></div>
        <div class="official-method"><strong>国家队持仓规模</strong><span>暂无统一的连续总市值序列。下方<a href="#national-team-etf">国家队观察</a>展示宽基ETF每日净申购估算和长期底层股票披露暴露；两者均不等于国家队实际持仓总规模。</span></div>
      </div>
    </div>
  </section>
`;

const script = `
  <script id="official-sentiment-script">
  (() => {
    const officialData = __OFFICIAL_DATA__;
    const officialEvents = __OFFICIAL_EVENTS__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
    const metrics = {
      ipoFunds: {
        title: "IPO融资额", unit: "亿元", digits: 1,
        subtitle: "A股IPO募集资金，按周汇总",
        note: "IPO融资额反映一级市场供给节奏，过快扩容可能压制二级市场风险偏好."
      },
      netReduceAmount: {
        title: "产业资本净减持额", unit: "亿元", digits: 1,
        subtitle: "重要股东增减持公告金额，按周汇总",
        note: "正值为净减持，负值为净增持；仅统计公告披露均价的记录."
      },
      stampTaxRate: {
        title: "印花税率", unit: "%", digits: 2,
        subtitle: "证券交易印花税政策阶梯序列",
        note: "印花税调整直接改变交易摩擦成本，常用于传递活跃或抑制交易的政策信号."
      },
      policyRate: {
        title: "政策利率代理", unit: "%", digits: 2,
        subtitle: "1年期SHIBOR，周末值",
        note: "用1年期SHIBOR代理资金利率环境，下降通常对应流动性边际改善."
      },
      socialFinancing: {
        title: "社融增量", unit: "亿元", digits: 0,
        subtitle: "社会融资规模月度增量",
        note: "社融增量反映实体信用扩张力度，权益市场常关注其趋势拐点."
      },
      m2Yoy: {
        title: "M2增速", unit: "%", digits: 1,
        subtitle: "M2同比增速，月度数据",
        note: "M2同比用于观察广义流动性环境，需结合社融和政策利率判断."
      }
    };
    let activeMetric = "ipoFunds";
    let activeYears = 0;
    const chart = echarts.init(document.getElementById("officialSentimentChart"), null, { renderer: "canvas" });
    function activeRows() {
      const rows = officialData.series.filter(row => Number.isFinite(row[activeMetric]));
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
      document.getElementById("officialMetricSubtitle").textContent = cfg.subtitle;
      document.getElementById("officialMetricNote").textContent = cfg.note;
      document.getElementById("officialLatestReading").textContent =
        (points[points.length - 1]?.[0] || "暂无") + "：" + fmt(latest, cfg.digits) + cfg.unit;
      chart.setOption({
        animation: false, backgroundColor: "transparent",
        grid: { left: 72, right: 28, top: 42, bottom: 64 },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
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
            fillerColor: "rgba(255,93,115,.16)", handleStyle: { color: "#ff5d73" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series: [{
          name: cfg.title, type: "line", data: points, showSymbol: false,
          step: activeMetric === "stampTaxRate" ? "end" : false,
          sampling: "lttb", lineStyle: { width: 2.2, color: "#ff5d73" },
          areaStyle: { color: "rgba(255,93,115,.08)" }, itemStyle: { color: "#ff5d73" }
        }]
      }, true);
    }
    document.querySelectorAll("#officialMetricTabs [data-metric]").forEach(button => {
      button.addEventListener("click", () => {
        activeMetric = button.dataset.metric;
        document.querySelectorAll("#officialMetricTabs [data-metric]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });
    document.querySelectorAll("#officialRangeTabs [data-years]").forEach(button => {
      button.addEventListener("click", () => {
        activeYears = Number(button.dataset.years);
        document.querySelectorAll("#officialRangeTabs [data-years]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });
    const yearSelect = document.getElementById("officialEventYear");
    const quarterSelect = document.getElementById("officialEventQuarter");
    const latestDate = officialData.series[officialData.series.length - 1].date;
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
    function latestQuarterRow(key) {
      const rows = officialData.series.filter(row => quarterKey(row.date) === key);
      return rows[rows.length - 1];
    }
    function renderEvents() {
      const key = yearSelect.value + "-" + quarterSelect.value;
      const events = officialEvents[key] || [];
      const row = latestQuarterRow(key);
      document.getElementById("officialEventPeriod").textContent = key;
      document.getElementById("officialEventCount").textContent = events.length ? events.length + "条事件" : "暂无事件";
      document.getElementById("officialQuarterDashboard").innerHTML = [
        ["IPO融资额", Number.isFinite(row?.ipoFunds) ? fmt(row.ipoFunds, 1) + "亿元" : "暂无数据"],
        ["净减持额", Number.isFinite(row?.netReduceAmount) ? fmt(row.netReduceAmount, 1) + "亿元" : "暂无数据"],
        ["政策利率", Number.isFinite(row?.policyRate) ? fmt(row.policyRate, 2) + "%" : "暂无数据"],
        ["M2增速", Number.isFinite(row?.m2Yoy) ? fmt(row.m2Yoy, 1) + "%" : "暂无数据"]
      ].map(([label, value]) => '<div><span>' + label + '</span><strong>' + value + '</strong></div>').join("");
      document.getElementById("officialEventList").innerHTML = events.length ? events.map(event =>
        '<li class="event-item"><div class="event-tag">' + escapeHtml(event.type) + '</div>' +
        '<div class="event-title">' + escapeHtml(event.title) + '</div>' +
        '<div class="event-desc">' + escapeHtml(event.desc) + '</div>' +
        '<div class="event-meta">' + escapeHtml(event.meta || "") + '</div></li>'
      ).join("") : '<li class="event-empty">该季度暂无符合官方情绪事件口径的记录</li>';
    }
    yearSelect.addEventListener("change", renderEvents);
    quarterSelect.addEventListener("change", renderEvents);
    window.addEventListener("resize", () => chart.resize());
    renderChart();
    renderEvents();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing official_sentiment_data.json.");
if (!fs.existsSync(EVENTS_FILE)) throw new Error("Missing official_sentiment_events.json.");
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const events = JSON.parse(fs.readFileSync(EVENTS_FILE, "utf8"));
let html = stripExisting(fs.readFileSync(OUTPUT, "utf8"));
html = html.replace(
  '<a href="#large-money-sentiment">情绪-大资金</a>',
  '<a href="#large-money-sentiment">情绪-大资金</a><a href="#official-sentiment">情绪-官方</a>'
);
function insertBeforeLast(source, marker, content) {
  const index = source.lastIndexOf(marker);
  if (index === -1) throw new Error(`Marker not found: ${marker}`);
  return source.slice(0, index) + content + source.slice(index);
}
const officialScript = script
  .replace("__OFFICIAL_DATA__", JSON.stringify(data))
  .replace("__OFFICIAL_EVENTS__", JSON.stringify(events.quarters));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", officialScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
