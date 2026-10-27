const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const DATA_FILE = path.join(ROOT, "work", "national_team_etf_data.json");
const FLOW_FILE = path.join(ROOT, "work", "etf_flow_data.json");
const { flowWindow, summarizeFlows, validateFlowHistory } = require("./etf_flow_history");
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
    #ntFlowCoverage { color: #f6c85f; }
    #national-team-etf-flow .nt-method a { color: var(--accent); }
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
        <p>汇金／证金A股与ETF、社保投资组合A股的已披露金额及报告期变化。</p>
      </div>
      <div class="module-status" id="nationalTeamEtfStatus">披露持仓样本</div>
    </div>
    ${directHoldings.html.trim()}
    ${etfHistory.html.trim()}
    <div class="nt-secondary-label">辅助观察 · ETF申赎与底层股票暴露</div>
    <div class="nt-block" id="national-team-etf-flow">
      <div class="nt-flow-controls">
        <div><div class="panel-title">重点宽基ETF · 每日净申购估算</div><div class="panel-subtitle" id="ntFlowPeriod"></div></div>
        <div class="range-tabs" id="ntFlowRanges" aria-label="ETF申赎时间范围">
          <button class="range-tab" data-range="30d" aria-pressed="false">30交易日</button>
          <button class="range-tab" data-range="60d" aria-pressed="false">60交易日</button>
          <button class="range-tab" data-range="90d" aria-pressed="false">90交易日</button>
          <button class="range-tab" data-range="1y" aria-pressed="false">1年</button>
          <button class="range-tab" data-range="3y" aria-pressed="false">3年</button>
          <button class="range-tab" data-range="5y" aria-pressed="false">5年</button>
          <button class="range-tab active" data-range="all" aria-pressed="true">2015至今</button>
        </div>
      </div>
      <div class="nt-flow-funds" id="ntFlowFunds" aria-label="ETF指数类别"></div>
      <div class="nt-flow-readings" id="ntFlowReadings"></div>
      <p class="nt-method" id="ntFlowCoverage" aria-live="polite"></p>
      <div id="nationalTeamEtfFlowChart" role="img" aria-label="2015年以来重点宽基ETF日度净申购与区间累计走势图"></div>
      <div class="nt-etf-table nt-flow-table" id="ntFlowTable"></div>
      <p class="nt-method"><strong>统计口径：</strong>每日净申购估算＝（当日总份额－前一交易日总份额×当日折算比例）×当日单位净值，单位亿元；无折算时比例为1。累计值从当前可见区间首日重算。正值为净申购，负值为净赎回。来源为Tushare每日份额及净值，已按原始年报核对3次份额折算。</p>
      <p class="nt-method"><strong>历史覆盖：</strong>从2015年首个交易日开始，按当时已上市的样本汇总；南方中证1000从2016年11月、华夏科创50从2020年11月加入，上市募集规模不作为当日申购。缺失不填零、不跨缺失交易日计算；缺失日总量及累计曲线断开，后续累计仅加总已知部分，不代表完整区间净申购。明细＊表示存在缺失，覆盖数量及可得起点随所选区间更新。</p>
      <p class="nt-method"><strong>归属限制：</strong>包含所有投资者及实物申赎，不能等同于现金流入或国家队买入。范围为下表9只宽基ETF，不代表全部宽基基金。<a href="https://github.com/leejiazhi88-gif/1-BigA-total/blob/main/outputs/etf-flow-history-audit.md" target="_blank" rel="noopener noreferrer">历史数据与折算核查</a></p>
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
    const flowWindow = ${flowWindow.toString()};
    const summarizeFlows = ${summarizeFlows.toString()};
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
    let flowRange = "all";
    let flowZoom = { start: 0, end: 100 };
    document.getElementById("ntFlowFunds").innerHTML = groups.map(group =>
      '<label><input type="checkbox" checked value="' + escapeHtml(group) + '">' + escapeHtml(group) + '</label>'
    ).join("");
    function renderFlow() {
      const allRows = flowWindow(flowData.series, flowRange);
      const first = Math.round(flowZoom.start / 100 * (allRows.length - 1));
      const lastIndex = Math.max(first, Math.round(flowZoom.end / 100 * (allRows.length - 1)));
      const rows = allRows.slice(first, lastIndex + 1);
      const funds = flowData.etfs.filter(row => selectedGroups.has(row.group));
      const summary = summarizeFlows(rows, funds);
      const totals = summary.points.map(row => row.total);
      const cumulative = summary.points.map(row => row.cumulative);
      const cumulativeName = summary.missing ? "已知累计净申购" : "累计净申购";
      const last = rows[rows.length - 1];
      const counts = summary.points.map(row => row.eligible);
      const lowCount = Math.min(...counts), highCount = Math.max(...counts);
      document.getElementById("ntFlowPeriod").textContent = rows[0].date + " 至 " + last.date + " · 当期已上市样本 " +
        (lowCount === highCount ? lowCount : lowCount + "–" + highCount) + "只 · 亿元";
      document.getElementById("ntFlowReadings").innerHTML = [
        [last.date + " 净申购", fmt(totals[totals.length - 1]) + " 亿"],
        ["区间" + cumulativeName, fmt(summary.knownTotal) + " 亿"],
        ["完整 / 应有交易日", summary.completeDays + " / " + summary.eligibleDays]
      ].map(([label, value]) => '<div><span>' + label + '</span><strong>' + value + '</strong></div>').join("");
      document.getElementById("ntFlowCoverage").textContent = summary.missing
        ? "当前区间有" + summary.missingDates.length + "个交易日缺少部分数据，涉及" + summary.missing + "条基金日度估算；累计仅包含已知部分。"
        : summary.eligibleDays ? "当前区间已上市样本数据完整。" : funds.length ? "所选区间内，该类别样本尚未上市。" : "";
      const axis = gridIndex => ({
        gridIndex, type: "category", data: allRows.map(row => row.date), boundaryGap: true,
        axisLine: { lineStyle: { color: "#344760" } },
        axisLabel: { color: "#8fa5bf", hideOverlap: true, formatter: value => rows.length > 252 ? value.slice(0, 7) : value.slice(5) }
      });
      const valueAxis = (gridIndex, name, points) => {
        const values = points.filter(Number.isFinite);
        const low = Math.min(0, ...values), high = Math.max(0, ...values);
        const padding = Math.max((high - low) * 0.12, 0.1);
        return { gridIndex, name, type: "value", min: low < 0 ? low - padding : 0, max: high > 0 ? high + padding : 0.1,
          nameTextStyle: { color: "#8fa5bf", align: "left" },
          axisLabel: { color: "#8fa5bf", formatter: value => Math.abs(value) >= 10000 ? fmt(value / 10000, 1) + "万" : fmt(value, Math.abs(value) < 1 && value !== 0 ? 2 : 0) },
          splitLine: { lineStyle: { color: "#17283d" } } };
      };
      const padded = values => allRows.map((row, index) => index >= first && index <= lastIndex ? values[index - first] : null);
      flowChart.setOption({
        animation: false,
        title: summary.eligibleDays ? [] : [{ text: funds.length ? "所选区间尚无已上市样本" : "未选择ETF类别", left: "center", top: "35%", textStyle: { color: "#8fa5bf", fontSize: 14 } }],
        grid: [{ left: 62, right: 18, top: 40, height: "40%" }, { left: 62, right: 18, top: "64%", bottom: 72 }],
        axisPointer: { link: [{ xAxisIndex: "all" }] },
        tooltip: {
          trigger: "axis", confine: true, backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter: params => {
            const point = summary.points[(params[0]?.dataIndex ?? -1) - first];
            if (!point) return "";
            return point.date + "<br>" + (point.missingSoFar ? "已知累计净申购" : "累计净申购") + "：" + fmt(point.knownCumulative) +
              " 亿元<br>当日净申购：" + fmt(point.total) + " 亿元<br>有效样本：" + point.coverage + " / " + point.eligible + "只" +
              (point.unavailable.length ? "<br>缺失：" + point.unavailable.map(escapeHtml).join("、") + "<br>当日已知部分：" + fmt(point.known) + " 亿元" : "") +
              (point.corrections.length ? "<br>已剔除份额折算：" + point.corrections.map(escapeHtml).join("、") : "");
          }
        },
        xAxis: [axis(0), axis(1)],
        yAxis: [valueAxis(0, cumulativeName + " / 亿元", cumulative), valueAxis(1, "当日净申购 / 亿元", totals)],
        dataZoom: [
          { type: "slider", xAxisIndex: [0, 1], ...flowZoom, filterMode: "none", height: 22, bottom: 10,
            showDataShadow: false, borderColor: "#344760", fillerColor: "rgba(54,194,255,.12)", textStyle: { color: "#8fa5bf" } },
          { type: "inside", xAxisIndex: [0, 1], ...flowZoom, filterMode: "none" }
        ],
        series: funds.length ? [
          { name: cumulativeName, type: "line", xAxisIndex: 0, yAxisIndex: 0, data: padded(cumulative),
            showSymbol: false, connectNulls: false, lineStyle: { width: 2.5, color: "#f6c85f" }, itemStyle: { color: "#f6c85f" } },
          { name: "当日净申购", type: "bar", xAxisIndex: 1, yAxisIndex: 1, data: padded(totals),
            barMaxWidth: 18, itemStyle: { color: params => params.value >= 0 ? "#f6c85f" : "#6bd98c" },
            markLine: { silent: true, symbol: "none", label: { show: false }, lineStyle: { color: "#8fa5bf" }, data: [{ yAxis: 0 }] } }
        ] : []
      }, true);
      document.getElementById("ntFlowTable").innerHTML = '<table><thead><tr><th>指数类别</th><th>基金</th><th>代码</th><th>区间可得日度范围</th><th>有效 / 应有日数</th><th>区间末日净申购（亿元）</th><th>区间已知累计（亿元）</th></tr></thead><tbody>' + summary.details.map(fund => {
        return '<tr><td>' + escapeHtml(fund.group) + '</td><td>' + escapeHtml(fund.name) + '</td><td class="nt-etf-code">' +
          fund.ts_code + '</td><td>' + (fund.first ? fund.first + ' 至 ' + fund.last : fund.eligibleDays ? '暂无' : '尚未上市') +
          '</td><td>' + fund.validDays + ' / ' + fund.eligibleDays + '</td><td>' + fmt(last.flows[fund.ts_code]) +
          '</td><td>' + fmt(fund.knownTotal) + (fund.validDays < fund.eligibleDays ? '＊' : '') + '</td></tr>';
      }).join("") + (funds.length ? '' : '<tr><td colspan="7">未选择ETF类别</td></tr>') + '</tbody></table>';
    }
    flowChart.on("datazoom", () => {
      const zoom = flowChart.getOption().dataZoom[0];
      flowZoom = { start: zoom.start, end: zoom.end };
      renderFlow();
    });
    document.getElementById("ntFlowRanges").addEventListener("click", event => {
      const button = event.target.closest("button[data-range]");
      if (!button) return;
      flowRange = button.dataset.range;
      flowZoom = { start: 0, end: 100 };
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
validateFlowHistory(flow);
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
const { observations, ...flowDisplay } = flow;
const ntEtfScript = script.replace("__NATIONAL_TEAM_ETF_DATA__", JSON.stringify(data)).replace("__ETF_FLOW_DATA__", JSON.stringify(flowDisplay));
html = insertBeforeLast(html, "</head>", css + "\n");
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", directHoldings.script + "\n" + etfHistory.script + "\n" + ntEtfScript + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");
console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
