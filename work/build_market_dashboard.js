const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const ROOT_INDEX = path.join(ROOT, "index.html");
const START = "2006-06-05";
let END;

function readMarketOverview() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "work", "market_overview_data.json"), "utf8"));
}

function lastByWeek(rows) {
  const result = [];
  let key = "";
  for (const row of rows) {
    const date = new Date(`${row.date}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
    const nextKey = date.toISOString().slice(0, 10);
    if (nextKey !== key) {
      result.push(row);
      key = nextKey;
    } else {
      result[result.length - 1] = row;
    }
  }
  return result;
}

function stats(rows, prices) {
  const latest = rows[rows.length - 1];
  const latestPrice = prices[prices.length - 1];
  const oneYearAgoDate = new Date(`${latestPrice.date}T00:00:00Z`);
  oneYearAgoDate.setUTCFullYear(oneYearAgoDate.getUTCFullYear() - 1);
  const oneYearAgo = prices.find((row) => row.date >= oneYearAgoDate.toISOString().slice(0, 10)) || prices[0];
  const peSorted = rows.map((row) => row.pe).sort((a, b) => a - b);
  const rank = peSorted.filter((value) => value <= latest.pe).length / peSorted.length;
  return {
    ...latest,
    ...latestPrice,
    valuationDate: latest.date,
    yearChange: (latestPrice.close / oneYearAgo.close - 1) * 100,
    pePercentile: rank * 100,
  };
}

function htmlTemplate(data, echartsSource) {
  const dataJson = JSON.stringify(data);
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>A股20年：股价、合计利润与市盈率</title>
  <style>
    :root {
      --bg: #07111f;
      --panel: #0d1929;
      --panel-2: #101f32;
      --line: #203149;
      --text: #edf4ff;
      --muted: #8fa5bf;
      --sh: #ff5d73;
      --sz: #36c2ff;
      --accent: #f6c85f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      background:
        radial-gradient(circle at 15% 0%, rgba(54,194,255,.11), transparent 34%),
        radial-gradient(circle at 90% 8%, rgba(255,93,115,.10), transparent 31%),
        var(--bg);
      font-family: "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    .wrap { max-width: 1540px; margin: 0 auto; padding: 28px 30px 34px; }
    header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-end; }
    .eyebrow { color: var(--accent); font-size: 12px; letter-spacing: .18em; font-weight: 700; }
    h1 { margin: 7px 0 6px; font-size: clamp(25px, 3vw, 42px); line-height: 1.1; }
    .subtitle { color: var(--muted); font-size: 14px; }
    .asof { color: var(--muted); text-align: right; font-size: 13px; line-height: 1.7; }
    .cards { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin: 24px 0 16px; }
    .card {
      background: linear-gradient(145deg, rgba(16,31,50,.98), rgba(10,22,37,.98));
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 15px 16px;
      min-height: 92px;
    }
    .card .label { color: var(--muted); font-size: 12px; margin-bottom: 9px; }
    .card .value { font-size: 24px; font-weight: 750; letter-spacing: -.02em; }
    .card .meta { color: var(--muted); font-size: 11px; margin-top: 5px; }
    .sh { color: var(--sh); } .sz { color: var(--sz); }
    .toolbar {
      display: flex; align-items: center; justify-content: space-between; gap: 16px;
      background: rgba(13,25,41,.86); border: 1px solid var(--line);
      border-radius: 14px 14px 0 0; padding: 12px 15px;
    }
    .ranges { display: flex; gap: 7px; flex-wrap: wrap; }
    button {
      color: var(--muted); background: #132239; border: 1px solid #263b58;
      border-radius: 8px; padding: 7px 12px; cursor: pointer; font-weight: 650;
    }
    button:hover, button.active { color: #07111f; background: var(--accent); border-color: var(--accent); }
    .legend { display: flex; gap: 10px; color: var(--muted); font-size: 12px; }
    .market-toggle {
      display: inline-flex; align-items: center; gap: 7px;
      height: 32px; padding: 0 10px; border: 1px solid #263b58; border-radius: 8px;
      background: #132239; cursor: pointer; user-select: none; font-weight: 650;
    }
    .market-toggle input { accent-color: var(--accent); margin: 0; }
    .market-toggle.off { opacity: .45; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; }
    #chart {
      height: 1080px;
      min-height: 1080px;
      background: rgba(9,20,34,.94);
      border: 1px solid var(--line); border-top: 0; border-radius: 0 0 14px 14px;
    }
    .notes {
      display: grid; grid-template-columns: 1.3fr 1fr; gap: 16px; margin-top: 15px;
      color: var(--muted); font-size: 12px; line-height: 1.7;
    }
    .note { border: 1px solid var(--line); background: rgba(13,25,41,.75); border-radius: 12px; padding: 13px 15px; }
    .note strong { color: var(--text); }
    @media (max-width: 1000px) {
      .cards { grid-template-columns: repeat(3, 1fr); }
      header { align-items: flex-start; flex-direction: column; }
      .asof { text-align: left; }
      #chart { height: 1080px; }
    }
    @media (max-width: 620px) {
      .wrap { padding: 20px 12px 26px; }
      .cards { grid-template-columns: repeat(2, 1fr); }
      .toolbar { align-items: flex-start; flex-direction: column; }
      .notes { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
<main class="wrap">
  <header>
    <div>
      <div class="eyebrow">A-SHARE MARKET DASHBOARD</div>
      <h1>A股20年：股价、合计利润与市盈率</h1>
      <div class="subtitle">上证综指 × 深证成指，共享同一时间横轴</div>
    </div>
    <div class="asof">数据区间：${START} 至 ${END}<br>周频展示，底层数据为交易日数据</div>
  </header>
  <section class="cards" id="cards"></section>
  <section>
    <div class="toolbar">
      <div class="ranges">
        <button data-years="1">1年</button>
        <button data-years="3">3年</button>
        <button data-years="5">5年</button>
        <button data-years="10">10年</button>
        <button class="active" data-years="20">20年</button>
      </div>
      <div class="legend">
        <label class="market-toggle" data-market="sh"><input type="checkbox" checked data-market="sh"><i class="dot" style="background:var(--sh)"></i>上证</label>
        <label class="market-toggle" data-market="sz"><input type="checkbox" checked data-market="sz"><i class="dot" style="background:var(--sz)"></i>深证</label>
      </div>
    </div>
    <div id="chart"></div>
    <div class="note" id="trading-scale"><strong>交易规模口径：</strong>沪深A股合计（上证A指 000002.SH + 深证A指 399107.SZ），不含B股、北交所、基金和债券。成交量按手×100÷1亿换算为亿股；成交额按千元×1000÷1亿换算为亿元。每周展示最后交易日的单日值，不是整周累计。两条曲线采用独立纵轴，上方市场勾选不改变两市合计口径。最新 ${data.trading.at(-1).date}：成交量 ${data.trading.at(-1).volume.toFixed(2)} 亿股，成交额 ${data.trading.at(-1).amount.toFixed(2)} 亿元。</div>
  </section>
  <section class="notes">
    <div class="note"><strong>利润口径：</strong>过去12个月合计利润 = 指数总市值 ÷ PE(TTM) ÷ 1亿，单位为亿元。它表示指数覆盖公司的隐含滚动净利润总额，适合观察整体公司利润规模的长期变化。</div>
    <div class="note"><strong>阅读方法：</strong>价格上涨若主要由盈利曲线上升推动，质量更扎实；若价格快速上涨、盈利横盘而PE显著抬升，则主要是估值扩张。虚线标记历史典型顶部窗口，仅用于辅助复盘。</div>
  </section>
</main>
<script>${echartsSource}</script>
<script>
const DATA = ${dataJson};
const COLORS = { sh: "#ff5d73", sz: "#36c2ff", volume: "#5cdbad", amount: "#f6c85f" };
const fmt = (n, digits = 2) => Number(n).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (n) => (n >= 0 ? "+" : "") + fmt(n, 1) + "%";
const cards = [
  ["上证综指", fmt(DATA.stats.sh.close), DATA.stats.sh.date + " · 近1年 " + signed(DATA.stats.sh.yearChange), "sh"],
  ["上证PE(TTM)", fmt(DATA.stats.sh.pe), DATA.stats.sh.valuationDate + " · 20年分位 " + fmt(DATA.stats.sh.pePercentile, 0) + "%", "sh"],
  ["上证合计利润", fmt(DATA.stats.sh.profit, 0), "亿元 · " + DATA.stats.sh.valuationDate, "sh"],
  ["深证成指", fmt(DATA.stats.sz.close), DATA.stats.sz.date + " · 近1年 " + signed(DATA.stats.sz.yearChange), "sz"],
  ["深证PE(TTM)", fmt(DATA.stats.sz.pe), DATA.stats.sz.valuationDate + " · 20年分位 " + fmt(DATA.stats.sz.pePercentile, 0) + "%", "sz"],
  ["深证合计利润", fmt(DATA.stats.sz.profit, 0), "亿元 · " + DATA.stats.sz.valuationDate, "sz"],
];
document.getElementById("cards").innerHTML = cards.map(([label, value, meta, cls]) =>
  '<article class="card"><div class="label">' + label + '</div><div class="value ' + cls + '">' + value +
  '</div><div class="meta">' + meta + '</div></article>'
).join("");

const chart = echarts.init(document.getElementById("chart"), null, { renderer: "canvas" });
const visibleMarkets = { sh: true, sz: true };
let activeYears = 20;
let zoomRange = null;
const topDates = [
  { xAxis: "2007-10-16", name: "2007顶" },
  { xAxis: "2009-08-04", name: "2009顶" },
  { xAxis: "2015-06-12", name: "2015顶" },
  { xAxis: "2018-01-29", name: "2018顶" },
  { xAxis: "2021-02-18", name: "2021顶" },
];
function points(rows, field) { return rows.map(r => [r.date, r[field]]); }
function series(name, rows, field, xAxisIndex, yAxisIndex, color, withMarks = false) {
  return {
    name, type: "line", xAxisIndex, yAxisIndex, data: points(rows, field),
    showSymbol: false, sampling: "lttb", smooth: false,
    lineStyle: { width: 1.8, color }, itemStyle: { color },
    emphasis: { focus: "series", lineStyle: { width: 3 } },
    markLine: withMarks ? {
      symbol: ["none", "none"], silent: true,
      label: { color: "#8fa5bf", fontSize: 10, formatter: p => p.name },
      lineStyle: { color: "#53657d", type: "dashed", width: 1 },
      data: topDates
    } : undefined
  };
}
function visibleSeries() {
  const result = [];
  const marksOnSh = visibleMarkets.sh;
  if (visibleMarkets.sh) {
    result.push(series("上证价格", DATA.prices.sh, "close", 0, 0, COLORS.sh, true));
    result.push(series("上证合计利润", DATA.sh, "profit", 1, 1, COLORS.sh));
    result.push(series("上证PE(TTM)", DATA.sh, "pe", 2, 2, COLORS.sh));
  }
  if (visibleMarkets.sz) {
    result.push(series("深证价格", DATA.prices.sz, "close", 0, 0, COLORS.sz, !marksOnSh));
    result.push(series("深证合计利润", DATA.sz, "profit", 1, 1, COLORS.sz));
    result.push(series("深证PE(TTM)", DATA.sz, "pe", 2, 2, COLORS.sz));
  }
  result.push(series("交易量", DATA.trading, "volume", 3, 3, COLORS.volume));
  result.push(series("交易额", DATA.trading, "amount", 3, 4, COLORS.amount));
  return result;
}
function rowsInActiveRange(rows) {
  if (zoomRange) return rows.filter(row => {
    const time = Date.parse(row.date);
    return time >= zoomRange[0] && time <= zoomRange[1];
  });
  if (!activeYears) return rows;
  const end = new Date("${END}T00:00:00Z");
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - activeYears);
  return rows.filter(row => row.date >= start.toISOString().slice(0, 10) && row.date <= "${END}");
}
function visibleValues(field) {
  if (field === "volume" || field === "amount") return rowsInActiveRange(DATA.trading).map(row => row[field]).filter(Number.isFinite);
  const values = [];
  const source = field === "close" ? DATA.prices : DATA;
  if (visibleMarkets.sh) values.push(...rowsInActiveRange(source.sh).map(row => row[field]));
  if (visibleMarkets.sz) values.push(...rowsInActiveRange(source.sz).map(row => row[field]));
  return values.filter(Number.isFinite);
}
function axisBounds(field, paddingRatio = 0.08) {
  const values = visibleValues(field);
  if (!values.length) return {};
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, Math.abs(max) * 0.02, 1);
  const padding = span * paddingRatio;
  return { min: Math.max(0, min - padding), max: max + padding };
}
function overviewYAxis() {
  const price = axisBounds("close", 0.10);
  const profit = axisBounds("profit", 0.10);
  const pe = axisBounds("pe", 0.10);
  return [
    { type: "value", gridIndex: 0, scale: true, ...price, axisLabel: { color: "#7890aa", formatter: value => fmt(value, 0) }, splitLine: { lineStyle: { color: "#17283d" } } },
    { type: "value", gridIndex: 1, scale: true, ...profit, axisLabel: { color: "#7890aa", formatter: value => fmt(value, 0) }, splitLine: { lineStyle: { color: "#17283d" } } },
    { type: "value", gridIndex: 2, scale: true, ...pe, axisLabel: { color: "#7890aa", formatter: value => fmt(value, 1) + "x" }, splitLine: { lineStyle: { color: "#17283d" } } },
    { type: "value", gridIndex: 3, scale: true, ...axisBounds("volume"), name: "亿股", nameTextStyle: { color: COLORS.volume }, axisLabel: { color: COLORS.volume, formatter: value => fmt(value, 0) }, splitLine: { lineStyle: { color: "#17283d" } } },
    { type: "value", gridIndex: 3, position: "right", scale: true, ...axisBounds("amount"), name: "亿元", nameTextStyle: { color: COLORS.amount }, axisLabel: { color: COLORS.amount, formatter: value => fmt(value, 0) }, splitLine: { show: false } }
  ];
}
function renderOverview() {
  chart.setOption({ series: visibleSeries(), yAxis: overviewYAxis() }, { replaceMerge: ["series", "yAxis"] });
}
const commonAxis = {
  type: "time", min: "${START}", max: "${END}", axisLine: { lineStyle: { color: "#344760" } },
  axisLabel: { color: "#7890aa", hideOverlap: true },
  splitLine: { show: false }, axisPointer: { show: true }
};
chart.setOption({
  animation: false,
  backgroundColor: "transparent",
  grid: [
    { left: 72, right: 68, top: 42, height: "22%" },
    { left: 72, right: 68, top: "76%", height: "17%" },
    { left: 72, right: 68, top: "55%", height: "15%" },
    { left: 72, right: 68, top: "33%", height: "15%" }
  ],
  title: [
    { text: "指数价格", left: 20, top: 12, textStyle: { color: "#edf4ff", fontSize: 13 } },
    { text: "交易规模 · 沪深A股合计", left: 20, top: "28%", textStyle: { color: "#edf4ff", fontSize: 13 } },
    { text: "市盈率 PE(TTM)", left: 20, top: "52%", textStyle: { color: "#edf4ff", fontSize: 13 } },
    { text: "过去12个月合计利润（亿元）", left: 20, top: "73%", textStyle: { color: "#edf4ff", fontSize: 13 } }
  ],
  legend: { data: ["交易量", "交易额"], top: "30%", left: "center", textStyle: { color: "#edf4ff" } },
  tooltip: {
    trigger: "axis", axisPointer: { type: "cross", link: [{ xAxisIndex: "all" }] },
    backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f", textStyle: { color: "#edf4ff" },
    formatter(params) {
      const date = params[0]?.axisValueLabel || "";
      const lines = params.map(p => {
        const isProfit = p.seriesName.includes("合计利润");
        const isPe = p.seriesName.includes("PE");
        const value = isProfit ? fmt(p.value[1], 0) : fmt(p.value[1]);
        const unit = p.seriesName === "交易量" ? " 亿股" : p.seriesName === "交易额" ? " 亿元" : isProfit ? " 亿元" : (isPe ? "x" : "");
        return p.marker + p.seriesName + "：<b>" + value + unit + "</b>";
      });
      return "<b>" + date + "</b><br>" + lines.join("<br>");
    }
  },
  axisPointer: { link: [{ xAxisIndex: "all" }], label: { backgroundColor: "#263b58" } },
  xAxis: [
    { ...commonAxis, gridIndex: 0, axisLabel: { show: false } },
    { ...commonAxis, gridIndex: 1 },
    { ...commonAxis, gridIndex: 2, axisLabel: { show: false } },
    { ...commonAxis, gridIndex: 3, axisLabel: { show: false } }
  ],
  yAxis: [
    ...overviewYAxis()
  ],
  dataZoom: [
    { type: "inside", xAxisIndex: [0,1,2,3], filterMode: "none", start: 0, end: 100 },
    { type: "slider", xAxisIndex: [0,1,2,3], bottom: 10, height: 24, borderColor: "#263b58",
      backgroundColor: "#0d1929", fillerColor: "rgba(246,200,95,.18)", handleStyle: { color: "#f6c85f" },
      textStyle: { color: "#8fa5bf" }, start: 0, end: 100 }
  ],
  series: visibleSeries()
});
chart.on("datazoom", () => {
  const zoom = chart.getOption().dataZoom[0];
  const start = Date.parse("${START}"), end = Date.parse("${END}");
  zoomRange = [start + (end - start) * zoom.start / 100, start + (end - start) * zoom.end / 100];
  chart.setOption({ yAxis: overviewYAxis() });
});

document.querySelectorAll(".market-toggle input").forEach(input => input.addEventListener("change", () => {
  const market = input.dataset.market;
  if (!input.checked && Object.values(visibleMarkets).filter(Boolean).length === 1) {
    input.checked = true;
    return;
  }
  visibleMarkets[market] = input.checked;
  document.querySelectorAll(".market-toggle").forEach(label => {
    label.classList.toggle("off", !visibleMarkets[label.dataset.market]);
  });
  renderOverview();
}));

document.querySelectorAll(".ranges [data-years]").forEach(btn => btn.addEventListener("click", () => {
  document.querySelectorAll(".ranges [data-years]").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  const years = Number(btn.dataset.years);
  activeYears = years;
  const end = new Date("${END}T00:00:00Z");
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  chart.dispatchAction({ type: "dataZoom", startValue: start.toISOString().slice(0,10), endValue: "${END}" });
  renderOverview();
}));
window.addEventListener("resize", () => chart.resize());
</script>
</body>
</html>`;
}

async function main() {
  const { execFileSync, spawnSync } = require("child_process");
  const candidates = [
    process.env.CODEX_PYTHON,
    process.env.PYTHON,
    "python3",
    "python",
  ].filter(Boolean);
  const python = candidates.find((cmd) =>
    spawnSync(cmd, ["--version"], { stdio: "ignore" }).status === 0
  );
  if (!python) {
    throw new Error("Unable to find a usable Python interpreter");
  }
  if (!process.argv.includes("--skip-refresh")) {
    for (const name of ["market_overview", "official_sentiment", "retail_sentiment", "large_money_sentiment", "national_team_etf", "etf_flow", "valuation"]) {
      try {
        execFileSync(python, [path.join(ROOT, "work", "fetch_" + name + "_data.py")], { stdio: "inherit" });
      } catch (error) {
        if (!fs.existsSync(path.join(ROOT, "work", name + "_data.json"))) throw error;
        console.warn(name + " refresh failed; retaining its existing dated cache.");
      }
    }
  }
  const overview = readMarketOverview();
  END = overview.meta.end;
  const inRange = rows => rows.filter(row => row.date >= START && row.date <= END);
  const sh = lastByWeek(inRange(overview.sh));
  const sz = lastByWeek(inRange(overview.sz));
  const trading = lastByWeek(inRange(overview.trading));
  const prices = Object.fromEntries(["sh", "sz"].map(market => [market, lastByWeek(inRange(overview.prices?.[market] || overview[market]))]));
  const echartsSource = fs.readFileSync(path.join(ROOT, "work", "echarts.min.js"), "utf8");
  const data = { sh, sz, trading, prices, stats: { sh: stats(sh, prices.sh), sz: stats(sz, prices.sz) } };
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, htmlTemplate(data, echartsSource), "utf8");
  require("./add_valuation_module");
  require("./add_retail_sentiment_module");
  require("./add_large_money_sentiment_module");
  require("./add_official_sentiment_module");
  require("./add_national_team_etf_module");
  fs.copyFileSync(OUTPUT, ROOT_INDEX);
  console.log(JSON.stringify({
    output: OUTPUT,
    rootIndex: ROOT_INDEX,
    bytes: fs.statSync(OUTPUT).size,
    shPoints: sh.length,
    szPoints: sz.length,
    shLatest: data.stats.sh,
    szLatest: data.stats.sz,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
