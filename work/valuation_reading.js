function percentileColor(value) {
  if (!Number.isFinite(value)) return 'var(--text)';
  const colors = ['#319a82', '#8ebd77', '#c2bd77', '#d9ac58', '#c65d76'];
  return colors[Math.min(4, Math.floor(Math.max(0, Math.min(100, value)) / 20))];
}

function percentileGauge(value) {
  if (!Number.isFinite(value)) return '';
  const position = Math.max(0, Math.min(100, value));
  return '<span class="valuation-gauge" role="img" aria-label="历史分位 ' + position.toFixed(2) + '%"><i style="left:' + position + '%"></i></span>';
}

function pairedPeReading(rows, sorted, date, fallbackRows) {
  const row = date ? rows.find(row => row.date === date) : rows.at(-1);
  const fallback = date ? fallbackRows.find(row => row.date === date) : fallbackRows.at(-1);
  const point = row || fallback;
  let low = 0, high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] <= row?.pe) low = mid + 1; else high = mid;
  }
  return { date: point?.date, pe: point?.pe,
    percentile: row && sorted.length ? low / sorted.length * 100 : null };
}
module.exports = { percentileGauge, pairedPeReading, percentileColor };
