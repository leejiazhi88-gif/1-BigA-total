const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, '.tools/qa/nav-scroll');

(async () => {
  fs.mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = process.env.A_TOTAL_TEST_URL || pathToFileURL(path.join(root, 'index.html')).href;
    await page.goto(url);
    const ids = await page.locator('.page-nav a').evaluateAll(links => links.map(link => link.hash.slice(1)));
    assert.equal(ids.length, 6);
    const active = () => page.locator('.page-nav a.active').getAttribute('href');
    const waitActive = id => page.waitForFunction(id => {
      const links = document.querySelectorAll('.page-nav a.active');
      return links.length === 1 && links[0].hash === '#' + id && links[0].getAttribute('aria-current') === 'location';
    }, id);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      for (const id of [...ids, ...ids.slice().reverse()]) {
        await page.evaluate(id => {
          if (id === 'overview') window.scrollTo(0, 0);
          else {
            const target = document.getElementById(id);
            window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - 64);
          }
        }, id);
        await waitActive(id);
        const bounds = await page.locator('.page-nav a.active').evaluate(link => {
          const nav = link.closest('nav').getBoundingClientRect(), rect = link.getBoundingClientRect();
          return { inside: rect.left >= nav.left && rect.right <= nav.right };
        });
        assert.equal(bounds.inside, true, `${width}: active link ${id} outside mobile navigation`);
      }
      await page.locator('.page-nav a[href="#official-sentiment"]').click();
      await waitActive('official-sentiment');
      await page.screenshot({ path: path.join(artifacts, `official-${width}.png`) });
      await page.evaluate(() => document.getElementById('officialSentimentChart').scrollIntoView({ block: 'center' }));
      await waitActive('official-sentiment');
      assert.equal(await active(), '#official-sentiment');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await waitActive('national-team-etf');
    }
    await page.goto(url.split('#')[0] + '#national-team-direct');
    await waitActive('national-team-etf');
    await page.goto(url.split('#')[0] + '#official-sentiment');
    await waitActive('official-sentiment');
    await page.evaluate(() => window.scrollTo(0, 0));
    await waitActive('overview');
    assert.equal(await page.evaluate(() => location.hash), '#official-sentiment', 'scrolling must not rewrite the URL/history');
    assert.deepEqual(errors, []);
    console.log('PASS: six modules scrolling down/up at desktop/390/320 widths, mobile active-tab visibility, anchor clicks, deep links, bottom/top and no scroll-driven URL changes');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
