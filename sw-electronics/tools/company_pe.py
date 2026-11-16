"""Electronics company PE(TTM), exact selectable-window counts and public receipts.

The browser receives prefix counts, not millions of daily records. Historical
rows are cached with original retrieval timestamps; every run re-queries the
last published date and all newer sessions, with no old-quote fallback on errors.
"""
from bisect import bisect_right
import concurrent.futures as cf
from datetime import datetime
import gzip
import json
import math
from pathlib import Path
import sys
from zoneinfo import ZoneInfo
sys.dont_write_bytecode=True
from collect_refresh import Client, today

SITE=Path(__file__).resolve().parents[1]
FIELDS='ts_code,trade_date,pe_ttm'
SOURCE='company-pe-source.json.gz'
PAYLOAD='company-pe.json'

def read(path):return json.loads(path.read_text())
def positive(v):return isinstance(v,(int,float)) and math.isfinite(v) and v>0

def write_source(source):
    with gzip.open(SITE/SOURCE,'wt',encoding='utf-8') as f:
        json.dump(source,f,ensure_ascii=False,separators=(',',':'),allow_nan=False)

def build(source,data):
    end=source['quoteDate'];quarters=[r['endDate'] for r in data['series']]
    boundaries=['20041231']+quarters+[end]
    assert boundaries==sorted(boundaries) and len(boundaries)==len(data['series'])+2
    presets={'all':'20050101'}
    for n in [1,3,5,10,20]:
        day=datetime.strptime(end,'%Y%m%d');presets[str(n*4)]=day.replace(year=day.year-n).strftime('%Y%m%d')
    companies={}
    for company in data['latestCompanies']:
        code=company['code'];rows=source['companies'][code]['rows']
        assert [r[0] for r in rows]==sorted({r[0] for r in rows})
        assert all('20050101'<=r[0]<=end and (r[1] is None or math.isfinite(r[1])) for r in rows)
        by_day=dict(rows);target=by_day.get(company['quoteDate']);valid=[(day,pe) for day,pe in rows if positive(pe)]
        days=[r[0] for r in valid];le_days=[day for day,pe in valid if positive(target) and pe<=target]
        counts=lambda stop:[bisect_right(days,stop),bisect_right(le_days,stop)]
        # Prefixes make arbitrary quarter boundaries exact (inclusive end).
        cumulative=[counts(stop) for stop in boundaries]
        windows={}
        for key,start in presets.items():
            windows[key]=[sum(day>=start for day in days),sum(day>=start for day in le_days)]
        companies[code]=dict(peTtm=target,quoteDate=company['quoteDate'],historyStart=rows[0][0] if rows else None,
            historyEnd=rows[-1][0] if rows else None,cumulative=cumulative,presets=windows)
    return dict(meta=dict(industry='电子',code='801080.SI',field='daily_basic.pe_ttm',
        checkedThrough=source['checkedThrough'],quoteDate=end,fetchedAt=source['fetchedAt'],
        sourceFile=SOURCE,start='20050101',boundaries=boundaries,presetStarts=presets,
        target='最新公司报价日PE(TTM)，随顶部时间范围仅调整分位样本区间',
        formula='有效正日度PE不高于最新PE的样本数 / 有效正日度PE样本数，包含相等值'),companies=companies)

def collect():
    data=read(SITE/'data.json');end=data['latestQuote']['date'];client=Client()
    old=json.load(gzip.open(SITE/SOURCE,'rt')) if (SITE/SOURCE).exists() else None
    wanted={r['code'] for r in data['latestCompanies']}
    source=dict(checkedThrough=today(),quoteDate=end,companies={},requests=[])
    if old:
        source['requests']=old['requests']
        source['companies']={code:old['companies'][code] for code in wanted if code in old['companies']}
    # Initial history can span fewer than 6,000 observations from 2005; if capped,
    # stop rather than publish a truncated history. Network errors also stop.
    missing=sorted(wanted-source['companies'].keys())
    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        pending={pool.submit(client.call,'daily_basic',dict(ts_code=code,start_date='20050101',end_date=end),FIELDS,6000):code for code in missing}
        for index,future in enumerate(cf.as_completed(pending),1):
            code=pending[future];rows=future.result()
            assert all(r['ts_code']==code for r in rows)
            by_day={r['trade_date']:r.get('pe_ttm') for r in rows};assert len(by_day)==len(rows)
            source['companies'][code]=dict(rows=sorted([d,v] for d,v in by_day.items()))
            if index%40==0:print(f'个股PE历史 {index}/{len(missing)}',flush=True)
    # On subsequent refreshes fetch new dates in all-market daily batches. Always
    # re-read the previous observation day, including nontrading-day refreshes.
    if old:
        start=min(old['quoteDate'],end)
        calendar=client.call('trade_cal',dict(exchange='SSE',start_date=start,end_date=end,is_open='1'))
        days=sorted(r['cal_date'] for r in calendar)
        assert days and days[-1]==end
        with cf.ThreadPoolExecutor(max_workers=4) as pool:
            pending={pool.submit(client.call,'daily_basic',dict(trade_date=day),FIELDS,6000):day for day in days}
            batches={}
            for future in cf.as_completed(pending):
                day=pending[future];batches[day]=future.result();assert batches[day], '当前个股PE查询无数据'
        for day in days:
            actual={r['ts_code']:r.get('pe_ttm') for r in batches[day]}
            for code,item in source['companies'].items():
                by_day=dict(item['rows']);by_day.pop(day,None)
                if code in actual:by_day[day]=actual[code]
                item['rows']=sorted([d,v] for d,v in by_day.items())
    source['requests'].extend(client.requests)
    source['fetchedAt']=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')
    # Exact quote-day matching is essential for suspended companies: don't pair a
    # carried market cap with a different date's PE or find a prior positive PE.
    for company in data['latestCompanies']:
        code=company['code'];day=company['quoteDate']
        assert day is None or day in dict(source['companies'][code]['rows']), (code,'缺少对应报价日PE响应')
    payload=build(source,data)
    write_source(source)
    (SITE/PAYLOAD).write_text(json.dumps(payload,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n')
    print(f'电子个股PE完成：{len(wanted)}家公司，{sum(len(x["rows"]) for x in source["companies"].values())}条日度记录',flush=True)

def verify():
    source=json.load(gzip.open(SITE/SOURCE,'rt'));data=read(SITE/'data.json');payload=read(SITE/PAYLOAD)
    assert source['quoteDate']==data['latestQuote']['date']
    assert source['checkedThrough']==data['meta']['financialAsOf']
    assert payload==build(source,data), '个股PE分位统计与日度原始值不一致'
    # Replay successful API receipts, including updates/removal at re-read dates.
    histories={code:{} for code in source['companies']}
    current=False
    for receipt in source['requests']:
        if receipt['api']!='daily_basic':continue
        assert not receipt.get('truncated') and 'pe_ttm' in receipt['fields']
        params=receipt['params'];day=params.get('trade_date')
        if day:
            for values in histories.values():values.pop(day,None)
        for row in receipt['rows']:
            if row['ts_code'] in histories:
                histories[row['ts_code']][row['trade_date']]=row.get('pe_ttm')
        if receipt['fetchedAt'][:10].replace('-','')==source['checkedThrough']:current=True
    assert current,'个股PE缺少当前核查日查询'
    assert all(sorted([day,v] for day,v in histories[code].items())==source['companies'][code]['rows'] for code in histories)
    print(f'PASS electronics company PE sources / {len(histories)} companies / all selectable range counts')

if __name__=='__main__':
    if '--verify' in sys.argv:verify()
    else:collect();verify()
