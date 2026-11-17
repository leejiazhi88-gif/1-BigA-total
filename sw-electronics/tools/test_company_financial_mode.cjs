// Run against a local site: SITE_URL=http://localhost:8768/ node tools/test_company_financial_mode.cjs
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const site=path.resolve(__dirname,'..');
const catalog=JSON.parse(fs.readFileSync(path.join(site,'catalog.json'))).industries;
// Independently read canonical CSVs rather than trusting the projected totals.
const expected=JSON.parse(execFileSync('python3',['-c',`
import csv,json
from pathlib import Path
from collections import defaultdict
out={}
for item in json.loads(Path('catalog.json').read_text())['industries']:
 root=Path(item['path']);data=json.loads((root/'data.json').read_text())
 quarters=[r['quarter'] for r in data['series'][-4:]];hist=defaultdict(dict)
 for row in csv.DictReader((root/'company-quarterly.csv').open(encoding='utf-8-sig')):
  if row['quarter'] in quarters:hist[row['code']][row['quarter']]=row
 companies={}
 for company in data['latestCompanies']:
  rows=[hist[company['code']][q] for q in quarters if q in hist[company['code']]]
  missing=any(r['status']=='missing' or any(r[k]=='' for k in ['revenue','profit']) for r in rows)
  estimated=any(r['status']=='estimated' for r in rows)
  complete=len(rows)==4 and not missing
  companies[company['code']]={'quarter':[company['revenue'],company['profit'],company['status']=='estimated','财务缺失' if company['status']=='missing' else '估算' if company['status']=='estimated' else '已披露'],
   'rolling':[sum(float(r[k]) for r in rows) if complete else None for k in ['revenue','profit']]+[estimated,'不足4季' if len(rows)<4 else '财务缺失' if missing else '含估算' if estimated else '四季实报']}
 out[item['key']]={'quarters':quarters,'companies':companies}
print(json.dumps(out,ensure_ascii=False))
`],{cwd:site,maxBuffer:10*1024*1024}));
const fmt=value=>value==null?'—':value.toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});

(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 let checked=0;
 try{
  for(let batch=0;batch<catalog.length;batch+=6){
   const page=await browser.newPage({viewport:{width:1500,height:1000},reducedMotion:'reduce'}),errors=[],requests=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
   await page.goto(process.env.SITE_URL||'http://localhost:8768/',{waitUntil:'networkidle'});
   for(const item of catalog.slice(batch,batch+6)){
    await page.evaluate(key=>ACTIVATE_INDUSTRY(key),item.key);
    const root=page.locator('#industry-'+item.key),e=expected[item.key];
    assert.equal(await root.locator('.supplement-tabs [aria-expanded="true"]').count(),0);
    assert.equal(requests.filter(u=>u.includes('/'+item.path+'companies.json?')).length,0,'company tables must remain lazy');
    // Some modules are first opened after a global mode change.
    if(item.key==='801170')await page.locator('[data-finance-mode="quarter"]').click();
    await root.locator('.supplement-tabs button').nth(1).click();
    await root.locator('[data-company-code]').first().waitFor();
    const tableURL='/'+item.path+'companies.json?';
    const loaded=requests.filter(u=>u.includes(tableURL)).length;
    assert.equal(loaded,1,'one company payload request');
    const identity=await root.locator('[data-company-code]').evaluateAll(rows=>rows.map(r=>[r.dataset.companyCode,...[...r.querySelectorAll('.company-market-cap,.company-pe,.company-pe-rank')].map(c=>c.textContent)]));
    for(const mode of ['rolling','quarter','rolling']){
     await page.locator('[data-finance-mode="'+mode+'"]').click();
     const prefix=mode==='rolling'?'近4季':'单季';
     assert.equal(await root.locator('.companies-section h2').innerText(),(mode==='rolling'?'最近4季':'最新单季')+' · 公司明细');
     assert.match(await root.locator('.company-revenue-heading').innerText(),new RegExp('^'+prefix+'营收'));
     assert.match(await root.locator('.company-profit-heading').innerText(),new RegExp('^'+prefix+'归母净利润'));
     const label=await root.locator('[id$="company-count"]').innerText();
     assert(label.includes(e.quarters.at(-1).replace('Q',' Q')));
     if(mode==='rolling')assert(label.includes(e.quarters[0].replace('Q',' Q')));
     const rendered=await root.locator('[data-company-code]').evaluateAll(rows=>rows.map(r=>[r.dataset.companyCode,...['.company-revenue','.company-profit','.company-status'].map(s=>r.querySelector(s).textContent)]));
     assert.equal(rendered.length,Object.keys(e.companies).length);
     for(const [code,revenue,profit,status] of rendered){
      const [rv,pv,est,state]=e.companies[code][mode],mark=est?' *':'';
      assert.deepEqual([revenue,profit,status],[fmt(rv)+mark,fmt(pv)+mark,state],item.name+' '+code+' '+mode);checked++;
     }
     assert.deepEqual(await root.locator('[data-company-code]').evaluateAll(rows=>rows.map(r=>[r.dataset.companyCode,...[...r.querySelectorAll('.company-market-cap,.company-pe,.company-pe-rank')].map(c=>c.textContent)])),identity,'mode changes must preserve market data and order');
    }
    assert.equal(requests.filter(u=>u.includes(tableURL)).length,loaded,'switching must reuse the loaded table');
    assert(!requests.some(u=>/company-quarterly\.csv|company-pe-source\.json/.test(u)),'no full history download');
    // Search and group counts still work after financial mode switches.
    const code=Object.keys(e.companies)[0],search=root.locator('[id$="company-search"]');
    await search.fill(code);await page.locator('[data-finance-mode="quarter"]').click();
    assert.equal(await search.inputValue(),code);assert.equal(await root.locator('[data-company-code]').count(),1);
    await search.fill('');await page.locator('[data-finance-mode="rolling"]').click();
    if(item.key==='801150'){
     await root.locator('[id$="estimated-only"]').check();
     assert.deepEqual(await root.locator('[data-company-code]').evaluateAll(rs=>rs.map(r=>r.dataset.companyCode)),Object.entries(e.companies).filter(([,v])=>v.rolling[2]).map(([code])=>code));
     await root.locator('[id$="estimated-only"]').uncheck();
    }
    if(item.key==='801170'&&process.env.SCREENSHOT_PATH){
     await search.fill('中国国航');await page.screenshot({path:process.env.SCREENSHOT_PATH});await search.fill('');
    }
    await root.locator('.supplement-tabs button').nth(1).click();
    console.log('PASS',item.name,Object.keys(e.companies).length,'companies, both financial modes');
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('PASS',checked,'company financial displays; 31 industries, labels, defaults, estimates, insufficient history, sorting, search and request reuse');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
