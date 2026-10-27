function stockRatio(rows, capital) {
  if (!rows.length) return { ratio: null, denominator: null, count: 0, details: [] };
  const companies = new Map();
  const details = rows.map(row => {
    const source = capital?.[row.code];
    if (!(source?.shares > 0) || !Number.isFinite(source.shares)) throw new Error("Missing A-share denominator: " + row.code);
    if (!(row.units > 0) || !(row.close > 0) || !Number.isFinite(row.amount) ||
        Math.abs(row.units * row.close / 1e8 - row.amount) > 0.01) throw new Error("Invalid ratio numerator: " + row.code);
    const previous = companies.get(row.code);
    if (previous && previous.close !== row.close) throw new Error("Mixed period prices: " + row.code);
    const ownedUnits = (previous?.ownedUnits || 0) + row.units;
    if (ownedUnits > source.shares + 1) throw new Error("Owned A shares exceed total A shares: " + row.code);
    companies.set(row.code, { close: row.close, totalUnits: source.shares, ownedUnits });
    return { ...row, totalUnits: source.shares, ownershipPct: row.units / source.shares * 100 };
  });
  const denominator = [...companies.values()].reduce((sum, row) => sum + row.totalUnits * row.close / 1e8, 0);
  const amount = rows.reduce((sum, row) => sum + row.amount, 0);
  return { ratio: amount / denominator * 100, denominator, count: companies.size, details };
}

function attachHoldingRatios(data, audit, market) {
  if (audit.failures.length || market?.failures?.length) throw new Error("Unresolved holding denominator audit");
  if (market?.unit !== "亿元") throw new Error("Invalid market denominator unit");
  return { ...data, ratioCheckedAt: audit.checkedAt, marketCapCheckedAt: market.checkedAt, snapshots: data.snapshots.map(row => {
    const stock = stockRatio(row.stocks, audit.stocks[row.period]);
    const social = stockRatio(row.social, audit.stocks[row.period]);
    const allA = market?.periods?.[row.period];
    if (!allA || allA.period !== row.period || !/^[0-9]{8}$/.test(allA.date) ||
        allA.date > row.period || allA.date.slice(0, 6) !== row.period.slice(0, 6) ||
        !Number.isFinite(allA.amount) || !(allA.amount > 0) || !Number.isInteger(allA.count) || allA.count <= 0 ||
        [row.stockAmount, row.socialAmount].some(amount => amount !== null && amount > allA.amount)) {
      throw new Error("Missing or invalid all-A-share market denominator: " + row.period);
    }
    const stockBase = { amount: allA.amount, count: allA.count, date: allA.date, scope: "all_a_shares" };
    let fundDenominator = 0, fundCount = 0;
    const funds = new Set();
    const etfs = row.etfs.map(fund => {
      if (fund.amount === null) return { ...fund, totalUnits: null, ownershipPct: null };
      const denominator = audit.funds[fund.code + ":" + row.period];
      if (funds.has(fund.code)) throw new Error("Duplicate ETF in ratio basket");
      funds.add(fund.code);
      if (!denominator || denominator.period !== row.period || !(denominator.units > 0) ||
          fund.units > denominator.units || Math.abs(denominator.nav - fund.nav) > 1e-8 ||
          Math.abs(denominator.amount - denominator.units * fund.nav / 1e8) > 0.01) throw new Error("Invalid ETF denominator: " + fund.code);
      fundDenominator += denominator.amount;
      fundCount++;
      return { ...fund, totalUnits: denominator.units, ownershipPct: fund.units / denominator.units * 100 };
    });
    const ratio = (amount, denominator) => amount === null || !denominator ? null : amount / denominator * 100;
    return { ...row, stocks: stock.details, social: social.details, etfs,
      ratios: { stockAmount: ratio(row.stockAmount, allA.amount),
        etfAmount: ratio(row.etfAmount, fundDenominator), socialAmount: ratio(row.socialAmount, allA.amount),
        huijinAmount: ratio(row.huijinAmount, allA.amount), otherAmount: ratio(row.otherAmount, allA.amount) },
      ratioBases: { stockAmount: stockBase,
        etfAmount: { amount: fundDenominator || null, count: fundCount },
        socialAmount: stockBase } };
  }) };
}

module.exports = { stockRatio, attachHoldingRatios };
