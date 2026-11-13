"""Apply freshly collected statements/membership/quotes and rebuild aggregates.

Market valuation history remains SW-published data. Financials use actual
cumulative statements, with estimates only for still-undisclosed latest reports.
"""
import csv
import gzip
import json
import math
from collections import defaultdict
from pathlib import Path
import subprocess
import sys
sys.dont_write_bytecode = True
from align_sw_data import SITE, read, write


def number(value):
    return None if value is None or value == '' else float(value)


def ann(row):
    return row.get('f_ann_date') or row.get('ann_date') or '99999999'


def revenue(row):
    return row.get('total_revenue') if row.get('total_revenue') is not None else row.get('revenue')


def apply():
    source = json.load(gzip.open(SITE / 'refresh-source.json.gz', 'rt'))
    fresh, asof, period = source['data'], source['asOf'], source['latestPeriod']
    catalog = read(SITE / 'catalog.json')
    basics = {r['ts_code']: r for r in fresh['basics']}
    quotes = {r['ts_code']: r for r in fresh['companyQuotes'] if r.get('total_mv') is not None}
    for key, rows in fresh.items():
        if key.startswith('carry:'):
            valid = [r for r in rows if r['trade_date'] <= source['quoteDate'] and r.get('total_mv') is not None]
            if valid:
                quotes[key[6:]] = max(valid, key=lambda r: r['trade_date'])
    candidates = defaultdict(list)
    for key, rows in fresh.items():
        if key.startswith('income:'):
            for r in rows:
                if ann(r) <= asof:
                    candidates[(r['ts_code'], r['end_date'])].append(r)
    reports = {}
    for key, rows in candidates.items():
        rows.sort(key=lambda r: (ann(r), {'5': 0, '1': 1, '4': 2}[str(r['report_type'])], str(r.get('update_flag') or '0')))
        current = dict(rows[-1])
        same = [r for r in rows if ann(r) == ann(current) and str(r['report_type']) == str(current['report_type'])]
        for field in ['total_revenue', 'revenue', 'n_income_attr_p']:
            if current.get(field) is None:
                current[field] = next((r[field] for r in reversed(same) if r.get(field) is not None), None)
        reports[key] = current

    def single(code, end, metric):
        current = reports.get((code, end))
        if not current:
            return None
        value = revenue(current) if metric == 'revenue' else current.get('n_income_attr_p')
        if value is None:
            return None
        suffixes = ['0331', '0630', '0930', '1231']
        i = suffixes.index(end[4:])
        if i == 0:
            return value / 1e8
        previous = reports.get((code, end[:4] + suffixes[i-1]))
        base = (revenue(previous) if metric == 'revenue' else previous.get('n_income_attr_p')) if previous else None
        return (value-base) / 1e8 if base is not None else None

    def estimate(code, end):
        suffixes = ['0331', '0630', '0930', '1231']
        i, year = suffixes.index(end[4:]), int(end[:4])
        previous = str(year) + suffixes[i-1] if i else str(year-1)+'1231'
        reference, old_reference = reports.get((code, previous)), reports.get((code, str(int(previous[:4])-1)+previous[4:]))
        base = single(code, str(year-1)+end[4:], 'revenue')
        if not reference or not old_reference or base is None:
            return None
        current, old = revenue(reference), revenue(old_reference)
        profit = reference.get('n_income_attr_p')
        if current is None or current <= 0 or old is None or old <= 0 or profit is None:
            return None
        growth, margin = current/old-1, profit/current
        return dict(revenue=base*(1+growth), profit=base*(1+growth)*margin,
            method='same_quarter_growth_recent_margin', priorRevenue=base, growth=growth,
            margin=margin, referencePeriod=previous, referenceRevenue=current/1e8,
            referenceProfit=profit/1e8, priorReferenceRevenue=old/1e8)

    old_rows = defaultdict(list)
    old_universe = set()
    fields = []
    modules = {}
    for item in catalog['industries']:
        root = SITE / item['path']
        data, sectors = read(root / 'data.json'), read(root / 'sectors.json')
        modules[item['key']] = (item, data, sectors)
        old_universe.update(c for g in sectors['groups'] for c in g['codes'])
        with (root / 'company-quarterly.csv').open(encoding='utf-8-sig') as f:
            reader = csv.DictReader(f)
            fields = list(dict.fromkeys(fields + reader.fieldnames))
            for row in reader:
                old_rows[row['code']].append(row)
    fields = list(dict.fromkeys(fields + ['latestMarketCap', 'latestQuoteDate', 'latestQuoteCarried']))
    changes, prepared, active_codes, pending = [], [], set(), []
    for item, data, sectors in modules.values():
        raw_members = fresh['members:' + item['code']]
        members = {r['ts_code']: r for r in raw_members if r['ts_code'] in basics}
        known_groups = {g['code']: g for g in sectors['groups']}
        assert all(r['l2_code'] in known_groups for r in members.values()), '新增分类需先补齐行业定义'
        codes = set(members)
        assert not active_codes & codes, '同一公司重复归属多个一级行业'
        active_codes |= codes
        estimates, rows = [], []
        for code in sorted(codes):
            listed = max(basics[code]['list_date'], '20211115') if code.endswith('.BJ') else basics[code]['list_date']
            if listed <= period and code not in old_rows:
                raise RuntimeError(f'{code} 是新增财务样本，需要先补齐历史财报；停止不完整刷新。')
            for row in old_rows.get(code, []):
                row['name'] = basics[code]['name']
                end = row['endDate']
                if end in source['periods']:
                    before = {k: row[k] for k in ['revenue', 'profit', 'status', 'announcementDate', 'reportType']}
                    rv, pv = single(code, end, 'revenue'), single(code, end, 'profit')
                    report = reports.get((code, end))
                    est = None
                    if rv is not None and pv is not None:
                        status = 'reported'
                    elif end == period:
                        actual = fresh.get('disclosure:' + code, [])
                        if any(r.get('actual_date') and r['actual_date'] <= asof for r in actual):
                            raise RuntimeError(f'{code} 已披露但缺少可用报表，不得继续使用估算。')
                        if row['status'] == 'reported':
                            raise RuntimeError(f'{code} 当前报表查询缺失，不能用旧值伪装刷新成功。')
                        est = estimate(code, end)
                        status = 'estimated' if est else 'missing'
                        if est:
                            rv, pv = est['revenue'], est['profit']
                    else:
                        if row['status'] == 'reported':
                            raise RuntimeError(f'{code} {end} 刷新报表缺失，停止发布。')
                        status = 'missing'
                    row.update(revenue=rv, profit=pv, status=status,
                        announcementDate=ann(report) if report else None,
                        reportType=report['report_type'] if report else None)
                    if status == 'estimated':
                        estimates.append(dict(code=code, name=row['name'], quarter=row['quarter'], **est))
                    difference = before['status'] != status or any(
                        (number(before[k]) is None) != (row[k] is None) or
                        (row[k] is not None and not math.isclose(number(before[k]), row[k], rel_tol=0, abs_tol=1e-8))
                        for k in ['revenue', 'profit'])
                    if difference:
                        changes.append(dict(code=code, name=row['name'], industry=item['name'], quarter=row['quarter'], before=before,
                            after={k: row[k] for k in before}))
                if end == period:
                    quote = quotes.get(code)
                    row.update(latestMarketCap=quote['total_mv']/10000 if quote else None,
                        latestQuoteDate=quote['trade_date'] if quote else None,
                        latestQuoteCarried=bool(quote and quote['trade_date'] < source['quoteDate']))
                    if row['status'] != 'reported':
                        pending.append(dict(code=code, name=row['name'], industry=item['name'], status=row['status'],
                            disclosure=fresh.get('disclosure:' + code, [])))
                rows.append(row)
        by_quarter = defaultdict(list)
        for row in rows:
            by_quarter[row['quarter']].append(row)
        def aggregate(series, scope):
            quality = []
            for point in series:
                records = [r for r in by_quarter[point['quarter']] if r['code'] in scope]
                est = [r for r in records if r['status'] == 'estimated']
                total = lambda group, key: sum(number(r.get(key)) or 0 for r in group)
                n = len(records)
                point.update(companies=n, revenue=total(records, 'revenue') if n else None,
                    profit=total(records, 'profit') if n else None, reportedCount=sum(r['status']=='reported' for r in records),
                    estimatedCount=len(est), missingCount=sum(r['status']=='missing' for r in records),
                    estimatedRevenue=total(est, 'revenue'), estimatedProfit=total(est, 'profit'),
                    financialCoverage=(n-sum(r['status']=='missing' for r in records))/n if n else 0,
                    carriedCount=sum(str(r['quoteCarried'])=='True' for r in records),
                    marketMissingCount=sum(number(r.get('marketCap')) is None for r in records))
                missing = lambda key: [dict(code=r['code'], name=r['name']) for r in records if key(r)]
                quality.append(dict(quarter=point['quarter'], financialMissing=missing(lambda r:r['status']=='missing'),
                    peMissing=[], marketMissing=missing(lambda r:number(r.get('marketCap')) is None),
                    carried=[dict(code=r['code'], name=r['name'], date=r['quoteDate'], marketCap=number(r['marketCap'])) for r in records if str(r['quoteCarried'])=='True'],
                    valuationDate=point.get('valuationDate'), valuationSource='sw_daily'))
            return quality
        data['quality'] = aggregate(data['series'], codes)
        for group in sectors['groups']:
            group['codes'] = sorted(c for c, m in members.items() if m['l2_code'] == group['code'])
            group['universeCount'] = len(group['codes'])
            group['quality'] = aggregate(group['series'], set(group['codes']))
        latest = []
        for row in by_quarter[data['series'][-1]['quarter']]:
            record = dict(row)
            for key in ['revenue', 'profit', 'marketCap']:
                record[key] = number(record.get(key))
            record['marketCapAtQuarterEnd'] = record['marketCap']
            record['marketCap'] = row['latestMarketCap']
            record['quoteDate'] = row['latestQuoteDate']
            record['quoteCarried'] = row['latestQuoteCarried']
            record['ttmProfitAsOf'] = data['series'][-1]['tradeDate']
            record['announcementDate'] = record.get('announcementDate') or None
            record['reportType'] = record.get('reportType') or None
            latest.append(record)
        data.update(estimates=estimates, latestCompanies=latest)
        data['meta'].update(asOf=asof[:4]+'-'+asof[4:6]+'-'+asof[6:], financialAsOf=asof,
            universeAsOf=asof, companyQuoteAsOf=source['quoteDate'], universeCount=len(codes), rawMembershipCount=len(raw_members),
            excludedInactive=[dict(code=r['ts_code'], name=r['name']) for r in raw_members if r['ts_code'] not in basics])
        sectors['asOf'] = data['meta']['asOf']
        item.update(universeCount=len(codes), financialAsOf=asof)
        supplemental = {}
        for code in read(SITE / item['path'] / 'sw-source.json')['indices']:
            receipts = [r for r in source['requests'] if r['api']=='sw_daily' and (r['params'].get('ts_code')==code or r['params'].get('trade_date'))]
            supplemental[code] = dict(params={'ts_code':code, 'end_date':asof}, fields=receipts[0]['fields'],
                requests=[{k:r[k] for k in ['api','params','fields','fetchedAt']} for r in receipts],
                rows=sorted(fresh['quote:'+code], key=lambda r:r['trade_date']))
        prepared.append((item, data, sectors, rows, supplemental))
    # All data quality checks above finish before changing published payloads.
    for item, data, sectors, rows, supplemental in prepared:
        root = SITE / item['path']
        write(root / 'data.json', data)
        write(root / 'sectors.json', sectors)
        with (root / 'company-quarterly.csv').open('w', encoding='utf-8-sig', newline='') as f:
            writer = csv.DictWriter(f, fields, lineterminator='\n')
            writer.writeheader()
            writer.writerows(rows)
        (root / 'latest-quotes-source.json').write_text(json.dumps(dict(source='Tushare sw_daily / SW2021',
            retrievedOn=data['meta']['asOf'], baseSnapshot=read(root / 'sw-source.json')['project2AsOf'],
            financialSnapshot=data['meta']['asOf'], quoteDate=source['quoteDate'], indices=supplemental), ensure_ascii=False, separators=(',', ':')))
    catalog['asOf'] = asof[:4]+'-'+asof[4:6]+'-'+asof[6:]
    catalog['financialAsOf'] = asof
    write(SITE / 'catalog.json', catalog)
    subprocess.run([sys.executable, str(SITE / 'tools/align_sw_data.py')], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([sys.executable, str(SITE / 'tools/build_latest_quotes.py')], check=True)
    subprocess.run([sys.executable, str(SITE / 'tools/update_snapshot_metadata.py')], check=True)
    audit = dict(checkedThrough=asof, quoteDate=source['quoteDate'], financialPeriod=period,
        fetchedAt=source['collectedAt'], requests=len(source['requests']), modules=31, indices=165,
        activeCompanies=len(active_codes), removedCodes=sorted(old_universe-active_codes), addedCodes=sorted(active_codes-old_universe),
        financialChanges=changes, stillPending=pending, sourceFile='refresh-source.json.gz')
    write(SITE / 'freshness-audit.json', audit)
    print(f'已刷新31个一级/134个二级；财务变更 {len(changes)} 项；当前在市样本 {len(active_codes)} 家；仍待披露 {len(pending)} 家')


if __name__ == '__main__':
    apply()
