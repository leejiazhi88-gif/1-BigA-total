const test = require("node:test");
const assert = require("node:assert/strict");
const audit = require("../outputs/national-team-holdings-comparison-20261026.json");
const historyAudit = require("./national_team_etf_history.json");
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

test("main chart combines audited ETF history with only the verified stock snapshots", () => {
  const rows = buildDirectData(audit, historyAudit).snapshots;
  assert.equal(rows.length, 23);
  assert.equal(rows[0].period, "20150630");
  assert.equal(rows.at(-1).period, "20260630");
  assert.equal(rows.filter(r => Number.isFinite(r.etfAmount)).length, 22);
  assert.equal(rows.filter(r => Number.isFinite(r.stockAmount)).length, 2);
  assert.equal(rows[0].etfs.length, 8);
  assert(Math.abs(rows[0].etfAmount - 67.006687745955) < 1e-8);
  for (const row of rows.slice(0, -2)) {
    assert.equal(row.stockStatus, "not_backfilled");
    for (const key of ["stockAmount", "huijinAmount", "otherAmount", "combinedAmount", "companyCount", "holderCount"]) {
      assert.equal(row[key], null, key + " must not imply an earlier stock observation");
    }
    assert.deepEqual(row.stocks, []);
  }
  for (const old of buildDirectData(audit).snapshots) {
    const merged = rows.find(r => r.period === old.period);
    assert.equal(merged.stockStatus, "verified");
    for (const key of ["stockAmount", "huijinAmount", "otherAmount", "companyCount", "holderCount"]) {
      assert.equal(merged[key], old[key]);
    }
    assert.deepEqual(merged.stocks, old.stocks);
    assert.equal(merged.etfAmount === null, old.etfAmount === null);
    if (old.etfAmount !== null) assert(Math.abs(merged.etfAmount - old.etfAmount) < 1e-8);
  }
  assert.equal(rows.at(-1).combinedAmount, null);
  assert.equal(rows.at(-1).disclosedFunds, 0);
});

test("history cannot override an independently audited overlapping snapshot", () => {
  const wrongAmount = structuredClone(historyAudit);
  const changed = wrongAmount.reports.find(r => r.period === "20251231" && r.kind === "annual" && r.status === "identified");
  changed.nav += 0.1;
  changed.value_yi = changed.units * changed.nav / 1e8;
  assert.throws(() => buildDirectData(audit, wrongAmount), /amount mismatch: ETF history 20251231/);
  const missingTable = structuredClone(historyAudit);
  missingTable.reports.find(r => r.period === "20251231" && r.kind === "annual").table_disclosed = false;
  assert.throws(() => buildDirectData(audit, missingTable), /ETF history disclosure mismatch/);
});
