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

function attachHoldingRatios(data, audit) {
  if (audit.failures.length) throw new Error("Unresolved holding denominator audit");
  return { ...data, ratioCheckedAt: audit.checkedAt, snapshots: data.snapshots.map(row => {
    const stock = stockRatio(row.stocks, audit.stocks[row.period]);
    const social = stockRatio(row.social, audit.stocks[row.period]);
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
      ratios: { stockAmount: ratio(row.stockAmount, stock.denominator),
        etfAmount: ratio(row.etfAmount, fundDenominator), socialAmount: ratio(row.socialAmount, social.denominator),
        huijinAmount: ratio(row.huijinAmount, stock.denominator), otherAmount: ratio(row.otherAmount, stock.denominator) },
      ratioBases: { stockAmount: { amount: stock.denominator, count: stock.count },
        etfAmount: { amount: fundDenominator || null, count: fundCount },
        socialAmount: { amount: social.denominator, count: social.count } } };
  }) };
}

module.exports = { stockRatio, attachHoldingRatios };
