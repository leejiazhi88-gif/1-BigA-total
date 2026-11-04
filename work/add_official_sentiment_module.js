const fs = require("fs");
const path = require("path");
const { guideCss, explanationScript } = require("./sentiment_explanations");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = process.argv.includes("--online-only") ? path.join(ROOT, "index.html") : path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "official_sentiment_data.json");
const REFINANCING_FILE = path.join(ROOT, "work", "refinancing_data.json");

function stripExisting(html) {
  return html
    .replace(/\s*<section class="module-shell" id="official-sentiment">[\s\S]*?<\/section>/g, "<!-- OFFICIAL_MODULE -->")
    .replace(/\s*<style id="official-sentiment-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="official-sentiment-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<a href="#official-sentiment"[^>]*>情绪-官方<\/a>/g, "");
}

const css = `
  <style id="official-sentiment-style">
    ${guideCss("official-sentiment")}
    .official-grid {
      display: grid; grid-template-columns: minmax(0, 1fr);
      gap: 15px; align-items: stretch;
    }
    #officialSentimentChart { height: 500px; width: 100%; }
    #official-sentiment .panel-head { flex-wrap: wrap; gap: 12px; }
    #official-sentiment .module-status { white-space: normal; }
    #officialSeriesControls, #officialRateControls { display: flex; flex-wrap: wrap; gap: 8px 18px; padding: 11px 16px 0; }
    #officialRateControls[hidden] { display: none; }
    #officialSeriesControls button, #officialRateControls button { display: inline-flex; align-items: center; gap: 6px; padding: 4px 0;
      border: 0; background: transparent; color: #8fa5bf; font-size: 12px; cursor: pointer; }
    #officialSeriesControls button[aria-pressed="false"], #officialSeriesControls button:disabled,
    #officialRateControls button[aria-pressed="false"] { opacity: .4; }
    #officialSeriesControls button:disabled { cursor: default; }
    #officialMarketScope { color: #8fa5bf; font-size: 12px; padding: 8px 16px 0; }
    .official-series-mark { position: relative; width: 22px; height: 12px; flex: none; }
    .official-series-mark::before { content: ""; position: absolute; left: 0; right: 0; top: 5px;
      border-top: 2px solid var(--series-color); }
    .official-series-mark::after { content: ""; position: absolute; left: 8px; top: 1px;
      width: 8px; height: 8px; border: 2px solid #edf4ff; border-radius: 50%; background: var(--series-color); }
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
        <div id="officialSeriesControls" role="group" aria-label="官方市场曲线">
          <button type="button" data-series="all" aria-pressed="true" style="--series-color:#f6c85f"><span class="official-series-mark"></span>两市合计</button>
          <button type="button" data-series="sh" aria-pressed="true" style="--series-color:#36c2ff"><span class="official-series-mark"></span>沪市</button>
          <button type="button" data-series="sz" aria-pressed="true" style="--series-color:#ff5d73"><span class="official-series-mark"></span>深市</button>
        </div>
        <div id="officialMarketScope" aria-live="polite"></div>
        <div class="metric-tabs" id="officialMetricTabs">
          <button class="metric-tab active" data-metric="ipoFunds">IPO融资额</button>
          <button class="metric-tab" data-metric="refinanceFunds">再融资额</button>
          <button class="metric-tab" data-metric="netReduceAmount">产业资本净减持额</button>
          <button class="metric-tab" data-metric="stampTaxRate">印花税率</button>
          <button class="metric-tab" data-metric="policyRate">政策利率</button>
          <button class="metric-tab" data-metric="socialFinancing">社融增量</button>
          <button class="metric-tab" data-metric="m2Yoy">M2增速</button>
        </div>
        <div id="officialRateControls" role="group" aria-label="选择利率曲线" hidden>
          <button type="button" data-rate="reverseRepo7d" aria-pressed="true" style="--series-color:#f6c85f"><span class="official-series-mark"></span>7天逆回购利率</button>
          <button type="button" data-rate="lpr1y" aria-pressed="true" style="--series-color:#36c2ff"><span class="official-series-mark"></span>1年期LPR</button>
          <button type="button" data-rate="lpr5y" aria-pressed="true" style="--series-color:#ff5d73"><span class="official-series-mark"></span>5年期以上LPR</button>
        </div>
        <div class="metric-note metric-reading-row">
          <span class="metric-reading" id="officialLatestReading"></span>
        </div>
        <div id="officialSentimentChart"></div>
      </article>

    </div>

    <div class="valuation-foot single-note">
      <details class="metric-method">
        <summary>指标含义、统计口径与数据来源</summary>
        <div class="metric-guide" id="officialMetricGuide" aria-live="polite"></div>
        <div id="officialMetricExplanation"></div>
      </details>
    </div>
  </section>
`;

