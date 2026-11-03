const fs = require("fs");
const path = require("path");
const { guideCss, explanationScript } = require("./sentiment_explanations");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = process.argv.includes("--online-only")
  ? path.join(ROOT, "index.html")
  : path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "large_money_sentiment_data.json");
const HOLDINGS_FILE = path.join(ROOT, "work", "northbound_holdings.json");
const FUND_REPORTS_FILE = path.join(ROOT, "work", "large_money_fund_reports.json");
const ETF_SHARES_FILE = path.join(ROOT, "work", "large_money_etf_shares.json");

function stripExisting(html) {
  return html
    .replace(/\s*<section class="module-shell" id="large-money-sentiment">[\s\S]*?<\/section>/g, "<!-- LARGE_MONEY_MODULE -->")
    .replace(/\s*<style id="large-money-sentiment-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="large-money-sentiment-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<a href="#large-money-sentiment"[^>]*>情绪-大资金<\/a>/g, "");
}

const css = `
  <style id="large-money-sentiment-style">
    ${guideCss("large-money-sentiment")}
    .large-money-grid {
      display: grid; grid-template-columns: minmax(0, 1fr);
      gap: 15px; align-items: stretch;
    }
    #largeMoneyChart { height: 500px; width: 100%; }
    #large-money-sentiment .panel-head { flex-wrap: wrap; gap: 12px; }
    #large-money-sentiment .module-status { white-space: normal; overflow-wrap: anywhere; }
    #largeMoneyMetricSubtitle { line-height: 1.7; }
    #largeMoneyHoldingModes[hidden], #largeMoneyHoldingCoverage[hidden], #largeMoneySmoothing[hidden] { display: none; }
    #largeMoneyHoldingCoverage { padding: 0 16px 12px; color: #8fa5bf; font-size: 12px; line-height: 1.7; }
    #largeMoneySeriesControls { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 11px 16px 0; }
    #largeMoneySeriesControls button { display: inline-flex; align-items: center; gap: 6px; padding: 4px 0;
      border: 0; background: transparent; color: #8fa5bf; font-size: 12px; cursor: pointer; }
    #largeMoneySeriesControls button:hover { color: #edf4ff; background: transparent; }
    #largeMoneySeriesControls button[aria-pressed="false"] { opacity: .4; }
    .large-money-series-mark { position: relative; width: 22px; height: 12px; flex: none; }
    .large-money-series-mark::before { content: ""; position: absolute; left: 0; right: 0; top: 5px;
      border-top: 2px solid var(--series-color); }
    .large-money-series-mark::after { content: ""; position: absolute; left: 8px; top: 1px;
      width: 8px; height: 8px; border: 2px solid #edf4ff; border-radius: 50%; background: var(--series-color); }
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
      <div class="module-status" id="largeMoneyDataStatus">大宗交易自2002年 / 股东增减持自2000年 / 北向持仓按季度</div>
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
        <div id="largeMoneySeriesControls" role="group" aria-label="大资金市场曲线">
          <button type="button" data-series="all" aria-pressed="true" style="--series-color:#f6c85f"><span class="large-money-series-mark"></span>两市合计</button>
          <button type="button" data-series="sh" aria-pressed="true" style="--series-color:#36c2ff"><span class="large-money-series-mark"></span>沪市</button>
          <button type="button" data-series="sz" aria-pressed="true" style="--series-color:#ff5d73"><span class="large-money-series-mark"></span>深市</button>
        </div>
        <div class="metric-tabs" id="largeMoneyMetricTabs">
          <button class="metric-tab active" data-metric="blockAmount">大宗交易额</button>
          <button class="metric-tab" data-metric="institutionBlockNet">机构大宗净买入</button>
          <button class="metric-tab" data-metric="holderNetShares">产业资本净增减持</button>
          <button class="metric-tab" data-metric="northHoldings">北向持仓分布</button>
          <button class="metric-tab" data-metric="fundPosition">主动权益基金仓位</button>
          <button class="metric-tab" data-metric="institutionConcentration">机构持仓集中度</button>
          <button class="metric-tab" data-metric="etfShares">ETF份额变化</button>
        </div>
        <div class="metric-tabs" id="largeMoneySmoothing" role="group" aria-label="移动平均采样点数">
          <button class="metric-tab active" data-window="1" aria-pressed="true">原数据</button>
          <button class="metric-tab" data-window="7" aria-pressed="false">7点均线</button>
          <button class="metric-tab" data-window="30" aria-pressed="false">30点均线</button>
        </div>
        <div class="metric-tabs" id="largeMoneyHoldingModes" role="group" aria-label="北向持仓统计口径" hidden>
          <button class="metric-tab active" data-mode="value" aria-pressed="true">持仓市值</button>
          <button class="metric-tab" data-mode="ratio" aria-pressed="false">持仓比例</button>
        </div>
        <div class="metric-note metric-reading-row">
          <span class="metric-reading" id="largeMoneyLatestReading"></span>
        </div>
        <div id="largeMoneyChart"></div>
        <div id="largeMoneyHoldingCoverage" aria-live="polite" hidden></div>
      </article>

    </div>

    <div class="valuation-foot single-note">
      <details class="metric-method">
        <summary>指标含义、统计口径与数据来源</summary>
        <div class="metric-guide" id="largeMoneyMetricGuide" aria-live="polite"></div>
        <div id="largeMoneyMetricExplanation"></div>
      </details>
    </div>
  </section>
`;

