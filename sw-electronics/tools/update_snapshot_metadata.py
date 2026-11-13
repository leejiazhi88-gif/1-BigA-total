"""Keep current manifests and industry explanations tied to generated payloads."""
import csv
import json
import gzip
import re
from pathlib import Path
from align_sw_data import SITE,read,write

def update():
    source=json.load(gzip.open(SITE/'refresh-source.json.gz','rt'))
    version='refresh-'+re.sub(r'[^0-9]','',source['collectedAt'])
    app=SITE/'app.js';app.write_text(re.sub(r"const assetVersion='[^']+'","const assetVersion='"+version+"'",app.read_text()))
    html=SITE/'index.html';html.write_text(re.sub(r'(style.css|catalog.js|app.js)\?v=[^"\s]+',lambda m:m.group(1)+'?v='+version,html.read_text()))
    catalog=read(SITE/'catalog.json'); overall=read(SITE/'all-industries-audit.json')
    if 'historicalCompanyAggregateAudit' not in overall:
        keys=['asOf','companyCount','companyQuarterRows','sorting','marketMissing','industries','historicalTTMAudit','wholeMarketReconciliation']
        overall['historicalCompanyAggregateAudit']={k:overall.pop(k) for k in keys if k in overall}
    summaries=[]
    for item in catalog['industries']:
        root=SITE/item['path'];d=read(root/'data.json');latest=d['series'][-1];quote=d['latestQuote']
        count=sum(1 for _ in csv.DictReader((root/'company-quarterly.csv').open(encoding='utf-8-sig')))
        manifest=read(root/'data-manifest.json')
        manifest['financialCompanyQuarterRows']=count
        manifest['currentRefresh']={'sourceFile':str(Path(*(['..'] if item['path']=='bank/' else ['..','..'] if item['path'].startswith('industries/') else []))/'refresh-source.json.gz'),
            'financialAsOf':d['meta']['financialAsOf'],'universeAsOf':d['meta']['universeAsOf'],
            'companyQuoteAsOf':d['meta']['companyQuoteAsOf'],'estimatedCount':latest['estimatedCount'],'missingCount':latest['missingCount'],
            'auditFile':'freshness-audit.json (project root)'}
        if 'validation' in manifest:
            manifest['validation']['financialIncompleteQuarters']=[r['quarter'] for r in d['series'] if r['missingCount']]
        manifest['collectionScopeNote']='历史取数统计与旧公司估值审计仅作历史资料；本次新查询见项目根refresh-source.json.gz，核查与哈希见freshness-audit.json。'
        write(root/'data-manifest.json',manifest)
        summaries.append(dict(industry=item['name'],code=item['code'],companies=d['meta']['universeCount'],
            companyQuarterRows=count,quarters=len(d['series']),latest=latest,latestObservation=quote,
            financialIncompleteQuarters=[r['quarter'] for r in d['series'] if r['missingCount']]))
        if item['key']!='electronics':
            (root/'README.md').write_text(f'''# {item['name']} · 全览图

申万2021一级 {item['code']}；财报与在市名单核查至 {d['meta']['asOf']}，当前固定财务样本 {d['meta']['universeCount']} 家，上市后纳入。{d['series'][0]['quarter']}—{latest['quarter']} 共{len(d['series'])}个真实季度，另附 {quote['date']} 最新行情观察点；{item['subIndustryCount']} 个二级行业默认不选。

市值和PE直接取申万 sw_daily，同项目2共用历史快照；最新补充保存在 latest-quotes-source.json。缺失的申万报价不沿用。财务柱按合并累计报表差分；最新观察点重复财报锚点，近4季不多累计一期。最新季度 {latest['reportedCount']} 家实报、{latest['estimatedCount']} 家估算、{latest['missingCount']} 家缺失。

公司明细按最新申万二级市值分组，再按最新公司市值排序，停牌注明沿用日期；公司市值不是申万指数逐股分拆。所有图PE紧邻分位，利润数字在柱底外侧。默认近10年、最近4季财务、PE曲线隐藏，汇总不随指标开关隐藏。

分位使用所选范围全部有效正日度PE，含并列值；快捷范围截至最新时向前推整年。与项目2比较须对齐指数、观察日和区间。完整约定见项目根SW_DATA_CONTRACT.md；后续统一通过tools/refresh_data.py联网刷新、重算及校验。
''')
    overall.update(asOf=catalog['asOf'],companyCount=sum(r['companies'] for r in summaries),
        companyQuarterRows=sum(r['companyQuarterRows'] for r in summaries),sorting='latest-day SW market cap descending',
        industries=summaries,financialSource='refresh-source.json.gz',freshnessAudit='freshness-audit.json')
    write(SITE/'all-industries-audit.json',overall)

if __name__=='__main__':update()
