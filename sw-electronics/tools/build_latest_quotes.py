"""Attach an electronics latest-day observation without adding a financial quarter.

Reads the public latest-quotes-source.json supplement. Historical quarterly data,
financials and the shared project-2 snapshot remain independently reproducible.
"""
import json
import sys
sys.dont_write_bytecode = True
from align_sw_data import SITE, positive, read, write


def main():
    data, sectors = read(SITE / 'data.json'), read(SITE / 'sectors.json')
    source = read(SITE / 'latest-quotes-source.json')
    code = data['meta']['indexCode']
    day = source['indices'][code]['rows'][-1]['trade_date']
    for obj, index in [(data, code)] + [(g, g['code']) for g in sectors['groups']]:
        rows = source['indices'][index]['rows']
        by_date = {r['trade_date']: r for r in rows}
        assert len(by_date) == len(rows) and list(by_date) == sorted(by_date)
        assert all(r['ts_code'] == index and r['trade_date'] > source['baseSnapshot'] for r in rows)
        quote = by_date.get(day)
        cap, pe = (quote['total_mv'], quote['pe']) if quote else (None, None)
        obj['latestQuote'] = dict(date=day, valuationDate=day if quote else None,
            valuationSource='sw_daily', valuationCode=index,
            marketCap=cap / 10000 if positive(cap) else None,
            marketCapObserved=cap / 10000 if positive(cap) else None,
            pe=pe if positive(pe) else None, peRaw=pe,
            peStatus='valid' if positive(pe) else 'nonpositive' if pe is not None and pe <= 0 else 'source_missing',
            peNote='' if positive(pe) else '申万公布PE非正' if pe is not None and pe <= 0 else '申万未提供该日PE',
            financialQuarter=obj['series'][-1]['quarter'])
        obj['valuationRecent'] = [[r['trade_date'], r['pe']] for r in rows]
    data['meta']['latestQuoteDate'] = day
    data['meta']['latestQuoteMethod'] = '最右侧最新交易日观察点；市值/PE使用同日申万值，财务沿用最近财报季度；最近4季不重复计入该观察点'
    for stem, obj in [('data', data), ('sectors', sectors)]:
        write(SITE / (stem + '.json'), obj)
        path = SITE / (stem + '.js')
        prefix = path.read_text().split('=', 1)[0]
        path.write_text(prefix + '=' + json.dumps(obj, ensure_ascii=False, separators=(',', ':'), allow_nan=False) + ';')
    manifest = read(SITE / 'data-manifest.json')
    manifest['meta'] = data['meta']
    manifest['latestQuote'] = {'sourceFile': 'latest-quotes-source.json', 'date': day,
        'financialSnapshot': source['financialSnapshot'], 'quarterlySeriesUnchanged': True,
        'indices': [data['latestQuote']] + [g['latestQuote'] for g in sectors['groups']]}
    write(SITE / 'data-manifest.json', manifest)
    catalog = read(SITE / 'catalog.json')
    next(x for x in catalog['industries'] if x['key'] == 'electronics')['latestObservation'] = data['latestQuote']
    write(SITE / 'catalog.json', catalog)
    (SITE / 'catalog.js').write_text('window.INDUSTRY_CATALOG=' + json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + ';')
    print('Attached latest electronics / 6 secondary observations:', day)


if __name__ == '__main__':
    main()
