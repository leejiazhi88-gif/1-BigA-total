const test = require('node:test');
const assert = require('node:assert/strict');
const { flowWindow, summarizeFlows, validateFlowHistory } = require('./etf_flow_history');
const data = require('./etf_flow_data.json');

test('later-listed funds join only when applicable and listing proceeds are not subscriptions', () => {
  const funds = [{ ts_code: 'A', name: 'A' }, { ts_code: 'B', name: 'B' }];
  const rows = [
    { date: '2015-01-05', flows: { A: 2, B: null }, issues: { B: 'not_listed' } },
    { date: '2015-01-06', flows: { A: 3, B: null }, issues: { B: 'missing_share' } },
    { date: '2015-01-07', flows: { A: -1, B: 5 }, issues: {} }
  ];
  const result = summarizeFlows(rows, funds);
  assert.deepEqual(result.points.map(r => r.total), [2, null, 4]);
  assert.deepEqual(result.points.map(r => r.cumulative), [2, null, 9]);
  assert.equal(result.knownTotal, 9);
  assert.equal(result.details.reduce((n, f) => n + f.knownTotal, 0), result.knownTotal);
  assert.equal(result.missing, 1);
  assert.equal(result.details[1].eligibleDays, 2);
  assert.equal(result.completeDays, 2);
  assert.equal(result.points[2].missingSoFar, 1);
  assert.equal(summarizeFlows(rows.slice(2), funds).knownTotal, 4);
  assert.equal(summarizeFlows(rows.slice(0, 1), [funds[1]]).knownTotal, null);
  assert.equal(summarizeFlows(rows, []).knownTotal, null);
});

test('full history retains actual 2015 starts, nine funds and null daily gaps', () => {
  validateFlowHistory(data);
  assert.equal(data.meta.start, '2015-01-05');
  assert(data.series.length >= 2867);
  assert.equal(data.meta.window, data.series.length);
  const result = summarizeFlows(data.series, data.etfs);
  assert.equal(result.completeDays, data.meta.completeDays);
  assert.equal(result.missing, result.details.reduce((n, f) => n + f.eligibleDays - f.validDays, 0));
  assert.equal(result.details.find(f => f.ts_code === '588000.SH').first, '2020-11-17');
  assert.equal(result.details.find(f => f.ts_code === '512100.SH').first, '2016-11-07');
  assert(result.points.some(r => r.total < 0));
  assert(result.points.some(r => r.total > 0));
  assert(Math.abs(result.knownTotal - result.details.reduce((n, f) => n + f.knownTotal, 0)) < 1e-6);
  const broken = structuredClone(data);
  broken.series[0].flows['588000.SH'] = 0;
  assert.throws(() => validateFlowHistory(broken), /coverage/);
  broken.series[0] = structuredClone(data.series[0]);
  broken.series[2].total = 100000;
  assert.throws(() => validateFlowHistory(broken), /total/);
});

test('recent-day and year windows retain daily frequency and reset cumulative at their own start', () => {
  assert.equal(flowWindow(data.series, '30d').length, 30);
  assert.equal(flowWindow(data.series, '60d').length, 60);
  assert.equal(flowWindow(data.series, '90d').length, 90);
  assert.equal(flowWindow(data.series, 'all'), data.series);
  for (const years of [1, 3, 5]) {
    const rows = flowWindow(data.series, years + 'y');
    const cutoff = new Date(data.series.at(-1).date + 'T00:00:00Z');
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
    assert(rows[0].date >= cutoff.toISOString().slice(0, 10));
    assert.equal(rows.at(-1).date, data.series.at(-1).date);
    const summary = summarizeFlows(rows, data.etfs);
    assert.equal(summary.points.find(r => r.complete)?.cumulative,
      summary.points.slice(0, summary.points.findIndex(r => r.complete) + 1).reduce((n, r) => n + (r.known ?? 0), 0));
  }
});
