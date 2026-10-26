const test = require("node:test");
const assert = require("node:assert/strict");
const audit = require("../outputs/national-team-holdings-comparison-20261026.json");
const { buildDirectData } = require("./national_team_direct_holdings");

test("2025 annual comparison uses the same period and excludes CCB H shares", () => {
  const row = buildDirectData(audit).snapshots[0];
  assert.equal(row.date, "2025-12-31");
  assert.equal(Math.round(row.stockAmount), 41581);
  assert.equal(Math.round(row.etfAmount), 14749);
  assert.equal(Math.round(row.combinedAmount), 56330);
  assert.equal(row.companyCount, 220);
  assert.equal(row.holderCount, 265);
  const ccb = row.stocks.find(r => r.code === "601939.SH" && r.holder === "中央汇金投资有限责任公司");
  assert.equal(ccb.units, 267392944);
  assert.equal(ccb.amount.toFixed(2), "24.81");
  assert.equal(row.huijinAmount + row.otherAmount, row.stockAmount);
});

test("missing named ETF disclosures remain null and cannot be added to stocks", () => {
  const row = buildDirectData(audit).snapshots[1];
  assert.equal(row.companyCount, 35);
  assert.equal(row.holderCount, 48);
  assert.equal(row.etfAmount, null);
  assert.equal(row.combinedAmount, null);
  assert.equal(row.disclosedFunds, 0);
  assert.equal(row.identifiedFunds, 0);
  assert.equal(row.etfs.length, 14);
  assert(row.etfs.every(r => r.amount === null && r.units === null));
});

test("not appearing in a disclosed ETF top ten does not become a zero holding", () => {
  const row = buildDirectData(audit).snapshots[0];
  assert.equal(row.disclosedFunds, 14);
  assert.equal(row.identifiedFunds, 12);
  for (const code of ["510580", "588000"]) {
    const fund = row.etfs.find(r => r.code === code);
    assert.equal(fund.amount, null);
    assert.equal(fund.units, null);
    assert.equal(fund.status, "no_identified_account_in_top10");
  }
});

test("inconsistent stock share amounts and reporting dates fail the build", () => {
  const wrongUnits = structuredClone(audit);
  wrongUnits.stocks["20251231"].details[0].a_share_amount += 1e8;
  assert.throws(() => buildDirectData(wrongUnits), /amount mismatch/);
  const wrongPeriod = structuredClone(audit);
  wrongPeriod.stocks["20251231"].details[0].end_date = "20260630";
  assert.throws(() => buildDirectData(wrongPeriod), /Mixed stock reporting periods/);
});

test("a source missing coverage cannot silently produce a partial ETF total", () => {
  const missingReport = structuredClone(audit);
  missingReport.etfs_20251231.rows[0].status = "named_holder_table_not_disclosed";
  assert.throws(() => buildDirectData(missingReport), /ETF total/);
  const missingPeriod = structuredClone(audit);
  delete missingPeriod.etfs_20260630;
  assert.throws(() => buildDirectData(missingPeriod), /Missing ETF disclosure status/);
});
