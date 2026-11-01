const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "official_sentiment_data.json");

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
      display: grid; grid-template-columns: minmax(0, 1fr);
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
      <div class="module-status">M2自1991年 / 其他指标按各自披露起点</div>
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
            <button class="range-tab" data-years="10">10年</button>
            <button class="range-tab" data-years="20">20年</button>
            <button class="range-tab" data-years="30">30年</button>
            <button class="range-tab active" data-years="0">全部</button>
          </div>
        </div>
        <div class="metric-tabs" id="officialMetricTabs">
          <button class="metric-tab active" data-metric="ipoFunds">IPO融资额</button>
          <button class="metric-tab" data-metric="netReduceAmount">产业资本净减持额</button>
          <button class="metric-tab" data-metric="stampTaxRate">印花税率</button>
          <button class="metric-tab" data-metric="policyRate">政策利率</button>
          <button class="metric-tab" data-metric="socialFinancing">社融增量</button>
          <button class="metric-tab" data-metric="m2Yoy">M2增速</button>
        </div>
        <div class="metric-note">
          <span id="officialMetricNote">IPO融资额反映一级市场供给节奏，过快扩容可能压制二级市场风险偏好。</span>
          <span class="metric-reading" id="officialLatestReading"></span>
        </div>
        <div id="officialSentimentChart"></div>
      </article>

    </div>

    <div class="valuation-foot single-note">
      <div class="note" aria-live="polite"><strong>当前指标说明：</strong><span id="officialMetricExplanation">A股IPO募集资金反映一级市场新股融资供给，按自然周汇总。</span></div>
    </div>
  </section>
`;

const script = `
  <script id="official-sentiment-script">
  (() => {
    const officialData = __OFFICIAL_DATA__;
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
        note: "IPO融资额反映一级市场供给节奏，过快扩容可能压制二级市场风险偏好.",
        explanation: "IPO融资额是新股发行募集资金，反映一级市场资金供给节奏，不是二级市场成交额。来源为Tushare new_share的funds字段，按IPO日期或发行日期归入自然周求和，单位亿元；未披露的发行不估算。"
      },
      netReduceAmount: {
        title: "产业资本净减持额", unit: "亿元", digits: 1,
        subtitle: "重要股东增减持公告金额，按周汇总",
        note: "正值为净减持，负值为净增持；仅统计公告披露均价的记录.",
        explanation: "产业资本净减持额按重要股东增减持公告估算：变动股数×披露均价，减持记正、增持记负，再按自然周汇总，单位亿元。来源为Tushare stk_holdertrade；没有均价的记录不计入，缺失不补零。它是公告样本，不等于全部产业资本净卖出。"
      },
      stampTaxRate: {
        title: "印花税率", unit: "%", digits: 2,
        subtitle: "证券交易印花税政策阶梯序列",
        note: "印花税调整直接改变交易摩擦成本，常用于传递活跃或抑制交易的政策信号.",
        explanation: "印花税率反映证券交易印花税政策规定的税率，单位%。来源为人工核对并维护的政策生效日与税率；图上采用阶梯线，表示下次调整前税率保持不变，不做线性插值。它是政策参数，不是实际征收税额。"
      },
      policyRate: {
        title: "政策利率代理", unit: "%", digits: 2,
        subtitle: "1年期SHIBOR，周末值",
        note: "用1年期SHIBOR代理资金利率环境，下降通常对应流动性边际改善.",
        explanation: "此页签使用1年期SHIBOR观察银行间资金价格，来源为Tushare shibor的1y字段，取每周最后一个可用值，单位%。它只是利率环境代理，并非央行直接设定的政策利率；图上升降不能单独解释为央行加息或降息。"
      },
      socialFinancing: {
        title: "社融增量", unit: "亿元", digits: 0,
        subtitle: "社会融资规模月度增量",
        note: "社融增量反映实体信用扩张力度，权益市场常关注其趋势拐点.",
        explanation: "社融增量是当月新增社会融资规模，观察实体部门融资扩张速度；来源为Tushare sf_month的inc_month字段。按月展示并落在月末，单位亿元；它是增量，不是社融存量或同比增速，不与周频指标混作同一口径。"
      },
      m2Yoy: {
        title: "M2增速", unit: "%", digits: 1,
        subtitle: "M2同比增速，月度数据",
        note: "M2同比用于观察广义流动性环境，需结合社融和政策利率判断.",
        explanation: "M2增速是广义货币供应量的同比增速，反映货币总量变化。来源为Tushare cn_m的m2_yoy字段，按月展示并落在月末，单位%；不是当月新增货币量。可结合社融与利率观察流动性，但不能单独推断股市涨跌。"
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
      document.getElementById("officialMetricExplanation").textContent = cfg.explanation;
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
    window.addEventListener("resize", () => chart.resize());
    renderChart();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing official_sentiment_data.json.");
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
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
  .replace("__OFFICIAL_DATA__", JSON.stringify(data));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", officialScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
