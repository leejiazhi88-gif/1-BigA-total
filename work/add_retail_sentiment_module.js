const fs = require("fs");
const path = require("path");
const { guideCss, explanationScript } = require("./sentiment_explanations");
const { chartShell, latestScript } = require("./chart_latest_readings");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = process.argv.includes("--online-only") ? path.join(ROOT, "index.html") : path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "retail_sentiment_data.json");
const MONTHLY_DATA_FILE = path.join(ROOT, "work", "retail_monthly_trends.json");

function stripExisting(html) {
  return html
    .replace(/\s*<section class="module-shell" id="retail-sentiment">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="retail-sentiment-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="retail-sentiment-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<a href="#retail-sentiment"[^>]*>情绪-散户<\/a>/g, "");
}

const css = `
  <style id="retail-sentiment-style">
    ${guideCss("retail-sentiment")}
    .retail-grid {
      display: grid; grid-template-columns: minmax(0, 1fr);
      gap: 15px; align-items: stretch;
    }
    #retailSentimentChart { height: 500px; width: 100%; }
    .retail-monthly-heading { margin: 28px 0 12px; font-size: 20px; }
    .retail-monthly-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .retail-monthly-chart { height: 330px; width: 100%; }
    .retail-monthly-grid .metric-note { padding: 0 16px 14px; }
    #retail-sentiment .panel-head { flex-wrap: wrap; gap: 12px; }
    #retail-sentiment .module-status { white-space: normal; overflow-wrap: anywhere; }
    #retailMetricSubtitle { line-height: 1.7; }
    #retailSmoothing[hidden] { display: none; }
    #retailSeriesControls { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 11px 16px 0; }
    #retailSeriesControls button { display: inline-flex; align-items: center; gap: 6px; padding: 4px 0;
      border: 0; background: transparent; color: #8fa5bf; font-size: 12px; cursor: pointer; }
    #retailSeriesControls button:hover { color: #edf4ff; background: transparent; }
    #retailSeriesControls button[aria-pressed="false"] { opacity: .4; }
    .retail-series-mark { position: relative; width: 22px; height: 12px; flex: none; }
    .retail-series-mark::before { content: ""; position: absolute; left: 0; right: 0; top: 5px;
      border-top: 2px solid var(--series-color); }
    .retail-series-mark::after { content: ""; position: absolute; left: 8px; top: 1px;
      width: 8px; height: 8px; border: 2px solid #edf4ff; border-radius: 50%; background: var(--series-color); }
    @media (max-width: 980px) {
      .retail-grid { grid-template-columns: 1fr; }
      #retailSentimentChart { height: 450px; }
      .retail-monthly-grid { grid-template-columns: 1fr; }
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
        <div id="retailSeriesControls" role="group" aria-label="选择市场曲线">
          <button type="button" data-series="all" aria-pressed="true" style="--series-color:#f6c85f"><span class="retail-series-mark"></span>两市合计</button>
          <button type="button" data-series="sh" aria-pressed="true" style="--series-color:#36c2ff"><span class="retail-series-mark"></span>沪市</button>
          <button type="button" data-series="sz" aria-pressed="true" style="--series-color:#ff5d73"><span class="retail-series-mark"></span>深市</button>
        </div>
        <div class="metric-tabs" id="retailMetricTabs">
          <button class="metric-tab active" data-metric="amount">两市成交额</button>
          <button class="metric-tab" data-metric="volume">两市成交量</button>
          <button class="metric-tab" data-metric="turnover">换手率</button>
          <button class="metric-tab" data-metric="marginBalance">融资余额</button>
          <button class="metric-tab" data-metric="marginFloatRatio">融资余额/流通市值</button>
        </div>
        <div class="metric-tabs" id="retailSmoothing" role="group" aria-label="移动平均采样点数">
          <button class="metric-tab active" data-window="1" aria-pressed="true">原数据</button>
          <button class="metric-tab" data-window="7" aria-pressed="false">7点均线</button>
          <button class="metric-tab" data-window="30" aria-pressed="false">30点均线</button>
        </div>
        ${chartShell("retailSentimentChart", "retailLatestReading")}
      </article>

    </div>

    <div class="valuation-foot single-note">
      <details class="metric-method">
        <summary>指标含义、统计口径与数据来源</summary>
        <div class="metric-guide" id="retailMetricGuide" aria-live="polite"></div>
        <div id="retailMetricExplanation"></div>
      </details>
    </div>
    <h3 class="retail-monthly-heading">月度入场趋势</h3>
    <div class="retail-monthly-grid">
      <article class="valuation-panel">
        <div class="panel-head"><div><div class="panel-title">上交所 A 股新开户</div><div class="panel-subtitle">月度 · 万户</div></div></div>
        ${chartShell("retailAccountsChart", "retailAccountsLatest", "retail-monthly-chart")}
        <div class="metric-note"><span>上交所开户口径，非沪深两市新增投资者人数。</span><span class="metric-reading" id="retailAccountsCoverage"></span></div>
      </article>
      <article class="valuation-panel">
        <div class="panel-head"><div><div class="panel-title">已披露新基金发行份额</div><div class="panel-subtitle">月度 · 亿份</div></div></div>
        ${chartShell("retailFundsChart", "retailFundsLatest", "retail-monthly-chart")}
        <div class="metric-note"><span>淡色月份披露不足 90%；均线仅使用连续三个覆盖达标月份。</span><span class="metric-reading" id="retailFundsCoverage"></span></div>
      </article>
    </div>
    <div class="valuation-foot single-note"><details class="metric-method">
      <summary>月度指标含义、统计口径与数据来源</summary>
      <div class="metric-guide"><ol>
      <li><strong>新开户是什么：</strong>当月在上交所新开立的A股账户数量。增加通常表示开户意愿增强，但一个人可能有多个账户，开户后也未必马上入金交易。</li>
      <li><strong>新基金发行份额是什么：</strong>当月成立基金已披露的初始份额，单位亿份。包含股票、混合、债券等基金，不能全部当作准备买股票的钱。</li>
      <li><strong>怎么看：</strong>两张图分别观察开户和买新基金的活跃程度。优先比较连续几个月及上年同月；淡色基金柱表示披露不全，不能直接认定为发行骤降。</li>
    </ol></div>
    <ol start="4">
      <li><strong>开户统计</strong><p>每个点对应一个统计月份，单位万户，仅为上交所A股新开户，不是全国去重后的新增投资者。</p><p>来源：<a href="https://www.sse.com.cn/aboutus/publication/yearly/" target="_blank" rel="noopener">上交所统计年鉴</a>（2007–2020）与<a href="https://star.sse.com.cn/aboutus/publication/monthly/investor/" target="_blank" rel="noopener">统计月报</a>（2021起）。</p></li>
      <li><strong>基金统计</strong><p>按基金成立月份和基金代码合计已披露发行份额，未披露份额不估算；份额不是募集金额。来源：<a href="https://tushare.pro/document/1?doc_id=19" target="_blank" rel="noopener">Tushare公募基金列表</a>。</p></li>
      <li><strong>三月均线与缺失</strong><p>三月均线取当月与前两个月的平均值，帮助观察趋势。基金发行的均线仅使用连续三个披露覆盖率达到90%的月份。横轴为统计月份，不是公告日期，未公布的月份不补值。</p></li>
    </ol></details></div>
  </section>
`;

