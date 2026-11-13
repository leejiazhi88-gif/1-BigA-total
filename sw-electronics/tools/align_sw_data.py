"""Align every industry valuation with project 2's exact SW2021 snapshot.

Usage: python3 tools/align_sw_data.py --project2 PATH --early-source PATH
Reads only project 2; writes this site's 31 modules, catalog and audit metadata.
No credentials are read or persisted. 2005 supplement is an API response by code.
Subsequent runs may reuse the published sw-source.json without --project2.
"""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path

SITE = Path(__file__).resolve().parents[1]
FIELDS = 'ts_code,trade_date,name,close,pe,pb,total_mv,float_mv,amount,vol,pct_change'
SOURCE_URL = 'https://leejiazhi88-gif.github.io/2-BigAtotal2/'
FINANCE_KEYS = ['quarter', 'companies', 'revenue', 'profit', 'reportedCount', 'estimatedCount',
                'missingCount', 'estimatedRevenue', 'estimatedProfit', 'financialCoverage']


def read(path):
    return json.loads(path.read_text())


def write(path, value):
    pretty = 'audit' in path.name or 'manifest' in path.name
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2 if pretty else None,
                               separators=None if pretty else (',', ':'), allow_nan=False))


def positive(value):
    return isinstance(value, (int, float)) and math.isfinite(value) and value > 0


