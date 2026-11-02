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
const button = dataset => ({ dataset, attrs: {}, classList: { add() {}, remove() {}, toggle() {} },
  addEventListener(type, handler) { this[type] = handler; },
  setAttribute(key, value) { this.attrs[key] = value; } });
const markets = ['all', 'sh', 'sz'].map(series => button({ series }));
assert.ok(!html.includes('data-metric="northMoney"'));
const metrics = ['blockAmount', 'institutionBlockNet', 'holderNetShares', 'northHoldings', 'fundPosition', 'institutionConcentration', 'etfShares'].map(metric => button({ metric }));
for (const metric of metrics) assert.ok(html.includes('data-metric="' + metric.dataset.metric + '"'));
assert.ok(!html.match(/<button[^>]+disabled[^>]*>\s*(主动权益基金仓位|机构持仓集中度|ETF份额变化)/));
const modes = ['value', 'ratio'].map(mode => button({ mode }));
const smoothing = [1, 7, 30].map(window => button({ window: String(window) }));
const ranges = [3, 5, 10, 20, 0].map(years => button({ years: String(years) }));
let option;
const chart = {
  setOption(next, replace) { option = replace ? next : { ...option, ...next,
    yAxis: { ...option?.yAxis, ...next.yAxis } }; },
  getOption() { return option || {}; }, on() {}, resize() {}
};
vm.runInNewContext(script, { document: {
  getElementById: element,
  querySelectorAll(selector) {
    return selector.includes('MetricTabs') ? metrics : selector.includes('Smoothing') ? smoothing : selector.includes('HoldingModes') ? modes : selector.includes('SeriesControls') ? markets : ranges;
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
for (const metric of metrics.slice(4)) {
  metric.click();
  assert.equal(element('largeMoneyHoldingModes').hidden, true);
  assert.equal(element('largeMoneyHoldingCoverage').hidden, false);
  assert.equal(option.yAxis.name, metric.dataset.metric === 'etfShares' ? '亿份' : '%');
  assert.equal(option.series[0].connectNulls, false);
  assert.ok(element('largeMoneyHoldingCoverage').textContent.includes('覆盖'));
}
metrics[3].click();
assert.equal(element('largeMoneyHoldingModes').hidden, false);
assert.equal(option.yAxis.name, '亿元');
const amount = option.series[0].data.find(p => Number.isFinite(p[1]))[1];
option.dataZoom[0].start = 40;
modes[1].click();
assert.equal(option.yAxis.name, '%');
assert.equal(option.dataZoom[0].start, 40);
assert.equal(option.series[0].name, '沪市');
assert.notEqual(option.series[0].data.find(p => Number.isFinite(p[1]))[1], amount);
assert.ok(option.series[0].data.some(p => p[1] === null));
assert.equal(option.series[0].connectNulls, false);
markets[1].click();
assert.equal(option.series.length, 1, 'at least one market must remain visible');
markets[2].click();
metrics[0].click();
assert.equal(element('largeMoneyHoldingModes').hidden, true);
ranges[0].click();
assert.equal(option.series.length, 2);
assert.ok(option.series.every(s => s.data.every(p => p[0] >= '2023-10-23')));
ranges.at(-1).click();
for (const metric of metrics.slice(0, 3)) {
  metric.click();
  smoothing[0].click();
  const raw = Array.from(option.series[0].data, p => [...p]);
  for (const [i, size] of [[1, 7], [2, 30]]) {
    option.dataZoom[0].start = 20;
    smoothing[i].click();
    assert.equal(option.dataZoom[0].start, 20);
    option.series[0].data.forEach((point, index) => {
      const window = raw.slice(Math.max(0, index-size+1), index+1);
      const expected = window.length === size && window.every(p => Number.isFinite(p[1]))
        ? window.reduce((sum,p) => sum+p[1],0)/size : null;
      assert.equal(point[1], expected);
    });
    const full = Array.from(option.series[0].data, p => [...p]);
    ranges[0].click();
    assert.deepEqual(Array.from(option.series[0].data, p => [...p]), full.filter(p => p[0] >= '2023-10-23'));
    ranges.at(-1).click();
  }
  smoothing[0].click();
  assert.deepEqual(Array.from(option.series[0].data, p => [...p]), raw);
}
smoothing[1].click();
metrics[3].click();
assert.equal(element('largeMoneySmoothing').hidden, true);
metrics[0].click();
assert.equal(element('largeMoneySmoothing').hidden, false);
assert.ok(element('largeMoneyMetricSubtitle').textContent.includes('7点均线'));
console.log('PASS: tabs, market controls, raw/7/30 averages, missing windows, range independence and zoom');
