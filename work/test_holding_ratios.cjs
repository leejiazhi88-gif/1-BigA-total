const test = require('node:test');
const assert = require('node:assert/strict');
const { stockRatio, attachHoldingRatios } = require('./holding_ratios');
const { buildDirectData, attachSocialData } = require('./national_team_direct_holdings');

test('multiple accounts share one stock denominator and uniform prices cancel', () => {
  const rows = [{code:'600000.SH',units:100,close:10,amount:0.00001},
    {code:'600000.SH',units:200,close:10,amount:0.00002}];
  const capital = {'600000.SH':{shares:1000}};
  const result = stockRatio(rows, capital);
  assert(Math.abs(result.ratio - 30) < 1e-8);
  assert.equal(result.count, 1);
  const doubled = stockRatio(rows.map(r=>({...r,close:r.close*2,amount:r.amount*2})), capital);
  assert.equal(result.ratio, doubled.ratio);
  assert.equal(result.details[0].ownershipPct, 10);
  assert.throws(()=>stockRatio(rows,{}),/Missing A-share denominator/);
  assert.throws(()=>stockRatio(rows,{'600000.SH':{shares:250}}),/exceed/);
});

test('ratios use sums of amounts, not a simple mean of company percentages', () => {
  const rows=[{code:'A',units:10,close:10,amount:0.000001},{code:'B',units:800,close:10,amount:0.00008}];
  const result=stockRatio(rows,{A:{shares:100},B:{shares:1000}});
  assert(Math.abs(result.ratio-810/1100*100)<1e-8);
  assert.notEqual(result.ratio,45);
});

test('audited history preserves amounts, ETF gaps, social independence and account totals', () => {
  const base=attachSocialData(buildDirectData(require('../outputs/national-team-holdings-comparison-20261026.json'),
    require('./national_team_etf_history.json'),require('./national_team_stock_history.json')),require('./social_security_history.json'));
  const result=attachHoldingRatios(base,require('./holding_denominators.json'));
  assert.equal(result.snapshots.length,45);
  for(const [i,row] of result.snapshots.entries()) {
    for(const key of ['stockAmount','etfAmount','socialAmount','combinedAmount']) assert.equal(row[key],base.snapshots[i][key]);
    for(const key of ['stockAmount','socialAmount']) assert(row.ratios[key]>0&&row.ratios[key]<=100);
    assert(Math.abs(row.ratios.stockAmount-row.ratios.huijinAmount-row.ratios.otherAmount)<1e-8);
    assert.equal(row.etfAmount===null,row.ratios.etfAmount===null);
    assert.equal(row.ratioBases.stockAmount.count,row.companyCount);
    assert.equal(row.ratioBases.socialAmount.count,row.socialCompanyCount);
    assert.equal(row.ratios.combinedAmount,undefined);
  }
  const ccb=result.snapshots.find(r=>r.period==='20251231').stocks.find(r=>r.code==='601939.SH');
  assert.equal(ccb.totalUnits,21183061579);
});
