const test = require('node:test');
const assert = require('node:assert/strict');
const { buildShareStocks, sumShareStocks, buildAssetStocks, sumAssetStocks, centerZeroAxis } = require('./etf_share_stock');

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

test('asset totals use same-day shares and NAV; missing data is never carried or zero-filled', () => {
  const etfs = [{ ts_code: 'A', list_date: '20260101' }, { ts_code: 'B', list_date: '20260103' }];
  const data = { etfs, series: ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05'].map(date => ({ date })),
    observations: { A: [
      { trade_date: '20260101', total_share: 20000, nav: 2, total_size: 999999 },
      { trade_date: '20260102', total_share: 20000, nav: null },
      { trade_date: '20260103', total_share: 20000, nav: 3 },
      { trade_date: '20260105', total_share: 0, nav: 3 }
    ], B: [{ trade_date: '20260103', total_share: 10000, nav: 5 }] } };
  const points = sumAssetStocks(buildAssetStocks(data), etfs);
  assert.deepEqual(points.map(row => row.total), [4, null, 11, null, null]);
  assert.equal(points[0].eligible, 1);
  assert.equal(points[1].coverage, 0);
  assert.deepEqual(points[3].missing, ['A', 'B']);
  const aOnly = sumAssetStocks(buildAssetStocks(data), [etfs[0]]);
  assert.equal(aOnly[2].total, 6);
  assert.equal(aOnly[4].total, 0);
  assert.equal(sumAssetStocks(buildAssetStocks(data), []).at(-1).total, null);
});

test('asset value is invariant to a pure share conversion and changes with NAV', () => {
  const etfs = [{ ts_code: 'A', list_date: '20260101' }];
  const data = { etfs, series: ['2026-01-01', '2026-01-02', '2026-01-03'].map(date => ({ date })),
    observations: { A: [
      { trade_date: '20260101', total_share: 20000, nav: 2 },
      { trade_date: '20260102', total_share: 10000, nav: 4 },
      { trade_date: '20260103', total_share: 10000, nav: 5 }
    ] } };
  assert.deepEqual(sumAssetStocks(buildAssetStocks(data), etfs).map(row => row.total), [4, 4, 5]);
  data.observations.A.push({ trade_date: '20260103', total_share: 10000, nav: 6 });
  assert.throws(() => buildAssetStocks(data), /Conflicting/);
});

test('all nine fund assets reconcile to raw inputs at every historical date and selected group', () => {
  const data = require('./etf_flow_data.json');
  const assets = buildAssetStocks(data);
  const inputs = Object.fromEntries(data.etfs.map(fund => [fund.ts_code,
    new Map(data.observations[fund.ts_code].map(row => [row.trade_date, row]))]));
  for (const funds of [data.etfs, data.etfs.filter(fund => fund.group === '沪深300')]) {
    assert.ok(funds.length);
    const points = sumAssetStocks(assets, funds);
    for (const point of points) {
      const date = point.date.replaceAll('-', '');
      const applicable = funds.filter(fund => fund.list_date <= date);
      const rows = applicable.map(fund => inputs[fund.ts_code].get(date));
      const complete = rows.length && rows.every(row => Number.isFinite(row?.total_share)
        && row.total_share >= 0 && Number.isFinite(row?.nav) && row.nav > 0);
      if (!complete) assert.equal(point.total, null);
      else assert.ok(Math.abs(point.total - rows.reduce((sum, row) => sum + row.total_share * row.nav / 10000, 0)) < 1e-8);
    }
    assert.equal(points.at(-1).coverage, funds.length);
  }
});
