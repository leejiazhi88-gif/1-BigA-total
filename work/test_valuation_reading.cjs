const test = require('node:test');
const assert = require('node:assert/strict');
const { percentileGauge, pairedPeReading, percentileColor } = require('./valuation_reading');

test('percentile numbers use the exact gauge color at each segment', () => {
  assert.equal(percentileColor(0),'#319a82');
  assert.equal(percentileColor(19.99),'#319a82');
  assert.equal(percentileColor(20),'#8ebd77');
  assert.equal(percentileColor(40),'#c2bd77');
  assert.equal(percentileColor(60),'#d9ac58');
  assert.equal(percentileColor(79.46),'#d9ac58');
  assert.equal(percentileColor(80),'#c65d76');
  assert.equal(percentileColor(100),'#c65d76');
  assert.equal(percentileColor(null),'var(--text)');
});

test('paired readings use all valid daily samples including ties and restore latest', () => {
  const rows = [{date:'2026-01-01',pe:10},{date:'2026-01-02',pe:20},{date:'2026-01-03',pe:20},{date:'2026-01-04',pe:30}];
  const sorted = rows.map(row => row.pe);
  assert.deepEqual(pairedPeReading(rows,sorted,'2026-01-02',rows), {date:'2026-01-02',pe:20,percentile:75});
  assert.equal(pairedPeReading(rows,sorted,undefined,rows).pe,30);
  assert(Math.abs(pairedPeReading(rows.slice(1),[20,20,30],'2026-01-02',rows).percentile-200/3)<1e-10);
  assert.equal(pairedPeReading(rows,sorted,'2004-01-01',[{date:'2004-01-01',pe:8}]).percentile,null);
});

test('gauge marker is clamped, accessible and absent for unavailable readings', () => {
  assert.equal(percentileGauge(null),'');
  assert.equal(percentileGauge(NaN),'');
  assert.match(percentileGauge(33.72),/left:33.72%/);
  assert.match(percentileGauge(120),/left:100%/);
  assert.match(percentileGauge(-10),/left:0%/);
  assert.match(percentileGauge(79),/aria-label=/);
});
