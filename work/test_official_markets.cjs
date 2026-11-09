const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'official_sentiment_data.json')));
const refinancing = JSON.parse(fs.readFileSync(path.join(__dirname, 'refinancing_data.json')));
const rangeStart = new Date(data.series.at(-1).date + 'T00:00:00Z');
rangeStart.setUTCFullYear(rangeStart.getUTCFullYear() - 3);
for (const metric of ['ipoFunds', 'netReduceAmount']) {
  const rows = data.series.filter(r => Number.isFinite(r[metric]));
  assert.ok(rows.length > 100);
  for (const row of rows) {
    const sh = data.markets.sh.find(r => r.date === row.date)?.[metric];
    const sz = data.markets.sz.find(r => r.date === row.date)?.[metric];
    assert.ok(Number.isFinite(sh) && Number.isFinite(sz));
    assert.ok(Math.abs(row[metric] - sh - sz) < .00011);
  }
}
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script id="official-sentiment-script">([\s\S]*?)<\/script>/)[1];
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, {textContent: '',
    get innerHTML() { return this.markup || ''; },
    set innerHTML(value) { this.markup = value; this.textContent = value.replace(/<[^>]*>/g, ' '); }});
  return elements.get(id);
};
const button = dataset => ({dataset, attrs: {}, classList: {add() {}, remove() {}},
  addEventListener(type, handler) {this[type] = handler;},
  setAttribute(key, value) {this.attrs[key] = value;}});
const markets = ['all', 'sh', 'sz'].map(series => button({series}));
const rates = ['reverseRepo7d', 'lpr1y', 'lpr5y'].map(rate => button({rate}));
const metrics = ['ipoFunds', 'netReduceAmount', 'stampTaxRate', 'policyRate', 'socialFinancing', 'm2Yoy', 'refinanceFunds'].map(metric => button({metric}));
const ranges = [3, 5, 10, 20, 30, 0].map(years => button({years: String(years)}));
let option;
const handlers = {};
const chart = {setOption(next, replace) {option = replace ? next : {...option, ...next,
    yAxis: Array.isArray(next.yAxis) ? next.yAxis : {...option?.yAxis, ...next.yAxis}};},
  getOption() {return option || {};}, on(type, fn) {handlers[type] = fn;}, resize() {}};
