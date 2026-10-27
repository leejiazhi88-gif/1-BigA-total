const fs = require("fs");
const path = require("path");

const SOURCE = path.join(__dirname, "../outputs/national-team-holdings-comparison-20261026.json");
const HISTORY_SOURCE = path.join(__dirname, "national_team_etf_history.json");
const STOCK_HISTORY_SOURCE = path.join(__dirname, "national_team_stock_history.json");
const SOCIAL_HISTORY_SOURCE = path.join(__dirname, "social_security_history.json");
const RATIO_SOURCE = path.join(__dirname, "holding_denominators.json");
const MARKET_CAP_SOURCE = path.join(__dirname, "a_share_market_cap.json");
const { attachHoldingRatios } = require("./holding_ratios");
const { buildHistoryData } = require("./national_team_etf_history");
const FUND_NAMES = {
  "510050": "华夏上证50ETF", "510300": "华泰柏瑞沪深300ETF",
  "510310": "易方达沪深300ETF", "510330": "华夏沪深300ETF",
  "159919": "嘉实沪深300ETF", "510500": "南方中证500ETF",
  "159922": "嘉实中证500ETF", "510580": "易方达中证500ETF",
  "512100": "南方中证1000ETF", "159845": "华夏中证1000ETF",
  "560010": "广发中证1000ETF", "159915": "易方达创业板ETF",
  "588000": "华夏科创50ETF", "588080": "易方达科创50ETF"
};

function buildDirectData(audit, historyAudit, stockHistory) {
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
  if (!historyAudit) return { checkedAt: audit.checked_at, snapshots };
  const history = buildHistoryData(historyAudit);
  const directByPeriod = new Map(snapshots.map(row => [row.period, row]));
  if (stockHistory) {
    if (stockHistory.failures.length) throw new Error("Unresolved stock history audit");
    for (const [period, stocks] of Object.entries(stockHistory.stocks)) {
      const keys = new Set();
      const details = stocks.details.map(row => {
        if (row.end_date !== period) throw new Error("Mixed stock history reporting periods");
        const key = row.ts_code + ":" + row.holder_name;
        if (keys.has(key)) throw new Error("Duplicate historical stock holding");
        keys.add(key);
        if (!(row.a_share_amount > 0) || !(row.close > 0)) throw new Error("Invalid historical share amount or price");
        if (row.excluded_h_shares != null) checkTotal(row.a_share_amount + row.excluded_h_shares, row.hold_amount, "A/H split");
        checkTotal(row.a_share_amount * row.close / 1e8, row.value_yi, row.ts_code);
        return { code: row.ts_code, name: row.stock_name, holder: row.holder_name,
          units: row.a_share_amount, close: row.close, amount: row.value_yi, announced: row.ann_date,
          source: row.adjustment_source || row.source_url, referencePrice: row.price_source !== "Tushare daily" };
      });
      checkTotal(sum(details.map(row => row.amount)), stocks.total_yi, period);
      checkTotal(stocks.huijin_investment_yi + stocks.other_identified_accounts_yi, stocks.total_yi, "historical accounts");
      const companyCount = new Set(details.map(row => row.code)).size;
      if (companyCount !== stocks.stock_count || details.length !== stocks.holder_rows) throw new Error("Historical stock coverage mismatch");
      const previous = directByPeriod.get(period);
      if (previous) {
        checkTotal(stocks.total_yi, previous.stockAmount, "overlapping stock history " + period);
        if (previous.companyCount !== companyCount || previous.holderCount !== details.length) throw new Error("Overlapping stock coverage mismatch");
      }
      directByPeriod.set(period, { ...previous, period,
        date: period.slice(0, 4) + "-" + period.slice(4, 6) + "-" + period.slice(6),
        stockAmount: stocks.total_yi, huijinAmount: stocks.huijin_investment_yi,
        otherAmount: stocks.other_identified_accounts_yi, companyCount, holderCount: details.length,
        stocks: details, stockCoverage: stocks.coverage });
    }
  }
  const reports = new Map(history.reports.map(row => [[row.code, row.period, row.kind].join(":"), row]));
  const periods = [...new Set([...directByPeriod.keys(), ...history.periods.filter(period => /(?:0630|1231)$/.test(period))])].sort();
  const merged = periods.map(period => {
    const direct = directByPeriod.get(period);
    const kind = period.endsWith("0630") ? "interim" : period.endsWith("1231") ? "annual" : "quarterly";
    const etfs = history.funds.filter(fund => fund.inception <= period).map(fund => {
      const report = reports.get([fund.code, period, kind].join(":"));
      return { code: fund.code, name: fund.name, amount: report?.amount ?? null, units: report?.units ?? null,
        nav: report?.nav ?? null, status: report?.status || "report_not_found", disclosed: report?.table || false,
        source: report?.source || "https://fundf10.eastmoney.com/jjgg_" + fund.code + ".html" };
    });
    const identifiedFunds = etfs.filter(row => row.amount !== null).length;
    const disclosedFunds = etfs.filter(row => row.disclosed).length;
    const etfAmount = etfs.length > 0 && disclosedFunds === etfs.length && identifiedFunds > 0
      ? sum(etfs.map(row => row.amount ?? 0)) : null;
    if (direct?.etfAmount !== undefined && (direct.etfAmount === null) !== (etfAmount === null)) throw new Error("ETF history disclosure mismatch: " + period);
    if (direct?.etfAmount !== undefined && etfAmount !== null) checkTotal(etfAmount, direct.etfAmount, "ETF history " + period);
    // ETF history does not establish stock holdings for earlier periods.
    const stock = direct || { period, date: period.slice(0, 4) + "-" + period.slice(4, 6) + "-" + period.slice(6),
      stockAmount: null, huijinAmount: null, otherAmount: null, companyCount: null, holderCount: null, stocks: [] };
    return { ...stock, stockStatus: direct ? "verified" : "not_backfilled", etfs, etfAmount,
      combinedAmount: stock.stockAmount === null || etfAmount === null ? null : stock.stockAmount + etfAmount,
      identifiedFunds, disclosedFunds, candidateFunds: history.funds.length, etfReportKind: kind };
  });
  return { checkedAt: audit.checked_at, historyCheckedAt: history.checkedAt, snapshots: merged };
}