const script = `
  <script id="large-money-sentiment-script">
  (() => {
    const largeMoneyData = __LARGE_MONEY_DATA__;
    const northHoldings = __NORTH_HOLDINGS_DATA__;
    const fundReports = __FUND_REPORTS_DATA__;
    const etfShares = __ETF_SHARES_DATA__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
    ${explanationScript(["blockAmount", "institutionBlockNet", "holderNetShares", "northHoldings", "fundPosition", "institutionConcentration", "etfShares"])}
    const metrics = {
      blockAmount: {
        title: "大宗交易额", unit: "亿元", digits: 1,
        subtitle: "沪深A股大宗交易周成交额",
        explanation: "大宗交易额反映已披露的大额股票交易活跃度，不直接代表机构净买入。来源为Tushare大宗交易记录，仅统计沪深A股，排除B股、北交所、债券和基金；按自然周汇总，金额由万元换算为亿元，并与成交价×成交量核对。历史包含后来退市的股票；早年记录较稀疏，未披露不等于没有交易。"
      },
      institutionBlockNet: {
        title: "机构大宗净买入", unit: "亿元", digits: 1,
        subtitle: "沪深A股机构专用席位大宗交易周净买入额",
        explanation: "机构大宗净买入＝买方为“机构专用”的成交金额－卖方为“机构专用”的成交金额；买卖双方都是机构专用时净额为零。来源为Tushare沪深A股大宗交易席位记录，按自然周汇总，单位亿元。它只覆盖披露的机构专用席位，不代表机构通过普通交易账户的全部买卖。"
      },
      holderNetShares: {
        title: "产业资本净增减持", unit: "亿股", digits: 2,
        subtitle: "重要股东公告周净变动 · 已剔除核实的改制更名记录",
        explanation: "按重要股东公告中的变动股数汇总：增加记正、减少记负，单位亿股。来源为Tushare stk_holdertrade，按公告日期归入自然周并去重。已依据公司公告逐条剔除44条改制、更名造成的非交易变更，包括2017年中石油集团更名；原始数据不按数值大小截断，均线仅用于展示。其他未核实的划转、重组等仍可能包含在内，因此曲线不是纯二级市场买卖量，也不是成交金额或实时完整持仓。纠正清单及公告依据见仓库 work/holder_trade_adjustments.json。"
      },
      fundPosition: {
        title: "主动权益基金仓位", unit: "%", digits: 2, field: "position",
        subtitle: "主动股票／混合基金样本投向沪深A股的净资产比例 · 半年报／年报",
        explanation: "来源：Tushare基金列表、基金净资产与半年报／年报持仓。筛选主动股票型、混合型基金，排除指数、增强指数、ETF、联接、FOF及QDII。按基金和股票取最新公告，股票市值占比合计在90%—110%且持仓市值不超过净资产120%的样本才纳入；完全相同的组合只保留净资产最大的一个代表。仓位＝样本在对应市场的A股持仓市值÷同一批样本基金净资产。两市不含港股、北交所等，因此不等于全部股票仓位。覆盖率不足40%的报告期留空；基金分类采用当前资料，样本会变化，不是全体基金的精确统计。"
      },
      institutionConcentration: {
        title: "机构持仓集中度", unit: "%", digits: 2, field: "concentration",
        subtitle: "主动基金样本前十大股票持仓集中度 · 半年报／年报",
        explanation: "与主动权益基金仓位使用相同的半年报／年报有效样本、去重和覆盖率门槛。先把各基金持有同一股票的市值相加，再按对应股票范围排序：集中度＝该范围排名前10只股票的合计持仓市值÷该范围全部股票的合计持仓市值。两市前10、沪市前10、深市前10分别计算；不是单只基金前十大权重的平均值，也不代表保险、社保、外资等所有机构。样本变化和股价波动均可能影响曲线。"
      },
      etfShares: {
        title: "ETF份额变化", unit: "亿份", digits: 2,
        subtitle: "沪深上市股票型ETF周末份额存量（含跨境股票ETF）",
        explanation: "来源：Tushare ETF列表、基金分类、基金份额及交易日历。筛选沪深上市股票型ETF（含跨境股票ETF，不含债券、货币、商品ETF），包含可确认上市和退市日期的退市基金。取每周最后交易日之前最近15天内披露份额，万份÷10000换算亿份。每个交易所覆盖至少90%的当期上市基金才展示已获取份额合计，不对缺失基金放大估算；两市合计要求已有上市样本的市场均达标，尚无上市样本的市场留空。份额受申赎、拆分、合并和新基金上市影响，各ETF每份净值不同，不能直接等同于资金流入或市场规模。"
      },
      northHoldings: {
        title: "北向持仓分布", unit: "亿元", digits: 1,
        subtitle: "北向持有沪深A股的季度末市值",
        explanation: "Tushare hk_hold持股数（股）×期末未复权收盘价÷1亿，按股票所属交易所汇总（亿元）。期末缺价的股票采用此前730天内最近可得收盘价，属于历史价格估值，并记录价格日期；仍缺价或同代码持股数冲突时，该市场当期留空，不把缺失计零。仅含沪深A股，不含北交所、B/H股及基金。数据源缺少的季度保留断线，未披露不等于清仓。"
      }
    };
    let activeMetric = "blockAmount";
    let activeYears = 0;
    let holdingMode = "value";
    let chartPoints = [];
    const markets = [
      { key: "all", name: "两市合计", rows: largeMoneyData.series, color: "#f6c85f" },
      { key: "sh", name: "沪市", rows: largeMoneyData.markets.sh, color: "#36c2ff" },
      { key: "sz", name: "深市", rows: largeMoneyData.markets.sz, color: "#ff5d73" }
    ];
    const selectedSeries = new Set(markets.map(market => market.key));
    const lastHolding = northHoldings.series.filter(row => Number.isFinite(row.all.value)).at(-1);
    const baseStatus = "大宗交易自2002年 / 股东增减持自2000年 / 北向完整持仓至 " + (lastHolding?.date || "暂无");
    document.getElementById("largeMoneyDataStatus").textContent = baseStatus;
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
      const dates = chartPoints.map(point => Date.parse(point[0]));
      const first = Math.min(...dates), last = Math.max(...dates);
      const timestamp = value => typeof value === "number" ? value : Date.parse(value);
      const startValue = timestamp(zoom.startValue), endValue = timestamp(zoom.endValue);
      const start = Number.isFinite(startValue) ? startValue : first + (last - first) * zoom.start / 100;
      const end = Number.isFinite(endValue) ? endValue : first + (last - first) * zoom.end / 100;
      const visible = chartPoints.filter(point => Date.parse(point[0]) >= start && Date.parse(point[0]) <= end);
      chart.setOption({ yAxis: axisBounds(visible) });
    }
    chart.on("datazoom", rescaleVisible);

    function activeRows(source) {
      const rows = source;
      if (!activeYears || !rows.length) return rows;
      const end = new Date(largeMoneyData.series[largeMoneyData.series.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      return rows.filter(row => new Date(row.date + "T00:00:00Z") >= cutoff);
    }
    const samplingNotes = {
      blockAmount: "周累计：按成交日期将周一至周日全部已披露成交额相加，不是周五单日值或日均值；横轴为该周最后一笔已披露大宗交易日期。",
      institutionBlockNet: "周累计：按成交日期累计周一至周日机构专用席位买入额减卖出额，不是采样日单日净额；横轴为该周最后一笔已披露大宗交易日期。",
      holderNetShares: "周累计：按公告日期累计周一至周日披露的增加股数减减少股数，不是周五单日值；横轴为该周最后一条股东变动公告日期，公告所述交易可能发生在更早日期或跨多个交易日。",
      northHoldings: "季度快照：每年3、6、9、12月末最后一个交易日的持仓估值或占比；横轴为该交易日，不是公告发布日期，不进行周采样，也不累计或平均整个季度。",
      fundPosition: "半年报／年报快照：每年6月30日、12月31日报告期末仓位；横轴为报告期末，不是报告公布日，不是周末值或半年度平均。披露后才可取得，期间连线不代表每日仓位。",
      institutionConcentration: "半年报／年报快照：每年6月30日、12月31日报告期末持仓集中度；横轴为报告期末，不是公告日，不做周采样或半年度平均，期间连线不代表每日变化。",
      etfShares: "周末存量：以每周最后一个交易日为观察点，各ETF取截至该日最近15天内的可得份额后汇总；横轴是观察日，各基金原始份额日期可能不同。不是整周份额相加、周平均或净申购量。"
    };
    let smoothingWindow = 1;
    function smoothedRows(rows, field) {
      if (smoothingWindow === 1) return rows;
      return rows.map((row, index) => {
        const window = rows.slice(Math.max(0, index - smoothingWindow + 1), index + 1);
        const valid = window.length === smoothingWindow && window.every(item => Number.isFinite(item[field]));
        return { ...row, [field]: valid ? window.reduce((sum, item) => sum + item[field], 0) / smoothingWindow : null };
      });
    }
    function renderChart(preserveZoom = false) {
      const holdingView = activeMetric === "northHoldings";
      const fundView = activeMetric === "fundPosition" || activeMetric === "institutionConcentration";
      const etfView = activeMetric === "etfShares";
      const smoothable = !holdingView && !fundView && !etfView;
      const smoothingLabel = smoothingWindow === 1 ? "原数据" : smoothingWindow + "点均线";
      document.getElementById("largeMoneySmoothing").hidden = !smoothable;
      const cfg = { ...metrics[activeMetric], ...(holdingView && holdingMode === "ratio"
        ? { unit: "%", digits: 3, subtitle: "北向持仓市值占对应市场全部A股总市值的季度末比例" } : {}) };
      const previousZoom = preserveZoom ? chart.getOption().dataZoom?.[0] : null;
      const dateField = activeMetric === "holderNetShares" ? "holderDate" : "blockDate";
      const series = markets.filter(market => selectedSeries.has(market.key)).map(market => ({
        name: market.name, type: "line",
        data: holdingView ? activeRows(northHoldings.series).map(row => [row.date, row[market.key][holdingMode]])
          : fundView ? activeRows(fundReports.series).map(row => [row.date, row[market.key][cfg.field]])
          : etfView ? activeRows(etfShares.series).map(row => [row.date, row[market.key]])
          : activeRows(smoothedRows(market.rows, activeMetric)).map(row => [row[dateField] || row.date, row[activeMetric]]),
        showSymbol: holdingView || fundView, symbolSize: 6, connectNulls: false, sampling: holdingView || fundView || etfView ? undefined : "lttb",
        lineStyle: { width: 2.2, color: market.color }, itemStyle: { color: market.color }
      }));
      const points = series.flatMap(item => item.data);
      chartPoints = points;
      const latest = series.map(item => {
        const point = item.data.filter(point => Number.isFinite(point[1])).at(-1);
        return item.name + " " + (point ? fmt(point[1], cfg.digits) + cfg.unit + "（" + point[0] + "）" : "暂无数据");
      });
      document.getElementById("largeMoneyMetricSubtitle").textContent = "两市合计 / 沪市 / 深市 · " + cfg.subtitle + (smoothable ? " · " + smoothingLabel : "");
      const details = [["时间与采样", samplingNotes[activeMetric]], ["计算与来源", cfg.explanation]];
      if (holdingView || smoothable) details.push(["市场范围与缺失", holdingView
          ? " 比例＝北向持仓市值÷同期对应市场全部A股总市值（含限售股），不是北向持仓内部配置比例；两市比例用合计分子÷合计分母，不相加沪深百分比。深股通2016年12月5日开通，之前深市留空；开通前两市持仓仅含沪股通，比例分母仍为沪深A股总市值。"
          : "按股票所属交易所拆分为沪市、深市，仅含沪深A股；两市合计为两者之和。完整抓取周内无该市场记录时，记为已披露汇总零值，不代表实际没有交易；整周无记录留空"]);
      if (smoothable) details.push(["当前平滑方式", smoothingLabel + "。7点／30点均线为当前及此前6／29个周采样点的算术平均，不是7／30天，也不是累计值。窗口不足或含缺失值时留空，不跳过缺失、不补零；先用完整历史计算，再截取所选时间范围。沪深及两市分别计算，最新读数与悬浮值均为当前模式的值"]);
      renderExplanation("largeMoney", activeMetric, details);
      document.getElementById("largeMoneyLatestReading").textContent = (smoothable ? smoothingLabel + " · " : "") + latest.join(" / ");
      document.getElementById("largeMoneyHoldingModes").hidden = !holdingView;
      const coverage = document.getElementById("largeMoneyHoldingCoverage");
      coverage.hidden = !(holdingView || fundView || etfView);
      document.getElementById("largeMoneyDataStatus").textContent = baseStatus;
      if (fundView) {
        const rows = activeRows(fundReports.series);
        const valid = rows.filter(row => Number.isFinite(row.all[cfg.field]));
        const last = valid.at(-1);
        document.getElementById("largeMoneyDataStatus").textContent = "主动基金半年报／年报 · 最新有效报告 " + (last?.date || "当前区间暂无");
        coverage.textContent = "数据核验 " + fundReports.meta.checkedAt + " · 可用 " + valid.length + "/" + rows.length + " 期" +
          (last ? " · 最新有效报告 " + last.date + "：" + last.funds + "只样本 / " + (last.navFunds - last.duplicatesExcluded.length) + "只去重后可得净资产基金（原始 " + last.navFunds + "只），覆盖率 " + fmt(last.coverage, 1) + "%" : " · 当前区间暂无达标样本") +
          "。半年度披露不插值为季度或日度数据。";
      }
      if (etfView) {
        const rows = activeRows(etfShares.series);
        document.getElementById("largeMoneyDataStatus").textContent = "股票ETF周度份额 · 两市最新有效数据 " + (rows.filter(row => Number.isFinite(row.all)).at(-1)?.date || "当前区间暂无");
        coverage.textContent = "数据核验 " + etfShares.meta.checkedAt + " · 股票ETF池 " + etfShares.meta.fundCount + "只（含已退市） · 当前区间两市可用 " + rows.filter(row => Number.isFinite(row.all)).length + "/" + rows.length + "周 · " +
          markets.filter(m => selectedSeries.has(m.key)).map(m => {
            const last = rows.filter(row => Number.isFinite(row[m.key])).at(-1);
            if (!last) return m.name + "：暂无达标样本";
            const keys = m.key === "all" ? ["sh", "sz"] : [m.key];
            const n = keys.reduce((s, key) => s + last.reported[key], 0);
            const d = keys.reduce((s, key) => s + last.eligible[key], 0);
            return m.name + " " + last.date + "：" + n + "/" + d + "只，覆盖 " + fmt(n / d * 100, 1) + "%";
          }).join("；") + "。另有 " + ((etfShares.meta.excludedMissingListingDates?.length || 0) + (etfShares.meta.excludedNonExchangeCodes?.length || 0)) + "只因代码或上市／退市日期无法核验，未纳入样本池。";
      }
      if (holdingView) {
        const rows = activeRows(northHoldings.series);
        coverage.textContent = "数据核验 " + northHoldings.meta.checkedAt + " · " + markets.filter(m => selectedSeries.has(m.key)).map(m => {
          const available = rows.filter(row => Number.isFinite(row[m.key].value));
          const last = available.at(-1);
          const missing = rows.filter(row => row[m.key].status !== "not_open" && row[m.key].value === null).length;
          return m.name + "：" + available.length + "期可得 / " + missing + "期缺失" + (last ? "，最新覆盖 " + last[m.key].count + "只股票" : "");
        }).join("；") + "。持股记录冲突季度：" + (rows.filter(row => ["sh", "sz"].some(m => row[m].status === "conflicting_records")).map(row => row.date).join("、") || "无") + "；冲突市场及两市合计留空。";
      }
      chart.setOption({
        animation: false, backgroundColor: "transparent",
        grid: { left: 12, right: 24, top: 42, bottom: 64, containLabel: true },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          confine: true, backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            const date = params[0]?.value?.[0];
            const report = fundView ? fundReports.series.find(row => row.date === date) : null;
            const sample = report ? "<br>有效样本：" + report.funds + "只 · 覆盖率 " + fmt(report.coverage, 1) + "%" : "";
            return "<b>" + escapeHtml(params[0]?.axisValueLabel || "") + (smoothable ? " · " + smoothingLabel : "") + "</b><br>" +
              params.map(item => item.marker + item.seriesName + "：<b>" + fmt(item.value[1], cfg.digits) + cfg.unit + "</b>").join("<br>") + sample;
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
          { type: "inside", filterMode: "none", start: previousZoom?.start ?? 0, end: previousZoom?.end ?? 100 },
          { type: "slider", filterMode: "none", bottom: 12, height: 22, start: previousZoom?.start ?? 0, end: previousZoom?.end ?? 100,
            borderColor: "#263b58", backgroundColor: "#0d1929",
            fillerColor: "rgba(54,194,255,.17)", handleStyle: { color: "#36c2ff" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series
      }, true);
      rescaleVisible();
    }
    document.querySelectorAll("#largeMoneySeriesControls [data-series]").forEach(button => {
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
    document.querySelectorAll("#largeMoneyMetricTabs [data-metric]").forEach(button => {
      button.addEventListener("click", () => {
        activeMetric = button.dataset.metric;
        document.querySelectorAll("#largeMoneyMetricTabs [data-metric]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderChart();
      });
    });
    document.querySelectorAll("#largeMoneySmoothing [data-window]").forEach(button => {
      button.addEventListener("click", () => {
        smoothingWindow = Number(button.dataset.window);
        document.querySelectorAll("#largeMoneySmoothing [data-window]").forEach(item => {
          const selected = Number(item.dataset.window) === smoothingWindow;
          item.classList.toggle("active", selected);
          item.setAttribute("aria-pressed", String(selected));
        });
        renderChart(true);
      });
    });
    document.querySelectorAll("#largeMoneyHoldingModes [data-mode]").forEach(button => {
      button.addEventListener("click", () => {
        holdingMode = button.dataset.mode;
        document.querySelectorAll("#largeMoneyHoldingModes [data-mode]").forEach(item => {
          item.classList.toggle("active", item.dataset.mode === holdingMode);
          item.setAttribute("aria-pressed", String(item.dataset.mode === holdingMode));
        });
        renderChart(true);
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
const holdings = JSON.parse(fs.readFileSync(HOLDINGS_FILE, "utf8"));
const reports = JSON.parse(fs.readFileSync(FUND_REPORTS_FILE, "utf8"));
const shares = JSON.parse(fs.readFileSync(ETF_SHARES_FILE, "utf8"));
if (!data.markets?.sh?.length || !data.markets?.sz?.length) throw new Error("Missing institutional SH/SZ series; run large_money_markets.py.");
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
  .replace("__NORTH_HOLDINGS_DATA__", JSON.stringify(holdings))
  .replace("__FUND_REPORTS_DATA__", JSON.stringify(reports))
  .replace("__ETF_SHARES_DATA__", JSON.stringify(shares));
html = insertBeforeLast(html, "</head>", css + "\n");
html = html.includes("<!-- LARGE_MONEY_MODULE -->")
  ? html.replace("<!-- LARGE_MONEY_MODULE -->", moduleHtml)
  : insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", largeMoneyScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
