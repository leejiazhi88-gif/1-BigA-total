const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "../outputs/national-team-holdings-comparison-20261026.json");
const FUND_NAMES = {
  "510050": "华夏上证50ETF", "510300": "华泰柏瑞沪深300ETF",
  "510310": "易方达沪深300ETF", "510330": "华夏沪深300ETF",
  "159919": "嘉实沪深300ETF", "510500": "南方中证500ETF",
  "159922": "嘉实中证500ETF", "510580": "易方达中证500ETF",
  "512100": "南方中证1000ETF", "159845": "华夏中证1000ETF",
  "560010": "广发中证1000ETF", "159915": "易方达创业板ETF",
  "588000": "华夏科创50ETF", "588080": "易方达科创50ETF"
};

function buildDirectData(audit) {
  const sum = rows => rows.reduce((total, row) => total + row, 0);
  const checkTotal = (actual, expected, label) => {
    if (!Number.isFinite(expected) || Math.abs(actual - expected) > 0.01) {
      throw new Error("Direct holding amount mismatch: " + label);
    }
  };
  const annualEtfs = audit.etfs_20251231;
  checkTotal(sum(annualEtfs.rows.filter(row => row.status === "identified").map(row => {
    const amount = sum(row.amounts);
    checkTotal(amount, row.units, row.code + " units");
    checkTotal(amount * row.unit_nav / 1e8, row.value_yi, row.code);
    return row.value_yi;
  })), annualEtfs.total_yi, "ETF total");
  const snapshots = Object.entries(audit.stocks).sort(([a], [b]) => a.localeCompare(b)).map(([period, stocks]) => {
    const details = stocks.details.map(row => {
      if (row.end_date !== period) throw new Error("Mixed stock reporting periods");
      checkTotal(row.a_share_amount * row.close / 1e8, row.value_yi, row.ts_code);
      return { code: row.ts_code, name: row.stock_name, holder: row.holder_name,
        units: row.a_share_amount, close: row.close, amount: row.value_yi, announced: row.ann_date,
        source: row.adjustment_source || row.source_url };
    });
    checkTotal(sum(details.map(row => row.amount)), stocks.total_yi, period);
    checkTotal(stocks.huijin_investment_yi + stocks.other_identified_accounts_yi, stocks.total_yi, "accounts");
    const sourceEtfs = period === "20251231" ? annualEtfs.rows : audit["etfs_" + period];
    if (!sourceEtfs?.length) throw new Error("Missing ETF disclosure status for " + period);
    const etfs = sourceEtfs.map(row => ({ code: row.code, name: FUND_NAMES[row.code] || row.title,
      amount: row.status === "identified" ? row.value_yi : null,
      units: row.status === "identified" ? row.units : null,
      nav: row.unit_nav ?? null, status: row.status, source: row.source_url }));
    // An absent named holder table is unknown, even when the prior report has a value.
    const etfAmount = etfs.every(row => row.status !== "named_holder_table_not_disclosed")
      ? sum(etfs.filter(row => row.amount !== null).map(row => row.amount)) : null;
    const companies = [...new Set(details.map(row => row.code))];
    if (companies.length !== stocks.stock_count || details.length !== stocks.holder_rows) {
      throw new Error("Direct holding coverage mismatch: " + period);
    }
    return { period, date: period.slice(0, 4) + "-" + period.slice(4, 6) + "-" + period.slice(6),
      stockAmount: stocks.total_yi, etfAmount,
      combinedAmount: etfAmount === null ? null : stocks.total_yi + etfAmount,
      huijinAmount: stocks.huijin_investment_yi, otherAmount: stocks.other_identified_accounts_yi,
      companyCount: companies.length, holderCount: details.length,
      identifiedFunds: etfs.filter(row => row.amount !== null).length,
      disclosedFunds: etfs.filter(row => row.status !== "named_holder_table_not_disclosed").length,
      etfs, stocks: details };
  });
  return { checkedAt: audit.checked_at, snapshots };
}

