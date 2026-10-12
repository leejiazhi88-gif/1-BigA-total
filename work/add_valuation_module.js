const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT = path.join(ROOT, "outputs", "a_share_20y_dashboard.html");
const VALUATION_DATA_FILE = path.join(ROOT, "work", "valuation_data.json");
const VALUATION_EVENTS_FILE = path.join(ROOT, "work", "valuation_events.json");
const START_MARKER = "<!-- VALUATION_MODULE_START -->";
const END_MARKER = "<!-- VALUATION_MODULE_END -->";

function stripExistingModule(html) {
  return html
    .replace(/\s*<!-- VALUATION_MODULE_(?:START|END) -->/g, "")
    .replace(/\s*<nav class="page-nav"[\s\S]*?<\/nav>/g, "")
    .replace(/\s*<section class="module-shell" id="valuation">[\s\S]*?<\/section>/g, "")
    .replace(/\s*<style id="valuation-module-style">[\s\S]*?<\/style>/g, "")
    .replace(/\s*<script id="valuation-module-script">[\s\S]*?<\/script>/g, "")
    .replace('<main class="wrap" id="overview">', '<main class="wrap">');
}

const css = `
  <style id="valuation-module-style">
    .page-nav {
      position: sticky; top: 0; z-index: 20; display: flex; gap: 8px;
      width: fit-content; max-width: 100%; overflow-x: auto; margin: 0 0 20px; padding: 6px;
      border: 1px solid var(--line); border-radius: 12px;
      background: rgba(7,17,31,.92); backdrop-filter: blur(12px);
    }
    .page-nav a {
      color: var(--muted); padding: 8px 14px; border-radius: 8px;
      text-decoration: none; font-size: 13px; font-weight: 700; white-space: nowrap; flex-shrink: 0;
    }
    .page-nav a:hover, .page-nav a.active { color: #07111f; background: var(--accent); }
    .module-shell { margin-top: 54px; scroll-margin-top: 72px; }
    .module-head {
      display: flex; justify-content: space-between; align-items: flex-end;
      gap: 18px; margin-bottom: 16px;
    }
    .module-kicker {
      color: var(--accent); font-size: 12px; font-weight: 800;
      letter-spacing: .16em; text-transform: uppercase;
    }
    .module-head h2 { margin: 7px 0 5px; font-size: 30px; }
    .module-head p { margin: 0; color: var(--muted); font-size: 13px; }
    .module-status {
      color: var(--muted); border: 1px solid var(--line); border-radius: 999px;
      padding: 7px 11px; font-size: 11px; white-space: nowrap;
    }
    .valuation-grid {
      display: grid; grid-template-columns: minmax(0, 1.68fr) minmax(360px, .82fr);
      gap: 15px; align-items: stretch;
    }
    .valuation-panel {
      min-width: 0; overflow: hidden; border: 1px solid var(--line);
      border-radius: 15px; background: rgba(9,20,34,.94);
    }
    .panel-head {
      min-height: 70px; display: flex; justify-content: space-between;
      align-items: center; gap: 14px; padding: 14px 16px;
      border-bottom: 1px solid var(--line); background: rgba(13,25,41,.9);
    }
    .panel-title { font-size: 15px; font-weight: 800; }
    .panel-subtitle { color: var(--muted); font-size: 11px; margin-top: 4px; }
    .metric-tabs, .range-tabs { display: flex; gap: 7px; flex-wrap: wrap; }
    .metric-tabs { padding: 13px 15px 0; }
    .metric-tab, .range-tab { padding: 7px 10px; font-size: 12px; }
    .range-tab { padding: 5px 8px; }
    .metric-tab[disabled] {
      cursor: not-allowed; opacity: .42; color: var(--muted);
      background: #101c2d; border-color: #203149;
    }
    .metric-note {
      display: flex; justify-content: space-between; gap: 12px; align-items: center;
      color: var(--muted); font-size: 11px; padding: 9px 16px 0;
    }
    .metric-reading { color: var(--text); font-weight: 700; }
    #valuationChart { height: 500px; width: 100%; }
    .event-controls { display: flex; gap: 8px; }
    .event-select {
      color: var(--text); background: #132239; border: 1px solid #2b4261;
      border-radius: 8px; padding: 7px 9px; outline: none;
    }
    .event-body { height: 560px; overflow: auto; padding: 16px; }
    .quarter-summary {
      display: flex; justify-content: space-between; gap: 12px; align-items: center;
      margin-bottom: 12px; padding-bottom: 12px; border-bottom: 1px solid var(--line);
    }
    .quarter-label { font-size: 20px; font-weight: 800; }
    .event-count { color: var(--muted); font-size: 11px; }
    .quarter-dashboard {
      display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px; margin-bottom: 12px;
    }
    .quarter-stat {
      padding: 10px; border: 1px solid #203149; border-radius: 10px;
      background: #0b1828;
    }
    .quarter-stat span { display: block; color: var(--muted); font-size: 10px; }
    .quarter-stat strong { display: block; margin-top: 4px; font-size: 15px; }
    .event-list { list-style: none; padding: 0; margin: 0; }
    .event-item {
      position: relative; margin: 0 0 10px; padding: 12px 12px 12px 34px;
      border: 1px solid #203149; border-radius: 11px; background: #0e1b2d;
      line-height: 1.55;
    }
    .event-item::before {
      content: ""; position: absolute; left: 15px; top: 18px;
      width: 7px; height: 7px; border-radius: 50%; background: var(--accent);
      box-shadow: 0 0 0 4px rgba(246,200,95,.11);
    }
    .event-source {
      display: inline-block; margin-top: 8px; color: #65c7ff;
      font-size: 11px; font-weight: 700; text-decoration: none;
    }
    .event-source:hover { text-decoration: underline; }
    .event-item.auto::before { background: #36c2ff; box-shadow: 0 0 0 4px rgba(54,194,255,.11); }
    .event-type { color: var(--accent); font-size: 10px; font-weight: 800; letter-spacing: .08em; }
    .event-item.auto .event-type { color: #36c2ff; }
    .event-title { margin-top: 3px; font-size: 13px; font-weight: 700; }
    .event-desc { color: var(--muted); font-size: 11px; margin-top: 5px; }
    .event-meta { color: #6f87a3; font-size: 10px; margin-top: 7px; }
    .valuation-foot {
      display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px;
    }
    @media (max-width: 1050px) {
      .valuation-grid { grid-template-columns: 1fr; }
      .event-body { height: auto; min-height: 420px; }
    }
    @media (max-width: 620px) {
      .module-head, .panel-head, .metric-note { align-items: flex-start; flex-direction: column; }
      .valuation-foot { grid-template-columns: 1fr; }
      #valuationChart { height: 450px; }
    }
  </style>
`;

