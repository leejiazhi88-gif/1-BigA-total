const test = require("node:test");
const assert = require("node:assert/strict");
const { buildHistoryData } = require("./national_team_etf_history");
const audit = require("./national_team_etf_history.json");

test("all history reports retain source dates, values and disclosure gaps", () => {
  const data = buildHistoryData(audit);
  assert.equal(data.periods[0], "20150630");
  assert(data.reports.length > 600);
  assert(data.reports.every(r => r.source.startsWith("https://fund.eastmoney.com/gonggao/")));
  assert(data.reports.filter(r => r.status !== "identified").every(r => r.amount === null && r.units === null));
});

test("inconsistent amounts, duplicate reports and unfinished audits block the build", () => {
  const changed = structuredClone(audit);
  changed.reports.find(r => r.status === "identified").value_yi += 1;
  assert.throws(() => buildHistoryData(changed), /amount mismatch/);
  const duplicate = structuredClone(audit);
  duplicate.reports.push(duplicate.reports[0]);
  assert.throws(() => buildHistoryData(duplicate), /Duplicate/);
  const unfinished = structuredClone(audit);
  unfinished.failures.push({ code: "510300" });
  assert.throws(() => buildHistoryData(unfinished), /Unresolved/);
});
