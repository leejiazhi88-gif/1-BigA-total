const fs = require("fs");
const path = require("path");

function buildHistoryData(audit) {
  if (audit.failures.length || audit.reports.some(r => r.issues.length)) throw new Error("Unresolved ETF report audit");
  const keys = new Set();
  for (const r of audit.reports) {
    const key = [r.code, r.period, r.kind].join(":");
    if (keys.has(key)) throw new Error("Duplicate ETF report");
    keys.add(key);
    if (r.status === "identified") {
      const units = r.holders.reduce((n, h) => n + h.units, 0);
      if (!(r.nav > 0) || Math.abs(units - r.units) > 0.001 || Math.abs(units * r.nav / 1e8 - r.value_yi) > 0.0001) {
        throw new Error("ETF historical amount mismatch");
      }
    } else if (r.value_yi != null) throw new Error("Unknown holding must not have an amount");
  }
  return { checkedAt: audit.checked_at, funds: audit.funds, periods: audit.periods,
    reports: audit.reports.map(r => ({ code: r.code, period: r.period, kind: r.kind, announced: r.announced,
      status: r.status, table: r.table_disclosed, units: r.units ?? null, nav: r.nav,
      amount: r.value_yi ?? null, source: r.source, holders: r.holders.map(h => ({
        name: h.account, units: h.units, ratio: h.ratio_pct })) })) };
}

const css = `
  #national-team-etf-history { margin-top: 30px; padding-top: 26px; border-top: 1px solid var(--line); scroll-margin-top: 72px; }
  .nt-history-controls { display: flex; flex-wrap: wrap; gap: 12px 20px; margin: 16px 0; }
  .nt-history-controls label { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; max-width: 100%; }
  .nt-history-controls select { color: var(--text); background: #101c2c; border: 1px solid #344760;
    border-radius: 4px; padding: 7px; min-height: 36px; font: inherit; min-width: 0; max-width: 100%; }
  .nt-history-controls select:focus-visible { outline: 2px solid #36c2ff; outline-offset: 2px; }
  #ntHistoryChart { width: 100%; height: 370px; overflow: hidden; }
  .nt-history-reading { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 24px; margin: 16px 0 8px; }
  .nt-history-reading strong { font-size: 25px; color: #f6c85f; }
  .nt-history-reading span { font-size: 12px; color: var(--muted); }
  #ntHistoryReports { max-height: 360px; }
  #ntHistoryReports table { min-width: 870px; }
  #ntHistoryReports td { vertical-align: top; }
  #ntHistoryReports td:nth-child(5), #ntHistoryReports td:nth-child(6) { text-align: right; font-variant-numeric: tabular-nums; }
  #ntHistoryReports a { color: #36c2ff; white-space: nowrap; }
  #ntHistoryReports small { display: block; margin-top: 6px; color: var(--muted); line-height: 1.7; }
  @media (max-width: 620px) {
    .nt-history-controls label { width: 100%; justify-content: space-between; }
    .nt-history-controls select { max-width: 78%; }
    #ntHistoryChart { height: 320px; }
  }
`;

