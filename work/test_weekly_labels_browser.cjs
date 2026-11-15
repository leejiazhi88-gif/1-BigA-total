const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const width of [1440, 390]) {
      const page = await browser.newPage({ viewport: { width, height: 1000 } });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve(__dirname, "../index.html")).href);
      await page.locator('#largeMoneyRangeTabs [data-years="0"]').click();
      for (const metric of ["blockAmount", "institutionBlockNet", "holderNetShares", "etfShares"]) {
        await page.locator('#largeMoneyMetricTabs [data-metric="' + metric + '"]').click();
        const dates = await page.evaluate(() =>
          echarts.getInstanceByDom(document.getElementById("largeMoneyChart")).getOption().series.flatMap(series =>
            series.data.filter(point => Array.isArray(point) && point[0] >= "2026-10-26" && point[0] <= "2026-10-31").map(point => point[0])));
        assert.ok(dates.length);
        assert.ok(dates.every(date => date === "2026-10-30"), metric + ": " + dates.join(","));
      }
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      console.log("PASS weekly chart dates", width);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
