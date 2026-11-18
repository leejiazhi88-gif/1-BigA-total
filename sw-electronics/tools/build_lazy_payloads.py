"""Derive view-only company fields and stable cache keys from canonical data."""
import hashlib
import json
import csv
import math
from collections import defaultdict
from pathlib import Path
import gzip
from company_pe import build as build_valuations, pack_percentile

FIELDS=['code','name','marketCap','quoteDate','quoteCarried','revenue','profit','announcementDate','status','sector']

def rolling_financials(records, quarters):
    """Compact latest four-quarter actuals; absence is never treated as zero."""
    wanted=set(quarters)
    assert len(quarters)==4 and len(wanted)==4
    by_company=defaultdict(dict)
    for row in records:
        if row['quarter'] not in wanted:
            continue
        company=by_company[row['code']]
        assert row['quarter'] not in company, '重复的公司季度财报'
        company[row['quarter']]=row
    result={}
    for code, by_quarter in by_company.items():
        rows=[by_quarter[q] for q in quarters if q in by_quarter]
        valid=lambda r: r['status'] in ['reported','estimated'] and all(
            r.get(k) not in [None,''] and math.isfinite(float(r[k])) for k in ['revenue','profit'])
        estimated=sum(r['status']=='estimated' for r in rows)
        missing=sum(not valid(r) for r in rows)
        complete=len(rows)==4 and not missing
        result[code]=[sum(float(r[k]) for r in rows) if complete else None for k in ['revenue','profit']]+[len(rows),estimated,missing]
    return result

def save(path,value):
    raw=(json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n').encode()
    if not path.exists() or path.read_bytes()!=raw:path.write_bytes(raw)

def build(root):
    for file in root.rglob('*'):
        if file.is_file() and file.suffix in {'.json','.js','.csv','.html','.css','.md'}:
            raw=file.read_bytes()
            if b'\r\n' in raw:file.write_bytes(raw.replace(b'\r\n',b'\n'))

    catalog=json.loads((root/'catalog.json').read_text())
    for item in catalog['industries']:
        folder=root/item['path'];data=json.loads((folder/'data.json').read_text());sectors=json.loads((folder/'sectors.json').read_text())
        groups=sorted(sectors['groups'],key=lambda g:g['latestQuote']['marketCap'] or 0,reverse=True)
        index={code:i for i,g in enumerate(groups) for code in g['codes']}
        source=json.load(gzip.open(folder/'company-pe-source.json.gz','rt'))
        quarters=[r['quarter'] for r in data['series'][-4:]]
        with (folder/'company-quarterly.csv').open(encoding='utf-8-sig',newline='') as stream:
            financials=rolling_financials(csv.DictReader(stream),quarters)
        fields=[*FIELDS,'rollingFinancials'];valuations=build_valuations(source,data)
        if valuations:fields.append('valuation')
        rows=[]
        for r in data['latestCompanies']:
            record={**r,'sector':index[r['code']],'rollingFinancials':financials.get(r['code'],[None,None,0,0,0])}
            if valuations:record['valuation']=valuations['companies'][r['code']]
            rows.append([record.get(f) for f in fields])
        table=dict(schema=2,fields=fields,groups=[[g['code'],g['name'],g['latestQuote']['marketCap']] for g in groups],rows=rows)
        # Project existing industry sources into small table summaries; no history download.
        summaries=[]
        for group in groups:
            quote=group['latestQuote'];latest=group['series'][-1];window=group['series'][-4:]
            complete=len(window)==4 and all(r['companies'] and not r['missingCount'] and all(
                isinstance(r[k],(int,float)) and math.isfinite(r[k]) for k in ['revenue','profit']) for r in window)
            summaries.append(dict(quoteDate=quote['date'],valuation=pack_percentile(
                [*group.get('valuationDaily',[]),*group.get('valuationRecent',[])],quote['pe'],
                valuations['meta']['boundaries'],valuations['meta']['presetStarts']),
                revenue=latest['revenue'],profit=latest['profit'],status='estimated' if latest['estimatedCount'] else 'reported',
                estimatedCount=latest['estimatedCount'],missingCount=latest['missingCount'],
                companies=latest['companies'],reportedCount=latest['reportedCount'],
                rollingFinancials=[sum(r[k] for r in window) if complete else None for k in ['revenue','profit']]+
                    [len(window),sum(r['estimatedCount'] for r in window),sum(r['missingCount'] for r in window)],
                latestAnnouncementDate=max((r['announcementDate'] for r in data['latestCompanies'] if r['code'] in group['codes'] and r.get('announcementDate')),default=None)))
        table['groupSummaries']=summaries
        table['financialWindow']=dict(quarters=quarters,fields=['revenue','profit','availableQuarters','estimatedQuarters','missingQuarters'])
        if valuations:table['valuation']=valuations['meta']
        data.pop('latestCompanies')
        save(folder/'main.json',data);save(folder/'companies.json',table)
        item['payloadVersions']={name:hashlib.sha256((folder/name).read_bytes()).hexdigest()[:16] for name in ['main.json','companies.json','sectors.json']}
    # Only content changes invalidate individual JSON caches; refresh timestamps
    # on the page do not force unchanged table/chart files to download again.
    save(root/'catalog.json',catalog)
    (root/'catalog.js').write_text('window.INDUSTRY_CATALOG='+json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+';')

if __name__=='__main__':build(Path(__file__).resolve().parents[1])
