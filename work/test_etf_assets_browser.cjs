const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const data = require('./etf_flow_data.json');
const { buildAssetStocks, sumAssetStocks } = require('./etf_share_stock');
const root = path.resolve(__dirname, '..');
const assets = buildAssetStocks(data);

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const output = path.join(root, '.tools/qa/etf-assets');
  fs.mkdirSync(output, { recursive: true });
  try {
    for (const width of [1440, 390, 320]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(process.env.A_TOTAL_TEST_URL || pathToFileURL(path.join(root, 'index.html')).href);
      await page.locator('#ntFlowRanges [data-range="30d"]').click();
      async function verify(funds) {
        const actual = await page.evaluate(() => {
          const chart = echarts.getInstanceByDom(document.getElementById('nationalTeamEtfFlowChart'));
          const option = chart.getOption();
          const series = option.series.find(series => series.yAxisIndex === 2);
          const dates = option.xAxis[0].data;
          const tooltip = option.tooltip[0].formatter([{ dataIndex: dates.length - 1 }]);
          return { dates, values: series?.data, names: option.yAxis.map(axis => axis.name),
            reading: document.getElementById('ntFlowReadings').textContent,
            text: document.getElementById('national-team-etf-flow').textContent,
            tooltip, zoom: option.dataZoom[0] };
        });
        const expected = new Map(sumAssetStocks(assets, funds).map(row => [row.date, row.total]));
        assert.deepEqual(actual.names, ['累计净申购 / 亿元', '当日净申购 / 亿元', '总资产净值 / 亿元']);
        for (let i = 0; i < actual.dates.length; i++) {
          if (actual.values[i] !== null) assert.ok(Math.abs(actual.values[i] - expected.get(actual.dates[i])) < 1e-8);
        }
        assert.ok(actual.reading.includes(expected.get(actual.dates.at(-1)).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' 亿元'));
        assert.ok(actual.tooltip.includes('样本总资产净值：'));
        assert.ok(actual.tooltip.includes('亿元'));
        assert.ok(!actual.text.includes('亿份'));
        assert.equal(actual.zoom.type, 'slider');
      }
      await verify(data.etfs);
      const controls = page.locator('#ntFlowFunds input');
      for (let i = 0; i < await controls.count(); i++) {
        if (await controls.nth(i).inputValue() !== '沪深300') await controls.nth(i).uncheck();
      }
      await verify(data.etfs.filter(fund => fund.group === '沪深300'));
      await page.locator('#ntFlowIndicators [data-indicator="assets"]').uncheck();
      assert.equal(await page.evaluate(() => echarts.getInstanceByDom(document.getElementById('nationalTeamEtfFlowChart')).getOption().series.some(series => series.yAxisIndex === 2)), false);
      await page.locator('#ntFlowIndicators [data-indicator="assets"]').check();
      for (let i = 0; i < await controls.count(); i++) await controls.nth(i).check();
      await page.locator('#nationalTeamEtfFlowChart').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('#ntFlowReadings strong')].some(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getClientRects().length > 1;
      })), false, 'Monetary reading and unit must remain on one line');
      await page.screenshot({ path: path.join(output, 'etf-assets-' + width + '.png') });
      await page.evaluate(() => echarts.getInstanceByDom(document.getElementById('nationalTeamEtfFlowChart')).dispatchAction({ type: 'dataZoom', start: 30, end: 90 }));
      const zoomed = await page.evaluate(() => echarts.getInstanceByDom(document.getElementById('nationalTeamEtfFlowChart')).getOption());
      const plotted = zoomed.series.find(series => series.yAxisIndex === 2).data;
      const expected = new Map(sumAssetStocks(assets, data.etfs).map(row => [row.date, row.total]));
      assert.ok(plotted.some(value => value === null));
      for (let i = 0; i < plotted.length; i++) if (plotted[i] !== null) assert.ok(Math.abs(plotted[i] - expected.get(zoomed.xAxis[0].data[i])) < 1e-8);
      for (let i = 0; i < await controls.count(); i++) await controls.nth(i).uncheck();
      assert.ok((await page.locator('#ntFlowReadings').textContent()).includes('暂无 亿元'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(errors, []);
      await page.close();
      console.log('PASS ETF asset values, units, tooltip, group/indicator choices, zoom and empty selection:', width);
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