vm.runInNewContext(script, {document: {getElementById: element,
  querySelectorAll(selector) {return selector.includes('MetricTabs') ? metrics : selector.includes('RateControls') ? rates : selector.includes('SeriesControls') ? markets : ranges;}
}, echarts: {init: () => chart}, window: {addEventListener() {}}});
assert.equal(option.series.length, 3);
option.dataZoom[0].start = 40;
markets[0].click(); markets[2].click();
assert.equal(option.dataZoom[0].start, 40);
metrics[1].click();
assert.equal(option.series.length, 1);
assert.equal(option.series[0].name, '沪市');
for (const metric of [metrics[2], metrics[3]]) {
  metric.click();
  const rateView = metric.dataset.metric === 'policyRate';
  assert.equal(option.series.length, rateView ? 3 : 1);
  assert.equal(option.series[0].name, rateView ? '7天逆回购利率' : '全国');
  assert.equal(element('officialRateControls').hidden, !rateView);
  assert.ok(option.series[0].data.length > 0);
  assert.ok(markets.every(m => m.disabled));
}
metrics[2].click(); ranges[0].click();
assert.equal(option.series[0].step, 'end');
assert.equal(option.series[0].data[0][0], rangeStart.toISOString().slice(0, 10));
assert.equal(option.series[0].data[0][1], .05);
metrics[3].click(); ranges.at(-1).click();
assert.equal(option.yAxis.max, 7, 'policy axis ends on a rounded tick, not 6.294399999999996');
assert.equal(option.yAxis.axisLabel.formatter(6.294399999999996), '6%');
assert.deepEqual(Array.from(option.series, s => s.name), ['7天逆回购利率', '1年期LPR', '5年期以上LPR']);
assert.equal(option.series[0].step, 'end');
assert.equal(option.series[0].sampling, undefined);
assert.deepEqual(Array.from(option.series[0].data, p => [...p]), data.reverseRepo.series.map(r => [r.date, r.reverseRepo7d]));
assert.ok(element('officialLatestReading').textContent.includes(data.reverseRepo.meta.end));
for (const [index, key] of [[1, 'lpr1y'], [2, 'lpr5y']]) {
  assert.equal(option.series[index].step, 'end');
  assert.equal(option.series[index].sampling, undefined);
  assert.deepEqual(Array.from(option.series[index].data, p => [...p]), data.lpr.series
    .filter(r => Number.isFinite(r[key])).map(r => [r.date, r[key]]));
}
assert.equal(option.series[1].data[0][0], '2013-10-25');
assert.equal(option.series[2].data[0][0], '2019-08-20');
assert.ok(element('officialLatestReading').textContent.includes(data.lpr.meta.end));
option.dataZoom[0].start = 60;
rates[0].click();
assert.equal(option.dataZoom[0].start, 60);
assert.equal(option.series.length, 2);
const repoHiddenMin = option.yAxis.min;
assert.ok(repoHiddenMin > 2);
rates[1].click(); rates[2].click();
assert.equal(option.series.length, 1, 'at least one rate stays visible');
assert.equal(option.series[0].name, '5年期以上LPR');
option.dataZoom[0].startValue = '2026-09-01';
option.dataZoom[0].endValue = '2026-11-03';
handlers.datazoom();
assert.equal(option.yAxis.axisLabel.formatter(3.51), '3.51%', 'constant rates keep distinct nearby ticks');
rates[1].click();
// Both active steps must remain inside the axis even between monthly quote dates.
option.dataZoom[0].startValue = '2026-09-25';
option.dataZoom[0].endValue = '2026-10-10';
handlers.datazoom();
assert.ok(option.yAxis.min < 3 && option.yAxis.max > 3.5);
ranges[0].click();
for (const series of option.series) assert.equal(series.data[0][0], rangeStart.toISOString().slice(0, 10));
metrics[0].click();
assert.equal(option.series[0].name, '沪市');
assert.ok(markets.every(m => !m.disabled));
markets[1].click();
assert.equal(option.series.length, 1);
assert.equal(element('officialRateControls').hidden, true);
metrics[3].click();
assert.equal(option.series.length, 2, 'rate selections persist across tabs');
metrics[6].click(); ranges.at(-1).click();
assert.equal(option.series.length, 1, 'market selection carries into refinancing');
assert.equal(option.series[0].name, '沪市');
assert.ok(markets.every(m => !m.disabled));
assert.equal(element('officialRateControls').hidden, true);
assert.deepEqual(Array.from(option.series[0].data, p => [...p]), refinancing.markets.sh.map(r => [r.date, r.refinanceFunds]));
assert.ok(element('officialMetricExplanation').innerHTML.includes('月累计'));
assert.ok(element('officialMetricGuide').innerHTML.includes('换股合并'));
assert.ok(element('officialLatestReading').textContent.includes(refinancing.meta.end));
option.dataZoom[0].start = 55;
markets[0].click(); markets[2].click();
assert.equal(option.dataZoom[0].start, 55);
assert.equal(option.series.length, 3);
refinancing.series.forEach((row, i) => {
  const sh = refinancing.markets.sh[i], sz = refinancing.markets.sz[i];
  assert.equal(sh.date, row.date); assert.equal(sz.date, row.date);
  if (row.refinanceFunds !== null) assert.ok(Math.abs(row.refinanceFunds-sh.refinanceFunds-sz.refinanceFunds)<.00011);
});
assert.equal(option.series[0].connectNulls, false);
assert.equal(option.series[0].sampling, undefined);
// Balance and growth are shown together on dual y-axes.
metrics[4].click();
assert.equal(option.series.length, 2);
assert.deepEqual(Array.from(option.series, s => s.name), ['社融绝对值', '社融同比增速']);
assert.deepEqual(Array.from(option.series[0].data, p => [...p]).filter(p => p[1] !== null), data.macro.social.series
  .filter(r => Number.isFinite(r.value)).map(r => [r.date, r.value]));