const nav = `
${START_MARKER}
  <nav class="page-nav" aria-label="研究模块导航">
    <a href="#overview" class="active">总览</a>
    <a href="#valuation">估值</a>
  </nav>
`;

const moduleHtml = `
  <section class="module-shell" id="valuation">
    <div class="module-head">
      <div>
        <div class="module-kicker">Module 01 / Valuation</div>
        <h2>估值</h2>
        <p>连续数据看估值位置，季度事件看当时市场为何愿意给出这种价格。</p>
      </div>
      <div class="module-status">PE 20年 / PB与股债收益差 10年</div>
    </div>

    <div class="valuation-grid">
      <article class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">连续走势图</div>
            <div class="panel-subtitle" id="valuationMetricSubtitle">上证与深证 PE(TTM)，周频展示</div>
          </div>
          <div class="range-tabs" id="valuationRangeTabs">
            <button class="range-tab" data-years="3">3年</button>
            <button class="range-tab" data-years="5">5年</button>
            <button class="range-tab" data-years="10">10年</button>
            <button class="range-tab active" data-years="0">全部</button>
          </div>
        </div>
        <div class="metric-tabs" id="valuationMetricTabs">
          <button class="metric-tab active" data-metric="pe">PE(TTM)</button>
          <button class="metric-tab" data-metric="pePercentile">PE历史分位</button>
          <button class="metric-tab" data-metric="pbPercentile">PB历史分位</button>
          <button class="metric-tab" data-metric="equityBondSpread">股债收益差</button>
          <button class="metric-tab" disabled title="需要全市场个股与行业截面数据">行业分位 / 高估值占比</button>
        </div>
        <div class="metric-note">
          <span id="valuationMetricNote">PE越高，市场对未来盈利增长的要求越高。</span>
          <span class="metric-reading" id="valuationLatestReading"></span>
        </div>
        <div id="valuationChart"></div>
      </article>

      <aside class="valuation-panel">
        <div class="panel-head">
          <div>
            <div class="panel-title">估值事件 List</div>
            <div class="panel-subtitle">按年份和季度切换；事件分类对应“A股指数”表的估值说明</div>
          </div>
          <div class="event-controls">
            <select id="eventYear" class="event-select" aria-label="事件年份"></select>
            <select id="eventQuarter" class="event-select" aria-label="事件季度">
              <option value="Q1">Q1</option><option value="Q2">Q2</option>
              <option value="Q3">Q3</option><option value="Q4">Q4</option>
            </select>
          </div>
        </div>
        <div class="event-body">
          <div class="quarter-summary">
            <div class="quarter-label" id="eventPeriod"></div>
            <div class="event-count" id="eventCount"></div>
          </div>
          <div class="quarter-dashboard" id="quarterDashboard"></div>
          <ul class="event-list" id="valuationEventList"></ul>
        </div>
      </aside>
    </div>

    <div class="valuation-foot">
      <div class="note"><strong>连续数据口径：</strong>PE(TTM)为指数动态市盈率；PE与PB分位均按当前选择的3年、5年、10年或全部可用样本动态重算。PB来自指数每日指标，股债收益差为100/PE减10年期国债收益率，两者共同可得区间为2016年6月以来。</div>
      <div class="note"><strong>事件库口径：</strong>对应飞书“A股指数”表的估值说明，仅收录盈利预警、业绩不及预期、重大减持、IPO定价过热、热门公司估值破纪录五类。季度估值数据单独展示，不计入事件条数。</div>
    </div>
  </section>
${END_MARKER}
`;