function attachSocialData(data, social) {
  if (social.failures.length) throw new Error("Unresolved social security audit");
  const periods = new Set(data.snapshots.map(row => row.period));
  const byPeriod = new Map();
  for (const row of social.snapshots) {
    if (!periods.has(row.period) || byPeriod.has(row.period)) throw new Error("Invalid social security period");
    const keys = new Set();
    for (const detail of row.details) {
      const key = detail.code + ":" + detail.account;
      if (keys.has(key)) throw new Error("Duplicate social security holding");
      keys.add(key);
      if (detail.period !== row.period || detail.announced > social.checkedAt) throw new Error("Mixed social security reporting periods");
      if (!(detail.units > 0) || !(detail.close > 0) || !Number.isFinite(detail.amount) ||
          Math.abs(detail.units * detail.close / 1e8 - detail.amount) > 0.01) throw new Error("Social security amount mismatch");
    }
    if (!Number.isFinite(row.amount) || Math.abs(row.details.reduce((sum, d) => sum + d.amount, 0) - row.amount) > 0.01) throw new Error("Social security total mismatch");
    if (row.holderCount !== row.details.length || row.companyCount !== new Set(row.details.map(d => d.code)).size) throw new Error("Social security coverage mismatch");
    byPeriod.set(row.period, row);
  }
  return { ...data, socialCheckedAt: social.checkedAt, snapshots: data.snapshots.map(row => {
    const entry = byPeriod.get(row.period);
    return { ...row, socialAmount: entry?.amount ?? null, socialCompanyCount: entry?.companyCount ?? null,
      socialHolderCount: entry?.holderCount ?? null, socialCoverage: entry?.coverage ?? null,
      social: entry?.details ?? [] };
  }) };
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
  .nt-direct-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 22px 0; }
  .nt-direct-reading { min-width: 0; padding: 4px 24px; border-left: 1px solid var(--line); }
  .nt-direct-reading:first-child { border: 0; padding-left: 0; }
  .nt-direct-reading:last-child { padding-right: 0; }
  .nt-direct-reading .label { font-size: 13px; color: var(--muted); }
  .nt-direct-reading .amount { display: block; font-size: 30px; font-weight: 700; margin: 7px 0; line-height: 1.3; }
  .nt-direct-reading .amount small { font-size: 12px; font-weight: 400; color: var(--muted); margin-left: 5px; }
  .nt-direct-reading .meta { font-size: 12px; line-height: 1.8; color: var(--muted); overflow-wrap: anywhere; }
  .nt-direct-reading[data-metric="stockAmount"] .amount { color: #36c2ff; }
  .nt-direct-reading[data-metric="etfAmount"] .amount { color: #f6c85f; }
  .nt-direct-reading[data-metric="socialAmount"] .amount { color: #6bd98c; }
  .nt-direct-reading .amount.missing { font-size: 22px; color: var(--muted); }
  .nt-direct-controls { display: flex; flex-wrap: wrap; gap: 12px 22px; margin: 10px 0; }
  .nt-direct-controls label { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; }
  .nt-direct-controls input { accent-color: var(--series-color); width: 15px; height: 15px; margin: 0; }
  .nt-direct-controls label::after { content: ""; width: 18px; height: 3px; background: var(--series-color); }
  .nt-direct-chart-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; }
  #nationalTeamDirectChart { height: 360px; width: 100%; overflow: hidden; }
  .nt-direct-status { font-size: 12px; color: #f6c85f; margin: 8px 0; line-height: 1.7; }
  .nt-direct-coverage { overflow: auto; max-height: 240px; margin-top: 14px; }
  .nt-direct-coverage table { width: 100%; min-width: 500px; font-size: 12px; border-collapse: collapse; }
  .nt-direct-coverage th, .nt-direct-coverage td { padding: 10px 12px; border-bottom: 1px solid var(--line); text-align: left; }
  .nt-direct-coverage th { color: var(--muted); font-weight: 400; position: sticky; top: 0; background: #101c2c; }
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
  @media (min-width: 621px) and (max-width: 1000px) {
    .nt-direct-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px 0; }
    .nt-direct-reading:nth-child(3) { border-left: 0; padding-left: 0; }
  }
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
        <div><h3>国家队与社保已披露持仓</h3><div class="panel-subtitle" id="ntDirectAsOf"></div></div>
        <label class="nt-direct-period">报告期 <select id="ntDirectPeriod" aria-label="国家队持仓报告期"></select></label>
      </div>
      <div class="nt-direct-cards" id="ntDirectCards" aria-live="polite"></div>
      <div class="nt-direct-tools">
        <div class="panel-title" id="ntDirectChartTitle">汇金／证金与社保投资组合 · 亿元</div>
        <div class="nt-direct-chart-tools">
          <div class="range-tabs" id="ntDirectMode" role="group" aria-label="持仓展示口径">
            <button type="button" class="range-tab active" data-mode="amount" aria-pressed="true">金额</button>
            <button type="button" class="range-tab" data-mode="ratio" aria-pressed="false">持仓比例</button>
          </div>
          <label class="nt-direct-period"><input type="checkbox" id="ntDirectBreakdown">汇金／证金A股构成</label>
        </div>
      </div>
      <div class="nt-direct-controls" id="ntDirectSeries" aria-label="持仓曲线"></div>
      <div id="nationalTeamDirectChart" role="img" aria-label="汇金、证金及社保投资组合已披露持仓金额走势图"></div>
      <p class="nt-method" id="ntDirectRatioNote" hidden>A股两条曲线：已识别持仓金额÷同期全A股总市值（沪深北，含限售A股）。ETF：已识别持仓金额÷各已识别持有基金的总净资产合计。A股分母不随识别到的持股公司数量变化；分子仍受股东榜披露覆盖及相对涨跌影响，不等于净买入。</p>
      <p class="nt-direct-status" id="ntDirectGap"></p>
      <p class="nt-method">2015年6月起，A股按季度展示；ETF为中报、年报已披露时点。虚线仅连接披露快照，不代表每日持仓路径。金额含价格涨跌及股东榜覆盖变化，不能把差额当作实际净买卖额。</p>
      <p class="nt-method">社保曲线为具名投资组合的直接A股持仓，含明确具名的委托组合；不含理事会直持、划转账户、基本养老保险及ETF。社保独立展示，不计入汇金／证金合计。</p>
      <div class="nt-direct-coverage" id="ntDirectCoverage"></div>
      <div class="nt-direct-details">
        <div class="nt-direct-detail-head">
          <div class="range-tabs" id="ntDirectTabs" role="tablist" aria-label="持仓明细类别">
            <button type="button" class="range-tab active" id="ntDirectStockTab" role="tab" aria-selected="true" aria-controls="ntDirectTable" data-view="stocks">直接A股</button>
            <button type="button" class="range-tab" id="ntDirectEtfTab" role="tab" aria-selected="false" aria-controls="ntDirectTable" data-view="etfs" tabindex="-1">ETF</button>
            <button type="button" class="range-tab" id="ntDirectSocialTab" role="tab" aria-selected="false" aria-controls="ntDirectTable" data-view="social" tabindex="-1">社保投资组合</button>
          </div>
          <input type="search" id="ntDirectSearch" aria-label="筛选持仓明细" placeholder="代码、名称、持有账户">
        </div>
        <div class="nt-direct-count" id="ntDirectTableCount" aria-live="polite"></div>
        <div class="nt-etf-table" id="ntDirectTable" role="tabpanel" aria-labelledby="ntDirectStockTab" tabindex="0"></div>
      </div>
      <details class="nt-direct-method">
        <summary>统计口径与来源</summary>
        <p>汇金／证金曲线识别中央汇金投资、中央汇金资产管理、中国证券金融，以及明确具名的汇金委托计划。社保投资组合单独识别、单独展示，不加入原有汇金／证金股票与ETF合计；保险、财政部、诚通、国新等未纳入。金额是已披露可识别部分，不是相关机构全部资产。</p>
        <p>社保投资组合：识别“全国社保基金××组合”及基金公司、证券公司明确标注的社保基金委托组合；中文和阿拉伯数字编号统一，按股票与组合去重。统一采用前十大股东表，用Tushare核对；金额＝A股股数×期末参考价÷1亿。理事会直持、转持／划转及基本养老保险账户不包含在此线。完整覆盖及来源差异见<a href="https://github.com/leejiazhi88-gif/1-BigA-total/blob/main/outputs/social-security-history-audit.md" target="_blank" rel="noopener noreferrer">社保历史核查</a>。</p>
        <p>持仓比例：汇金／证金A股和社保投资组合A股共用同期全A股总市值作为分母，包含沪市主板、科创板、深市主板、创业板及开市后的北交所，含流通与限售A股，排除B/H股、基金和新三板。取报告期末最后交易日市值；沪深来自Tushare交易所市场统计，北交所来自官方日报。汇金投资与其他账户构成也使用该分母，两项比例可以相加。ETF分母仍为当期已识别持有基金的总份额×同一净值，含场外份额，按基金去重；股票和ETF比例不合计。明细中的“占该标的比例”仍以单家公司A股总股本或单只基金总份额计算，与全市场曲线含义不同。分母证据及差异见<a href="https://github.com/leejiazhi88-gif/1-BigA-total/blob/main/outputs/holding-ratio-audit.md" target="_blank" rel="noopener noreferrer">持仓比例核查</a>。</p>
        <p>直接A股：东方财富各期前十大股东表中的国家队A股股数 × 期末参考价 ÷ 1亿，以Tushare交叉核对。正常交易采用期末最后交易日未复权收盘价；停牌采用数据源期末参考市值折算价，明细以＊标记。按股票与账户去重，排除B/H股、优先股、上市前及退市后的记录；建行A/H股按各期原报告拆分。</p>
        <p>汇金／证金历史统一采用前十大股东表，未把前十大流通股东另行并入。仅识别上述三家机构及全称明确的委托账户，不把名称仅含“汇金”的普通私募、中证金融计划或转融通担保账户一概计入。各期公司数量会随进入、退出股东榜及披露覆盖变化，不等于国家队真实持股公司总数。</p>
        <p>ETF：14只重点宽基候选样本中具名国家队账户的持有份额 × 同期单位净值 ÷ 1亿；仅纳入当期已成立基金，2015年6月为8只。未进入前十名不能视为零持仓；缺少具名持有人表时不汇总该期ETF金额，也不沿用上一期份额。股票与ETF仅在同一报告期且均有可识别金额时相加，不再重复计入ETF底层股票。</p>
        <p>“汇金投资”包含长期金融企业控参股持仓；“其他已识别账户”包括证金、汇金资管及具名计划。这是账户分类，不能直接等同于救市资金与非救市资金。仅展示已核实的报告期。</p>
        <p>每条明细附对应来源。2026年中报ETF缺失状态来自逐份报告核查；未披露不表示清仓。核算记录与逐条原始股数保存在仓库的国家队持仓对比文件中。</p>
      </details>
    </div>
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
  let mode = "amount";
  const valueOf = (row, key) => mode === "ratio" ? row.ratios[key] ?? null : row[key];
  const ratioDigits = value => Math.abs(value) < 1 ? 3 : 2;
  const displayValue = value => fmt(value, mode === "ratio" ? ratioDigits(value) : 0);
  const unit = () => mode === "ratio" ? "%" : "亿元";
  const seriesDefs = [
    { key: "stockAmount", name: "汇金／证金A股", color: "#36c2ff" },
    { key: "etfAmount", name: "汇金／证金ETF", color: "#f6c85f" },
    { key: "socialAmount", name: "社保投资组合A股", color: "#6bd98c" },
    { key: "huijinAmount", name: "汇金投资", color: "#e6a76f", breakdown: true },
    { key: "otherAmount", name: "其他已识别账户", color: "#ff8c9e", breakdown: true }
  ];
  const active = new Set(seriesDefs.map(def => def.key));
  let breakdown = false;
  let zoom = { start: 0, end: 100 };
  $("ntDirectAsOf").textContent = "汇金／证金核验 " + data.checkedAt + " · 社保核验 " + dateLabel(data.socialCheckedAt) + " · 人民币";
  $("ntDirectPeriod").innerHTML = [...snapshots].reverse().map(row => '<option value="' + row.period + '">' + row.date + '</option>').join("");
  $("ntDirectPeriod").value = snapshots[selected].period;
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

  function axisState() {
    const visible = seriesDefs.filter(def => (!def.breakdown || breakdown) && active.has(def.key));
    const first = Math.round(zoom.start / 100 * (snapshots.length - 1));
    const last = Math.round(zoom.end / 100 * (snapshots.length - 1));
    const values = visible.flatMap(def => snapshots.slice(first, last + 1).map(row => valueOf(row, def.key))).filter(Number.isFinite);
    const low = values.length ? Math.min(...values) : 0;
    const high = values.length ? Math.max(...values) : 1;
    const padding = Math.max((high - low) * 0.15, high * 0.05, mode === "ratio" ? 0.01 : 1);
    const step = mode === "ratio" ? (high > 10 ? 1 : high > 1 ? 0.1 : 0.01) : high > 10000 ? 1000 : high > 1000 ? 100 : 1;
    const minimum = Math.max(0, Math.floor((low - padding) / step) * step);
    const maximum = mode === "ratio" ? Math.min(100, Math.ceil((high + padding) / step) * step) : Math.ceil((high + padding) / step) * step;
    return { yAxis: { min: minimum, max: maximum },
      title: values.length ? [] : [{ text: visible.length ? "该区间暂无已核实持仓" : "未选择持仓曲线", left: "center", top: "42%", textStyle: { color: "#8fa5bf", fontSize: 14 } }] };
  }

  function renderChart() {
    $("ntDirectChartTitle").textContent = "汇金／证金与社保投资组合 · " + unit();
    $("ntDirectRatioNote").hidden = mode !== "ratio";
    const visible = seriesDefs.filter(def => (!def.breakdown || breakdown) && active.has(def.key));
    const axes = axisState();
    chart.setOption({
      animation: false,
      grid: { left: 65, right: 40, top: 28, bottom: 82 },
      title: axes.title,
      tooltip: { trigger: "axis", confine: true, hideDelay: 0, transitionDuration: 0,
        backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
        textStyle: { color: "#edf4ff", fontSize: 12 },
        formatter: params => {
          if (!params.length) return "";
          const row = snapshots.find(s => s.date === params[0].axisValue);
          return "<strong>报告期末 " + row.date + "</strong><br>" + visible.map(def => {
            const value = valueOf(row, def.key);
            const base = row.ratioBases[def.breakdown ? "stockAmount" : def.key];
            return '<span style="color:' + def.color + '">●</span> ' + def.name + "：" +
              (value === null ? "未披露" : fmt(value, mode === "ratio" ? ratioDigits(value) : 2) + " " + unit()) +
              (mode === "ratio" && value !== null ? "<br>　" + fmt(row[def.key], 2) + " ÷ " + fmt(base.amount, 2) + " 亿元" +
                (base.scope === "all_a_shares" ? "（全A股 · " + dateLabel(base.date) + "）" : "（已识别持有基金）") : "");
          }).join("<br>") + "<br>A股：" + (row.stockStatus === "not_backfilled" ? "该期尚未回溯" : row.companyCount + "家公司 / " + row.holderCount + "条持仓") +
            "<br>ETF：具名表 " + row.disclosedFunds + "/" + row.etfs.length + " 只，已识别 " + row.identifiedFunds + " 只" +
            "<br>社保：" + (row.socialAmount === null ? "该期尚未核实" : row.socialCompanyCount + "家公司 / " + row.socialHolderCount + "条持仓");
        } },
      xAxis: { type: "category", boundaryGap: true, data: snapshots.map(row => row.date),
        axisTick: { show: false }, axisLine: { lineStyle: { color: "#344760" } },
        axisLabel: { color: "#8fa5bf", fontSize: 12, hideOverlap: true } },
      yAxis: { type: "value", ...axes.yAxis, splitNumber: 4,
        axisLabel: { color: "#8fa5bf", formatter: value => mode === "ratio" ? fmt(value, value < 1 && value !== 0 ? 2 : 1) + "%" : fmt(value) },
        splitLine: { lineStyle: { color: "#233247" } } },
      dataZoom: [{ type: "slider", xAxisIndex: 0, ...zoom, filterMode: "none", height: 22, bottom: 8,
        borderColor: "#344760", fillerColor: "rgba(54,194,255,.12)", textStyle: { color: "#8fa5bf", fontSize: 10 } },
        { type: "inside", xAxisIndex: 0, filterMode: "none" }],
      series: visible.map(def => ({ name: def.name, type: "line", connectNulls: false, smooth: false,
        data: snapshots.filter(row => def.key !== "etfAmount" || row.etfReportKind !== "quarterly").map(row => [row.date, valueOf(row, def.key)]), symbol: "circle", symbolSize: 8, showSymbol: true,
        lineStyle: { color: def.color, type: "dashed", width: 2 }, itemStyle: { color: def.color },
        emphasis: { scale: 1.4 },
        label: { show: visible.length <= 2, position: "top", color: def.color, fontSize: 12,
          formatter: params => params.value[1] === null ? "" :
            (snapshots.filter(row => valueOf(row, def.key) !== null).length <= 3 || params.value[0] === snapshots.findLast(row => valueOf(row, def.key) !== null)?.date ? displayValue(params.value[1]) + (mode === "ratio" ? "%" : "") : "") }
      }))
    }, true);
  }

  chart.on("datazoom", () => {
    const current = chart.getOption().dataZoom[0];
    zoom = { start: current.start, end: current.end };
    chart.setOption(axisState(), { replaceMerge: ["title"] });
  });

  function renderTable() {
    const snapshot = snapshots[selected];
    const query = $("ntDirectSearch").value.trim().toLowerCase();
    const rows = snapshot[view].filter(row => [row.code, row.name, row.holder || ""].join(" ").toLowerCase().includes(query));
    rows.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
    const sourceLink = row => '<a href="' + escape(row.source) + '" target="_blank" rel="noopener noreferrer">' +
      (view === "etfs" ? (row.status === "report_not_found" ? "公告列表" : "报告原文") : "股东来源") + '</a>';
    const headings = view !== "etfs"
      ? ["股票代码", "公司", "持有账户", "A股股数 / 亿股", "期末参考价 / 元", "持仓 / 亿元", "公告日期", "来源"]
      : ["基金代码", "基金", "披露状态", "已识别份额 / 亿份", "期末净值 / 元", "持仓 / 亿元", "来源"];
    if (mode === "ratio") headings.push(view === "etfs" ? "基金总份额 / 亿份" : "A股总股本 / 亿股", "占该标的比例");
    const ratioCells = row => mode !== "ratio" ? "" : '<td class="nt-number">' + (row.totalUnits == null ? "未核实" : fmt(row.totalUnits / 1e8, 4)) +
      '</td><td class="nt-number">' + (row.ownershipPct == null ? "无法确认" : fmt(row.ownershipPct, 3) + "%") + '</td>';
    const cells = rows.map(row => {
      if (view !== "etfs") return '<tr><td class="nt-etf-code">' + escape(row.code) + '</td><td>' + escape(row.name) +
        '</td><td>' + escape(row.holder) + '</td><td class="nt-number">' + fmt(row.units / 1e8, 4) +
        '</td><td class="nt-number">' + fmt(row.close, 2) + (row.referencePrice ? '＊' : '') + '</td><td class="nt-number">' + fmt(row.amount, 2) +
        '</td><td>' + dateLabel(row.announced) + '</td><td>' + sourceLink(row) + '</td>' + ratioCells(row) + '</tr>';
      const status = row.status === "identified" ? "具名持仓" : row.status === "no_identified_account_in_top10"
        ? "榜内未发现，不代表零" : row.status === "report_not_found" ? "暂未检索到报告" : "具名表未披露";
      return '<tr><td class="nt-etf-code">' + row.code + '</td><td>' + escape(row.name) + '</td><td>' + status +
        '</td><td class="nt-number">' + (row.units === null ? "—" : fmt(row.units / 1e8, 4)) +
        '</td><td class="nt-number">' + (row.nav === null ? "—" : fmt(row.nav, 4)) +
        '</td><td class="nt-number' + (row.amount === null ? ' nt-missing' : '') + '">' +
        (row.amount === null ? "无法确认" : fmt(row.amount, 2)) + '</td><td>' + sourceLink(row) + '</td>' + ratioCells(row) + '</tr>';
    });
    $("ntDirectTable").innerHTML = '<table><thead><tr>' + headings.map(h => '<th scope="col">' + h + '</th>').join("") +
      '</tr></thead><tbody>' + (cells.join("") || '<tr><td colspan="' + headings.length + '">' +
        (view === "social" && snapshot.socialAmount === null ? "该期社保持仓尚未核实，不能视为零持仓" : view === "stocks" && snapshot.stockStatus === "not_backfilled" ? "该期直接A股持仓尚未回溯，不能视为零持仓" : "没有匹配的持仓记录") + '</td></tr>') + '</tbody></table>';
    $("ntDirectTableCount").textContent = snapshot.date + " · " + (view === "stocks"
      ? (snapshot.stockStatus === "not_backfilled" ? "直接A股尚未回溯" : snapshot.companyCount + "家公司，" + snapshot.holderCount + "条已识别账户持仓")
      : view === "social" ? (snapshot.socialAmount === null ? "社保持仓尚未核实" : snapshot.socialCompanyCount + "家公司，" + snapshot.socialHolderCount + "条社保组合持仓")
      : snapshot.etfs.length + "只当期已成立样本，具名表披露" + snapshot.disclosedFunds + "只，已识别持仓" + snapshot.identifiedFunds + "只") +
      (query ? " · 筛选后" + rows.length + "条" : "") +
      ((view === "stocks" && snapshot.stockCoverage?.reference_price_rows) || (view === "social" && snapshot.socialCoverage?.reference_price_rows) ? " · ＊停牌等情形采用期末参考市值折算价" : "");
  }

  function renderSnapshot() {
    const row = snapshots[selected];
    const cards = [
      { key: "stockAmount", label: "汇金／证金 · 直接A股", meta: row.stockStatus === "not_backfilled" ? "该期尚未回溯，不能视为零持仓" : row.companyCount + "家公司 · 前十大股东可识别持仓" },
      { key: "etfAmount", label: "汇金／证金 · ETF样本", meta: row.etfAmount === null
        ? "具名表 " + row.disclosedFunds + "/" + row.etfs.length + "只，金额无法核实"
        : row.etfs.length + "只当期已成立样本 · " + row.identifiedFunds + "只发现具名账户" },
      { key: "combinedAmount", label: "汇金／证金合计 · 不含社保", meta: row.combinedAmount === null
        ? (row.stockAmount === null ? "直接A股尚未回溯，暂不能合计" : "ETF金额缺失，未计算两类持仓合计") : "同一报告期A股＋ETF · 非全部资产" },
      { key: "socialAmount", label: "社保投资组合 · 直接A股", meta: row.socialAmount === null ? "该期尚未核实" : row.socialCompanyCount + "家公司 · " + row.socialHolderCount + "条持仓" }
    ];
    $("ntDirectCards").innerHTML = cards.map(card => {
      const value = valueOf(row, card.key);
      const combinedRatio = mode === "ratio" && card.key === "combinedAmount";
      const base = row.ratioBases[card.key];
      const meta = combinedRatio ? "A股与ETF分母不同，比例分别展示" : mode === "ratio" && base?.amount
        ? (card.key === "etfAmount" ? "分母 " + fmt(base.amount) + "亿元 · " + base.count + "只已识别持有基金"
          : "全A股总市值 " + fmt(base.amount) + "亿元 · " + dateLabel(base.date) + "<br>已识别持仓 " +
            (card.key === "stockAmount" ? row.companyCount : row.socialCompanyCount) + "家公司") : card.meta;
      return '<div class="nt-direct-reading" data-metric="' + card.key + '">' +
        '<span class="label">' + (combinedRatio ? "汇金／证金综合比例" : card.label) + '</span><strong class="amount' + (value === null ? ' missing' : '') + '">' +
        (value === null ? (combinedRatio ? "不合并比例" : card.key === "combinedAmount" ? "暂不可合计" : "未披露") : displayValue(value) + '<small>' + unit() + '</small>') +
        '</strong><div class="meta">截至 ' + row.date + '<br>' + meta + '</div></div>';
    }).join("");
    $("ntDirectCoverage").innerHTML = '<table><thead><tr><th>报告期末</th><th>汇金／证金A股</th><th>ETF具名表 / 样本</th><th>已识别ETF持仓</th><th>社保A股覆盖</th></tr></thead><tbody>' +
      [...snapshots].reverse().map(s => '<tr aria-current="' + (s.period === row.period) + '"><td>' + s.date + '</td><td>' +
        (s.stockStatus === "not_backfilled" ? "尚未回溯" : s.companyCount + '家公司 / ' + s.holderCount + '条持仓') + '</td><td>' + s.disclosedFunds + ' / ' + s.etfs.length +
        '只</td><td>' + (s.etfAmount === null ? "未披露" : s.identifiedFunds + "只") + '</td><td>' +
        (s.socialAmount === null ? "尚未核实" : s.socialCompanyCount + "家公司 / " + s.socialHolderCount + "条") + '</td></tr>').join("") + '</tbody></table>';
    renderTable();
  }

  $("ntDirectPeriod").addEventListener("change", event => {
    selected = snapshots.findIndex(row => row.period === event.target.value);
    renderSnapshot();
  });
  $("ntDirectSeries").addEventListener("change", event => {
    const key = event.target.dataset.series;
    if (!key) return;
    if (event.target.checked) active.add(key); else active.delete(key);
    renderChart();
  });
  $("ntDirectMode").addEventListener("click", event => {
    const button = event.target.closest("button[data-mode]");
    if (!button || button.dataset.mode === mode) return;
    mode = button.dataset.mode;
    $("ntDirectMode").querySelectorAll("button").forEach(item => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    });
    renderChart();
    renderSnapshot();
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
    const current = buttons.findIndex(button => button.dataset.view === view);
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    selectTab(buttons[index]);
    buttons[index].focus();
  });
  $("ntDirectSearch").addEventListener("input", renderTable);
  chart.on("click", params => {
    if (params.componentType !== "series") return;
    selected = snapshots.findIndex(row => row.date === params.value[0]);
    $("ntDirectPeriod").value = snapshots[selected].period;
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
  const data = attachHoldingRatios(attachSocialData(buildDirectData(JSON.parse(fs.readFileSync(SOURCE, "utf8")), JSON.parse(fs.readFileSync(HISTORY_SOURCE, "utf8")), JSON.parse(fs.readFileSync(STOCK_HISTORY_SOURCE, "utf8"))), JSON.parse(fs.readFileSync(SOCIAL_HISTORY_SOURCE, "utf8"))), JSON.parse(fs.readFileSync(RATIO_SOURCE, "utf8")), JSON.parse(fs.readFileSync(MARKET_CAP_SOURCE, "utf8")));
  const payload = JSON.stringify(data).replace(/</g, "\\u003c");
  return { css, html, checkedAt: data.checkedAt,
    script: '<script id="national-team-direct-script">(' + renderDirectHoldings.toString() + ')(' + payload + ');</script>' };
}

module.exports = { buildDirectData, attachSocialData, directHoldingsModule };