assert.deepEqual(Array.from(option.series[1].data, p => [...p]), data.macro.social.series
  .filter(r => Number.isFinite(r.yoy) || r.yoyStatus === 'incompatible_balance_scopes').map(r => [r.date, r.yoy]));
assert.equal(option.series[0].yAxisIndex, 0);
assert.equal(option.series[1].yAxisIndex, 1);
assert.ok(Array.isArray(option.yAxis) && option.yAxis.length === 2);
assert.equal(data.macro.social.series[0].date, '2006-12-31');
assert.equal(option.series[0].data[0][0], '2006-12-31');
assert.equal(option.series[0].data[8][0], '2014-12-31');
assert.ok(option.series[0].data.some(p => p[0] === '2017-01-01' && p[1] === null), 'balance line breaks across incompatible scopes');
assert.equal(option.series[0].markLine.data[0].xAxis, '2017-01-01');
for (const point of option.series[1].data.filter(p => p[0].startsWith('2017-'))) {
  assert.equal(point[1], point[0] === '2017-12-31' ? 12 : null, 'no spurious growth peak or bridging over unverified months');
}
assert.ok(option.tooltip.formatter([{seriesIndex: 1, seriesName: '社融同比增速', marker: '',
  axisValueLabel: '2017-12-31', value: ['2017-12-31', 12]}]).includes('官方可比同比'));
assert.ok(option.tooltip.formatter([{seriesIndex: 1, seriesName: '社融同比增速', marker: '',
  axisValueLabel: '2017-01-31', value: ['2017-01-31', null]}]).includes('口径不同'));
metrics[5].click();
assert.deepEqual(Array.from(option.series, s => s.name), ['M2绝对值', 'M2同比增速']);
assert.deepEqual(Array.from(option.series[0].data, p => [...p]), data.macro.m2.series
  .filter(r => Number.isFinite(r.value)).map(r => [r.date, r.value]));
assert.deepEqual(Array.from(option.series[1].data, p => [...p]), data.macro.m2.series
  .filter(r => Number.isFinite(r.yoy)).map(r => [r.date, r.yoy]));
assert.ok(element('officialLatestReading').textContent.includes('万亿元'));
assert.ok(element('officialMetricGuide').innerHTML.includes('增长速度'));
metrics[0].click();
assert.equal(option.series[0].name, '两市合计');
const gapData = structuredClone(refinancing);
gapData.series[20].refinanceFunds = null;
gapData.markets.sh[20].refinanceFunds = null;
const gapScript = script.replace(/const refinancingData = .*;/, () => 'const refinancingData = ' + JSON.stringify(gapData) + ';');
vm.runInNewContext(gapScript, {document: {getElementById: element,
  querySelectorAll(selector) {return selector.includes('MetricTabs') ? metrics : selector.includes('RateControls') ? rates : selector.includes('SeriesControls') ? markets : ranges;}
}, echarts: {init: () => chart}, window: {addEventListener() {}}});
metrics[6].click();
assert.equal(option.series[0].data[20][1], null, 'an incomplete month stays as an explicit gap');
assert.equal(option.series[1].data[20][1], null);
assert.equal(option.series[2].data[20][1], refinancing.markets.sz[20].refinanceFunds);
assert.equal(option.series[0].connectNulls, false);
console.log('PASS: seven tabs, market sums/selections, monthly refinancing, dates, zoom, LPR and tax steps, visible-rate axes');
