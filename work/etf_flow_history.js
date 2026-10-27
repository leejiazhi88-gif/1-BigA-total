function flowWindow(series, range) {
  if (range === "all") return series;
  if (range.endsWith("d")) return series.slice(-Number(range.slice(0, -1)));
  const cutoff = new Date(series.at(-1).date + "T00:00:00Z");
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - Number(range.slice(0, -1)));
  return series.filter(row => row.date >= cutoff.toISOString().slice(0, 10));
}

function summarizeFlows(rows, funds) {
  let running = 0, seen = 0, missing = 0;
  const details = funds.map(fund => ({ ...fund, knownTotal: null, validDays: 0, eligibleDays: 0, first: null, last: null }));
  const points = rows.map(row => {
    let known = 0, coverage = 0, eligible = 0;
    const unavailable = [], corrections = [];
    for (const fund of details) {
      const code = fund.ts_code;
      if (row.issues[code] === "not_listed") continue;
      eligible++;
      fund.eligibleDays++;
      const value = row.flows[code];
      if (Number.isFinite(value)) {
        known += value;
        coverage++;
        fund.knownTotal = (fund.knownTotal ?? 0) + value;
        fund.validDays++;
        fund.first ??= row.date;
        fund.last = row.date;
      } else {
        unavailable.push(fund.name);
      }
      if (row.adjusted?.includes(code)) corrections.push(fund.name);
    }
    running += known;
    seen += coverage;
    missing += eligible - coverage;
    const complete = eligible > 0 && coverage === eligible;
    return { date: row.date, coverage, eligible, unavailable, corrections, complete,
      total: complete ? known : null, known: coverage ? known : null,
      cumulative: complete ? running : null, knownCumulative: seen ? running : null, missingSoFar: missing };
  });
  return { points, details, knownTotal: seen ? running : null, missing,
    completeDays: points.filter(row => row.complete).length,
    eligibleDays: points.filter(row => row.eligible > 0).length,
    missingDates: points.filter(row => row.coverage < row.eligible).map(row => row.date) };
}

function validateFlowHistory(data) {
  if (!data.series?.length || !data.etfs?.length) throw new Error("Empty ETF flow history");
  if (new Set(data.etfs.map(f => f.ts_code)).size !== data.etfs.length) throw new Error("Duplicate ETF flow fund");
  for (let i = 0; i < data.series.length; i++) {
    const row = data.series[i];
    if (i && row.date <= data.series[i - 1].date) throw new Error("Unordered ETF flow dates");
    for (const fund of data.etfs) {
      const value = row.flows[fund.ts_code], issue = row.issues[fund.ts_code];
      const beforeListing = row.date.replaceAll("-", "") < fund.list_date;
      if (!(value === null || Number.isFinite(value)) || (value === null) !== Boolean(issue) ||
          beforeListing !== (issue === "not_listed")) throw new Error("Invalid ETF flow coverage: " + fund.ts_code + " " + row.date);
    }
    const point = summarizeFlows([row], data.etfs).points[0];
    if (point.coverage !== row.coverage || point.eligible !== row.eligible ||
        (point.total === null) !== (row.total === null) || (point.total !== null && Math.abs(point.total - row.total) > 0.00001)) {
      throw new Error("Inconsistent ETF flow total: " + row.date);
    }
  }
}

module.exports = { flowWindow, summarizeFlows, validateFlowHistory };
