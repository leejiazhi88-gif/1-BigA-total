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
  const market=require('./a_share_market_cap.json');
  const result=attachHoldingRatios(base,require('./holding_denominators.json'),market);
  assert.equal(result.snapshots.length,45);
  for(const [i,row] of result.snapshots.entries()) {
    for(const key of ['stockAmount','etfAmount','socialAmount','combinedAmount']) assert.equal(row[key],base.snapshots[i][key]);
    for(const key of ['stockAmount','socialAmount']) assert(row.ratios[key]>0&&row.ratios[key]<=100);
    assert(Math.abs(row.ratios.stockAmount-row.ratios.huijinAmount-row.ratios.otherAmount)<1e-8);
    assert.equal(row.etfAmount===null,row.ratios.etfAmount===null);
    assert.deepEqual(row.ratioBases.stockAmount,row.ratioBases.socialAmount);
    assert.equal(row.ratioBases.stockAmount.amount,market.periods[row.period].amount);
    assert.equal(row.ratioBases.stockAmount.count,market.periods[row.period].count);
    assert.equal(row.ratios.stockAmount,row.stockAmount/market.periods[row.period].amount*100);
    assert.equal(row.ratios.socialAmount,row.socialAmount/market.periods[row.period].amount*100);
    assert.equal(row.ratios.etfAmount,row.etfAmount===null?null:row.etfAmount/row.ratioBases.etfAmount.amount*100);
    assert.equal(row.ratios.combinedAmount,undefined);
  }
  const ccb=result.snapshots.find(r=>r.period==='20251231').stocks.find(r=>r.code==='601939.SH');
  assert.equal(ccb.totalUnits,21183061579);
});

test('market denominator is independent of held companies and applies to both A-share curves', () => {
  const a={code:'A',units:10,close:10,amount:0.000001};
  const b={code:'B',units:10,close:10,amount:0.000001};
  const fixture=stocks=>({snapshots:[{period:'20260630',stocks,social:[b],etfs:[],
    stockAmount:0.000002,socialAmount:0.000001,huijinAmount:0.000001,otherAmount:0.000001,etfAmount:null}]});
  const audit={failures:[],stocks:{20260630:{A:{shares:100},B:{shares:1000}}},funds:{}};
  const market={unit:'亿元',failures:[],periods:{20260630:{period:'20260630',date:'20260630',amount:1,count:5000}}};
  const one=attachHoldingRatios(fixture([{...a,units:20,amount:0.000002}]),audit,market).snapshots[0];
  const two=attachHoldingRatios(fixture([a,b]),audit,market).snapshots[0];
  assert.equal(one.ratios.stockAmount,two.ratios.stockAmount);
  assert(Math.abs(two.ratios.stockAmount-0.0002)<1e-12);
  assert(Math.abs(two.ratios.socialAmount-0.0001)<1e-12);
  assert.equal(two.stocks[0].ownershipPct,10);
  assert.equal(two.stocks[1].ownershipPct,1);
  const doubled={...market,periods:{20260630:{...market.periods[20260630],amount:2}}};
  assert(Math.abs(attachHoldingRatios(fixture([a,b]),audit,doubled).snapshots[0].ratios.stockAmount-0.0001)<1e-12);
  for(const bad of [undefined,{...market,periods:{}},
    {...market,periods:{20260630:{...market.periods[20260630],date:'20260701'}}}]) {
    assert.throws(()=>attachHoldingRatios(fixture([a,b]),audit,bad),/market denominator/);
  }
});
