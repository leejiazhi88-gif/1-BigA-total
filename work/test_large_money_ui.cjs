const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script id="large-money-sentiment-script">([\s\S]*?)<\/script>/)[1];
const elements = new Map();
const element = id => {
  if (!elements.has(id)) elements.set(id, { textContent: '' });
  return elements.get(id);
};
const button = dataset => ({ dataset, attrs: {}, classList: { add() {}, remove() {} },
  addEventListener(type, handler) { this[type] = handler; },
  setAttribute(key, value) { this.attrs[key] = value; } });
const markets = ['all', 'sh', 'sz'].map(series => button({ series }));
const metrics = ['blockAmount', 'institutionBlockNet', 'holderNetShares', 'northMoney'].map(metric => button({ metric }));
const ranges = [3, 5, 10, 20, 0].map(years => button({ years: String(years) }));
let option;
const chart = {
  setOption(next, replace) { option = replace ? next : { ...option, ...next }; },
  getOption() { return option || {}; }, on() {}, resize() {}
};
vm.runInNewContext(script, { document: {
  getElementById: element,
  querySelectorAll(selector) {
    return selector.includes('MetricTabs') ? metrics : selector.includes('SeriesControls') ? markets : ranges;
  }
}, echarts: { init: () => chart }, window: { addEventListener() {} } });
assert.equal(option.series.length, 3);
assert.deepEqual(Array.from(option.series, s => s.name), ['两市合计', '沪市', '深市']);
option.dataZoom[0].start = 40;
markets[0].click();
markets[2].click();
assert.equal(option.series.length, 1);
assert.equal(option.series[0].name, '沪市');
assert.equal(option.dataZoom[0].start, 40);
for (const metric of metrics) {
  metric.click();
  assert.equal(option.series.length, 1);
  assert.equal(option.series[0].name, '沪市');
  assert.ok(option.series[0].data.some(p => Number.isFinite(p[1])));
  assert.ok(Number.isFinite(option.yAxis.min) && Number.isFinite(option.yAxis.max));
  assert.ok(!element('largeMoneyLatestReading').textContent.includes('深市'));
}
markets[1].click();
assert.equal(option.series.length, 1, 'at least one market must remain visible');
markets[2].click();
metrics[0].click();
ranges[0].click();
assert.equal(option.series.length, 2);
assert.ok(option.series.every(s => s.data.every(p => p[0] >= '2023-10-23')));
console.log('PASS: all four tabs, shared selection, last-series guard, zoom preservation and date range');
