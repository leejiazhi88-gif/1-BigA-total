function buildShareStocks(data) {
  const histories = Object.fromEntries(data.etfs.map(fund => {
    const byDate = new Map();
    for (const row of data.observations[fund.ts_code] || []) {
      if (!Number.isFinite(row.total_share) || row.total_share < 0) continue;
      if (byDate.has(row.trade_date) && byDate.get(row.trade_date) !== row.total_share) throw new Error('Conflicting ETF shares');
      byDate.set(row.trade_date, row.total_share);
    }
    return [fund.ts_code, [...byDate].sort(([a], [b]) => a.localeCompare(b))];
  }));
  const pointers = Object.fromEntries(data.etfs.map(fund => [fund.ts_code, -1]));
  const iso = date => date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6);
  return data.series.map(point => {
    const date = point.date.replace(/-/g, '');
    const shares = {}, dates = {};
    for (const fund of data.etfs) {
      if (date < fund.list_date) continue;
      const rows = histories[fund.ts_code];
      let i = pointers[fund.ts_code];
      while (i + 1 < rows.length && rows[i + 1][0] <= date) i++;
      pointers[fund.ts_code] = i;
      const source = rows[i];
      const age = source ? (Date.parse(point.date + 'T00:00:00Z') - Date.parse(iso(source[0]) + 'T00:00:00Z')) / 86400000 : Infinity;
      shares[fund.ts_code] = age <= 15 ? source[1] / 10000 : null;
      dates[fund.ts_code] = age <= 15 ? iso(source[0]) : null;
    }
    return { date: point.date, shares, dates };
  });
}

function sumShareStocks(rows, funds) {
  return rows.map(row => {
    const eligible = funds.filter(fund => Object.hasOwn(row.shares, fund.ts_code));
    const missing = eligible.filter(fund => !Number.isFinite(row.shares[fund.ts_code]));
    return { ...row, total: eligible.length && !missing.length ? eligible.reduce((sum, fund) => sum + row.shares[fund.ts_code], 0) : null,
      coverage: eligible.length - missing.length, eligible: eligible.length, missing: missing.map(fund => fund.ts_code) };
  });
}
function centerZeroAxis(axis) {
  const bound = Math.max(Math.abs(axis.min), Math.abs(axis.max), 1);
  return { ...axis, min: -bound, max: bound, interval: bound / 4 };
}
module.exports = { buildShareStocks, sumShareStocks, centerZeroAxis };
