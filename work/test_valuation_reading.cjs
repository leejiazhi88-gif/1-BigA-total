const test = require('node:test');
const assert = require('node:assert/strict');
const { percentileGauge, pairedPeReading } = require('./valuation_reading');

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