const html = `
  <div id="national-team-etf-history">
    <div class="nt-direct-head"><div><h3>ETF具名持仓历史</h3><div class="panel-subtitle" id="ntHistorySubtitle"></div></div></div>
    <div class="nt-history-controls">
      <label>基金范围<select id="ntHistoryFund" aria-label="历史持仓基金范围"></select></label>
      <label>时间点<select id="ntHistoryFrequency" aria-label="历史持仓时间点"><option value="half">中报 / 年报</option><option value="quarter">全部季度</option></select></label>
      <label>区间<select id="ntHistoryRange" aria-label="历史持仓区间"><option value="all">2015年以来</option><option value="5">近5年</option><option value="3">近3年</option></select></label>
    </div>
    <div id="ntHistoryChart" role="img" aria-label="2015年6月以来国家队具名ETF持仓金额走势"></div>
    <p class="nt-method">单位：亿元。持有份额 × 同期单位净值；虚线连接披露快照，缺失保持空白。金额变化含净值涨跌，不能直接当作增减持金额。样本包含后来成立的基金，单只基金与2015年已成立样本可分别查看。</p>
    <div class="nt-direct-head"><div class="panel-title">报告核查与持仓依据</div></div>
    <div class="nt-history-controls">
      <label>报告期<select id="ntHistoryPeriod" aria-label="ETF历史核查报告期"></select></label>
      <label>报告类型<select id="ntHistoryKind" aria-label="ETF历史核查报告类型"><option value="all">全部报告</option><option value="quarterly">季报</option><option value="long">中报 / 年报</option></select></label>
    </div>
    <div class="nt-history-reading" id="ntHistoryReading" aria-live="polite"></div>
    <p class="nt-direct-status" id="ntHistoryStatus"></p>
    <div class="nt-etf-table" id="ntHistoryReports"></div>
    <details class="nt-direct-method"><summary>历史统计范围与缺口</summary>
      <p id="ntHistoryAuditSummary"></p>
      <p>账户范围沿用上方口径：中央汇金投资、中央汇金资产管理、中国证券金融及明确具名的委托计划。未进入前十名不表示零持仓，未披露具名表不表示清仓；季报中的匿名大额投资者、基金总份额与机构合计不能直接识别国家队。</p>
      <p>合计仅在所选范围内当期已成立基金均有具名表，且至少识别出一个国家队账户时显示；否则保留缺口。尚未成立的基金不计入当期覆盖分母。若基金刚成立、报告不适用或未能检索到报告，状态单独列示，不推断为零。</p>
      <p>图按报告期末排列，报告公布时间另列；这些数据并非在报告期当天就已公开。这里只回溯ETF具名持仓，直接A股仍采用上方已核实的两期快照。</p>
    </details>
  </div>
`;