const js = `
  <script id="valuation-module-script">
  (() => {
    const valuationExtra = __VALUATION_EXTRA__;
    const fmt = (value, digits = 1) => Number.isFinite(value)
      ? Number(value).toLocaleString("zh-CN", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      : "--";
    const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);

    const valuationData = { sh: DATA.sh, sz: DATA.sz };
    const curatedEvents = {
      "2007-Q3": [
        { type: "估值升温", title: "指数估值进入历史极高区间", desc: "股价上涨明显快于盈利点数增长，估值扩张成为行情主要推动力。", meta: "观察项：PE分位、IPO热度" }
      ],
      "2007-Q4": [
        { type: "IPO定价过热", title: "大型热门公司上市强化高估值叙事", desc: "稀缺性、成长空间和指数权重被集中定价，顶部阶段的乐观预期进一步强化。", meta: "典型窗口：2007年10月至11月" }
      ],
      "2008-Q3": [
        { type: "盈利预警", title: "全球金融冲击令盈利预期快速下修", desc: "盈利预测下降使静态PE暂时失真，风险偏好与盈利预期同时收缩。", meta: "观察项：盈利下修速度" }
      ],
      "2009-Q3": [
        { type: "估值修复", title: "刺激政策后的快速反弹推高估值", desc: "盈利修复尚未完全确认时，价格与风险偏好率先上行。", meta: "观察项：价格与盈利剪刀差" }
      ],
      "2010-Q4": [
        { type: "政策转向", title: "通胀与紧缩预期压制估值扩张", desc: "利率和流动性预期变化，提高了权益资产的折现率。", meta: "观察项：政策利率、股债收益差" }
      ],
      "2012-Q4": [
        { type: "估值底部", title: "市场在低估值区间出现修复", desc: "长期下跌后风险溢价较厚，价格对盈利和政策边际改善更敏感。", meta: "观察项：PE/PB低分位" }
      ],
      "2014-Q4": [
        { type: "估值升温", title: "流动性宽松推动指数快速重估", desc: "价格上涨速度开始超过盈利改善速度，行情由修复逐步转为扩张。", meta: "观察项：PE斜率、成交活跃度" }
      ],
      "2015-Q2": [
        { type: "估值纪录", title: "成长与主题板块估值快速扩张", desc: "高风险偏好、杠杆资金和热门叙事相互强化，深市估值尤为突出。", meta: "典型顶部：2015年6月" },
        { type: "重大减持", title: "高位减持与融资安排受到关注", desc: "产业资本行为成为判断高估值可持续性的辅助信号。", meta: "观察项：减持与再融资" }
      ],
      "2015-Q3": [
        { type: "估值收缩", title: "快速调整触发去杠杆与风险偏好逆转", desc: "估值从高位回落时，流动性和交易结构放大了价格波动。", meta: "观察项：估值回撤速度" }
      ],
      "2016-Q1": [
        { type: "极端情绪", title: "年初剧烈波动压低市场估值", desc: "风险偏好快速下降，估值与价格同步收缩。", meta: "典型窗口：2016年1月" }
      ],
      "2017-Q4": [
        { type: "结构高估", title: "大盘蓝筹与市场整体估值出现分化", desc: "指数整体估值不极端，但少数核心资产获得明显溢价。", meta: "观察项：集中度与行业分位" }
      ],
      "2018-Q4": [
        { type: "估值底部", title: "去杠杆与盈利担忧将估值压至低位", desc: "低PB与较厚股债收益差开始提供中长期安全垫。", meta: "观察项：PB分位、股债收益差" }
      ],
      "2019-Q3": [
        { type: "IPO定价", title: "科创板开市带来新经济估值框架", desc: "新股定价、稀缺性溢价与上市后表现成为风险偏好的重要窗口。", meta: "观察项：IPO定价与首日表现" }
      ],
      "2020-Q1": [
        { type: "盈利预警", title: "疫情冲击提高盈利预测不确定性", desc: "盈利预期快速变化时，静态PE可能低估真实估值压力。", meta: "观察项：盈利预测修正" }
      ],
      "2020-Q3": [
        { type: "IPO定价", title: "注册制扩围提高成长股定价热度", desc: "新经济公司估值与上市后表现成为市场风险偏好的观察项。", meta: "观察项：热门新股估值" }
      ],
      "2021-Q1": [
        { type: "估值纪录", title: "核心资产与热门赛道估值处于高位", desc: "机构集中持仓、盈利外推和低利率叙事共同支撑高估值。", meta: "典型窗口：2021年2月" },
        { type: "业绩验证", title: "市场提高对盈利兑现速度的要求", desc: "估值高位时，小幅业绩偏差也可能带来较大价格波动。", meta: "观察项：业绩不及预期" }
      ],
      "2022-Q2": [
        { type: "盈利预警", title: "需求与成本压力提高盈利不确定性", desc: "盈利预期下修使单看静态PE容易低估真实估值压力。", meta: "观察项：盈利预测与利润率" }
      ],
      "2022-Q4": [
        { type: "估值修复", title: "政策和复苏预期推动风险偏好回升", desc: "价格率先反映未来盈利修复，估值从低位回升。", meta: "观察项：估值先行幅度" }
      ],
      "2023-Q3": [
        { type: "监管政策", title: "资本市场政策组合改善风险偏好", desc: "印花税、IPO与再融资节奏、减持规则等政策变化共同影响估值。", meta: "典型窗口：2023年8月" }
      ],
      "2024-Q1": [
        { type: "估值修复", title: "市场稳定措施推动低位估值修复", desc: "低PB区域的风险偏好回升，价格先于盈利出现反弹。", meta: "观察项：PB分位与ETF资金" }
      ],
      "2024-Q3": [
        { type: "估值修复", title: "政策预期推动风险偏好快速修复", desc: "价格短期上行速度快于盈利变化，估值分位明显抬升。", meta: "典型窗口：2024年9月" }
      ],
      "2024-Q4": [
        { type: "结构分化", title: "热门主题估值扩张与传统行业分化", desc: "指数估值之外，还需结合行业估值分位与高估值股票占比判断局部过热。", meta: "观察项：行业分位" }
      ]
    };

    Object.keys(curatedEvents).forEach(key => delete curatedEvents[key]);
    Object.assign(curatedEvents, {
      "2007-Q3": [
        { type: "热门公司估值破纪录", title: "热门蓝筹估值进入历史极高区间", desc: "市场对稀缺性与长期成长的定价快速抬升，热门公司的估值纪录接连刷新。", meta: "典型窗口：2007年三季度" }
      ],
      "2007-Q4": [
        { type: "IPO定价过热", title: "大型热门公司上市强化高估值叙事", desc: "稀缺性、成长空间和指数权重被集中定价，顶部阶段的乐观预期进一步强化。", meta: "典型窗口：2007年10月至11月" }
      ],
      "2008-Q3": [
        { type: "盈利预警", title: "全球金融冲击令盈利预期快速下修", desc: "盈利预测下降使静态PE暂时失真，风险偏好与盈利预期同时收缩。", meta: "观察项：盈利下修速度" }
      ],
      "2014-Q4": [
        { type: "热门公司估值破纪录", title: "券商与主题龙头估值快速抬升", desc: "行情加速后，热门公司的价格上涨明显快于短期盈利改善。", meta: "典型窗口：2014年四季度" }
      ],
      "2015-Q2": [
        { type: "热门公司估值破纪录", title: "成长与主题公司估值快速扩张", desc: "高风险偏好、杠杆资金和热门叙事相互强化，深市热门公司的估值尤为突出。", meta: "典型顶部：2015年6月" },
        { type: "重大减持", title: "高位减持与融资安排受到关注", desc: "产业资本行为成为判断高估值可持续性的辅助信号。", meta: "观察项：减持与再融资" }
      ],
      "2015-Q3": [
        { type: "业绩不及预期", title: "部分高估值公司的业绩难以匹配预期", desc: "高估值建立在持续高增长假设上，业绩兑现偏弱加剧了估值收缩。", meta: "观察项：中报与三季报" }
      ],
      "2017-Q4": [
        { type: "热门公司估值破纪录", title: "核心蓝筹估值溢价明显扩大", desc: "指数整体估值不极端，但少数热门核心资产获得明显溢价。", meta: "观察项：热门公司估值分位" }
      ],
      "2018-Q4": [
        { type: "盈利预警", title: "盈利下修与商誉减值预警集中出现", desc: "盈利预期下调使部分公司的实际估值压力高于静态PE所显示的水平。", meta: "观察项：年报预告与商誉减值" }
      ],
      "2019-Q3": [
        { type: "IPO定价过热", title: "科创板开市带来新经济估值框架", desc: "新股定价、稀缺性溢价与上市后表现成为风险偏好的重要窗口。", meta: "观察项：IPO定价与首日表现" }
      ],
      "2020-Q1": [
        { type: "盈利预警", title: "疫情冲击提高盈利预测不确定性", desc: "盈利预期快速变化时，静态PE可能低估真实估值压力。", meta: "观察项：盈利预测修正" }
      ],
      "2020-Q3": [
        { type: "IPO定价过热", title: "注册制扩围提高成长股定价热度", desc: "新经济公司估值与上市后表现成为市场风险偏好的观察项。", meta: "观察项：热门新股估值" }
      ],
      "2021-Q1": [
        { type: "热门公司估值破纪录", title: "核心资产与热门赛道估值刷新纪录", desc: "机构集中持仓、盈利外推和低利率叙事共同支撑高估值。", meta: "典型窗口：2021年2月" },
        { type: "业绩不及预期", title: "市场提高对盈利兑现速度的要求", desc: "估值高位时，小幅业绩偏差也可能带来较大价格波动。", meta: "观察项：年报与一季报" }
      ],
      "2022-Q2": [
        { type: "盈利预警", title: "需求与成本压力提高盈利不确定性", desc: "盈利预期下修使单看静态PE容易低估真实估值压力。", meta: "观察项：盈利预测与利润率" }
      ],
      "2024-Q3": [
        { type: "热门公司估值破纪录", title: "短期急涨推动热门公司估值迅速抬升", desc: "价格短期上行速度快于盈利变化，部分热门公司的估值分位明显抬升。", meta: "典型窗口：2024年9月" }
      ],
      "2024-Q4": [
        { type: "IPO定价过热", title: "热门科技叙事提高新股与次新股定价", desc: "局部高估值扩张需要结合新股发行定价与上市后表现共同观察。", meta: "观察项：新股与次新股估值" }
      ]
    });
    Object.assign(curatedEvents, __VALUATION_EVENTS__);

    const metricConfig = {
      pe: {
        title: "PE(TTM)", unit: "倍", subtitle: "上证与深证 PE(TTM)，周频展示",
        note: "PE越高，市场对未来盈利增长的要求越高。"
      },
      pePercentile: {
        title: "PE历史分位", unit: "%", subtitle: "各时点相对当前所选时间跨度的位置",
        note: "80%以上通常属于样本高位，20%以下通常属于样本低位。", fixedRange: true
      },
      pbPercentile: {
        title: "PB历史分位", unit: "%", subtitle: "指数市净率相对当前所选时间跨度的位置",
        note: "PB更适合观察金融、周期及资产密集型指数的估值位置。", fixedRange: true, extra: true
      },
      equityBondSpread: {
        title: "股债收益差", unit: "%", subtitle: "盈利收益率减10年期国债收益率",
        note: "数值越低，股票相对债券的估值补偿越薄。", extra: true, inverseRisk: true
      }
    };

    function metricRows(market, field) {
      return metricConfig[field].extra ? valuationExtra[market] : valuationData[market];
    }
    function quarterKey(date) {
      const month = Number(date.slice(5, 7));
      return date.slice(0, 4) + "-Q" + Math.ceil(month / 3);
    }
    function rowsInQuarter(rows, key) {
      return rows.filter(row => quarterKey(row.date) === key);
    }
    function latestQuarterRow(market, key) {
      const rows = rowsInQuarter(valuationData[market], key);
      return rows[rows.length - 1];
    }
    function latestExtraRow(market, key) {
      const rows = rowsInQuarter(valuationExtra[market], key);
      return rows[rows.length - 1];
    }
    function riskLabel(percentile) {
      if (!Number.isFinite(percentile)) return "暂无";
      if (percentile >= 85) return "极高";
      if (percentile >= 70) return "偏高";
      if (percentile <= 15) return "极低";
      if (percentile <= 30) return "偏低";
      return "中性";
    }
    function valueWithUnit(value, unit, digits = 0) {
      return Number.isFinite(value) ? fmt(value, digits) + unit : "暂无数据";
    }

    const valuationChart = echarts.init(document.getElementById("valuationChart"), null, { renderer: "canvas" });
    let activeMetric = "pe";
    let activeYears = 0;

    function rowsForActiveRange(market, field) {
      const sourceField = field === "pePercentile" ? "pe"
        : field === "pbPercentile" ? "pb" : field;
      const rows = metricRows(market, field).filter(row => Number.isFinite(row[sourceField]));
      if (!activeYears || !rows.length) return rows;
      const end = new Date(rows[rows.length - 1].date + "T00:00:00Z");
      const cutoff = new Date(end);
      cutoff.setUTCFullYear(cutoff.getUTCFullYear() - activeYears);
      return rows.filter(row => new Date(row.date + "T00:00:00Z") >= cutoff);
    }

    function percentileRank(sorted, value) {
      let low = 0, high = sorted.length;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (sorted[mid] <= value) low = mid + 1; else high = mid;
      }
      return sorted.length ? low / sorted.length * 100 : NaN;
    }

    function valuationPoints(market, field) {
      const rows = rowsForActiveRange(market, field);
      if (field === "pePercentile" || field === "pbPercentile") {
        const sourceField = field === "pePercentile" ? "pe" : "pb";
        const sorted = rows.map(row => row[sourceField]).sort((a, b) => a - b);
        return rows.map(row => [row.date, percentileRank(sorted, row[sourceField])]);
      }
      return rows.map(row => [row.date, row[field]]);
    }

    function renderValuationChart() {
      const cfg = metricConfig[activeMetric];
      const shPoints = valuationPoints("sh", activeMetric);
      const szPoints = valuationPoints("sz", activeMetric);
      const shLatest = shPoints[shPoints.length - 1]?.[1];
      const szLatest = szPoints[szPoints.length - 1]?.[1];
      const latestDate = shPoints[shPoints.length - 1]?.[0] || "暂无";
      const rangeLabel = activeYears ? activeYears + "年" : "全部可用";
      document.getElementById("valuationMetricSubtitle").textContent =
        cfg.fixedRange ? cfg.subtitle + "（" + rangeLabel + "样本动态计算）" : cfg.subtitle;
      document.getElementById("valuationMetricNote").textContent = cfg.note +
        (activeMetric === "equityBondSpread" && valuationExtra.meta.bondStatus !== "refreshed"
          ? " 部分日期的国债收益率缺失，收益差仅显示同日数据齐全的观测，最新为 " + latestDate + "。PE与PB独立更新。" : "") +
        (activeMetric === "equityBondSpread" ? " 10年期国债收益率取中债到期收益率曲线；接口不可用时由中债官方公开数据补充。" : "");
      document.getElementById("valuationLatestReading").textContent =
        latestDate + "：上证 " + fmt(shLatest, 2) + cfg.unit + " / 深证 " + fmt(szLatest, 2) + cfg.unit;

      const riskArea = cfg.fixedRange ? {
        silent: true,
        data: [
          [{ yAxis: 80, itemStyle: { color: "rgba(255,93,115,.07)" } }, { yAxis: 100 }],
          [{ yAxis: 0, itemStyle: { color: "rgba(54,194,255,.05)" } }, { yAxis: 20 }]
        ]
      } : undefined;

      valuationChart.setOption({
        animation: false,
        backgroundColor: "transparent",
        grid: { left: 66, right: 28, top: 42, bottom: 64 },
        tooltip: {
          trigger: "axis", axisPointer: { type: "cross" },
          backgroundColor: "rgba(7,17,31,.96)", borderColor: "#36506f",
          textStyle: { color: "#edf4ff" },
          formatter(params) {
            const lines = params.map(item => item.marker + item.seriesName + "：<b>" +
              fmt(Number(item.value[1]), 2) + cfg.unit + "</b>");
            return "<b>" + (params[0]?.axisValueLabel || "") + "</b><br>" + lines.join("<br>");
          }
        },
        legend: { show: false },
        xAxis: {
          type: "time", axisLine: { lineStyle: { color: "#344760" } },
          axisLabel: { color: "#7890aa", hideOverlap: true }, splitLine: { show: false }
        },
        yAxis: {
          type: "value", scale: !cfg.fixedRange,
          min: cfg.fixedRange ? 0 : undefined,
          max: cfg.fixedRange ? 100 : undefined,
          axisLabel: { color: "#7890aa", formatter: "{value}" + cfg.unit },
          splitLine: { lineStyle: { color: "#17283d" } }
        },
        dataZoom: [
          { type: "inside", filterMode: "none", start: 0, end: 100 },
          { type: "slider", bottom: 12, height: 22, start: 0, end: 100, borderColor: "#263b58",
            backgroundColor: "#0d1929", fillerColor: "rgba(246,200,95,.18)",
            handleStyle: { color: "#f6c85f" }, textStyle: { color: "#8fa5bf" } }
        ],
        series: [
          {
            name: "上证" + cfg.title, type: "line", data: shPoints, showSymbol: false,
            sampling: "lttb", lineStyle: { width: 2, color: COLORS.sh },
            itemStyle: { color: COLORS.sh }, emphasis: { focus: "series" }, markArea: riskArea
          },
          {
            name: "深证" + cfg.title, type: "line", data: szPoints, showSymbol: false,
            sampling: "lttb", lineStyle: { width: 2, color: COLORS.sz },
            itemStyle: { color: COLORS.sz }, emphasis: { focus: "series" }
          }
        ]
      }, true);
    }

    document.querySelectorAll("#valuationMetricTabs [data-metric]").forEach(button => {
      button.addEventListener("click", () => {
        activeMetric = button.dataset.metric;
        document.querySelectorAll("#valuationMetricTabs [data-metric]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderValuationChart();
      });
    });
    document.querySelectorAll("#valuationRangeTabs [data-years]").forEach(button => {
      button.addEventListener("click", () => {
        activeYears = Number(button.dataset.years);
        document.querySelectorAll("#valuationRangeTabs [data-years]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        renderValuationChart();
      });
    });

    const yearSelect = document.getElementById("eventYear");
    const quarterSelect = document.getElementById("eventQuarter");
    const latestDate = valuationData.sh[valuationData.sh.length - 1].date;
    const latestKey = quarterKey(latestDate);
    const [latestYear, latestQuarter] = latestKey.split("-");
    for (let year = Number(latestYear); year >= 2006; year--) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      yearSelect.appendChild(option);
    }
    yearSelect.value = latestYear;
    quarterSelect.value = latestQuarter;

    function renderEvents() {
      const key = yearSelect.value + "-" + quarterSelect.value;
      const sh = latestQuarterRow("sh", key);
      const sz = latestQuarterRow("sz", key);
      const shExtra = latestExtraRow("sh", key);
      const szExtra = latestExtraRow("sz", key);
      const events = curatedEvents[key] || [];

      document.getElementById("eventPeriod").textContent = yearSelect.value + " " + quarterSelect.value;
      document.getElementById("eventCount").textContent = events.length + " 条事件";
      document.getElementById("quarterDashboard").innerHTML = [
        ["上证PE", valueWithUnit(sh?.pe, "倍", 2)],
        ["深证PE", valueWithUnit(sz?.pe, "倍", 2)],
        ["上证PB分位", valueWithUnit(shExtra?.pbPercentile, "%")],
        ["深证PB分位", valueWithUnit(szExtra?.pbPercentile, "%")]
      ].map(item => '<div class="quarter-stat"><span>' + item[0] + '</span><strong>' + item[1] + '</strong></div>').join("");
      document.getElementById("valuationEventList").innerHTML = events.length ? events.map(event =>
        '<li class="event-item' + (event.auto ? ' auto' : '') + '">' +
        '<div class="event-type">' + escapeHtml(event.type) + '</div>' +
        '<div class="event-title">' + escapeHtml(event.title) + '</div>' +
        '<div class="event-desc">' + escapeHtml(event.desc) + '</div>' +
        '<div class="event-meta">' + escapeHtml(event.meta || "") + '</div>' +
        (event.sourceUrl
          ? '<a class="event-source" href="' + escapeHtml(event.sourceUrl) + '" target="_blank" rel="noopener noreferrer">查看' + escapeHtml(event.source || "来源") + '</a>'
          : (event.source ? '<div class="event-source">' + escapeHtml(event.source) + '</div>' : '')) +
        '</li>'
      ).join("") : '<li class="event-empty">该季度暂无符合估值事件口径的记录</li>';
    }

    yearSelect.addEventListener("change", renderEvents);
    quarterSelect.addEventListener("change", renderEvents);
    const navLinks = document.querySelectorAll(".page-nav a");
    navLinks.forEach(link => link.addEventListener("click", () => {
      navLinks.forEach(item => item.classList.remove("active"));
      link.classList.add("active");
    }));
    window.addEventListener("resize", () => valuationChart.resize());
    renderValuationChart();
    renderEvents();
  })();
  </script>
`;

