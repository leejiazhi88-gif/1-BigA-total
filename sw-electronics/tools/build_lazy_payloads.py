"""Derive view-only company fields and stable cache keys from canonical data."""
import hashlib
import json
from pathlib import Path
import gzip
from company_pe import build as build_valuations

FIELDS=['code','name','marketCap','quoteDate','quoteCarried','revenue','profit','announcementDate','status','sector']

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
        fields=list(FIELDS);valuations=build_valuations(source,data)
        if valuations:fields.append('valuation')
        rows=[]
        for r in data['latestCompanies']:
            record={**r,'sector':index[r['code']]}
            if valuations:record['valuation']=valuations['companies'][r['code']]
            rows.append([record.get(f) for f in fields])
        table=dict(schema=2,fields=fields,groups=[[g['code'],g['name'],g['latestQuote']['marketCap']] for g in groups],rows=rows)
        if valuations:table['valuation']=valuations['meta']
        data.pop('latestCompanies')
        save(folder/'main.json',data);save(folder/'companies.json',table)
        item['payloadVersions']={name:hashlib.sha256((folder/name).read_bytes()).hexdigest()[:16] for name in ['main.json','companies.json','sectors.json']}
    # Only content changes invalidate individual JSON caches; refresh timestamps
    # on the page do not force unchanged table/chart files to download again.
    save(root/'catalog.json',catalog)
    (root/'catalog.js').write_text('window.INDUSTRY_CATALOG='+json.dumps(catalog,ensure_ascii=False,separators=(',',':'))+';')

if __name__=='__main__':build(Path(__file__).resolve().parents[1])