const script = `
  <script id="retail-sentiment-script">
  (() => {
    ${latestScript}
    const retailData = __RETAIL_DATA__;
    const monthlyData = __MONTHLY_DATA__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const axisFmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: digits })
      : "--";
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
    ${explanationScript(["amount", "volume", "turnover", "marginBalance", "marginFloatRatio"])}

    const metrics = {
      amount: {
        title: "两市成交额", unit: "亿元", digits: 0,
        subtitle: "两市合计、沪市与深市股票成交额",
        explanation: "沪深股票成交额反映交易活跃度。来源为Tushare交易所市场统计；先计算每日两市合计，再对该周有效交易日求算术平均，沪市、深市分别计算自己的日均值。含A/B股，不含北交所、基金和债券；不是指数成分股口径。2019年前沪市由A/B股分项加总。单位亿元，不是周成交额总和，也不是最后一天的成交额；缺失不补零。"
      },
      volume: {
        title: "两市成交量", unit: "亿股", digits: 2,
        subtitle: "两市合计、沪市与深市股票成交量",
        explanation: "成交量表示实际成交的股票数量，买卖双方不重复计算。统计沪深股票（含A/B股），不含北交所、基金和债券，与本模块成交额范围一致。单位亿股，每周对有效交易日的成交股数求算术平均，不是整周累计。沪市采用Tushare daily_info的股票市场合计，早期用沪A与沪B加总；深市优先采用sz_daily_info的股票合计（股除以1亿），缺报时使用daily_info的深市合计或互不重叠板块加总。2021年4月6日起中小板并入主板，不再重复加中小板；创业板自2009年10月30日起单列。板块缺失不视为零，早期不能完整取得的深市及两市合计留空。"
      },
      turnover: {
        title: "市场换手率", unit: "%", digits: 2,
        subtitle: "两市合计、沪市与深市换手率，按流通市值加权",
        explanation: "换手率衡量股票筹码交换速度。先用每日各股票板块的流通市值对当日换手率加权，再对该周有效日的每日结果求算术平均；两市换手率不是沪、深比例的简单平均，也不是把一周换手率相加。范围含沪深A/B股，不含北交所、基金和债券。来源为Tushare交易所板块换手率及流通市值，单位%；缺失不补零。"
      },
      marginBalance: {
        title: "融资余额", unit: "亿元", digits: 0,
        subtitle: "两市合计、沪市与深市融资余额",
        explanation: "融资余额是投资者尚未偿还的融资买入资金余额，用来观察杠杆存量，不是当日融资买入额。来源为Tushare沪深交易所融资余额；两市合计为沪市与深市之和。单位亿元，每周取最后可得交易日的余额，不是周累计。融资融券业务于2010年3月启动，更早年份不适用；缺失不补零。"
      },
      marginFloatRatio: {
        title: "融资余额/流通市值", unit: "%", digits: 2,
        subtitle: "融资余额占对应市场流通市值比例",
        explanation: "融资余额/流通市值用于观察杠杆资金相对市场规模的拥挤程度。沪市、深市各以本市场融资余额除以本市场股票流通市值；两市合计以两市融资余额之和除以两市流通市值之和，不是两个比例的平均。来源为Tushare交易所融资及市场统计，单位%；每周取最后可得交易日的值，2010年3月以前不适用，缺失不补零。"
      }
    };
    const coverage = Object.fromEntries(Object.keys(metrics).map(key => {
      const rows = retailData.series.filter(row => Number.isFinite(row[key]));
      return [key, { start: rows[0]?.date, end: rows[rows.length - 1]?.date }];
    }));
    const startYear = key => coverage[key].start?.slice(0, 4) || "暂无";
    document.getElementById("retailCoverageStatus").textContent = "成交额/换手 " + startYear("amount") + "年起 · 成交量 " + startYear("volume") + "年起 · 融资 " +
      startYear("marginBalance") + "年起";

    let activeMetric = "amount";
    let activeYears = 0;
    const markets = [
      { key: "all", name: "两市合计", rows: retailData.series, color: "#f6c85f" },
      { key: "sh", name: "沪市", rows: retailData.markets.sh, color: "#36c2ff" },
      { key: "sz", name: "深市", rows: retailData.markets.sz, color: "#ff5d73" }
    ];
    const selectedSeries = new Set(markets.map(market => market.key));
    let smoothingWindow = 1;
    function metricRows(source, field, weeklyAverage) {
      // Other indicators can add a second date to the same week; exclude those empty slots.
      const rows = source.filter(row => Number.isFinite(row[field]) || (weeklyAverage && row.weeklySamples?.[field]));
      if (!weeklyAverage || smoothingWindow === 1) return rows;
      return rows.map((row, index) => {
        const window = rows.slice(Math.max(0, index - smoothingWindow + 1), index + 1);
        const valid = window.length === smoothingWindow && window.every(item => Number.isFinite(item[field]));
        return { ...row, [field]: valid ? window.reduce((sum, item) => sum + item[field], 0) / smoothingWindow : null };
      });
    }
    const chart = echarts.init(document.getElementById("retailSentimentChart"), null, { renderer: "canvas" });

    function renderChart(preserveZoom = false) {
      const cfg = metrics[activeMetric];
      const weeklyAverage = ["amount", "volume", "turnover"].includes(activeMetric);
      const smoothingLabel = smoothingWindow === 1 ? "原数据" : smoothingWindow + "点均线";
      const previousZoom = preserveZoom ? chart.getOption().dataZoom?.[0] : null;
      document.getElementById("retailSmoothing").hidden = !weeklyAverage;
      const end = new Date(retailData.series[retailData.series.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      if (activeYears) cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      const minDate = activeYears ? cutoff.toISOString().slice(0, 10) : "";
      const visibleMarkets = markets.filter(market => selectedSeries.has(market.key)).map(market => ({
        ...market, rows: metricRows(market.rows, activeMetric, weeklyAverage)
      }));
      const series = visibleMarkets.map(market => ({
        name: market.name, type: "line",
        data: market.rows.filter(row => row.date >= minDate)
          .map(row => [row.date, row[activeMetric]]),
        showSymbol: false, sampling: "lttb", connectNulls: false,
        lineStyle: { width: 2.2, color: market.color }, itemStyle: { color: market.color }
      }));
      const latest = series.map(item => {
        const market = visibleMarkets.find(market => market.name === item.name);
        const point = market.rows.at(-1);
        const days = point?.weeklySamples?.[activeMetric]?.days;
        return { name: item.name, color: item.itemStyle.color, value: point?.[activeMetric], date: point?.date, unit: cfg.unit, digits: cfg.digits,
          status: weeklyAverage && !Number.isFinite(point?.[activeMetric]) ? "窗口不足或数据缺失"
            : weeklyAverage && days ? (smoothingWindow > 1 ? "最近周" : "") + days + "个有效交易日" : "" };
      });
      const span = coverage[activeMetric];
      document.getElementById("retailMetricSubtitle").textContent = cfg.subtitle + (weeklyAverage ? " · 周内日均 · " + smoothingLabel : " · 周末时点") + " · 可用历史 " +
        (span.start ? span.start + " 至 " + span.end : "暂无");
      renderExplanation("retail", activeMetric, [
        ["时间与采样", weeklyAverage
          ? "按自然周（周一至周日），将周内全部有效交易日的该项数值相加，再除以有效天数；每个交易日权重相同，合法的零值计入，周末、节假日及缺报日不按零计。横轴标在该指标周内最后一个有效观测日，不代表只使用那一天；悬浮提示标明有效起止日与天数。未结束的周只平均截至数据截止日已取得的观测。不跨周填补缺失，三个市场分别使用各自有效日，若缺报日不同，日均合计未必等于两个市场日均值之和"
          : "按自然周（周一至周日），每个指标取周内最后一次有效观测，横轴为实际观测日期。通常接近周五，节假日或缺报时可能提前，不取周平均、不跨周补值"],
        ["计算范围与来源", cfg.explanation],
        ...(weeklyAverage ? [["当前平滑方式", smoothingLabel + "。原数据为周内有效交易日的日均值；7点／30点均线取当前及此前6／29个原始周采样点的算术平均，不是7／30天，也不是累计值。先用完整历史计算，再截取所选时间范围；三个市场分别计算。窗口不足或含明确缺失值时留空，不补零；没有观测的周不新增采样点，因此7／30点未必等于连续7／30个自然周。最新读数和悬浮值随当前模式更新，提示的有效交易日区间及天数仅指当前点对应原始周"]] : [])
      ]);
      renderChartLatest("retailLatestReading", cfg.title, latest, weeklyAverage ? "周内日均 · " + smoothingLabel : "");
      chart.setOption({
        animation: false,
        backgroundColor: "transparent",
        grid: { left: 72, right: 28, top: chartLatestTop("retailLatestReading"), bottom: 64 },
        legend: { show: false },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          confine: true, backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            return "<b>" + (params[0]?.axisValueLabel || "") + (weeklyAverage ? " · 周内日均 · " + smoothingLabel : "") + "</b><br>" +
              params.map(item => {
                const market = markets.find(market => market.name === item.seriesName);
                const sample = market?.rows.find(row => row.date === item.value[0])?.weeklySamples?.[activeMetric];
                return item.marker + item.seriesName + "：<b>" + fmt(item.value[1], cfg.digits) + cfg.unit + "</b>" +
                  (weeklyAverage && sample ? "<br>" + (smoothingWindow > 1 ? "当前点原数据" : "") + "有效区间：" + sample.start + " 至 " + sample.end + "（" + sample.days + "个交易日）" : "");
              }).join("<br>");
          }
        },
        xAxis: {
          type: "time", min: minDate || retailData.series[0].date,
          max: retailData.series[retailData.series.length - 1].date,
          axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false }
        },
        yAxis: {
          type: "value", scale: !["amount", "volume", "marginBalance"].includes(activeMetric),
          min: ["amount", "volume", "marginBalance"].includes(activeMetric) ? 0 : undefined,
          axisLabel: { color: "#7890aa", formatter: value => axisFmt(value, cfg.digits) + cfg.unit },
          splitLine: { lineStyle: { color: "#17283d" } }
        },
        dataZoom: [
          { type: "slider", bottom: 12, height: 22, start: 0, end: 100,
            ...(previousZoom ? { start: previousZoom.start, end: previousZoom.end } : {}),
            borderColor: "#263b58", backgroundColor: "#0d1929",
            fillerColor: "rgba(246,200,95,.18)", handleStyle: { color: "#f6c85f" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series
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
    document.querySelectorAll("#retailSmoothing [data-window]").forEach(button => {
      button.addEventListener("click", () => {
        smoothingWindow = Number(button.dataset.window);
        document.querySelectorAll("#retailSmoothing [data-window]").forEach(item => {
          const selected = Number(item.dataset.window) === smoothingWindow;
          item.classList.toggle("active", selected);
          item.setAttribute("aria-pressed", String(selected));
        });
        renderChart(true);
      });
    });
    document.querySelectorAll("#retailSeriesControls [data-series]").forEach(button => {
      button.addEventListener("click", () => {
        const key = button.dataset.series;
        if (selectedSeries.has(key)) {
          if (selectedSeries.size === 1) return;
          selectedSeries.delete(key);
        } else {
          selectedSeries.add(key);
        }
        button.setAttribute("aria-pressed", String(selectedSeries.has(key)));
        renderChart(true);
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

    function movingAverage(values, valid = () => true) {
      return values.map((_, index) => index >= 2 && [index - 2, index - 1, index].every(valid)
        ? Number(((values[index - 2] + values[index - 1] + values[index]) / 3).toFixed(2))
        : null);
    }

    function monthlyOption(rows, field, unit, color, fund = false) {
      const values = rows.map(row => row[field]);
      const average = movingAverage(values, index => !fund || rows[index].coverage >= 90);
      const readingId = fund ? "retailFundsLatest" : "retailAccountsLatest";
      const latest = rows.at(-1);
      renderChartLatest(readingId, fund ? "新基金发行份额" : "上交所A股新开户", [
        { name: fund ? "已披露份额" : "新开户", value: latest?.[field], date: latest?.month, unit, color, digits: 1,
          status: fund && latest?.coverage < 90 ? "披露覆盖 " + fmt(latest.coverage, 1) + "%" : "" },
        { name: "3月均线", value: average.at(-1), date: latest?.month, unit, color: fund ? "#36c2ff" : "#edf4ff", digits: 1,
          status: Number.isFinite(average.at(-1)) ? "" : "连续三月覆盖不足" }
      ]);
      const top = chartLatestTop(readingId);
      return {
        animation: false,
        grid: { left: 64, right: 20, top: top + 30, bottom: 58 },
        legend: { top: top - 2, right: 18, textStyle: { color: "#8fa5bf", fontSize: 11 },
          data: [fund ? "已披露份额" : "新开户", "3月均线"] },
        tooltip: { trigger: "axis", backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" }, formatter(params) {
            const row = rows[params[0]?.dataIndex];
            if (!row) return "";
            const lines = params.filter(item => item.value != null).map(item =>
              item.marker + item.seriesName + "：<b>" + fmt(Number(item.value), 1) + unit + "</b>");
            if (fund) lines.push("发行份额披露：" + row.reported + "/" + row.funds + "（" + row.coverage + "%）");
            return "<b>" + row.month + "</b><br>" + lines.join("<br>");
          } },
        xAxis: { type: "category", data: rows.map(row => row.month), boundaryGap: true,
          axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true } },
        yAxis: { type: "value", min: 0, axisLabel: { color: "#7890aa", formatter: value => axisFmt(value, 0) + unit },
          splitLine: { lineStyle: { color: "#17283d" } } },
        dataZoom: [{ type: "slider", bottom: 8, height: 18, borderColor: "#263b58",
            backgroundColor: "#0d1929", fillerColor: "rgba(246,200,95,.18)",
            handleStyle: { color: "#f6c85f" }, textStyle: { color: "#8fa5bf" } }],
        series: [
          { name: fund ? "已披露份额" : "新开户", type: "bar", barMaxWidth: 16,
            itemStyle: { color },
            data: rows.map(row => ({ value: row[field],
              itemStyle: { opacity: fund && row.coverage < 90 ? .3 : .85 } })) },
          { name: "3月均线", type: "line", data: average, showSymbol: false, connectNulls: false,
            lineStyle: { color: fund ? "#36c2ff" : "#edf4ff", width: 2 },
            itemStyle: { color: fund ? "#36c2ff" : "#edf4ff" } }
        ]
      };
    }

    const accountsChart = echarts.init(document.getElementById("retailAccountsChart"), null, { renderer: "canvas" });
    const fundsChart = echarts.init(document.getElementById("retailFundsChart"), null, { renderer: "canvas" });
    accountsChart.setOption(monthlyOption(monthlyData.accounts, "accountsWan", "万户", "#f6c85f"));
    fundsChart.setOption(monthlyOption(monthlyData.funds, "sharesYi", "亿份", "#7ddc82", true));
    bindLatestLegend(accountsChart, "retailAccountsLatest");
    bindLatestLegend(fundsChart, "retailFundsLatest");
    const latestAccounts = monthlyData.accounts.at(-1);
    const latestFunds = monthlyData.funds.at(-1);
    document.getElementById("retailAccountsCoverage").textContent = "最新 " + latestAccounts.month;
    document.getElementById("retailFundsCoverage").textContent =
      "最新 " + latestFunds.month + " · 披露 " + latestFunds.coverage + "%";
    window.addEventListener("resize", () => {
      chart.resize(); accountsChart.resize(); fundsChart.resize();
      layoutChartLatest(chart, "retailLatestReading");
      layoutChartLatest(accountsChart, "retailAccountsLatest", true);
      layoutChartLatest(fundsChart, "retailFundsLatest", true);
    });
    renderChart();
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing retail_sentiment_data.json.");
if (!fs.existsSync(MONTHLY_DATA_FILE)) throw new Error("Missing retail_monthly_trends.json.");

const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const monthlyData = JSON.parse(fs.readFileSync(MONTHLY_DATA_FILE, "utf8"));
const originalHtml = fs.readFileSync(OUTPUT, "utf8");
let html = stripExisting(originalHtml);
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
  .replace("__MONTHLY_DATA__", JSON.stringify(monthlyData));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", retailScript + "\n");
if (process.argv.includes("--online-only") && originalHtml.includes('id="retail-sentiment"')) {
  html = originalHtml
    .replace(/<style id="retail-sentiment-style">[\s\S]*?<\/style>/, () => css.trim())
    .replace(/<section class="module-shell" id="retail-sentiment">[\s\S]*?<\/section>/, () => moduleHtml.trim())
    .replace(/<script id="retail-sentiment-script">[\s\S]*?<\/script>/, () => retailScript.trim());
}
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