if (!fs.existsSync(VALUATION_DATA_FILE)) {
  throw new Error("Missing valuation_data.json. Run fetch_valuation_data.py first.");
}
if (!fs.existsSync(VALUATION_EVENTS_FILE)) {
  throw new Error("Missing valuation_events.json.");
}

const valuationExtra = JSON.parse(fs.readFileSync(VALUATION_DATA_FILE, "utf8"));
const valuationEvents = JSON.parse(fs.readFileSync(VALUATION_EVENTS_FILE, "utf8"));
const valuationJs = js
  .replace("__VALUATION_EXTRA__", JSON.stringify(valuationExtra))
  .replace("__VALUATION_EVENTS__", JSON.stringify(valuationEvents.quarters));
let html = stripExistingModule(fs.readFileSync(OUTPUT, "utf8"));

function insertBeforeLast(source, marker, content) {
  const index = source.lastIndexOf(marker);
  if (index === -1) throw new Error(`Marker not found: ${marker}`);
  return source.slice(0, index) + content + source.slice(index);
}

html = insertBeforeLast(html, "</head>", css + "\n");
html = html.replace('<main class="wrap">', '<main class="wrap" id="overview">' + nav);
html = insertBeforeLast(html, "</main>", moduleHtml + "\n");
html = insertBeforeLast(html, "</body>", valuationJs + "\n");
fs.writeFileSync(OUTPUT, html, "utf8");

console.log(JSON.stringify({ output: OUTPUT, bytes: fs.statSync(OUTPUT).size }, null, 2));