const css = `
  .nt-direct-head, .nt-direct-tools, .nt-direct-detail-head {
    display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap;
  }
  .nt-direct-head h3 { font-size: 20px; margin: 0 0 8px; letter-spacing: 0; }
  .nt-direct-period { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--muted); }
  .nt-direct-period select, #ntDirectSearch {
    color: var(--text); background: #101c2c; border: 1px solid #344760; border-radius: 4px;
    padding: 8px 10px; font: inherit; min-height: 38px; max-width: 100%;
  }
  .nt-direct-period select:focus-visible, #ntDirectSearch:focus-visible,
  .nt-direct-controls input:focus-visible { outline: 2px solid #36c2ff; outline-offset: 3px; }
  .nt-direct-cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); margin: 22px 0; }
  .nt-direct-reading { min-width: 0; padding: 4px 24px; border-left: 1px solid var(--line); }
  .nt-direct-reading:first-child { border: 0; padding-left: 0; }
  .nt-direct-reading:last-child { padding-right: 0; }
  .nt-direct-reading .label { font-size: 13px; color: var(--muted); }
  .nt-direct-reading .amount { display: block; font-size: 30px; font-weight: 700; margin: 7px 0; line-height: 1.3; }
  .nt-direct-reading .amount small { font-size: 12px; font-weight: 400; color: var(--muted); margin-left: 5px; }
  .nt-direct-reading .meta { font-size: 12px; line-height: 1.8; color: var(--muted); overflow-wrap: anywhere; }
  .nt-direct-reading[data-metric="stockAmount"] .amount { color: #36c2ff; }
  .nt-direct-reading[data-metric="etfAmount"] .amount { color: #f6c85f; }
  .nt-direct-reading .amount.missing { font-size: 22px; color: var(--muted); }
  .nt-direct-controls { display: flex; flex-wrap: wrap; gap: 12px 22px; margin: 10px 0; }
  .nt-direct-controls label { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; }
  .nt-direct-controls input { accent-color: var(--series-color); width: 15px; height: 15px; margin: 0; }
  .nt-direct-controls label::after { content: ""; width: 18px; height: 3px; background: var(--series-color); }
  #nationalTeamDirectChart { height: 360px; width: 100%; overflow: hidden; }
  .nt-direct-status { font-size: 12px; color: #f6c85f; margin: 8px 0; line-height: 1.7; }
  .nt-direct-coverage { overflow-x: auto; margin-top: 14px; }
  .nt-direct-coverage table { width: 100%; min-width: 500px; font-size: 12px; border-collapse: collapse; }
  .nt-direct-coverage th, .nt-direct-coverage td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; }
  .nt-direct-coverage th { color: var(--muted); font-weight: 400; }
  .nt-direct-coverage td:first-child { white-space: nowrap; }
  .nt-direct-coverage tr[aria-current="true"] { background: rgba(54,194,255,.06); }
  .nt-direct-details { margin-top: 24px; }
  #ntDirectTable { max-height: 430px; }
  #ntDirectTable table { min-width: 850px; }
  #ntDirectTable td { vertical-align: top; }
  #ntDirectTable td:nth-child(2) { min-width: 120px; }
  #ntDirectTable a { color: #36c2ff; text-underline-offset: 3px; white-space: nowrap; }
  #ntDirectTable .nt-number { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  #ntDirectTable .nt-missing { color: var(--muted); font-size: 11px; }
  #ntDirectTable td:nth-child(3) { max-width: 280px; overflow-wrap: anywhere; }
  #ntDirectSearch { width: 240px; font-size: 13px; }
  .nt-direct-count { font-size: 12px; color: var(--muted); margin: 10px 0; }
  .nt-direct-method { font-size: 12px; line-height: 1.8; color: var(--muted); margin-top: 18px; }
  .nt-direct-method summary { color: var(--text); cursor: pointer; padding: 8px 0; }
  .nt-direct-method p { margin: 8px 0; }
  .nt-direct-method a { color: #36c2ff; }
  .nt-secondary-label { margin: 32px 0 0; font-size: 14px; color: var(--muted); }
  @media (max-width: 620px) {
    .nt-direct-head h3 { font-size: 18px; }
    .nt-direct-cards { grid-template-columns: 1fr; margin: 14px 0; }
    .nt-direct-reading, .nt-direct-reading:first-child, .nt-direct-reading:last-child {
      border-left: 0; padding: 12px 0; border-bottom: 1px solid var(--line);
    }
    .nt-direct-reading .amount { font-size: 26px; margin: 4px 0; }
    .nt-direct-reading .meta { line-height: 1.6; }
    #nationalTeamDirectChart { height: 330px; }
    .nt-direct-controls { gap: 14px 18px; }
    .nt-direct-controls label { font-size: 12px; }
    #ntDirectSearch { width: 100%; }
    .nt-direct-detail-head { gap: 10px; }
  }
`;