def finance_hash(series):
    value = [{k: row.get(k) for k in FINANCE_KEYS} for row in series]
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def source_for(project2, code, end, early):
    by_date = {}
    requests = []
    for start, stop in [('20060101', '20151231'), ('20160101', '20251231'), ('20260101', end)]:
        params = dict(ts_code=code, start_date=start, end_date=stop)
        key = hashlib.sha256(json.dumps(['sw_daily', params, FIELDS], sort_keys=True).encode()).hexdigest()
        # Match the snapshot date; newer cache days can contain revised histories.
        path = project2 / 'work/.tushare-cache' / end / (key + '.json')
        rows = read(path)
        assert len(rows) < 4000, f'Truncated source {code} {start}'
        requests.append({'api': 'sw_daily', 'params': params, 'fields': FIELDS.split(','),
                         'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'rows': len(rows)})
        for row in rows:
            assert row['ts_code'] == code and start <= row['trade_date'] <= stop
            if row['trade_date'] in by_date:
                assert by_date[row['trade_date']] == row, 'Conflicting source rows'
            by_date[row['trade_date']] = row
    if code in early:
        rows = early[code]
        for row in rows:
            assert row['ts_code'] == code and '20050101' <= row['trade_date'] <= '20051231'
            by_date[row['trade_date']] = row
        requests.append({'api': 'sw_daily', 'params': {'ts_code': code, 'start_date': '20050101',
                         'end_date': '20051231'}, 'rows': len(rows), 'retrievedOn': '2026-11-13'})
    return {'code': code, 'requests': requests, 'rows': sorted(by_date.values(), key=lambda r: r['trade_date'])}


def align_series(series, source):
    dates = {r['trade_date']: r for r in source['rows']}
    for row in series:
        # Require the same quarter-end trading date; do not silently carry an old index quote.
        official = dates.get(row['tradeDate'])
        cap = official.get('total_mv') if official else None
        pe = official.get('pe') if official else None
        row.update(marketCap=cap / 10000 if positive(cap) else None,
                   marketCapObserved=cap / 10000 if positive(cap) else None,
                   pe=pe if positive(pe) else None, peRaw=pe,
                   valuationSource='sw_daily', valuationCode=source['code'],
                   valuationDate=official['trade_date'] if official else None,
                   peStatus='valid' if positive(pe) else 'nonpositive' if pe is not None and pe <= 0 else 'source_missing',
                   peNote='' if positive(pe) else '申万公布PE非正' if pe is not None and pe <= 0 else '申万未提供该日PE')
        # sw_daily does not supply the numerator/denominator or constituent coverage of its PE.
        for key in ['peMarketCap', 'peProfit', 'peCoverage', 'peMissingCount', 'peRebuiltCount']:
            row.pop(key, None)
    return [[r['trade_date'], r.get('pe')] for r in source['rows']]


def empty_group(name, code, series):
    rows = []
    for original in series:
        rows.append(dict(quarter=original['quarter'], endDate=original['endDate'],
                         tradeDate=original['tradeDate'], companies=0, revenue=None, profit=None,
                         reportedCount=0, estimatedCount=0, missingCount=0, estimatedRevenue=0,
                         estimatedProfit=0, financialCoverage=None, carriedCount=0, marketMissingCount=0))
    return {'name': name, 'code': code, 'codes': [], 'universeCount': 0, 'series': rows, 'quality': []}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--project2', type=Path)
    parser.add_argument('--early-source', type=Path)
    args = parser.parse_args()
    project = read(args.project2 / 'outputs/sector_real_data.json') if args.project2 else None
    early = read(args.early_source) if args.early_source else {}
    catalog = read(SITE / 'catalog.json')
    audits = []
    for item in catalog['industries']:
        folder, name, code = item['path'], item['name'], item['code']
        root = SITE / folder
        data, sectors = read(root / 'data.json'), read(root / 'sectors.json')
        before = finance_hash(data['series'])
        sector_before = {g['code']: finance_hash(g['series']) for g in sectors['groups']}
        if project:
            definitions = [(name, code)] + [(n, project['codes'][n]) for n in project['industries'][name]]
            # A later import must not silently discard the earlier 2005 supplement.
            supplement = dict(early)
            if (root / 'sw-source.json').exists():
                for c, previous in read(root / 'sw-source.json')['indices'].items():
                    supplement.setdefault(c, [r for r in previous['rows'] if r['trade_date'] < '20060101'])
            sources = {c: source_for(args.project2, c, project['asOf'], supplement) for n, c in definitions}
            for n, c in definitions:
                sources[c]['name'] = n
            source = {'source': 'Tushare sw_daily / SW2021', 'project2AsOf': project['asOf'],
                      'project2URL': SOURCE_URL, 'classification': definitions,
                      'units': {'total_mv': '万元', 'pe': '倍'}, 'indices': sources}
            # Same-date published project 2 values are an independent snapshot check.
            for n, c in definitions:
                rows, latest = sources[c]['rows'], project['metrics'][n]['latest']
                if rows:
                    assert rows[-1]['trade_date'] == latest['date']
                    for field, published in [('pe', 'pe'), ('total_mv', 'totalMv')]:
                        value = rows[-1].get(field)
                        assert (round(value, 2) if value is not None else None) == latest[published]
                else:
                    assert latest['date'] is None and latest['pe'] is None and latest['totalMv'] is None
            write(root / 'sw-source.json', source)
        else:
            source = read(root / 'sw-source.json')
            definitions, sources = source['classification'], source['indices']
        for n, c in definitions[1:]:
            group = next((g for g in sectors['groups'] if g['code'] == c), None)
            if group is None:
                sectors['groups'].append(empty_group(n, c, data['series']))
            else:
                group['name'] = n
        assert {g['code'] for g in sectors['groups']} == {c for _, c in definitions[1:]}
        objects = [(data, code)] + [(g, g['code']) for g in sectors['groups']]
        for obj, c in objects:
            obj['valuationDaily'] = align_series(obj['series'], sources[c])
            obj['valuationSource'] = 'sw_daily'
            for quality, row in zip(obj.get('quality', []), obj['series']):
                quality['peMissing'] = []
                quality['valuationDate'] = row['valuationDate']
                quality['valuationSource'] = 'sw_daily'
        data['meta'].update(
            valuationMethod='sw_daily', valuationAsOf=source['project2AsOf'],
            valuationHistoryStart=sources[code]['rows'][0]['trade_date'] if sources[code]['rows'] else None,
            marketCapMethod='申万 sw_daily.total_mv（万元）÷10000；季度最后交易日公布值',
            peMethod='直接采用申万 sw_daily.pe 公布值；不使用公司市值和财报利润重新合成',
            percentileMethod='所选起始季度首日至结束季度末日的全部有效正日度PE；含相等值；与项目2同源同公式，日期范围需一致',
            source='Tushare sw_daily（申万行情） / index_member_all SW2021（财务样本） / income（财报）',
            universeType='行情为申万指数历史；财务为最新在市SW2021成分固定回溯，上市后纳入',
            quoteCarryMethod='申万季末行情不沿用旧值；公司明细保留此前有效报价并显示日期',
            companyMarketCapMethod='daily_basic.total_mv÷10000，全部普通股按A股价格估值，与项目2公司明细同字段；不等于申万行业市值分拆',
            financialVersusValuation='财务柱是全公司实际合并报表汇总，不是指数PE分母；不以公布市值÷PE反推真实利润',
            project2URL=SOURCE_URL)
        for old in ['peAuditDate', 'peVersionRule']:
            data['meta'].pop(old, None)
        if not any('doc_id=327' in x['url'] for x in data['meta']['sourceLinks']):
            data['meta']['sourceLinks'].insert(0, {'name': '申万公布行情及单位', 'url': 'https://tushare.pro/document/2?doc_id=327'})
        sectors.update(valuationSource='sw_daily', valuationAsOf=source['project2AsOf'])
        sectors['groups'].sort(key=lambda g: g['series'][-1]['marketCap'] or 0, reverse=True)
        assert finance_hash(data['series']) == before, 'Financial totals changed unexpectedly'
        assert all(finance_hash(g['series']) == sector_before[g['code']]
                   for g in sectors['groups'] if g['code'] in sector_before), 'Subindustry financials changed'
        for metric in ['revenue', 'profit']:
            for i, row in enumerate(data['series']):
                assert math.isclose(sum(g['series'][i][metric] or 0 for g in sectors['groups']), row[metric] or 0, abs_tol=1e-6)
        audit = {'industry': name, 'code': code, 'scope': 'SW公布市值/PE与财报汇总分离',
                 'project2AsOf': source['project2AsOf'], 'financialAsOf': data['meta'].get('financialAsOf', data['meta']['asOf']),
                 'financialHash': before,
                 'sectorFinancialHashes': {g['code']: finance_hash(g['series']) for g in sectors['groups']},
                 'latest': data['series'][-1], 'indices': []}
        for obj, c in objects:
            audit['indices'].append({'code': c, 'name': sources[c]['name'], 'dailyCount': len(sources[c]['rows']),
                 'firstDate': sources[c]['rows'][0]['trade_date'] if sources[c]['rows'] else None,
                 'lastDate': sources[c]['rows'][-1]['trade_date'] if sources[c]['rows'] else None,
                 'quarterQuotes': sum(r['valuationDate'] is not None for r in obj['series']),
                 'missingQuarterQuotes': [r['quarter'] for r in obj['series'] if r['valuationDate'] is None]})
        write(root / 'sw-alignment-audit.json', audit)
        audits.append(audit)
        write(root / 'data.json', data)
        write(root / 'sectors.json', sectors)
        for filename, value in [('data.js', data), ('sectors.js', sectors)]:
            path = root / filename
            prefix = path.read_text().split('=', 1)[0]
            path.write_text(prefix + '=' + json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + ';')
        fields = list(dict.fromkeys(k for row in data['series'] for k in row))
        with (root / 'quarterly.csv').open('w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
            writer.writeheader()
            writer.writerows(data['series'])
        manifest = read(root / 'data-manifest.json')
        manifest['meta'] = data['meta']
        manifest['valuationAlignment'] = audit
        manifest['collectionScopeNote'] = '既有财报与daily_basic查询用于财务及公司明细；现行行业行情源为sw-source.json。'
        manifest['industryValuationCollection'] = {'api': 'sw_daily', 'snapshot': source['project2AsOf'],
            'sourceFile': 'sw-source.json', 'classification': source['classification']}
        if 'validation' in manifest:
            manifest['validation'].pop('peCoverageMinimum', None)
            manifest['validationScopeNote'] = '既有validation中的market字段仅核验公司报价；申万行情覆盖见valuationAlignment。'
        if 'peAudit' in manifest:
            manifest['historicalCompanyPEAudit'] = {'scope': '旧公司整体法审计，已不用于图表PE', 'details': manifest.pop('peAudit')}
        write(root / 'data-manifest.json', manifest)
        if (root / 'pe-audit.json').exists():
            historical = read(root / 'pe-audit.json')
            historical['auditScope'] = '旧公司整体法历史核验，不代表现行申万行业PE；参见sw-alignment-audit.json'
            write(root / 'pe-audit.json', historical)
        if (root / 'data-audit.json').exists():
            previous = read(root / 'data-audit.json')
            if 'valuationAlignment' not in previous:
                previous = {'historicalCompanyAggregateAudit': previous,
                            'historicalAuditScope': '旧公司整体法，市值/PE已被sw-alignment-audit.json取代；财务核验仍有效'}
            previous['valuationAlignment'] = audit
            write(root / 'data-audit.json', previous)
        item.update(latest=data['series'][-1], subIndustryCount=len(sectors['groups']), valuationSource='sw_daily')
    catalog['industries'].sort(key=lambda x: x['latest']['marketCap'] or 0, reverse=True)
    catalog['valuationSources'] = {'sw_daily': [x['key'] for x in catalog['industries']]}
    write(SITE / 'catalog.json', catalog)
    (SITE / 'catalog.js').write_text('window.INDUSTRY_CATALOG=' + json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + ';')
    audit = read(SITE / 'all-industries-audit.json')
    audit['valuationAlignment'] = audits
    audit['valuationCounts'] = {'level1': len(audits), 'level2': sum(len(a['indices']) - 1 for a in audits)}
    audit['auditScopeNote'] = '既有公司汇总核验保留作历史财务/公司数据审计；全部31个一级、134个二级行业的现行申万市值/PE参见valuationAlignment，不与公司合计强制对账。'
    write(SITE / 'all-industries-audit.json', audit)
    print(json.dumps([{'industry': a['industry'], 'marketCap': a['latest']['marketCap'],
                       'pe': a['latest']['pe'], 'indices': len(a['indices'])} for a in audits], ensure_ascii=False))


if __name__ == '__main__':
    main()
