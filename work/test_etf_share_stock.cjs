const test = require('node:test');
const assert = require('node:assert/strict');
const { buildShareStocks, sumShareStocks, centerZeroAxis } = require('./etf_share_stock');

test('independent axes center zero at the same midpoint for all value ranges', () => {
  for (const axis of [{min:-20000,max:5000},{min:0,max:4000},{min:0,max:0.1}]) {
    const centered = centerZeroAxis(axis);
    assert.equal(centered.min, -centered.max);
    assert.equal((0-centered.min)/(centered.max-centered.min), 0.5);
    assert.equal(centered.max / centered.interval, 4);
    assert(centered.min <= axis.min && centered.max >= axis.max);
  }
});

test('share stock uses past observations only, fifteen-day limit, units and listing dates', () => {
  const etfs = [{ ts_code: 'A', list_date: '20260101' }, { ts_code: 'B', list_date: '20260120' }];
  const data = { etfs, series: ['2026-01-15', '2026-01-16', '2026-01-17', '2026-01-20'].map(date => ({ date })),
    observations: { A: [{ trade_date: '20260101', total_share: 20000 }, { trade_date: '20260120', total_share: 30000 }],
      B: [{ trade_date: '20260120', total_share: 10000 }] } };
  const points = sumShareStocks(buildShareStocks(data), etfs);
  assert.deepEqual(points.map(row => row.total), [2, 2, null, 4]);
  assert.equal(points[0].eligible, 1);
  assert.equal(points[2].coverage, 0);
  assert.equal(points[3].dates.A, '2026-01-20');
  assert.equal(sumShareStocks(buildShareStocks(data), [etfs[0]]).at(-1).total, 3);
  assert.equal(sumShareStocks(buildShareStocks(data), []).at(-1).total, null);
});

test('actual nine-fund stock reconciles to raw shares independently of net flows', () => {
  const data = require('./etf_flow_data.json');
  const points = sumShareStocks(buildShareStocks(data), data.etfs);
  const last = points.at(-1);
  assert.equal(last.coverage, 9);
  const date = last.date.replaceAll('-', '');
  const expected = data.etfs.reduce((sum, fund) => sum + data.observations[fund.ts_code]
    .filter(row => row.trade_date <= date && Number.isFinite(row.total_share)).at(-1).total_share / 10000, 0);
  assert(Math.abs(expected - last.total) < 1e-8);
  assert(last.total > 0);
});
