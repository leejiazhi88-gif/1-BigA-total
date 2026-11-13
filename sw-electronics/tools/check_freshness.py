"""Verify fresh receipts, source arithmetic, aggregates and sealed payloads before publishing."""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import datetime, timedelta
import gzip
import hashlib
import json
from pathlib import Path
from zoneinfo import ZoneInfo

SITE = Path(__file__).resolve().parents[1]

def read(path):
    return json.loads(path.read_text())

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def canonical(row):
    return json.dumps(row, sort_keys=True, separators=(',', ':'), ensure_ascii=False)

def close(a, b):
    assert (a is None) == (b is None), (a, b)
    if a is not None:
        assert abs(float(a)-float(b)) <= max(1e-6, abs(float(a))*1e-12), (a,b)

def paths(catalog):
    result = ['catalog.json','catalog.js','all-industries-audit.json','refresh-source.json.gz','app.js','index.html','style.css']
    for item in catalog['industries']:
        for name in ['data.json','data.js','sectors.json','sectors.js','company-quarterly.csv','quarterly.csv',
                     'latest-quotes-source.json','sw-alignment-audit.json','data-manifest.json']:
            result.append(str(Path(item['path']) / name))
    return sorted(set(result))

def verify(seal=False):
    audit = read(SITE/'freshness-audit.json')
    source = json.load(gzip.open(SITE/audit['sourceFile'], 'rt'))
    today = datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y%m%d')
    assert source['asOf'] == audit['checkedThrough'] == today, '财报核查日期过期，必须重新取数后发布'
    assert source['collectedAt'][:10].replace('-','') == today
    assert audit['quoteDate'] == source['quoteDate'] <= today
    assert len(source['requests']) == audit['requests']
    catalog = read(SITE/'catalog.json')
    fresh = source['data']
    receipts = source['requests']
    for r in receipts:
        assert r['fetchedAt'][:10].replace('-','') == today, '查询凭证过期'
        assert isinstance(r['rows'], list)
        if r.get('truncated'):
            # A capped parent is allowed only with both complete child intervals.
            p = r['params']; lo=p.get('start_date',p['period'][:4]+'0101'); hi=p.get('end_date',today)
            children=[x for x in receipts if x['api']==r['api'] and x['params'].get('period')==p.get('period') and x['params'].get('report_type')==p.get('report_type') and x['params'].get('start_date','')>=lo and x['params'].get('end_date','')<=hi and x is not r]
            intervals=sorted((x['params']['start_date'],x['params']['end_date']) for x in children if not x.get('truncated'))
            cursor=lo
            for start,end in intervals:
                assert start<=cursor, '截断查询补查日期不连续'
                cursor=max(cursor,(datetime.strptime(end,'%Y%m%d')+timedelta(days=1)).strftime('%Y%m%d'))
            assert intervals and cursor>hi, '截断数据未补全'
    complete = [r for r in receipts if not r.get('truncated')]
    def matching(api, **params):
        return [r for r in complete if r['api']==api and all(r['params'].get(k)==v for k,v in params.items())]
    def received(rows, queries):
        # Existence of empty receipts matters: missing source is not an empty response.
        assert queries, '缺少对应新查询记录'
        expected=Counter(canonical(row) for r in queries for row in r['rows'])
        actual=Counter(canonical(row) for row in rows)
        assert not actual-expected, '生成来源与新接口响应不符'
    received(fresh['basics'],matching('stock_basic',list_status='L'))
    received(fresh['companyQuotes'],matching('daily_basic',trade_date=source['quoteDate']))
    assert fresh['companyQuotes'] and fresh['basics']
    for key,rows in fresh.items():
        if key.startswith('income:'):
            _,period,report=key.split(':')
            queries=matching('income_vip',period=period,report_type=report)
            received(rows,queries)
            assert Counter(canonical(r) for r in rows)==Counter(canonical(r) for q in queries for r in q['rows']), '财报查询缺少行'
        elif key.startswith('carry:'):
            received(rows,matching('daily_basic',ts_code=key[6:]))
        elif key.startswith('disclosure:'):
            received(rows,matching('disclosure_date',ts_code=key[11:]))
    for report in ['1','4','5']:
        assert any(r['api']=='income_vip' and r['params'].get('start_date')==source['incrementalStart'] and r['params'].get('end_date')==today and r['params'].get('report_type')==report for r in receipts)
        for period in source['periods']:
            assert 'income:'+period+':'+report in fresh
    incremental_queries=[r for r in complete if r['api']=='income_vip' and not r['params'].get('period')]
    received(source['incremental'],incremental_queries)
    assert not any(r['end_date']>source['latestPeriod'] for r in source['incremental']), '发现新财报季度，必须推进季度构建'
    for r in source['incremental']:
        assert r['end_date'] in source['periods'], '更正公告未纳入重新取数范围'
    # Independently select published cumulative statements, then compare their
    # single-quarter differences to every rebuilt company and sector total.
    candidates=defaultdict(list)
    for key,rows in fresh.items():
        if key.startswith('income:'):
            for r in rows:
                if (r.get('f_ann_date') or r.get('ann_date') or '99999999')<=today:
                    candidates[(r['ts_code'],r['end_date'])].append(r)
    reports={}
    for key,rows in candidates.items():
        rows.sort(key=lambda r:(r.get('f_ann_date') or r.get('ann_date'),{'5':0,'1':1,'4':2}[str(r['report_type'])],str(r.get('update_flag') or '0')))
        r=dict(rows[-1])
        for field in ['total_revenue','revenue','n_income_attr_p']:
            if r.get(field) is None:
                peers=[x for x in reversed(rows) if (x.get('f_ann_date') or x.get('ann_date'))==(r.get('f_ann_date') or r.get('ann_date')) and str(x['report_type'])==str(r['report_type'])]
                r[field]=next((x[field] for x in peers if x.get(field) is not None),None)
        reports[key]=r
    def value(r,key):
        return (r.get('total_revenue') if r.get('total_revenue') is not None else r.get('revenue')) if key=='revenue' else r.get('n_income_attr_p')
    def quarter(code,period,key):
        r=reports.get((code,period)); current=value(r,key) if r else None
        if current is None:return None
        suffix=['0331','0630','0930','1231']; i=suffix.index(period[4:])
        if not i:return current/1e8
        prev=reports.get((code,period[:4]+suffix[i-1])); base=value(prev,key) if prev else None
        return (current-base)/1e8 if base is not None else None
    quotes={r['ts_code']:r for r in fresh['companyQuotes'] if r.get('total_mv') is not None}
    for key,rows in fresh.items():
        if key.startswith('carry:'):
            valid=[r for r in rows if r['trade_date']<=source['quoteDate'] and r.get('total_mv') is not None]
            if valid:quotes[key[6:]]=max(valid,key=lambda r:r['trade_date'])
    active={r['ts_code'] for r in fresh['basics']}; seen=set(); checks=0
    for item in catalog['industries']:
        root=SITE/item['path']; d=read(root/'data.json'); groups=read(root/'sectors.json')['groups']
        assert d['meta']['financialAsOf']==d['meta']['universeAsOf']==today
        assert d['meta']['companyQuoteAsOf']==source['quoteDate']
        members=fresh['members:'+item['code']]; received(members,matching('index_member_all',l1_code=item['code']))
        codes={r['ts_code'] for r in members}&active
        assert not seen&codes;seen|=codes
        assert codes=={c for g in groups for c in g['codes']}
        for obj,code in [(d,item['code'])]+[(g,g['code']) for g in groups]:
            rows=fresh['quote:'+code]
            queries=[r for r in complete if r['api']=='sw_daily' and (r['params'].get('ts_code')==code or r['params'].get('trade_date'))]
            received(rows,queries)
            assert obj['latestQuote']['date']==source['quoteDate']
            latest=next((r for r in rows if r['trade_date']==source['quoteDate']),None)
            close(obj['latestQuote']['marketCap'],latest['total_mv']/10000 if latest and latest.get('total_mv',0)>0 else None)
            if obj is d:assert latest, '一级最新行情缺失'
        records=list(csv.DictReader((root/'company-quarterly.csv').open(encoding='utf-8-sig')))
        byquarter=defaultdict(list)
        for r in records:
            byquarter[r['quarter']].append(r)
            if r['endDate'] in source['periods']:
                rv,pv=[quarter(r['code'],r['endDate'],k) for k in ['revenue','profit']]
                if rv is not None and pv is not None:
                    assert r['status']=='reported', '已披露仍使用估算'
                    close(float(r['revenue']),rv);close(float(r['profit']),pv);checks+=1
        for obj,scope in [(d,codes)]+[(g,set(g['codes'])) for g in groups]:
            for point in obj['series']:
                rows=[r for r in byquarter[point['quarter']] if r['code'] in scope]
                assert point['companies']==len(rows)
                for metric in ['revenue','profit']:
                    close(point[metric],sum(float(r[metric] or 0) for r in rows) if rows else None)
                assert point['estimatedCount']==sum(r['status']=='estimated' for r in rows)
        for r in d['latestCompanies']:
            code=r['code']; q=quotes.get(code)
            close(r['marketCap'],q['total_mv']/10000 if q else None)
            assert r['quoteDate']==(q['trade_date'] if q else None)
            assert r['quoteCarried']==bool(q and q['trade_date']<source['quoteDate'])
            if r['status']!='reported':
                disc=fresh.get('disclosure:'+code)
                assert disc is not None, '未披露样本必须重新核查披露日'
                assert not any(x.get('actual_date') and x['actual_date']<=today for x in disc), '已披露不得估算'
                assert quarter(code,source['latestPeriod'],'revenue') is None or quarter(code,source['latestPeriod'],'profit') is None
                if r['status']=='estimated':
                    period=source['latestPeriod'];suffix=['0331','0630','0930','1231'];idx=suffix.index(period[4:]);year=int(period[:4])
                    previous=(str(year)+suffix[idx-1]) if idx else str(year-1)+'1231'
                    ref=reports.get((code,previous));old=reports.get((code,str(int(previous[:4])-1)+previous[4:]))
                    assert ref and old and value(ref,'revenue')>0 and value(old,'revenue')>0
                    base=quarter(code,str(year-1)+period[4:],'revenue');assert base is not None
                    expected=base*value(ref,'revenue')/value(old,'revenue')
                    close(r['revenue'],expected);close(r['profit'],expected*value(ref,'profit')/value(ref,'revenue'))
    assert len(seen)==audit['activeCompanies']
    hashes={p:digest(SITE/p) for p in paths(catalog)}
    if seal:
        audit['payloadSha256']=hashes
        audit['verifiedFinancialRows']=checks
        (SITE/'freshness-audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
    else:
        assert hashes==audit.get('payloadSha256'), '生成文件与核查封存不符，重新运行刷新/校验流程'
    print(f'PASS freshness {today}; {len(seen)} companies; {checks} newly checked financial rows; {len(hashes)} sealed files')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--seal',action='store_true');args=parser.parse_args()
    verify(args.seal)
