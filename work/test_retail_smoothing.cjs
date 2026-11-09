const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const script = html.match(/<script id="retail-sentiment-script">([\s\S]*?)<\/script>/)[1];
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'retail_sentiment_data.json')));
const button = dataset => ({ dataset, attrs: {}, classList: { add() {}, remove() {}, toggle() {} },
  addEventListener(type, handler) { this[type] = handler; },
  setAttribute(key, value) { this.attrs[key] = value; } });

function mount(source = script) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '',
      get innerHTML() { return this.markup || ''; },
      set innerHTML(value) { this.markup = value; this.textContent = value.replace(/<[^>]*>/g, ' '); } });
    return elements.get(id);
  };
  const metrics = ['amount', 'volume', 'turnover', 'marginBalance', 'marginFloatRatio'].map(metric => button({ metric }));
  const smoothing = [1, 7, 30].map(window => button({ window: String(window) }));
  const markets = ['all', 'sh', 'sz'].map(series => button({ series }));
  const ranges = [3, 0].map(years => button({ years: String(years) }));
  const charts = [];
  vm.runInNewContext(source, {
    document: { getElementById: element, querySelectorAll(selector) {
      return selector.includes('MetricTabs') ? metrics : selector.includes('Smoothing') ? smoothing
        : selector.includes('SeriesControls') ? markets : selector.includes('RangeTabs') ? ranges : [];
    } },
    echarts: { init() {
      const chart = { option: {}, setOption(next, replace) { this.option = replace ? next : { ...this.option, ...next }; },
        getOption() { return this.option; }, resize() {}, on() {} };
      charts.push(chart);
      return chart;
    } }, window: { addEventListener() {} }
  });
  return { element, metrics, smoothing, markets, ranges, chart: charts[0] };
}

const ui = mount();
const points = series => Array.from(series.data, point => [...point]);
for (const [index, field] of ['amount', 'volume', 'turnover'].entries()) {
  ui.metrics[index].click(); ui.ranges[1].click(); ui.smoothing[0].click();
  assert.equal(ui.element('retailSmoothing').hidden, false);
  const sources = [data.series, data.markets.sh, data.markets.sz];
  ui.chart.option.series.forEach((series, market) => assert.deepEqual(points(series),
    sources[market].filter(row => Number.isFinite(row[field])).map(row => [row.date, row[field]])));
  const raw = ui.chart.option.series.map(points);
  for (const [mode, size] of [[1, 7], [2, 30]]) {
    ui.chart.option.dataZoom[0].start = 40;
    ui.smoothing[mode].click();
    assert.equal(ui.chart.option.dataZoom[0].start, 40);
    ui.chart.option.series.forEach((series, market) => {
      const prefix = [0];
      raw[market].forEach(point => prefix.push(prefix.at(-1) + point[1]));
      series.data.forEach((point, i) => {
        const expected = i < size - 1 ? null : (prefix[i + 1] - prefix[i + 1 - size]) / size;
        assert.equal(point[0], raw[market][i][0]);
        if (expected === null) assert.equal(point[1], null);
        else assert.ok(Math.abs(point[1] - expected) < 1e-7);
      });
    });
    const option = ui.chart.option;
    const last = option.series[0].data.at(-1);
    assert.ok(ui.element('retailLatestReading').textContent.includes(size + '点均线'));
    assert.ok(option.tooltip.formatter([{ axisValueLabel: last[0], seriesName: '两市合计', value: last, marker: '' }]).includes(size + '点均线'));
    const full = option.series.map(points);
    ui.ranges[0].click();
    const cutoff = new Date(data.series.at(-1).date + 'T00:00:00Z');
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 3);
    ui.chart.option.series.forEach((series, market) => assert.deepEqual(points(series),
      full[market].filter(point => point[0] >= cutoff.toISOString().slice(0, 10))));
    ui.ranges[1].click();
  }
  ui.smoothing[0].click();
  assert.deepEqual(ui.chart.option.series.map(points), raw);
}
ui.smoothing[1].click(); ui.markets[0].click(); ui.markets[2].click();
ui.chart.option.dataZoom[0].start = 55;
ui.smoothing[2].click();
assert.equal(ui.chart.option.dataZoom[0].start, 55);
ui.metrics[1].click();
assert.equal(ui.chart.option.series.length, 1);
assert.equal(ui.chart.option.series[0].name, '沪市');
assert.ok(ui.element('retailLatestReading').textContent.includes('30点均线'));
for (const index of [3, 4]) {
  ui.metrics[index].click();
  assert.equal(ui.element('retailSmoothing').hidden, true);
  assert.ok(!ui.element('retailLatestReading').textContent.includes('均线'));
  const field = ui.metrics[index].dataset.metric;
  assert.deepEqual(points(ui.chart.option.series[0]), data.markets.sh.filter(row => Number.isFinite(row[field])).map(row => [row.date, row[field]]));
}
ui.metrics[0].click();
assert.ok(ui.element('retailLatestReading').textContent.includes('30点均线'));

// A missing observation must invalidate its entire window; an unrelated date must not add a point.
const gap = structuredClone(data);
const observed = gap.series.filter(row => row.weeklySamples?.amount);
observed[40].amount = null;
observed[70].amount = 0;
observed.at(-1).amount = null;
const withGap = mount(script.replace(/const retailData = .*;/, () => 'const retailData = ' + JSON.stringify(gap) + ';'));
withGap.smoothing[1].click();
const values = points(withGap.chart.option.series[0]);
assert.equal(values.length, observed.length);
for (let index = 40; index < 47; index++) assert.equal(values[index][1], null);
assert.ok(Number.isFinite(values[47][1]));
assert.equal(values[70][1], observed.slice(64, 71).reduce((sum, row) => sum + row.amount, 0) / 7);
assert.equal(values.at(-1)[1], null);
assert.ok(withGap.element('retailLatestReading').textContent.includes('窗口不足或数据缺失'));
assert.equal(withGap.chart.option.series[0].connectNulls, false);
console.log('PASS: retail raw/7/30 across all markets, full-history calculation, gaps, valid zero, shared state, financing unchanged and zoom preservation');
