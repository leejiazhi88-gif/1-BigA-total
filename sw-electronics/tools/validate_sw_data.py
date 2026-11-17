"""Validate published SW source, all quarterly values and finance checksums.

Optional: --project2 PATH also checks every published project2 percentile point.
"""
import argparse
import csv
import json
import math
import hashlib
from collections import defaultdict
from bisect import bisect_right
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
    catalog = read(SITE / 'catalog.json')
    assert len(catalog['industries']) == 31
    assert sum(x['subIndustryCount'] for x in catalog['industries']) == 134
    for item in catalog['industries']:
        root = SITE / item['path']
        data, sectors, source = [read(root / filename) for filename in ['data.json', 'sectors.json', 'sw-source.json']]
        audit = read(root / 'sw-alignment-audit.json')
        supplement = read(root / 'latest-quotes-source.json') if (root / 'latest-quotes-source.json').exists() else None
        assert finance_hash(data['series']) == audit['financialHash']
        assert data['meta']['valuationMethod'] == item['valuationSource'] == 'sw_daily'
        assert len(sectors['groups']) == item['subIndustryCount']
        assert {g['code']: finance_hash(g['series']) for g in sectors['groups']} == audit['sectorFinancialHashes']
        if project:
            assert {g['name'] for g in sectors['groups']} == set(project['industries'][item['name']])
        for obj, code in [(data, data['meta']['indexCode'])] + [(g, g['code']) for g in sectors['groups']]:
            rows = source['indices'][code]['rows']
            by_date = {r['trade_date']: r for r in rows}
            assert len(by_date) == len(rows), 'Duplicate date'
            assert list(by_date) == sorted(by_date), 'Unsorted source'
            assert obj['valuationDaily'] == [[r['trade_date'], r['pe']] for r in rows]
            if supplement:
                recent = supplement['indices'][code]['rows']
                assert all(r['ts_code'] == code and r['trade_date'] > source['project2AsOf'] for r in recent)
                assert len({r['trade_date'] for r in recent}) == len(recent)
                assert obj['valuationRecent'] == [[r['trade_date'], r['pe']] for r in recent]
                latest = obj['latestQuote']
                raw = next((r for r in recent if r['trade_date'] == latest['date']), None)
                cap, pe = (raw['total_mv'], raw['pe']) if raw else (None, None)
                assert latest['marketCap'] == (cap / 10000 if positive(cap) else None)
                assert latest['pe'] == (pe if positive(pe) else None) and latest['peRaw'] == pe
                assert latest['financialQuarter'] == obj['series'][-1]['quarter']
                assert latest['date'] > obj['series'][-1]['endDate']
            for quarter in obj['series']:
                src = by_date.get(quarter['tradeDate'])
                cap, pe = (src.get('total_mv'), src.get('pe')) if src else (None, None)
                assert quarter['marketCap'] == (cap / 10000 if positive(cap) else None)
                assert quarter['pe'] == (pe if positive(pe) else None)
                assert quarter['peRaw'] == pe
                assert not {'peProfit', 'peMarketCap', 'peCoverage'} & quarter.keys()
                quarter_checks += 1
            if project:
                assert source['project2AsOf'] <= project['asOf']
                comparison_rows=rows+(supplement['indices'][code]['rows'] if supplement else [])
                comparison_by_date={r['trade_date']:r for r in comparison_rows}
                assert len(comparison_by_date)==len(comparison_rows)
                latest=project['metrics'][source['indices'][code]['name']]['latest']
                if latest['date'] is not None:
                    raw=comparison_by_date[latest['date']]
                    assert (round(raw['total_mv'],2) if raw['total_mv'] is not None else None)==latest['totalMv']
                    assert (round(raw['pe'],2) if raw['pe'] is not None else None)==latest['pe']
                name = source['indices'][code]['name']
                for interval, period in project['metrics'][name]['periods'].items():
                    if period is None:
                        continue
                    values = sorted(r['pe'] for r in comparison_rows if project['periodStarts'][interval] <= r['trade_date'] <= project['asOf'] and positive(r['pe']))
                    for date, rank in zip(period['dates'], period['pePercentileSeries']):
                        pe = comparison_by_date.get(date, {}).get('pe')
                        result = round(bisect_right(values, pe) / len(values) * 100) if positive(pe) and values else None
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
    for item in catalog['industries']:
        data = read(SITE / item['path'] / 'data.json')
        main_payload = read(SITE / item['path'] / 'main.json')
        companies = read(SITE / item['path'] / 'companies.json')
        assert {**main_payload, 'latestCompanies': data['latestCompanies']} == data, '主图数据与原始数据不一致'
        assert companies['schema']==2
        records=[dict(zip(companies['fields'],row)) for row in companies['rows']]
        assert len(records)==len(data['latestCompanies'])
        window=[p['quarter'] for p in data['series'][-4:]]
        assert companies['financialWindow']==dict(quarters=window,fields=['revenue','profit','availableQuarters','estimatedQuarters','missingQuarters'])
        financial_rows=defaultdict(dict)
        with (SITE/item['path']/'company-quarterly.csv').open(encoding='utf-8-sig') as stream:
            for row in csv.DictReader(stream):
                if row['quarter'] in window:
                    assert row['quarter'] not in financial_rows[row['code']], '重复财务季度'
                    financial_rows[row['code']][row['quarter']]=row
        groups=read(SITE/item['path']/'sectors.json')['groups']
        ordered=sorted(groups,key=lambda g:g['latestQuote']['marketCap'] or 0,reverse=True)
        assert companies['groups']==[[g['code'],g['name'],g['latestQuote']['marketCap']] for g in ordered]
        for projected,original in zip(records,data['latestCompanies']):
            assert all(projected[k]==original.get(k) for k in companies['fields'] if k not in ['sector','valuation','rollingFinancials']), '公司展示字段变动'
            assert original['code'] in ordered[projected['sector']]['codes'], '公司归属变动'
            history=financial_rows[original['code']]
            used=[history[q] for q in window if q in history]
            missing=sum(r['status'] not in ['reported','estimated'] or any(r[k]=='' or not math.isfinite(float(r[k])) for k in ['revenue','profit']) for r in used)
            actual=projected['rollingFinancials']
            assert actual[2:]==[len(used),sum(r['status']=='estimated' for r in used),missing]
            for i,key in enumerate(['revenue','profit']):
                if len(used)<4 or missing:
                    assert actual[i] is None, '不足四季或缺值不得伪装完整合计'
                else:
                    assert math.isclose(actual[i],sum(float(r[key]) for r in used),rel_tol=1e-12,abs_tol=1e-8), '公司近4季财务与原始季度记录不符'
        for name,version in item['payloadVersions'].items():
            assert hashlib.sha256((SITE/item['path']/name).read_bytes()).hexdigest()[:16]==version, '缓存版本不符'
        assert item['latest'] == data['series'][-1]
        if 'latestObservation' in item:
            assert item['latestObservation'] == data['latestQuote']
    caps = [x.get('latestObservation', x['latest'])['marketCap'] or 0 for x in catalog['industries']]
    assert caps == sorted(caps, reverse=True)
    assert json.loads((SITE / 'catalog.js').read_text().split('=', 1)[1].rstrip(';')) == catalog
    print(f'PASS {quarter_checks} index-quarter records; financial checksums, sector totals, CSV/JS/catalog; {percentile_checks} project2 percentile points')


if __name__ == '__main__':
    main()
