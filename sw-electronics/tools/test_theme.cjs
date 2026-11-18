// SITE_URL=http://127.0.0.1:8768/ node tools/test_theme.cjs
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const catalog=JSON.parse(fs.readFileSync(path.join(__dirname,'../catalog.json'))).industries;
const base=process.env.SITE_URL||'http://127.0.0.1:8768/';
async function toggle(page){await page.locator('#theme-toggle').evaluate(button=>button.click());}
async function snapshot(page,key){return page.evaluate(key=>{
 const module=RESEARCH_MODULES[key],charts=module.getCharts();
 return {state:module.getState(),charts:[charts.main,...Object.values(charts.children)].map(chart=>{
  const o=chart.getOption();return {series:o.series.map(s=>[s.id,s.data.map(p=>p&&typeof p==='object'?p.value:p)]),zoom:o.dataZoom.map(z=>[z.startValue,z.endValue])};
 })};
},key);}
async function verifyCharts(page,key,dark){return page.evaluate(({key,dark})=>{
 const {main,children}=RESEARCH_MODULES[key].getCharts();
 return [main,...Object.values(children)].map(chart=>{
  const o=chart.getOption(),mv=o.series.find(s=>s.id==='mv'),rev=o.series.find(s=>s.id==='revenue');
  return [mv.lineStyle.color,rev.data.find(d=>d.value!=null)?.itemStyle.color??null,o.yAxis[0].splitLine.lineStyle.color,o.tooltip[0].showContent];
 });
},{key,dark}).then(charts=>{
 for(const colors of charts)assert.deepEqual(colors,dark?['#65c9ba',colors[1]===null?null:'#344d5e','#293840',false]:['#147b76',colors[1]===null?null:'#ccdde4','#edf1ee',false]);return charts.length;
});}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});let charts=0;
 try{
  for(let batch=0;batch<catalog.length;batch+=3){
   const page=await browser.newPage({viewport:{width:1500,height:1000},reducedMotion:'reduce'}),errors=[],requests=[];
   page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
   await page.goto(base,{waitUntil:'networkidle'});
   assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
   for(const item of catalog.slice(batch,batch+3)){
    await page.evaluate(async key=>{await ACTIVATE_INDUSTRY(key);await RESEARCH_MODULES[key].setAllSectors(true);},item.key);
    const root=page.locator('#industry-'+item.key);
    await root.locator('.supplement-tabs button').nth(1).click();await root.locator('[data-company-code]').first().waitFor();
    const initial=await snapshot(page,item.key),summary=await root.locator('.company-group').allTextContents();
    const fetches=requests.filter(u=>/\.json\?/.test(u)).length;
    await toggle(page);assert.equal(await page.locator('#theme-toggle').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
    charts+=await verifyCharts(page,item.key,true);assert.deepEqual(await snapshot(page,item.key),initial);
    assert.deepEqual(await root.locator('.company-group').allTextContents(),summary);
    assert.equal(requests.filter(u=>/\.json\?/.test(u)).length,fetches,'theme switch must reuse data');
    await toggle(page);await verifyCharts(page,item.key,false);assert.deepEqual(await snapshot(page,item.key),initial);
    await root.locator('.supplement-tabs button').nth(1).click();
    await page.evaluate(key=>RESEARCH_MODULES[key].setAllSectors(false),item.key);
    console.log('PASS',item.name,'main/mini and tables; light/dark values, controls and requests unchanged');
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  const page=await browser.newPage({viewport:{width:1500,height:1000},reducedMotion:'reduce'});
  await page.goto(base,{waitUntil:'networkidle'});await toggle(page);
  assert.equal(await page.evaluate(()=>localStorage.getItem('quanlantu-theme')),'dark');
  await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.equal(await page.locator('#theme-toggle').getAttribute('aria-label'),'切换日间模式');
  // A module and its cards first loaded at night use the same theme immediately.
  await page.evaluate(async()=>{await ACTIVATE_INDUSTRY('electronics');await RESEARCH_MODULES.electronics.setAllSectors(true);});
  await verifyCharts(page,'electronics',true);
  await page.screenshot({path:path.join(__dirname,'../../../night-mode-desktop.png')});
  const root=page.locator('#industry-electronics');await root.locator('.supplement-tabs button').nth(1).click();
  await root.locator('[data-company-code]').first().waitFor();await root.locator('.companies-section').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(__dirname,'../../../night-mode-companies.png')});
  await page.setViewportSize({width:390,height:900});await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:path.join(__dirname,'../../../night-mode-mobile.png')});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  // Native button keyboard support must work without a pointer.
  await page.locator('#theme-toggle').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.reload({waitUntil:'networkidle'});assert.equal(await page.locator('html').getAttribute('data-theme'),'light');await page.close();
  const blocked=await browser.newPage();await blocked.addInitScript(()=>{Object.defineProperty(Storage.prototype,'getItem',{value(){throw Error('storage disabled');}});Object.defineProperty(Storage.prototype,'setItem',{value(){throw Error('storage disabled');}});});
  await blocked.goto(base,{waitUntil:'networkidle'});await toggle(blocked);assert.equal(await blocked.locator('html').getAttribute('data-theme'),'dark');await blocked.close();
  console.log('PASS',charts,'charts; saved choice after reload, lazy night modules, keyboard, mobile and unavailable storage');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