const html = `
    <div class="nt-block" id="national-team-direct">
      <div class="nt-direct-head">
        <div><h3>国家队已披露持仓与变化</h3><div class="panel-subtitle" id="ntDirectAsOf"></div></div>
        <label class="nt-direct-period">报告期 <select id="ntDirectPeriod" aria-label="国家队持仓报告期"></select></label>
      </div>
      <div class="nt-direct-cards" id="ntDirectCards" aria-live="polite"></div>
      <div class="nt-direct-tools">
        <div class="panel-title">直接A股与ETF持仓 · 亿元</div>
        <label class="nt-direct-period"><input type="checkbox" id="ntDirectBreakdown">A股账户构成</label>
      </div>
      <div class="nt-direct-controls" id="ntDirectSeries" aria-label="持仓曲线"></div>
      <div id="nationalTeamDirectChart" role="img" aria-label="国家队直接A股及ETF已披露持仓金额走势图"></div>
      <p class="nt-direct-status" id="ntDirectGap"></p>
      <p class="nt-method">报告期末快照，虚线仅连接披露点，不代表每日持仓路径。金额包含价格涨跌；股东榜覆盖变化也会改变可识别金额，不能把两期差额当作实际净买入或净卖出。</p>
      <div class="nt-direct-coverage" id="ntDirectCoverage"></div>
      <div class="nt-direct-details">
        <div class="nt-direct-detail-head">
          <div class="range-tabs" id="ntDirectTabs" role="tablist" aria-label="持仓明细类别">
            <button type="button" class="range-tab active" id="ntDirectStockTab" role="tab" aria-selected="true" aria-controls="ntDirectTable" data-view="stocks">直接A股</button>
            <button type="button" class="range-tab" id="ntDirectEtfTab" role="tab" aria-selected="false" aria-controls="ntDirectTable" data-view="etfs" tabindex="-1">ETF</button>
          </div>
          <input type="search" id="ntDirectSearch" aria-label="筛选持仓明细" placeholder="代码、名称、持有账户">
        </div>
        <div class="nt-direct-count" id="ntDirectTableCount" aria-live="polite"></div>
        <div class="nt-etf-table" id="ntDirectTable" role="tabpanel" aria-labelledby="ntDirectStockTab" tabindex="0"></div>
      </div>
      <details class="nt-direct-method">
        <summary>统计口径与来源</summary>
        <p>识别中央汇金投资、中央汇金资产管理、中国证券金融，以及明确具名的汇金委托计划。未纳入社保、保险、财政部、诚通、国新等其他国有资金。金额是已披露可识别部分，合计不是国家队全部资产。</p>
        <p>直接A股：各公司前十大股东中的国家队A股股数 × 同期未复权收盘价 ÷ 1亿。按股票与账户去重，排除优先股、B股和H股。建行汇金账户已将A股与H股分开。股票股数及股份类别经Tushare和东方财富逐项核对。</p>
        <p>ETF：14只重点宽基样本中具名国家队账户的持有份额 × 同期单位净值 ÷ 1亿。未进入前十名不能视为零持仓；未披露具名持有人表时不计算该期ETF金额，也不沿用上一期份额。股票与ETF仅在同一报告期且均有可识别金额时相加，不再重复计入ETF底层股票。</p>
        <p>“汇金投资”包含长期金融企业控参股持仓；“其他已识别账户”包括证金、汇金资管及具名计划。这是账户分类，不能直接等同于救市资金与非救市资金。仅展示已核实的报告期。</p>
        <p>每条明细附对应来源。2026年中报ETF缺失状态来自逐份报告核查；未披露不表示清仓。核算记录与逐条原始股数保存在仓库的国家队持仓对比文件中。</p>
      </details>
    </div>
    <div class="nt-secondary-label">辅助观察 · ETF申赎与底层股票暴露</div>
`;

