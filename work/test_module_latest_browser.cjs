const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.tools/qa/module-latest');
const modules = [
  { prefix: 'valuation', chart: 'valuationChart', reading: 'valuationLatestReading' },
  { prefix: 'retail', chart: 'retailSentimentChart', reading: 'retailLatestReading' },
  { prefix: 'largeMoney', chart: 'largeMoneyChart', reading: 'largeMoneyLatestReading' },
  { prefix: 'official', chart: 'officialSentimentChart', reading: 'officialLatestReading' }
];

async function checkChart(page, config) {
  const result = await page.evaluate(({ chart: chartId, reading }) => {
    const chart = echarts.getInstanceByDom(document.getElementById(chartId));
    const option = chart.getOption();
    const header = document.getElementById(reading);
    const headerRect = header.getBoundingClientRect();
    const shell = header.parentElement.getBoundingClientRect();
    const chartRect = chart.getDom().getBoundingClientRect();
    const plot = chart.getModel().getComponent('grid').coordinateSystem.getRect();
    const items = [...header.querySelectorAll('.module-chart-item')];
    const monthly = chartId === 'retailAccountsChart' || chartId === 'retailFundsChart';
    return {
      topClearance: chartRect.top + plot.y - headerRect.bottom,
      plotHeight: plot.height,
      axisName: option.yAxis.some(axis => axis.name),
      texts: items.map(item => ({
        name: item.querySelector('.module-chart-name').textContent,
        value: item.querySelector('.module-chart-value').firstChild.textContent,
        font: getComputedStyle(item.querySelector('.module-chart-value')).fontSize,
        inside: item.getBoundingClientRect().left >= shell.left && item.getBoundingClientRect().right <= shell.right,
        color: getComputedStyle(item).color
      })),
      points: option.series.map(series => {
        let point;
        if (monthly) {
          const value = series.data.at(-1);
          return { name: series.name, color: series.itemStyle.color, value: typeof value === 'object' && value !== null ? value.value : value };
        }
        if (chartId === 'largeMoneyChart' || (chartId === 'officialSentimentChart' && option.yAxis.length === 2)) {
          point = series.data.findLast(point => Number.isFinite(point[1]));
        } else point = series.data.at(-1);
        return { name: series.name, color: series.itemStyle.color, value: point?.[1], date: point?.[0] };
      }),
      dateText: header.textContent,
      insideZoom: option.dataZoom.some(zoom => zoom.type === 'inside'),
      overlaps: items.some((item, index) => items.slice(index + 1).some(other => {
        const a = item.getBoundingClientRect(), b = other.getBoundingClientRect();
        return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      }))
    };
  }, config);
  assert.ok(result.topClearance >= 5, `${config.chart}: readout overlaps plot (${result.topClearance})`);
  if (result.axisName) assert.ok(result.topClearance >= 30, `${config.chart}: axis unit overlaps readout`);
  assert.ok(result.plotHeight >= 65, `${config.chart}: insufficient plot height (${result.plotHeight})`);
  assert.equal(result.insideZoom, false);
  assert.equal(result.overlaps, false);
  assert.equal(result.texts.length, result.points.length);
  for (const text of result.texts) {
    const point = result.points.find(point => config.chart === 'valuationChart' ? point.name.startsWith(text.name) : point.name === text.name);
    assert.ok(point, `${config.chart}: missing series ${text.name}`);
    assert.equal(text.font, '13px');
    assert.equal(text.color, 'rgb(' + point.color.slice(1).match(/../g).map(value => parseInt(value, 16)).join(', ') + ')');
    assert.equal(text.inside, true, `${config.chart}: ${text.name} overflows`);
    if (Number.isFinite(point.value)) {
      const number = Number(text.value.replaceAll(',', ''));
      const digits = text.value.split('.')[1]?.length || 0;
      const expected = Number(point.value.toLocaleString('en-US', { useGrouping: false, minimumFractionDigits: digits, maximumFractionDigits: digits }));
      assert.equal(number, expected, `${config.chart}: incorrect latest value`);
    } else assert.equal(text.value, '--');
    if (point.date) assert.ok(result.dateText.includes(point.date), `${config.chart}: missing actual date ${point.date}`);
  }
}

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(process.env.A_TOTAL_TEST_URL || pathToFileURL(path.join(root, 'index.html')).href);
    await page.waitForFunction(() => typeof echarts !== 'undefined' && document.querySelector('#officialLatestReading .module-chart-value'));
    let cases = 0;
    for (const width of [1440, 800, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const config of modules) {
        const tabs = page.locator(`#${config.prefix}MetricTabs [data-metric]`);
        for (let index = 0; index < await tabs.count(); index++) {
          await tabs.nth(index).click();
          await checkChart(page, config);
          cases++;
          if ((width === 1440 || width === 390) && index === 0) {
            await page.locator(`#${config.reading}`).locator('..').screenshot({ path: path.join(artifacts, `${config.prefix}-${width}.png`) });
          }
        }
      }
      for (const [chart, reading] of [['retailAccountsChart', 'retailAccountsLatest'], ['retailFundsChart', 'retailFundsLatest']]) {
        await checkChart(page, { chart, reading });
        cases++;
        if (width === 390) await page.locator(`#${reading}`).locator('..').screenshot({ path: path.join(artifacts, `${chart}-${width}.png`) });
      }
    }
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.locator('#officialMetricTabs [data-metric="policyRate"]').click();
    await page.locator('#officialLatestReading').locator('..').screenshot({ path: path.join(artifacts, 'policy-rate-390.png') });
    await page.locator('#largeMoneyMetricTabs [data-metric="northHoldings"]').click();
    await page.locator('#largeMoneyLatestReading').locator('..').screenshot({ path: path.join(artifacts, 'north-holdings-390.png') });
    await page.locator('#largeMoneyHoldingModes [data-mode="ratio"]').click();
    await checkChart(page, modules[2]);
    for (const metric of ['blockAmount', 'institutionBlockNet', 'holderNetShares']) {
      await page.locator(`#largeMoneyMetricTabs [data-metric="${metric}"]`).click();
      for (const window of [7, 30, 1]) {
        await page.locator(`#largeMoneySmoothing [data-window="${window}"]`).click();
        await checkChart(page, modules[2]);
        assert.ok((await page.locator('#largeMoneyLatestReading').textContent()).includes(window === 1 ? '原数据' : window + '点均线'));
      }
    }
    await page.locator('#valuationMetricTabs [data-metric="pePercentile"]').click();
    await page.locator('#valuationRangeTabs [data-years="3"]').click();
    await checkChart(page, modules[0]);
    assert.ok((await page.locator('#valuationLatestReading').textContent()).includes('3年样本'));
    await page.locator('#officialRateControls [data-rate="reverseRepo7d"]').click();
    await checkChart(page, modules[3]);
    assert.equal(await page.locator('#officialLatestReading .module-chart-name').count(), 2);
    for (const [prefix, chart, reading] of [
      ['retail', 'retailSentimentChart', 'retailLatestReading'],
      ['largeMoney', 'largeMoneyChart', 'largeMoneyLatestReading'],
      ['official', 'officialSentimentChart', 'officialLatestReading']
    ]) {
      await page.locator(`#${prefix}MetricTabs [data-metric]`).first().click();
      await page.locator(`#${prefix}SeriesControls [data-series="all"]`).click();
      await page.locator(`#${prefix}SeriesControls [data-series="sz"]`).click();
      const names = await page.locator(`#${reading} .module-chart-name`).allTextContents();
      assert.deepEqual(names, ['沪市']);
      await checkChart(page, { chart, reading });
    }
    await page.locator('#officialMetricTabs [data-metric="m2Yoy"]').click();
    const before = await page.locator('#officialLatestReading').textContent();
    await page.evaluate(() => {
      const chart = echarts.getInstanceByDom(document.getElementById('officialSentimentChart'));
      chart.dispatchAction({ type: 'dataZoom', start: 20, end: 50 });
    });
    assert.equal(await page.locator('#officialLatestReading').textContent(), before);
    await page.evaluate(() => {
      const chart = echarts.getInstanceByDom(document.getElementById('officialSentimentChart'));
      chart.dispatchAction({ type: 'legendToggleSelect', name: 'M2同比增速' });
    });
    assert.equal(await page.locator('#officialLatestReading [data-latest-series="M2同比增速"]').isVisible(), false);
    assert.equal(await page.locator('#officialLatestReading [data-latest-series="M2绝对值"]').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log(`PASS: ${cases} chart/tab/viewport cases, latest values/dates/colors/font/layout, shared market choices, historical zoom and macro legend; screenshots in ${artifacts}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
