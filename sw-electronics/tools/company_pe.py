"""One canonical PE receipt archive; derive compact table counts without a sidecar.

Initial history is queried once per new company. Incremental PE reuses the
current daily_basic response and trading calendar from the financial refresh.
Receipts keep only the requested industry projection, with original query
metadata and hashes; there is no second stored copy of reconstructed history.
"""
from bisect import bisect_right
import concurrent.futures as cf
from datetime import datetime
import gzip
import hashlib
import json
import math
from pathlib import Path
import sys
from zoneinfo import ZoneInfo
sys.dont_write_bytecode=True
from collect_refresh import Client,today

SITE=Path(__file__).resolve().parents[1]
FIELDS='ts_code,trade_date,pe_ttm'
SOURCE='company-pe-source.json.gz'
PRESETS=['4','12','20','40','80']

def read(path):return json.loads(path.read_text())
def positive(v):return isinstance(v,(int,float)) and math.isfinite(v) and v>0

def fingerprint(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()).hexdigest()

def unpack(receipt):
    if receipt.get('columns'):
        for row in receipt['rows']:
            yield {**({'ts_code':receipt['params']['ts_code']} if 'ts_code' not in receipt['columns'] else {}),**dict(zip(receipt['columns'],row))}
    else:
        yield from receipt['rows']

def pack(receipt,wanted,retain_day=None):
    columns=['trade_date','pe_ttm'] if receipt['params'].get('ts_code') else FIELDS.split(',')
    metadata={k:receipt[k] for k in ['api','params','fetchedAt']}
    if receipt.get('columns')==columns and receipt.get('responseSha256'):
        # Compact receipts already carry the verified original response hash.
        # Filter their columns directly, without recreating millions of dicts.
        di=columns.index('trade_date');ci=columns.index('ts_code') if 'ts_code' in columns else None
        retained=[row for row in receipt['rows'] if (row[ci] if ci is not None else receipt['params']['ts_code']) in wanted and (not retain_day or row[di]==retain_day)]
        return dict(**metadata,fields=FIELDS.split(','),columns=columns,rows=retained,
            responseRows=receipt['responseRows'],responseSha256=receipt['responseSha256'],
            projection='current industry companies; ts_code repeated by query is omitted',
            **({'retainedDate':retain_day} if retain_day else {}))
    raw=list(unpack(receipt))
    retained=[r for r in raw if r['ts_code'] in wanted and (not retain_day or r['trade_date']==retain_day)]
    return dict(**metadata,fields=FIELDS.split(','),columns=columns,rows=[[r.get(f) for f in columns] for r in retained],
        responseRows=receipt.get('responseRows',len(raw)),responseSha256=receipt.get('responseSha256',fingerprint(raw)),
        projection='current industry companies; ts_code repeated by query is omitted',
        **({'retainedDate':retain_day} if retain_day else {}))

def normalize(source,wanted):
    # Replacing the same query prevents same-day refreshes growing the archive.
    unique={}
    for original in source['requests']:
        if original['api']!='daily_basic':continue
        receipt=pack(original,wanted,original.get('retainedDate'))
        if receipt['params'].get('ts_code') not in wanted and receipt['params'].get('ts_code'):continue
        key=fingerprint([receipt['api'],receipt['params'],receipt.get('retainedDate')])
        unique.pop(key,None);unique[key]=receipt
    return dict(schema=2,checkedThrough=source['checkedThrough'],quoteDate=source['quoteDate'],fetchedAt=source['fetchedAt'],
        codes=sorted(wanted),requests=list(unique.values()))

def histories(source):
    wanted=set(source.get('codes',source.get('companies',{})))
    result={code:{} for code in wanted}
    for receipt in source['requests']:
        if receipt['api']!='daily_basic':continue
        day=receipt['params'].get('trade_date')
        if day:
            for values in result.values():values.pop(day,None)
        for row in unpack(receipt):
            if row['ts_code'] in result:result[row['ts_code']][row['trade_date']]=row.get('pe_ttm')
    return {code:sorted(values.items()) for code,values in result.items()}