function renderHistory(data) {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const date = s => s.slice(0, 4) + "-" + s.slice(4, 6) + "-" + s.slice(6);
  const fmt = (n, digits = 2) => Number.isFinite(n) ? n.toLocaleString("zh-CN", { maximumFractionDigits: digits, minimumFractionDigits: digits }) : "无法核实";
  const kindNames = { annual: "年报", interim: "中报", quarterly: "季报" };
  const statuses = { identified: "具名持仓", no_identified_account_in_top10: "榜内未发现，不代表零",
    named_holder_table_not_disclosed: "未列具名持有人表", not_established: "尚未成立", report_not_found: "暂未检索到报告" };
  const byKey = new Map(data.reports.map(r => [[r.code, r.period, r.kind].join(":"), r]));
  const chart = echarts.init($("ntHistoryChart"), null, { renderer: "canvas" });
  let plotted = [];
  $("ntHistorySubtitle").textContent = "2015-06-30起 · " + data.funds.length + "只重点宽基ETF · 核验 " + data.checkedAt;
  $("ntHistoryFund").innerHTML = '<option value="all">全部14只样本</option><option value="original">2015年6月已成立样本</option>' +
    data.funds.map(f => '<option value="' + f.code + '">' + f.code + ' ' + esc(f.name) + '</option>').join("");
  $("ntHistoryPeriod").innerHTML = [...data.periods].reverse().map(p => '<option value="' + p + '">' + date(p) + '</option>').join("");
  const quarters = data.reports.filter(r => r.kind === "quarterly");
  $("ntHistoryAuditSummary").textContent = "核查" + data.reports.length + "份报告，其中季报" + quarters.length + "份，列有具名持有人表" +
    quarters.filter(r => r.table).length + "份。当前14只基金是固定候选范围，各期仅纳入当时已成立基金，并非全市场ETF。";

  function funds() {
    const scope = $("ntHistoryFund").value;
    return data.funds.filter(f => scope === "all" || (scope === "original" ? f.inception <= "20150630" : f.code === scope));
  }
  function report(fund, period, kind) {
    return byKey.get([fund.code, period, kind].join(":")) || { code: fund.code, period, kind,
      status: fund.inception > period ? "not_established" : "report_not_found", amount: null,
      units: null, nav: null, table: false, holders: [], source: "https://fundf10.eastmoney.com/jjgg_" + fund.code + ".html" };
  }
  function snapshot(period, requestedKind) {
    const eligible = funds().filter(f => f.inception <= period);
    const rows = eligible.map(f => {
      if (requestedKind) return report(f, period, requestedKind);
      const long = period.endsWith("0630") ? "interim" : period.endsWith("1231") ? "annual" : null;
      const r = long ? report(f, period, long) : null;
      return r && r.status !== "report_not_found" ? r : report(f, period, "quarterly");
    });
    const identified = rows.filter(r => r.amount !== null);
    const disclosed = rows.filter(r => r.table).length;
    const complete = rows.length > 0 && disclosed === rows.length && identified.length > 0;
    return { period, amount: complete ? identified.reduce((n, r) => n + r.amount, 0) : null,
      eligible: rows.length, disclosed, identified: identified.length };
  }
  function renderChart() {
    const frequency = $("ntHistoryFrequency").value;
    const range = $("ntHistoryRange").value;
    const endYear = Number(data.periods.at(-1).slice(0, 4));
    plotted = data.periods.filter(p => (frequency === "quarter" || /(?:0630|1231)$/.test(p)) &&
      (range === "all" || Number(p.slice(0, 4)) > endYear - Number(range))).map(p => snapshot(p));
    const numbers = plotted.map(p => p.amount).filter(Number.isFinite);
    chart.setOption({ animation: false, grid: { left: 64, right: 20, top: 25, bottom: 82 },
      title: numbers.length ? [] : [{ text: "所选范围暂无可核实的具名持仓", left: "center", top: "40%", textStyle: { color: "#8fa5bf", fontSize: 12 } }],
      tooltip: { trigger: "axis", confine: true, transitionDuration: 0, backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f", textStyle: { color: "#edf4ff", fontSize: 12 },
        formatter: params => {
          const s = plotted[params[0].dataIndex];
          return date(s.period) + "<br>已识别持仓：" + (s.amount === null ? "无法核实" : fmt(s.amount) + " 亿元") +
            "<br>具名表：" + s.disclosed + " / " + s.eligible + "只当期已成立样本<br>识别出国家队：" + s.identified + "只";
        } },
      xAxis: { type: "category", data: plotted.map(s => date(s.period)), boundaryGap: true,
        axisLine: { lineStyle: { color: "#344760" } }, axisLabel: { color: "#8fa5bf", hideOverlap: true, fontSize: 11 } },
      yAxis: { type: "value", ...bounds(numbers),
        axisLabel: { color: "#8fa5bf", formatter: n => fmt(n, 0) }, splitLine: { lineStyle: { color: "#233247" } } },
      dataZoom: [{ type: "slider", xAxisIndex: 0, start: 0, end: 100, filterMode: "none", bottom: 8, height: 22,
        borderColor: "#344760", fillerColor: "rgba(246,200,95,.15)", textStyle: { color: "#8fa5bf", fontSize: 10 } },
        { type: "inside", xAxisIndex: 0, filterMode: "none" }],
      series: [{ name: "已识别ETF持仓", type: "line", data: plotted.map(s => s.amount), connectNulls: false,
        smooth: false, showSymbol: true, symbolSize: 7, lineStyle: { color: "#f6c85f", type: "dashed", width: 2 }, itemStyle: { color: "#f6c85f" } }]
    }, true);
  }
  function bounds(numbers) {
    const high = Math.max(...numbers, 1), low = numbers.length ? Math.min(...numbers) : 0;
    const padding = Math.max((high - low) * .12, high * .05, 1);
    const step = high > 10000 ? 1000 : high > 1000 ? 100 : high > 100 ? 10 : 1;
    return { min: Math.max(0, Math.floor((low - padding) / step) * step), max: Math.ceil((high + padding) / step) * step };
  }
  chart.on("datazoom", () => {
    const zoom = chart.getOption().dataZoom[0];
    const first = zoom.startValue ?? Math.round(zoom.start / 100 * (plotted.length - 1));
    const last = zoom.endValue ?? Math.round(zoom.end / 100 * (plotted.length - 1));
    chart.setOption({ yAxis: bounds(plotted.slice(first, last + 1).map(s => s.amount).filter(Number.isFinite)) });
  });
  function renderReports() {
    const period = $("ntHistoryPeriod").value, filter = $("ntHistoryKind").value;
    const long = period.endsWith("0630") ? "interim" : period.endsWith("1231") ? "annual" : null;
    const kinds = filter === "quarterly" ? ["quarterly"] : filter === "long" ? (long ? [long] : []) : (long ? [long, "quarterly"] : ["quarterly"]);
    const rows = funds().flatMap(f => kinds.map(kind => ({ ...report(f, period, kind), name: f.name })));
    const s = snapshot(period, filter === "quarterly" ? "quarterly" : undefined);
    $("ntHistoryReading").innerHTML = '<strong>' + (s.amount === null ? "金额暂无法核实" : fmt(s.amount) + " 亿元") + '</strong><span>' + date(period) +
      ' · 具名表 ' + s.disclosed + ' / ' + s.eligible + '只当期已成立样本 · 识别出国家队 ' + s.identified + '只</span>';
    $("ntHistoryStatus").textContent = s.amount === null ? "该期缺少足够的具名持仓披露，未续填上一期金额，也未记为零。" :
      "金额取当期中报、年报或具名季报中的可识别持仓；未入榜持仓无法计入。";
    const head = ["基金", "报告", "公布日期", "核查结果", "已识别份额 / 亿份", "金额 / 亿元", "来源"];
    $("ntHistoryReports").innerHTML = '<table><thead><tr>' + head.map(h => '<th>' + h + '</th>').join("") + '</tr></thead><tbody>' +
      (rows.map(r => '<tr><td><span class="nt-etf-code">' + r.code + '</span><br>' + esc(r.name) + '</td><td>' + kindNames[r.kind] +
        '</td><td>' + (r.announced || "—") + '</td><td>' + statuses[r.status] + (r.holders.length ? '<small>' + r.holders.map(h =>
          esc(h.name) + '：' + fmt(h.units / 1e8, 4) + '亿份' + (h.ratio === null ? '' : '（' + fmt(h.ratio) + '%）')).join('<br>') + '</small>' : '') +
        '</td><td>' + (r.units === null ? "—" : fmt(r.units / 1e8, 4)) + '</td><td>' + (r.amount === null ? "—" : fmt(r.amount)) +
        '</td><td>' + (r.status === "not_established" ? "—" : '<a target="_blank" rel="noopener noreferrer" href="' + esc(r.source) + '">' +
        (r.status === "report_not_found" ? "公告列表" : "报告原文") + '</a>') + '</td></tr>').join("") || '<tr><td colspan="7">该季度无中报或年报报告期</td></tr>') + '</tbody></table>';
  }
  $("ntHistoryFund").addEventListener("change", () => { renderChart(); renderReports(); });
  for (const id of ["ntHistoryFrequency", "ntHistoryRange"]) $(id).addEventListener("change", renderChart);
  for (const id of ["ntHistoryPeriod", "ntHistoryKind"]) $(id).addEventListener("change", renderReports);
  chart.on("click", p => { if (p.componentType === "series") { $("ntHistoryPeriod").value = plotted[p.dataIndex].period; renderReports(); } });
  window.addEventListener("resize", () => { chart.dispatchAction({ type: "hideTip" }); chart.resize(); });
  $("ntHistoryPeriod").value = data.periods.findLast(p => snapshot(p).amount !== null) || data.periods.at(-1);
  renderChart();
  renderReports();
}

function etfHistoryModule() {
  const data = buildHistoryData(JSON.parse(fs.readFileSync(path.join(__dirname, "national_team_etf_history.json"), "utf8")));
  return { css, html, script: '<script id="national-team-etf-history-script">(' + renderHistory.toString() + ')(' + JSON.stringify(data).replace(/</g, "\\u003c") + ');</script>' };
}

module.exports = { buildHistoryData, etfHistoryModule };