function renderDirectHoldings(data) {
  const $ = id => document.getElementById(id);
  const escape = value => String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const fmt = (value, digits = 0) => Number.isFinite(value) ? value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits, maximumFractionDigits: digits
  }) : "未披露";
  const dateLabel = value => value.slice(0, 4) + "-" + value.slice(4, 6) + "-" + value.slice(6);
  const snapshots = data.snapshots;
  let selected = snapshots.findLastIndex(row => row.combinedAmount !== null);
  if (selected < 0) selected = snapshots.length - 1;
  let view = "stocks";
  const seriesDefs = [
    { key: "stockAmount", name: "直接A股", color: "#36c2ff" },
    { key: "etfAmount", name: "ETF样本", color: "#f6c85f" },
    { key: "huijinAmount", name: "汇金投资", color: "#6bd98c", breakdown: true },
    { key: "otherAmount", name: "其他已识别账户", color: "#ff8c9e", breakdown: true }
  ];
  const active = new Set(["stockAmount", "etfAmount", "huijinAmount", "otherAmount"]);
  let breakdown = false;
  $("ntDirectAsOf").textContent = "核验 " + data.checkedAt + " · 汇金、证金及具名委托计划 · 人民币";
  $("ntDirectPeriod").innerHTML = snapshots.map((row, index) => '<option value="' + index + '">' + row.date + '</option>').join("");
  $("ntDirectPeriod").value = String(selected);
  const latest = snapshots.at(-1);
  $("ntDirectGap").textContent = latest.etfAmount === null
    ? latest.date + "：核查的" + latest.etfs.length + "只ETF均缺少具名前十名持有人表，本期ETF及合计金额未披露。"
    : "ETF为固定样本中的已披露金额，不代表全市场ETF持仓。";
  const chart = echarts.init($("nationalTeamDirectChart"), null, { renderer: "canvas" });

  function renderControls() {
    $("ntDirectSeries").innerHTML = seriesDefs.filter(def => !def.breakdown || breakdown).map(def =>
      '<label style="--series-color:' + def.color + '"><input type="checkbox" data-series="' + def.key + '"' +
      (active.has(def.key) ? ' checked' : '') + '>' + def.name + '</label>'
    ).join("");
  }

  function renderChart() {
    const visible = seriesDefs.filter(def => (!def.breakdown || breakdown) && active.has(def.key));
    const values = visible.flatMap(def => snapshots.map(row => row[def.key])).filter(Number.isFinite);
    const low = values.length ? Math.min(...values) : 0;
    const high = values.length ? Math.max(...values) : 1;
    const padding = Math.max((high - low) * 0.15, high * 0.05, 1);
    const step = high > 10000 ? 1000 : high > 1000 ? 100 : 1;
    const minimum = Math.max(0, Math.floor((low - padding) / step) * step);
    const maximum = Math.ceil((high + padding) / step) * step;
    chart.setOption({
      animation: false,
      grid: { left: 65, right: 40, top: 28, bottom: 44 },
      title: visible.length ? [] : [{ text: "未选择持仓曲线", left: "center", top: "42%", textStyle: { color: "#8fa5bf", fontSize: 14 } }],
      tooltip: { trigger: "axis", confine: true, hideDelay: 0, transitionDuration: 0,
        backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
        textStyle: { color: "#edf4ff", fontSize: 12 },
        formatter: params => {
          if (!params.length) return "";
          const row = snapshots[params[0].dataIndex];
          return "<strong>报告期末 " + row.date + "</strong><br>" + visible.map(def =>
            '<span style="color:' + def.color + '">●</span> ' + def.name + "：" +
            (row[def.key] === null ? "未披露" : fmt(row[def.key], 2) + " 亿元")
          ).join("<br>") + "<br>A股：" + row.companyCount + "家公司 / " + row.holderCount + "条持仓" +
            "<br>ETF：具名表 " + row.disclosedFunds + "/" + row.etfs.length + " 只，已识别 " + row.identifiedFunds + " 只";
        } },
      xAxis: { type: "category", boundaryGap: true, data: snapshots.map(row => row.date),
        axisTick: { show: false }, axisLine: { lineStyle: { color: "#344760" } },
        axisLabel: { color: "#8fa5bf", fontSize: 12, hideOverlap: true } },
      yAxis: { type: "value", min: minimum, max: maximum, splitNumber: 4,
        axisLabel: { color: "#8fa5bf", formatter: value => fmt(value) },
        splitLine: { lineStyle: { color: "#233247" } } },
      series: visible.map(def => ({ name: def.name, type: "line", connectNulls: false, smooth: false,
        data: snapshots.map(row => row[def.key]), symbol: "circle", symbolSize: 10, showSymbol: true,
        lineStyle: { color: def.color, type: "dashed", width: 2 }, itemStyle: { color: def.color },
        emphasis: { scale: 1.4 },
        label: { show: visible.length <= 2, position: "top", color: def.color, fontSize: 12,
          formatter: params => params.value === null ? "" : fmt(params.value) }
      }))
    }, true);
  }

  function renderTable() {
    const snapshot = snapshots[selected];
    const query = $("ntDirectSearch").value.trim().toLowerCase();
    const rows = snapshot[view].filter(row => [row.code, row.name, row.holder || ""].join(" ").toLowerCase().includes(query));
    rows.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
    const sourceLink = row => '<a href="' + escape(row.source) + '" target="_blank" rel="noopener noreferrer">' +
      (view === "etfs" ? "报告原文" : "股东来源") + '</a>';
    const headings = view === "stocks"
      ? ["股票代码", "公司", "持有账户", "A股股数 / 亿股", "收盘价 / 元", "持仓 / 亿元", "公告日期", "来源"]
      : ["基金代码", "基金", "披露状态", "已识别份额 / 亿份", "期末净值 / 元", "持仓 / 亿元", "来源"];
    const cells = rows.map(row => {
      if (view === "stocks") return '<tr><td class="nt-etf-code">' + escape(row.code) + '</td><td>' + escape(row.name) +
        '</td><td>' + escape(row.holder) + '</td><td class="nt-number">' + fmt(row.units / 1e8, 4) +
        '</td><td class="nt-number">' + fmt(row.close, 2) + '</td><td class="nt-number">' + fmt(row.amount, 2) +
        '</td><td>' + dateLabel(row.announced) + '</td><td>' + sourceLink(row) + '</td></tr>';
      const status = row.status === "identified" ? "具名持仓" : row.status === "no_identified_account_in_top10"
        ? "榜内未发现，不代表零" : "具名表未披露";
      return '<tr><td class="nt-etf-code">' + row.code + '</td><td>' + escape(row.name) + '</td><td>' + status +
        '</td><td class="nt-number">' + (row.units === null ? "—" : fmt(row.units / 1e8, 4)) +
        '</td><td class="nt-number">' + (row.nav === null ? "—" : fmt(row.nav, 4)) +
        '</td><td class="nt-number' + (row.amount === null ? ' nt-missing' : '') + '">' +
        (row.amount === null ? "无法确认" : fmt(row.amount, 2)) + '</td><td>' + sourceLink(row) + '</td></tr>';
    });
    $("ntDirectTable").innerHTML = '<table><thead><tr>' + headings.map(h => '<th scope="col">' + h + '</th>').join("") +
      '</tr></thead><tbody>' + (cells.join("") || '<tr><td colspan="' + headings.length + '">没有匹配的持仓记录</td></tr>') + '</tbody></table>';
    $("ntDirectTableCount").textContent = snapshot.date + " · " + (view === "stocks"
      ? snapshot.companyCount + "家公司，" + snapshot.holderCount + "条已识别账户持仓"
      : snapshot.etfs.length + "只固定样本，具名表披露" + snapshot.disclosedFunds + "只，已识别持仓" + snapshot.identifiedFunds + "只") +
      (query ? " · 筛选后" + rows.length + "条" : "");
  }

  function renderSnapshot() {
    const row = snapshots[selected];
    const cards = [
      { key: "stockAmount", label: "直接A股持仓", meta: row.companyCount + "家公司 · 前十大股东可识别持仓" },
      { key: "etfAmount", label: "ETF持仓 · 固定样本", meta: row.etfAmount === null
        ? row.etfs.length + "只样本缺少具名表，不能视为零"
        : row.etfs.length + "只样本 · " + row.identifiedFunds + "只发现具名账户" },
      { key: "combinedAmount", label: "以上已识别持仓合计", meta: row.combinedAmount === null
        ? "ETF金额缺失，未计算两类持仓合计" : "同一报告期相加 · 非国家队全部资产" }
    ];
    $("ntDirectCards").innerHTML = cards.map(card => '<div class="nt-direct-reading" data-metric="' + card.key + '">' +
      '<span class="label">' + card.label + '</span><strong class="amount' + (row[card.key] === null ? ' missing' : '') + '">' +
      (row[card.key] === null ? (card.key === "combinedAmount" ? "暂不可合计" : "未披露") : fmt(row[card.key]) + '<small>亿元</small>') +
      '</strong><div class="meta">截至 ' + row.date + '<br>' + card.meta + '</div></div>').join("");
    $("ntDirectCoverage").innerHTML = '<table><thead><tr><th>报告期末</th><th>A股覆盖</th><th>ETF具名表 / 样本</th><th>已识别ETF持仓</th></tr></thead><tbody>' +
      snapshots.map((s, index) => '<tr aria-current="' + (index === selected) + '"><td>' + s.date + '</td><td>' +
        s.companyCount + '家公司 / ' + s.holderCount + '条持仓</td><td>' + s.disclosedFunds + ' / ' + s.etfs.length +
        '只</td><td>' + (s.etfAmount === null ? "未披露" : s.identifiedFunds + "只") + '</td></tr>').join("") + '</tbody></table>';
    renderTable();
  }

  $("ntDirectPeriod").addEventListener("change", event => {
    selected = Number(event.target.value);
    renderSnapshot();
  });
  $("ntDirectSeries").addEventListener("change", event => {
    const key = event.target.dataset.series;
    if (!key) return;
    if (event.target.checked) active.add(key); else active.delete(key);
    renderChart();
  });
  $("ntDirectBreakdown").addEventListener("change", event => {
    breakdown = event.target.checked;
    renderControls();
    renderChart();
  });
  function selectTab(button) {
    view = button.dataset.view;
    $("ntDirectTable").setAttribute("aria-labelledby", button.id);
    $("ntDirectTabs").querySelectorAll("button").forEach(item => {
      const isActive = item === button;
      item.classList.toggle("active", isActive);
      item.setAttribute("aria-selected", String(isActive));
      item.tabIndex = isActive ? 0 : -1;
    });
    $("ntDirectSearch").value = "";
    renderTable();
  }
  $("ntDirectTabs").addEventListener("click", event => {
    const button = event.target.closest("button[data-view]");
    if (button) selectTab(button);
  });
  $("ntDirectTabs").addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...$("ntDirectTabs").querySelectorAll("button")];
    const index = event.key === "Home" ? 0 : event.key === "End" ? 1 : view === "stocks" ? 1 : 0;
    selectTab(buttons[index]);
    buttons[index].focus();
  });
  $("ntDirectSearch").addEventListener("input", renderTable);
  chart.on("click", params => {
    if (params.componentType !== "series") return;
    selected = params.dataIndex;
    $("ntDirectPeriod").value = String(selected);
    renderSnapshot();
  });
  window.addEventListener("resize", () => {
    chart.dispatchAction({ type: "hideTip" });
    chart.resize();
  });
  renderControls();
  renderChart();
  renderSnapshot();
}

function directHoldingsModule() {
  const data = buildDirectData(JSON.parse(fs.readFileSync(SOURCE, "utf8")));
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  return { css, html, checkedAt: data.checkedAt,
    script: '<script id="national-team-direct-script">(' + renderDirectHoldings.toString() + ')(' + payload + ');</script>' };
}

module.exports = { buildDirectData, directHoldingsModule };