def build(source,data):
    end=source['quoteDate'];boundaries=['20041231']+[r['endDate'] for r in data['series']]+[end]
    assert boundaries==sorted(boundaries)
    day=datetime.strptime(end,'%Y%m%d')
    starts={key:day.replace(year=day.year-int(key)//4).strftime('%Y%m%d') for key in PRESETS}
    history=histories(source);companies={}
    for company in data['latestCompanies']:
        code=company['code'];rows=history[code];by_day=dict(rows);target=by_day.get(company['quoteDate'])
        assert company['quoteDate'] is None or company['quoteDate'] in by_day,(code,'PE报价日缺失')
        assert all('20050101'<=d<=end and (pe is None or math.isfinite(pe)) for d,pe in rows)
        if not positive(target):
            companies[code]=[target];continue
        days=[d for d,pe in rows if positive(pe)];le=[d for d,pe in rows if positive(pe) and pe<=target]
        prefix=[[bisect_right(days,b),bisect_right(le,b)] for b in boundaries]
        deltas=[[b[0]-a[0],b[1]-a[1]] for a,b in zip(prefix,prefix[1:])]
        offset=next((i for i,pair in enumerate(deltas) if pair!=[0,0]),len(deltas))
        stop=len(deltas)
        while stop>offset and deltas[stop-1]==[0,0]:stop-=1
        packed=[value for pair in deltas[offset:stop] for value in pair]
        windows=[v for key in PRESETS for v in [sum(d>=starts[key] for d in days),sum(d>=starts[key] for d in le)]]
        companies[code]=[target,offset,packed,windows]
    return dict(meta=dict(field='daily_basic.pe_ttm',quoteDate=end,boundaries=boundaries,presetKeys=PRESETS,presetStarts=starts),companies=companies)

def write_source(source,path):
    # Fixed gzip header avoids changing bytes only due to compression time.
    raw=json.dumps(source,ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
    encoded=gzip.compress(raw,mtime=0)
    if not path.exists() or path.read_bytes()!=encoded:path.write_bytes(encoded)

def initial_history(code,end,cache):
    # Checkpoints live outside either public repository. Interrupted initial
    # builds reuse complete, hashed responses instead of repeating thousands
    # of successful calls; latest quotes always come from this refresh.
    params=dict(ts_code=code,start_date='20050101',end_date=end)
    path=cache/(code+'-'+end+'.json.gz')
    if path.exists():
        saved=json.load(gzip.open(path,'rt'));receipt=saved['receipt']
        assert saved['sha256']==fingerprint(receipt) and receipt['params']==params
        assert receipt['api']=='daily_basic' and receipt['columns']==['trade_date','pe_ttm']
        assert len(receipt['rows'])<6000
        return receipt,False
    client=Client();client.call('daily_basic',params,FIELDS,6000)
    receipt=pack(client.requests[0],{code})
    assert all('20050101'<=d<=end and (v is None or math.isfinite(v)) for d,v in receipt['rows'])
    cache.mkdir(parents=True,exist_ok=True)
    raw=json.dumps(dict(receipt=receipt,sha256=fingerprint(receipt)),ensure_ascii=False,separators=(',',':'),allow_nan=False).encode()
    temporary=path.with_suffix('.tmp');temporary.write_bytes(gzip.compress(raw,mtime=0));temporary.replace(path)
    return receipt,True

def collect():
    shared=json.load(gzip.open(SITE/'refresh-source.json.gz','rt'))
    end=shared['quoteDate'];assert shared['asOf']==today()
    catalog=read(SITE/'catalog.json')['industries']
    shared_quote=next(r for r in shared['requests'] if r['api']=='daily_basic' and r['params'].get('trade_date')==end)
    assert 'pe_ttm' in shared_quote['fields'],'统一市值查询需包含pe_ttm，禁止重复查询'
    client=Client();incremental={};calendars={};requested=0;total=0
    cache=SITE.parent/'.quanlantu-pe-history-cache'
    for item in catalog:
        folder=SITE/item['path'];data=read(folder/'data.json');assert data['latestQuote']['date']==end
        wanted={r['code'] for r in data['latestCompanies']};path=folder/SOURCE
        original=json.load(gzip.open(path,'rt')) if path.exists() else None
        source=normalize(original,wanted) if original else dict(schema=2,codes=sorted(wanted),requests=[])
        covered={r['params']['ts_code'] for r in source['requests'] if r['params'].get('ts_code') and r['params'].get('start_date')=='20050101' and not r.get('retainedDate')}
        missing=sorted(wanted-covered)
        print(f'{item["name"]}：复用 {len(wanted)-len(missing)} 家历史，首次补齐 {len(missing)} 家',flush=True)
        with cf.ThreadPoolExecutor(max_workers=4) as pool:
            jobs={pool.submit(initial_history,code,end,cache):code for code in missing}
            for i,future in enumerate(cf.as_completed(jobs),1):
                receipt,is_new=future.result();source['requests'].append(receipt);requested+=is_new
                if i%40==0:print(f'{item["name"]} PE历史 {i}/{len(missing)}',flush=True)
        start=min(original['quoteDate'],end) if original else end
        calendar=next((r for r in shared['requests'] if r['api']=='trade_cal' and r['params'].get('start_date','99999999')<=start and r['params'].get('end_date','')>=end),None)
        if calendar:rows=calendar['rows']
        else:
            if start not in calendars:calendars[start]=client.call('trade_cal',dict(exchange='SSE',start_date=start,end_date=end,is_open='1'))
            rows=calendars[start]
        days=sorted(r['cal_date'] for r in rows if r.get('is_open') in ['1',1] and start<=r['cal_date']<=end)
        assert days and days[-1]==end
        for day in days:
            if day==end:continue
            if day not in incremental:
                result=client.call('daily_basic',dict(trade_date=day),FIELDS,6000);assert result,'增量PE日行情为空'
                incremental[day]=client.requests[-1]
            source['requests'].append(pack(incremental[day],wanted))
        source['requests'].append(pack(shared_quote,wanted))
        for company in data['latestCompanies']:
            if company.get('quoteCarried'):
                code=company['code'];receipt=next(r for r in shared['requests'] if r['api']=='daily_basic' and r['params'].get('ts_code')==code)
                assert 'pe_ttm' in receipt['fields']
                source['requests'].append(pack(receipt,wanted,company['quoteDate']))
        source.update(checkedThrough=today(),quoteDate=end,fetchedAt=shared['collectedAt'])
        source=normalize(source,wanted);write_source(source,path);total+=len(wanted)
        print(f'{item["name"]} PE归档完成：{len(wanted)} 家，{len(source["requests"])} 份去重凭证',flush=True)
    print(f'全部31行业PE复用统一行情；{total} 家；首次历史请求 {requested} 次，增量/日历额外请求 {len(client.requests)} 次',flush=True)

def verify():
    fresh=json.load(gzip.open(SITE/'refresh-source.json.gz','rt'))
    shared=next(r for r in fresh['requests'] if r['api']=='daily_basic' and r['params'].get('trade_date')==fresh['quoteDate'])
    seen=set();checked=0
    for item in read(SITE/'catalog.json')['industries']:
        folder=SITE/item['path'];source=json.load(gzip.open(folder/SOURCE,'rt'));data=read(folder/'data.json');table=read(folder/'companies.json')
        assert source['schema']==2 and source['quoteDate']==data['latestQuote']['date']==fresh['quoteDate']
        assert source['checkedThrough']==data['meta']['financialAsOf']==fresh['asOf']
        wanted={r['code'] for r in data['latestCompanies']};assert set(source['codes'])==wanted
        assert not seen&wanted,'公司PE源跨行业重复';seen|=wanted
        keys=[fingerprint([r['api'],r['params'],r.get('retainedDate')]) for r in source['requests']]
        assert len(keys)==len(set(keys)), 'PE源凭证重复'
        covered=set()
        for r in source['requests']:
            assert 'pe_ttm' in r['fields'] and len(r['rows'])<6000
            assert all(len(row)==len(r['columns']) for row in r['rows'])
            assert all(row['ts_code'] in wanted for row in unpack(r)), 'PE历史公司归属不匹配'
            if r['params'].get('start_date')=='20050101' and not r.get('retainedDate'):covered.add(r['params'].get('ts_code'))
        assert wanted<=covered,'缺少公司完整历史查询凭证'
        current=next(r for r in source['requests'] if r['params'].get('trade_date')==source['quoteDate'])
        assert current==pack(shared,wanted),'PE未复用本次统一行情或来源不匹配'
        assert current['fetchedAt'][:10].replace('-','')==source['checkedThrough']
        for company in data['latestCompanies']:
            if company.get('quoteCarried'):
                receipt=next(r for r in fresh['requests'] if r['api']=='daily_basic' and r['params'].get('ts_code')==company['code'])
                assert pack(receipt,wanted,company['quoteDate']) in source['requests'],'停牌公司PE未复用本次核查'
        calculated=build(source,data);assert table['valuation']==calculated['meta']
        vi=table['fields'].index('valuation');ci=table['fields'].index('code')
        assert {r[ci]:r[vi] for r in table['rows']}==calculated['companies'],'公司表PE统计与日度来源不符'
        checked+=1
    print(f'PASS {checked} separate PE archives, shared quotes, {len(seen)} companies and exact selectable-window counts')

if __name__=='__main__':
    if '--verify' in sys.argv:verify()
    else:collect()
