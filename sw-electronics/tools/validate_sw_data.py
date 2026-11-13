"""Validate published SW source, all quarterly values and finance checksums.

Optional: --project2 PATH also checks every published project2 percentile point.
"""
import argparse
import csv
import json
import math
from pathlib import Path
import sys
sys.dont_write_bytecode = True
from align_sw_data import SITE, finance_hash, positive, read


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project2', type=Path)
    args = parser.parse_args()
    project = read(args.project2 / 'outputs/sector_real_data.json') if args.project2 else None
    percentile_checks, quarter_checks = 0, 0
    for folder in ['', 'bank']:
        root = SITE / folder
        data, sectors, source = [read(root / filename) for filename in ['data.json', 'sectors.json', 'sw-source.json']]
        audit = read(root / 'sw-alignment-audit.json')
        assert finance_hash(data['series']) == audit['financialHash']
        for obj, code in [(data, data['meta']['indexCode'])] + [(g, g['code']) for g in sectors['groups']]:
            rows = source['indices'][code]['rows']
            by_date = {r['trade_date']: r for r in rows}
            assert len(by_date) == len(rows), 'Duplicate date'
            assert list(by_date) == sorted(by_date), 'Unsorted source'
            assert obj['valuationDaily'] == [[r['trade_date'], r['pe']] for r in rows]
            for quarter in obj['series']:
                src = by_date.get(quarter['tradeDate'])
                cap, pe = (src.get('total_mv'), src.get('pe')) if src else (None, None)
                assert quarter['marketCap'] == (cap / 10000 if positive(cap) else None)
                assert quarter['pe'] == (pe if positive(pe) else None)
                assert quarter['peRaw'] == pe
                assert not {'peProfit', 'peMarketCap', 'peCoverage'} & quarter.keys()
                quarter_checks += 1
            if project:
                assert source['project2AsOf'] == project['asOf']
                name = source['indices'][code]['name']
                for interval, period in project['metrics'][name]['periods'].items():
                    if period is None:
                        continue
                    values = [r['pe'] for r in rows if r['trade_date'] >= project['periodStarts'][interval] and positive(r['pe'])]
                    for date, rank in zip(period['dates'], period['pePercentileSeries']):
                        pe = by_date[date]['pe']
                        result = round(100 * sum(v <= pe for v in values) / len(values)) if positive(pe) and values else None
                        assert result == rank, (code, interval, date)
                        percentile_checks += 1
        for i, quarter in enumerate(data['series']):
            for metric in ['revenue', 'profit']:
                assert math.isclose(sum(g['series'][i][metric] or 0 for g in sectors['groups']), quarter[metric] or 0, abs_tol=1e-6)
        for row, serialized in zip(data['series'], csv.DictReader((root / 'quarterly.csv').open(encoding='utf-8-sig'))):
            for key in ['marketCap', 'pe']:
                assert (float(serialized[key]) if serialized[key] else None) == row[key]
        for file, expected in [('data.js', data), ('sectors.js', sectors)]:
            assert json.loads((root / file).read_text().split('=', 1)[1].rstrip(';')) == expected
    catalog = read(SITE / 'catalog.json')
    for item in catalog['industries']:
        if item['key'] in ['electronics', 'bank']:
            assert item['latest'] == read(SITE / item['path'] / 'data.json')['series'][-1]
    print(f'PASS {quarter_checks} index-quarter records; financial checksums, sector totals, CSV/JS/catalog; {percentile_checks} project2 percentile points')


if __name__ == '__main__':
    main()
