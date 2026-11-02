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
const metrics = ['ipoFunds', 'netReduceAmount', 'stampTaxRate', 'policyRate', 'socialFinancing', 'm2Yoy'].map(metric => button({metric}));
const ranges = [3, 5, 10, 20, 30, 0].map(years => button({years: String(years)}));
let option;
const chart = {setOption(next, replace) {option = replace ? next : {...option, ...next};},
  getOption() {return option || {};}, on() {}, resize() {}};
vm.runInNewContext(script, {document: {getElementById: element,
  querySelectorAll(selector) {return selector.includes('MetricTabs') ? metrics : selector.includes('SeriesControls') ? markets : ranges;}
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
  assert.equal(option.series.length, 1);
  assert.equal(option.series[0].name, '全国');
  assert.ok(option.series[0].data.length > 0);
  assert.ok(markets.every(m => m.disabled));
}
metrics[2].click(); ranges[0].click();
assert.equal(option.series[0].step, 'end');
assert.equal(option.series[0].data[0][0], rangeStart.toISOString().slice(0, 10));
assert.equal(option.series[0].data[0][1], .05);
metrics[0].click();
assert.equal(option.series[0].name, '沪市');
assert.ok(markets.every(m => !m.disabled));
markets[1].click();
assert.equal(option.series.length, 1);
console.log('PASS: market sums, all six tabs, national scope, persistent selection, zoom and tax step');