const script = `
  <script id="official-sentiment-script">
  (() => {
    const officialData = __OFFICIAL_DATA__;
    const refinancingData = __REFINANCING_DATA__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const axisFmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: digits })
      : "--";
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
    ${explanationScript(["ipoFunds", "refinanceFunds", "netReduceAmount", "stampTaxRate", "policyRate", "socialFinancing", "m2Yoy"])}
    const metrics = {
      ipoFunds: {
        title: "IPO融资额", unit: "亿元", digits: 1,
        subtitle: "A股IPO募集资金，按周汇总",
        explanation: "IPO融资额是新股发行募集资金，反映一级市场资金供给节奏，不是二级市场成交额。来源为Tushare new_share的funds字段，按IPO日期或发行日期归入自然周求和，单位亿元；未披露的发行不估算。"
      },
      refinanceFunds: {
        title: "再融资额", unit: "亿元", digits: 1,
        subtitle: "沪深A股已实施增发＋配股 · 月度发行金额（含非现金发行）",
        explanation: "来源为东方财富数据中心已实施增发明细RPT_SEO_DETAIL与配股明细RPT_IPO_ALLOTMENT，参考项目6的发行记录统计口径。优先采用实际发行总金额，缺失时用实际发行股数×发行价格计算，元÷1亿转为亿元；不采用预案募资上限、公告金额或市值估算。用Tushare上市日期排除首次上市前及上市当日发行，按融资事件编号去重。范围仅含沪深A股增发与配股，不含IPO、可转债、北交所及其他债务融资。部分发行以资产认购或换股合并完成，金额不等于现金到账，也不能视为二级市场净流出。2008年起按月汇总。"
      },
      netReduceAmount: {
        title: "产业资本净减持额", unit: "亿元", digits: 1,
        subtitle: "重要股东增减持公告金额，按周汇总",
        explanation: "产业资本净减持额按重要股东增减持公告估算：变动股数×披露均价，减持记正、增持记负，再按自然周汇总，单位亿元。来源为Tushare stk_holdertrade；没有均价的记录不计入，缺失不补零。它是公告样本，不等于全部产业资本净卖出。"
      },
      stampTaxRate: {
        title: "印花税率", unit: "%", digits: 2,
        subtitle: "证券交易印花税政策阶梯序列",
        explanation: "印花税率反映证券交易印花税政策规定的税率，单位%。来源为人工核对并维护的政策生效日与税率；图上采用阶梯线，表示下次调整前税率保持不变，不做线性插值。它是政策参数，不是实际征收税额。"
      },
      policyRate: {
        title: "政策利率", unit: "%", digits: 2,
        subtitle: "7天逆回购利率、1年期LPR、5年期以上LPR · 年利率%",
        explanation: "7天逆回购利率取自中国人民银行公开市场业务交易公告，仅提取7天期逆回购的操作利率或中标利率，排除隔夜、14天等其他期限及买断式逆回购；它是央行向银行体系提供短期资金的利率，2024年以来政策利率地位进一步明确。LPR历史来源为Tushare shibor_lpr的1y、5y字段，接口滞后月份用中国货币网官方报价补齐。单位均为年利率百分比，7天指资金期限，并非7天获得的收益率。1年期LPR最早可得为2013年10月25日，2019年8月改革后按月公布并增加5年期以上LPR。各曲线按自身实际披露起止日期展示，早期缺失不补零，末端不伪造新报价。LPR为贷款定价参考，实际贷款利率还受加减点、重定价日等影响。"
      },
      socialFinancing: {
        title: "社融增量", unit: "亿元", digits: 0,
        subtitle: "社会融资规模月度增量",
        explanation: "社融增量是当月新增社会融资规模，观察实体部门融资扩张速度；来源为Tushare sf_month的inc_month字段。按月展示并落在月末，单位亿元；它是增量，不是社融存量或同比增速，不与周频指标混作同一口径。"
      },
      m2Yoy: {
        title: "M2增速", unit: "%", digits: 1,
        subtitle: "M2同比增速，月度数据",
        explanation: "M2增速是广义货币供应量的同比增速，反映货币总量变化。来源为Tushare cn_m的m2_yoy字段，按月展示并落在月末，单位%；不是当月新增货币量。可结合社融与利率观察流动性，但不能单独推断股市涨跌。"
      }
    };
    let activeMetric = "ipoFunds";
    let activeYears = 0;
    const markets = [
      { key: "all", name: "两市合计", rows: officialData.series, color: "#f6c85f" },
      { key: "sh", name: "沪市", rows: officialData.markets.sh, color: "#36c2ff" },
      { key: "sz", name: "深市", rows: officialData.markets.sz, color: "#ff5d73" }
    ];
    const selectedMarkets = new Set(["all", "sh", "sz"]);
    const rates = [
      { key: "reverseRepo7d", name: "7天逆回购利率", rows: officialData.reverseRepo.series, color: "#f6c85f", step: true },
      { key: "lpr1y", name: "1年期LPR", rows: officialData.lpr.series, color: "#36c2ff", step: true },
      { key: "lpr5y", name: "5年期以上LPR", rows: officialData.lpr.series, color: "#ff5d73", step: true }
    ];
    const selectedRates = new Set(rates.map(rate => rate.key));
    const isSplit = () => ["ipoFunds", "refinanceFunds", "netReduceAmount"].includes(activeMetric);
    let chartPoints = [];
    let chartSeries = [];
    const chart = echarts.init(document.getElementById("officialSentimentChart"), null, { renderer: "canvas" });
    function axisBounds(points) {
      const values = points.map(p => p[1]).filter(Number.isFinite);
      if (!values.length) return { min: 0, max: 1 };
      const low = Math.min(...values), high = Math.max(...values);
      const pad = Math.max((high - low) * .12, .01);
      const rawMin = low >= 0 ? Math.max(0, low - pad) : low - pad;
      const rawMax = high + pad;
      const span = Math.max(rawMax - rawMin, .01);
      const magnitude = 10 ** Math.floor(Math.log10(span / 6));
      const normalized = (span / 6) / magnitude;
      const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
      const step = multiplier * magnitude;
      const clean = value => Number(value.toPrecision(12));
      return { min: clean(Math.floor(rawMin / step) * step), max: clean(Math.ceil(rawMax / step) * step) };
    }
    function rescaleVisible() {
      const zoom = chart.getOption().dataZoom[0];
      const dates = chartPoints.map(p => Date.parse(p[0]));
      if (!dates.length) return;
      const first = Math.min(...dates), last = Math.max(...dates);
      const timestamp = value => typeof value === "number" ? value : Date.parse(value);
      const start = Number.isFinite(timestamp(zoom.startValue)) ? timestamp(zoom.startValue) : first + (last - first) * zoom.start / 100;
      const end = Number.isFinite(timestamp(zoom.endValue)) ? timestamp(zoom.endValue) : first + (last - first) * zoom.end / 100;
      const visible = chartPoints.filter(p => Date.parse(p[0]) >= start && Date.parse(p[0]) <= end);
      for (const series of chartSeries.filter(s => s.step)) {
        const preceding = series.data.filter(p => Date.parse(p[0]) < start).at(-1);
        if (preceding && Date.parse(series.data.at(-1)[0]) >= start) visible.push(preceding);
      }
      chart.setOption({ yAxis: axisBounds(visible) });
    }
    chart.on("datazoom", rescaleVisible);
    function activeRows(source, field = activeMetric, step = activeMetric === "stampTaxRate") {
      const rows = source.filter(row => activeMetric === "refinanceFunds"
        ? Object.prototype.hasOwnProperty.call(row, field) : Number.isFinite(row[field]));
      if (!activeYears || !rows.length) return rows;
      const end = new Date(officialData.meta.end + "T00:00:00Z");
      const cutoff = new Date(end);
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      const visible = rows.filter(row => new Date(row.date + "T00:00:00Z") >= cutoff);
      if (step && rows.at(-1).date >= cutoff.toISOString().slice(0, 10)) {
        const preceding = rows.filter(row => new Date(row.date + "T00:00:00Z") < cutoff).at(-1);
        if (preceding) visible.unshift({ ...preceding, date: cutoff.toISOString().slice(0, 10) });
      }
      return visible;
    }
    function renderChart(preserveZoom = false) {
      const cfg = metrics[activeMetric];
      const previousZoom = preserveZoom ? chart.getOption().dataZoom?.[0] : null;
      const split = isSplit();
      const rateView = activeMetric === "policyRate";
      const refinancingView = activeMetric === "refinanceFunds";
      const visibleMarkets = rateView ? rates.filter(rate => selectedRates.has(rate.key)) : split
        ? markets.filter(m => selectedMarkets.has(m.key)).map(m => ({ ...m,
          rows: refinancingView ? (m.key === "all" ? refinancingData.series : refinancingData.markets[m.key]) : m.rows }))
        : [{name: "全国", rows: officialData.series, color: "#f6c85f"}];
      const series = visibleMarkets.map(market => ({
        name: market.name, type: "line", data: activeRows(market.rows, rateView ? market.key : activeMetric,
          market.step || activeMetric === "stampTaxRate").map(row => [row.date, row[rateView ? market.key : activeMetric]]),
        showSymbol: false, connectNulls: false, step: market.step || activeMetric === "stampTaxRate" ? "end" : false,
        sampling: market.step || activeMetric === "stampTaxRate" || refinancingView ? undefined : "lttb",
        lineStyle: { width: 2.2, color: market.color }, itemStyle: { color: market.color }
      }));
      chartSeries = series;
      chartPoints = series.flatMap(s => s.data);
      document.getElementById("officialRateControls").hidden = !rateView;
      document.querySelectorAll("#officialSeriesControls [data-series]").forEach(button => { button.disabled = !split; });
      document.getElementById("officialMarketScope").textContent = split ? "沪深A股 · 不含北交所" : "全国统一口径，不按沪深拆分";
      document.getElementById("officialMetricSubtitle").textContent = cfg.subtitle;
      const sampling = ({
        ipoFunds: "周累计：按IPO日期（缺失时用发行日期）将周一至周日的募集额相加；横轴为该周最后一条可计入发行记录的日期，不是当天融资额或周平均。",
        refinanceFunds: "月累计：一个点是整个自然月已实施增发和配股的发行金额之和，增发按发行日期、配股按缴款截止日期归月，不按股票上市日或公告日归月。横轴标记月末，不是月末当天的金额，也不是月均值。只展示已结束月份，当前未结束月份暂不画入；因此月频末端会早于每日行情的更新日期",
        netReduceAmount: "周累计：按公告日期累计周一至周日披露的净减持金额；横轴为该周最后一条可计入公告的日期，不是当天交易金额，公告覆盖的交易可能跨日。",
        stampTaxRate: "政策事件序列：按政策生效日跳变，并延续至下一次调整；不是周采样、周平均或周累计，区间端点仅用于延续有效税率。",
        policyRate: "7天逆回购保留央行实际操作公告日期，LPR保留实际报价日期；三条线均不做周采样、均值或累计，按新利率公布日阶梯跳变。2019年8月前1年期LPR为旧机制的工作日报价，改革后通常每月公布。区间起点若落在两次公布之间，沿用当时最近有效利率；末尾不超出各自最后已取得的7天操作或LPR报价日期。近期只有隔夜操作的公告不作为新的7天利率观测",
        socialFinancing: "月度累计：一个点表示整个月新增社融，不是月末当天发生额；横轴标记统计月份的月末，不是实际发布日期，不另做周采样。",
        m2Yoy: "月度时点：一个点表示该月M2余额相对上年同月的增速，不是当月累计或周平均；横轴标记统计月份月末，不是实际发布日期。"
      })[activeMetric];
      renderExplanation("official", activeMetric, [["时间与采样", sampling], ["计算与来源", cfg.explanation], ["市场范围", split
        ? refinancingView
          ? "按股票所属交易所拆分沪市、深市，两市合计为两者之和。完整查询后某市场某月没有发行记录时记零，表示本数据源没有记录；若存在记录但发行金额缺失，该市场整月及两市合计留空，曲线不跨缺口连线，不用零代替缺失"
          : " 按股票所属交易所分为沪市、深市，两市合计为两者之和，仅含沪深A股。已披露样本按周汇总；周内某市场无可计入记录时记为样本汇总零值，不代表实际零融资或零减持。"
        : "此指标为全国口径，没有沪深市场拆分值"]]);
      document.getElementById("officialLatestReading").textContent = series.map(s => {
        const point = s.data.at(-1);
        return s.name + " " + (point ? (Number.isFinite(point[1]) ? fmt(point[1], cfg.digits) + cfg.unit : "披露金额不完整") + "（" + point[0] + "）" : "暂无数据");
      }).join(" / ");
      chart.setOption({
        animation: false, backgroundColor: "transparent",
        grid: { left: 12, right: 24, top: 42, bottom: 64, containLabel: true },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" }, confine: true,
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            return "<b>" + escapeHtml(params[0]?.axisValueLabel || "") + "</b><br>" +
              params.map(item => item.marker + item.seriesName + "：<b>" + fmt(item.value[1], cfg.digits) + cfg.unit + "</b>").join("<br>");
          }
        },
        xAxis: {
          type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false }
        },
        yAxis: {
          type: "value", scale: true, ...axisBounds(chartPoints),
          axisLabel: { color: "#7890aa", formatter: value => axisFmt(value, activeMetric === "policyRate" ? 1 : cfg.digits) + cfg.unit },
          splitLine: { lineStyle: { color: "#17283d" } }
        },
        dataZoom: [
          { type: "inside", filterMode: "none", start: previousZoom?.start ?? 0, end: previousZoom?.end ?? 100 },
          { type: "slider", filterMode: "none", bottom: 12, height: 22, start: previousZoom?.start ?? 0, end: previousZoom?.end ?? 100,
            borderColor: "#263b58", backgroundColor: "#0d1929",
            fillerColor: "rgba(255,93,115,.16)", handleStyle: { color: "#ff5d73" },
            textStyle: { color: "#8fa5bf" } }
        ],
        series
      }, true);
      rescaleVisible();
    }
    document.querySelectorAll("#officialSeriesControls [data-series]").forEach(button => {
      button.addEventListener("click", () => {
        if (!isSplit()) return;
        const key = button.dataset.series;
        if (selectedMarkets.has(key)) {
          if (selectedMarkets.size === 1) return;
          selectedMarkets.delete(key);
        } else selectedMarkets.add(key);
        button.setAttribute("aria-pressed", String(selectedMarkets.has(key)));
        renderChart(true);
      });
    });
    document.querySelectorAll("#officialRateControls [data-rate]").forEach(button => {
      button.addEventListener("click", () => {
        const key = button.dataset.rate;
        if (selectedRates.has(key)) {
          if (selectedRates.size === 1) return;
          selectedRates.delete(key);
        } else selectedRates.add(key);
        button.setAttribute("aria-pressed", String(selectedRates.has(key)));
        renderChart(true);
      });
    });
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
const refinancingData = JSON.parse(fs.readFileSync(REFINANCING_FILE, "utf8"));
if (!refinancingData.series?.length || !refinancingData.markets?.sh?.length || !refinancingData.markets?.sz?.length) throw new Error("Missing refinancing series");
if (!data.markets?.sh?.length || !data.markets?.sz?.length) throw new Error("Missing official market splits");
if (!data.lpr?.series?.some(row => Number.isFinite(row.lpr1y) && Number.isFinite(row.lpr5y))) throw new Error("Missing LPR quotes; refresh official sentiment data first");
if (!data.reverseRepo?.series?.some(row => Number.isFinite(row.reverseRepo7d))) throw new Error("Missing PBOC seven-day reverse repo rates");
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
  .replace("__REFINANCING_DATA__", JSON.stringify(refinancingData));
html = insertBeforeLast(html, "</head>", css + "\n");
html = html.includes("<!-- OFFICIAL_MODULE -->") ? html.replace("<!-- OFFICIAL_MODULE -->", moduleHtml) : insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", officialScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
