const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "national_team_etf_data.json");
const FLOW_FILE = path.join(ROOT, "work", "etf_flow_data.json");
const directHoldings = require("./national_team_direct_holdings").directHoldingsModule();
const etfHistory = require("./national_team_etf_history").etfHistoryModule();

function stripExisting(html) {
  return html
    .replace(/\s*<section class="module-shell" id="national-team-etf">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="national-team-etf-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="national-team-etf-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<script id="national-team-direct-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<script id="national-team-etf-history-script">[\s\S]*?<\/script>/g, "")
    .replace(/\s*<a href="#national-team-etf"[^>]*>(?:国家队-ETF|国家队持仓)<\/a>/g, "");
}

const css = `
  <style id="national-team-etf-style">
    ${directHoldings.css.trim()}
    ${etfHistory.css.trim()}
    #nationalTeamEtfTrendChart { height: 320px; width: 100%; min-height: 320px; }
    #nationalTeamEtfFlowChart { height: 540px; width: 100%; }
    .nt-block { padding: 20px 0; border-top: 1px solid var(--line); min-width: 0; scroll-margin-top: 72px; }
    .nt-flow-controls { display: flex; gap: 12px; flex-wrap: wrap; justify-content: space-between; align-items: center; }
    .nt-flow-funds { display: flex; flex-wrap: wrap; gap: 10px 18px; margin: 14px 0; }
    .nt-flow-funds label { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text); }
    .nt-flow-funds input { accent-color: var(--accent); }
    .nt-flow-readings { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin: 16px 0 0; }
    .nt-flow-readings span { display: block; color: var(--muted); font-size: 12px; }
    .nt-flow-readings strong { display: block; font-size: 22px; margin: 5px 0; overflow-wrap: anywhere; }
    .nt-method { color: var(--muted); font-size: 12px; line-height: 1.7; margin: 10px 0 0; }
    #national-team-etf .panel-head { flex-wrap: wrap; gap: 12px; }
    #national-team-etf .panel-title { font-size: 16px; }
    #national-team-etf .panel-subtitle { overflow-wrap: anywhere; }
    .nt-flow-table { margin: 12px 0; max-height: 240px; }
    .nt-etf-table { margin-top: 12px; overflow: auto; max-height: 394px; border: 1px solid var(--line); border-radius: 8px; }
    .nt-etf-table table { width: 100%; border-collapse: collapse; min-width: 620px; font-size: 12px; }
    .nt-etf-table th, .nt-etf-table td { padding: 9px 10px; border-bottom: 1px solid rgba(32,49,73,.8); text-align: left; }
    .nt-etf-table th { color: var(--muted); font-weight: 650; background: rgba(13,25,41,.96); position: sticky; top: 0; }
    .nt-etf-table td { color: var(--text); }
    .nt-etf-code { color: var(--accent); font-weight: 700; }
    .nt-etf-note-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 980px) {
      .nt-etf-note-grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 620px) {
      .nt-flow-readings { gap: 10px; }
      .nt-flow-readings strong { font-size: 18px; }
      #nationalTeamEtfFlowChart { height: 500px; }
      .nt-flow-funds { gap: 12px; }
    }
  </style>
`;

const moduleHtml = `
  <section class="module-shell" id="national-team-etf">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 05 / National Team Holdings</div>
        <h2>国家队观察</h2>
        <p>直接A股与ETF的已披露持仓金额、账户构成及报告期变化。</p>
      </div>
      <div class="module-status" id="nationalTeamEtfStatus">披露持仓样本</div>
    </div>
    ${directHoldings.html.trim()}
    ${etfHistory.html.trim()}
    <div class="nt-secondary-label">辅助观察 · ETF申赎与底层股票暴露</div>
    <div class="nt-block">
      <div class="nt-flow-controls">
        <div><div class="panel-title">重点宽基ETF · 每日净申购估算</div><div class="panel-subtitle" id="ntFlowPeriod"></div></div>
        <div class="range-tabs" id="ntFlowRanges" aria-label="ETF申赎时间范围">
          <button class="range-tab" data-days="30" aria-pressed="false">30交易日</button>
          <button class="range-tab" data-days="60" aria-pressed="false">60交易日</button>
          <button class="range-tab active" data-days="90" aria-pressed="true">90交易日</button>
        </div>
      </div>
      <div class="nt-flow-funds" id="ntFlowFunds" aria-label="ETF指数类别"></div>
      <div class="nt-flow-readings" id="ntFlowReadings"></div>
      <div id="nationalTeamEtfFlowChart"></div>
      <div class="nt-etf-table nt-flow-table" id="ntFlowTable"></div>
      <p class="nt-method"><strong>统计口径：</strong>每日净申购估算＝（当日总份额－前一交易日总份额）×当日单位净值，单位亿元；累计值从所选区间首日开始加总。正值为净申购，负值为净赎回。来源为 Tushare ETF每日份额及净值，通常次日更新。</p>
      <p class="nt-method"><strong>归属限制：</strong>包含所有投资者及实物申赎，不能等同于现金流入或国家队买入。范围为下表9只宽基ETF，不代表全部宽基基金。缺失数据不填零、不跨缺失交易日计算；疑似份额拆分留空待核对，累计值在缺失后也留空。</p>
    </div>
    <div class="nt-block">
        <div class="panel-head">
          <div>
            <div class="panel-title">长期披露样本 · 底层股票暴露</div>
            <div class="panel-subtitle">上证50ETF与沪深300ETF，半年报/年报披露快照；单位%，不是国家队持仓总规模</div>
          </div>
        </div>
        <div id="nationalTeamEtfTrendChart"></div>
        <p class="nt-method">基于各期ETF披露股票权重与对应股票的前十大流通股东。已扩展至全部披露A股，不再只取五只股票；不把缺失值视为零，未披露的股东持仓不计入。覆盖不完整时为可识别部分的贡献，不能把比例变化解释为增减持金额。历史点标记报告期末，不表示当时已公开；当前仅使用本次截止日前的公告。</p>
    </div>
    <div class="valuation-foot nt-etf-note-grid">
      <div class="note"><strong>计算口径：</strong>ETF底层国家队暴露＝Σ(披露股票权重×该股国家队流通股持股比例)。权重保留原披露比例，缺少权重时才在披露样本内按市值归一化；股东信息缺失不当作零持仓。名单包括中央汇金、汇金资产、中国证券金融及明确证金账户。</div>
      <div class="note"><strong>限制说明：</strong>不是国家队直接持有ETF的份额比例，也不是持仓总市值。包含国家队长期战略持股，不能都解释为救市买入。基金样本及股东覆盖随报告变化，低于前十大流通股东门槛的持仓无法识别。</div>
    </div>
  </section>
`;

const script = `
  <script id="national-team-etf-script">
  (() => {
    const ntEtfData = __NATIONAL_TEAM_ETF_DATA__;
    const flowData = __ETF_FLOW_DATA__;
    const fmt = (value, digits = 2) => Number.isFinite(value) ? Number(value).toLocaleString("zh-CN", {
      minimumFractionDigits: digits, maximumFractionDigits: digits
    }) : "暂无";
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
    document.getElementById("nationalTeamEtfStatus").textContent =
      "金额核验 ${directHoldings.checkedAt} / 底层暴露 " + ntEtfData.meta.period.slice(0, 4) + "Q" +
      Math.ceil(Number(ntEtfData.meta.period.slice(4, 6)) / 3);

    const trendChart = echarts.init(document.getElementById("nationalTeamEtfTrendChart"), null, { renderer: "canvas" });
    const flowChart = echarts.init(document.getElementById("nationalTeamEtfFlowChart"), null, { renderer: "canvas" });
    const groups = [...new Set(flowData.etfs.map(row => row.group))];
    const selectedGroups = new Set(groups);
    let flowDays = 90;
    document.getElementById("ntFlowFunds").innerHTML = groups.map(group =>
      '<label><input type="checkbox" checked value="' + escapeHtml(group) + '">' + escapeHtml(group) + '</label>'
    ).join("");
    function renderFlow() {
      const rows = flowData.series.slice(-flowDays);
      const funds = flowData.etfs.filter(row => selectedGroups.has(row.group));
      const totals = rows.map(row => {
        const values = funds.map(fund => row.flows[fund.ts_code]);
        return values.length && values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null;
      });
      let running = 0;
      const cumulative = totals.map(value => {
        running = Number.isFinite(value) && running !== null ? running + value : null;
        return running;
      });
      const last = rows[rows.length - 1];
      document.getElementById("ntFlowPeriod").textContent = rows[0].date + " 至 " + last.date + " · " + funds.length + "只ETF · 亿元";
      document.getElementById("ntFlowReadings").innerHTML = [
        [last.date + " 净申购", fmt(totals[totals.length - 1]) + " 亿"],
        ["区间累计净申购", fmt(cumulative[cumulative.length - 1]) + " 亿"],
        ["数据完整交易日", totals.filter(Number.isFinite).length + " / " + rows.length]
      ].map(([label, value]) => '<div><span>' + label + '</span><strong>' + value + '</strong></div>').join("");
      const axis = gridIndex => ({
        gridIndex, type: "category", data: rows.map(row => row.date), boundaryGap: true,
        axisLine: { lineStyle: { color: "#344760" } },
        axisLabel: { color: "#8fa5bf", hideOverlap: true, formatter: value => value.slice(5) }
      });
      const valueAxis = (gridIndex, name) => ({
        gridIndex, name, type: "value", scale: true, nameTextStyle: { color: "#8fa5bf" },
        axisLabel: { color: "#8fa5bf" }, splitLine: { lineStyle: { color: "#17283d" } }
      });
      flowChart.setOption({
        animation: false,
        title: funds.length ? [] : [{ text: "未选择ETF类别", left: "center", top: "40%", textStyle: { color: "#8fa5bf", fontSize: 14 } }],
        grid: [{ left: 70, right: 22, top: 40, height: "44%" }, { left: 70, right: 22, top: "65%", bottom: 44 }],
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        tooltip: {
          trigger: "axis", confine: true, backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter: params => {
            const index = params[0].dataIndex;
            return rows[index].date + "<br>累计净申购：" + fmt(cumulative[index]) + " 亿元<br>当日净申购：" + fmt(totals[index]) + " 亿元";
          }
        },
        xAxis: [axis(0), axis(1)],
        yAxis: [valueAxis(0, "累计净申购 / 亿元"), valueAxis(1, "当日净申购 / 亿元")],
        series: funds.length ? [
          { name: "累计净申购", type: "line", xAxisIndex: 0, yAxisIndex: 0, data: cumulative,
            showSymbol: false, connectNulls: false, lineStyle: { width: 2.5, color: "#f6c85f" }, itemStyle: { color: "#f6c85f" } },
          { name: "当日净申购", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: totals,
            barMaxWidth: 18, itemStyle: { color: params => params.value >= 0 ? "#f6c85f" : "#6bd98c" },
            markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "#8fa5bf" }, data: [{ yAxis: 0 }] } }
        ] : []
      }, true);
      document.getElementById("ntFlowTable").innerHTML = '<table><thead><tr><th>指数类别</th><th>基金</th><th>代码</th><th>最新交易日</th><th>当日净申购（亿元）</th><th>区间累计（亿元）</th></tr></thead><tbody>' + funds.map(fund => {
        const values = rows.map(row => row.flows[fund.ts_code]);
        const total = values.every(Number.isFinite) ? values.reduce((sum, value) => sum + value, 0) : null;
        return '<tr><td>' + escapeHtml(fund.group) + '</td><td>' + escapeHtml(fund.name) + '</td><td class="nt-etf-code">' +
          fund.ts_code + '</td><td>' + last.date + '</td><td>' + fmt(last.flows[fund.ts_code]) + '</td><td>' + fmt(total) + '</td></tr>';
      }).join("") + '</tbody></table>';
    }
    document.getElementById("ntFlowRanges").addEventListener("click", event => {
      const button = event.target.closest("button[data-days]");
      if (!button) return;
      flowDays = Number(button.dataset.days);
      document.querySelectorAll("#ntFlowRanges button").forEach(item => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      renderFlow();
    });
    document.getElementById("ntFlowFunds").addEventListener("change", event => {
      if (event.target.checked) selectedGroups.add(event.target.value);
      else selectedGroups.delete(event.target.value);
      renderFlow();
    });
    renderFlow();
    const historySeries = ntEtfData.history || [];
    const trendNames = {
      "510050.SH": "上证50ETF",
      "510300.SH": "沪深300ETF",
    };
    const trendSeries = Object.keys(trendNames).map(code => ({
      name: trendNames[code],
      type: "line",
      data: historySeries.map(row => [row.date, row[code] ?? null]),
      connectNulls: false,
      showSymbol: true,
      smooth: false,
      lineStyle: { width: 1.8 },
      symbolSize: 7
    }));
    trendSeries.push({
      name: "平均暴露",
      type: "line",
      data: historySeries.map(row => [row.date, row.averageExposure]),
      showSymbol: true,
      symbolSize: 7,
      lineStyle: { width: 3, color: "#f6c85f" },
      itemStyle: { color: "#f6c85f" },
      connectNulls: false
    });
    trendChart.setOption({
      animation: false,
      color: ["#36c2ff", "#ff5d73", "#f6c85f"],
      grid: { left: 58, right: 22, top: 58, bottom: 44 },
      legend: {
        top: 10,
        textStyle: { color: "#8fa5bf" }
      },
      tooltip: {
        trigger: "axis",
        confine: true,
        backgroundColor: "rgba(7,17,31,.96)",
        borderColor: "#36506f",
        textStyle: { color: "#edf4ff" },
        formatter: params => {
          const row = historySeries[params[0].dataIndex];
          return "报告期末 " + row.date + "<br>" + params.map(item => {
            const code = Object.keys(trendNames).find(key => trendNames[key] === item.seriesName);
            return item.marker + item.seriesName + "：" + fmt(item.value[1]) + "%" +
              (code ? "（覆盖权重 " + fmt(row.coverage[code], 1) + "%）" : "");
          }).join("<br>");
        }
      },
      xAxis: {
        type: "time",
        boundaryGap: false,
        axisLine: { lineStyle: { color: "#344760" } },
        axisLabel: { color: "#7890aa", hideOverlap: true }
      },
      yAxis: {
        type: "value",
        scale: true,
        axisLabel: { color: "#7890aa", formatter: "{value}%" },
        splitLine: { lineStyle: { color: "#17283d" } }
      },
      series: trendSeries
    }, true);
    window.addEventListener("resize", () => trendChart.resize());
    window.addEventListener("resize", () => flowChart.resize());
  })();
  </script>
`;

if (!fs.existsSync(DATA_FILE)) throw new Error("Missing national_team_etf_data.json.");
if (!fs.existsSync(FLOW_FILE)) throw new Error("Missing etf_flow_data.json.");
const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
const flow = JSON.parse(fs.readFileSync(FLOW_FILE, "utf8"));
if (!flow.series?.length) throw new Error("No daily ETF flow observations.");
let html = stripExisting(fs.readFileSync(OUTPUT, "utf8"));
html = html.replace(
  '<a href="#official-sentiment">情绪-官方</a>',
  '<a href="#official-sentiment">情绪-官方</a><a href="#national-team-etf">国家队持仓</a>'
);
function insertBeforeLast(source, marker, content) {
  const index = source.lastIndexOf(marker);
  if (index === -1) throw new Error(`Marker not found: ${marker}`);
  return source.slice(0, index) + content + source.slice(index);
}
const ntEtfScript = script.replace("__NATIONAL_TEAM_ETF_DATA__", JSON.stringify(data)).replace("__ETF_FLOW_DATA__", JSON.stringify(flow));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", directHoldings.script + "\n" + etfHistory.script + "\n" + ntEtfScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
