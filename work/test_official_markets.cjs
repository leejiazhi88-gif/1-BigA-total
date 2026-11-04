const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'official_sentiment_data.json')));
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
  if (!elements.has(id)) elements.set(id, {textContent: ''});
  return elements.get(id);
};
const button = dataset => ({dataset, attrs: {}, classList: {add() {}, remove() {}},
  addEventListener(type, handler) {this[type] = handler;},
  setAttribute(key, value) {this.attrs[key] = value;}});
const markets = ['all', 'sh', 'sz'].map(series => button({series}));
const rates = ['policyRate', 'lpr1y', 'lpr5y'].map(rate => button({rate}));
const metrics = ['ipoFunds', 'netReduceAmount', 'stampTaxRate', 'policyRate', 'socialFinancing', 'm2Yoy'].map(metric => button({metric}));
const ranges = [3, 5, 10, 20, 30, 0].map(years => button({years: String(years)}));
let option;
const handlers = {};
const chart = {setOption(next, replace) {option = replace ? next : {...option, ...next};},
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
for (const metric of metrics.slice(2)) {
  metric.click();
  const rateView = metric.dataset.metric === 'policyRate';
  assert.equal(option.series.length, rateView ? 3 : 1);
  assert.equal(option.series[0].name, rateView ? '1年期SHIBOR' : '全国');
  assert.equal(element('officialRateControls').hidden, !rateView);
  assert.ok(option.series[0].data.length > 0);
  assert.ok(markets.every(m => m.disabled));
}
metrics[2].click(); ranges[0].click();
assert.equal(option.series[0].step, 'end');
assert.equal(option.series[0].data[0][0], rangeStart.toISOString().slice(0, 10));
assert.equal(option.series[0].data[0][1], .05);
metrics[3].click(); ranges.at(-1).click();
assert.deepEqual(Array.from(option.series, s => s.name), ['1年期SHIBOR', '1年期LPR', '5年期以上LPR']);
assert.equal(option.series[0].step, false);
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
const shiborHiddenMin = option.yAxis.min;
assert.ok(shiborHiddenMin > 2);
rates[1].click(); rates[2].click();
assert.equal(option.series.length, 1, 'at least one rate stays visible');
assert.equal(option.series[0].name, '5年期以上LPR');
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
console.log('PASS: market sums, tabs, national scope, persistent selections, zoom, tax and LPR steps, dates and visible-rate axes');
