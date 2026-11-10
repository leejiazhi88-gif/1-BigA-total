'use strict';
const BASE=window.RESEARCH_DATA,GROUPS=window.SECTOR_DATA.groups,$=id=>document.getElementById(id);
let D=BASE,S=D.series,L=S.at(-1);
const selectedSectors=new Set(GROUPS.map(g=>g.code));
const fmt=(v,n=1)=>v==null?'—':Number(v).toLocaleString('zh-CN',{minimumFractionDigits:n,maximumFractionDigits:n});
const pct=(v,n=1)=>fmt(v*100,n)+'%';
const date=v=>v?v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6,8):'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=q=>q.replace('Q',' Q');
let first=Math.max(0,S.length-20),last=S.length-1,showLabels=true,reverseTable=true;
for(const id of ['from-quarter','to-quarter'])$(id).innerHTML=S.map((s,i)=>`<option value="${i}">${short(s.quarter)}</option>`).join('');
function focus(s){$('focus-row').innerHTML=`<strong class="focus-quarter">${short(s.quarter)}</strong><div><span>总市值</span><strong>${fmt(s.marketCap==null?null:s.marketCap/10000,2)}<small> 万亿</small></strong></div><div><span>PE</span><strong>${fmt(s.pe,2)}<small> 倍</small></strong></div><div><span>营收</span><strong>${fmt(s.revenue)}<small> 亿${s.estimatedCount?'*':s.missingCount?'†':''}</small></strong></div><div><span>归母净利</span><strong>${fmt(s.profit)}<small> 亿${s.estimatedCount?'*':s.missingCount?'†':''}</small></strong></div><small class="focus-coverage">${s.reportedCount} 家实报${s.estimatedCount?' / '+s.estimatedCount+' 家估算':''}</small>`;}
focus(L);
const C={mv:'#147b76',pe:'#c47a36',rev:'#ccdde4',profit:'#427f93',loss:'#c47b6c',estimated:'#e2d1ad'};
const chart=echarts.init($('chart'),null,{renderer:'canvas'});window.researchChart=chart;
function nice(x){if(!x)return 1;const p=10**Math.floor(Math.log10(x));return Math.ceil(x/p*2)/2*p;}
function axes(){const visible=S.slice(first,last+1);const mvmax=nice(Math.max(...visible.map(s=>(s.marketCap||s.marketCapObserved)/10000))*1.08),pemax=nice(Math.max(...visible.map(s=>s.pe||0))*1.08),finmax=nice(Math.max(...visible.map(s=>s.revenue))*1.17);const neg=Math.min(0,...visible.map(s=>s.profit));const negRatio=neg<0?Math.max(.08,-neg/finmax*1.25):0;
$('finance-scale').textContent=`柱形独立刻度：${negRatio?fmt(-finmax*negRatio,0):'0'} — ${fmt(finmax,0)} 亿元`;
return [{type:'value',min:-mvmax*negRatio,max:mvmax,splitNumber:5,axisLabel:{color:'#6f8f8c',fontSize:10,formatter:v=>v<0?'':fmt(v,v<1?2:v<2?1:0)},axisLine:{show:false},axisTick:{show:false},splitLine:{lineStyle:{color:'#edf1ee',type:'dashed'}}},
{type:'value',min:-pemax*negRatio,max:pemax,splitNumber:5,position:'right',axisLabel:{color:'#af8b63',fontSize:10,formatter:v=>v<0?'':fmt(v,0)},axisLine:{show:false},axisTick:{show:false},splitLine:{show:false}},
{type:'value',min:-finmax*negRatio,max:finmax,show:false}];}
function valLabel(s,key,position){return{show:showLabels,position,rotate:last-first>38?90:0,distance:5,color:key==='revenue'?'#4f6e7b':'#fff',fontSize:last-first>38?8:10,fontWeight:400,formatter:fmt(s[key],0)+(s.estimatedCount?'*':s.missingCount?'†':'')};}
function barData(key){const maxRevenue=Math.max(...S.slice(first,last+1).map(s=>s.revenue));return S.map(s=>{
if(!s.companies)return {value:null,label:{show:false}};
let v=key==='revenue'?s.revenue-Math.max(0,s.profit):key==='profit'?Math.max(0,s.profit):Math.min(0,s.profit);
let color=key==='revenue'?C.rev:key==='profit'?C.profit:C.loss;
let label=valLabel(s,key==='loss'?'profit':key,key==='revenue'?'insideTop':'inside');
if(key!=='revenue'&&Math.abs(v)<maxRevenue*.042){label.position=key==='loss'?'bottom':'top';label.color=key==='loss'?C.loss:C.profit;label.distance=3;}
if((key==='profit'&&s.profit<=0)||(key==='loss'&&s.profit>=0))label.show=false;
if(key==='revenue'&&s.revenue<maxRevenue*.12){label.position='top';label.distance=6;}
return{value:v,itemStyle:{color,opacity:s.missingCount?.65:1,borderColor:s.estimatedCount?'#aa884f':color,borderWidth:s.estimatedCount?1:0,decal:s.estimatedCount?{symbol:'rect',dashArrayX:[1,0],dashArrayY:[2,4],rotation:Math.PI/4,color:'rgba(137,99,38,0.18)'}:undefined},label};});}
function tooltip(params){let p=params.find(p=>p.dataIndex!=null);if(!p)return'';const s=S[p.dataIndex];focus(s);return `<div class="tooltip"><div class="tooltip-title">${short(s.quarter)} ${s.estimatedCount?' <span style="color:#aa803d;font-size:10px">含估算</span>':''}</div><div class="tooltip-row"><span>总市值 · 亿元</span><b style="color:${C.mv}">${fmt(s.marketCap,2)}</b></div><div class="tooltip-row"><span>整体 PE（TTM）</span><b style="color:${C.pe}">${fmt(s.pe,2)} 倍</b></div><div class="tooltip-row"><span>单季营收${s.missingCount?'（已知合计）':''}</span><b>${fmt(s.revenue,2)} 亿</b></div><div class="tooltip-row"><span>归母净利润${s.missingCount?'（已知合计）':''}</span><b>${fmt(s.profit,2)} 亿</b></div><div class="tooltip-footer">财报 ${s.reportedCount} 家 / ${s.companies} 家；估算 ${s.estimatedCount} 家${s.missingCount?'；缺失 '+s.missingCount+' 家':''}<br>PE 市值覆盖 ${pct(s.peCoverage,2)}；市值沿用 ${s.carriedCount} 家<br>市值 / PE 时点 ${date(s.tradeDate)}${s.estimatedCount?'<br>估算营收 '+fmt(s.estimatedRevenue,2)+' 亿；利润 '+fmt(s.estimatedProfit,2)+' 亿':''}</div></div>`;}
function series(){return [
{id:'profit',name:'归母净利润',type:'bar',stack:'finance',yAxisIndex:2,barMaxWidth:43,barCategoryGap:'24%',z:1,data:barData('profit')},
{id:'revenue',name:'单季营收',type:'bar',stack:'finance',yAxisIndex:2,barMaxWidth:43,z:1,data:barData('revenue')},
{id:'loss',name:'归母净亏损',type:'bar',stack:'finance',yAxisIndex:2,barMaxWidth:43,z:1,data:barData('loss')},
{id:'mv',name:'总市值',type:'line',yAxisIndex:0,z:6,smooth:false,showSymbol:true,symbol:'circle',symbolSize:last-first>40?3:5,lineStyle:{color:C.mv,width:2.5},itemStyle:{color:C.mv,borderColor:'#fff',borderWidth:1},data:S.map(s=>s.marketCap==null?null:s.marketCap/10000)},
{id:'pe',name:'PE（TTM）',type:'line',yAxisIndex:1,z:7,smooth:false,showSymbol:true,symbolSize:last-first>40?3:5,lineStyle:{color:C.pe,width:2},itemStyle:{color:C.pe,borderColor:'#fff',borderWidth:1},data:S.map(s=>({value:s.pe,symbol:s.peCoverage<.9999?'emptyCircle':'circle',symbolSize:s.peCoverage<.9999?6:4}))}
];}
chart.setOption({animation:false,textStyle:{fontFamily:'-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif'},grid:{left:56,right:51,top:16,bottom:76},tooltip:{trigger:'axis',confine:true,backgroundColor:'rgba(255,255,255,.98)',borderColor:'#dce5df',borderWidth:1,padding:16,extraCssText:'box-shadow:0 6px 24px #1b42351a;border-radius:8px;',axisPointer:{type:'line',lineStyle:{color:'#aebeb5',type:'dashed'}},formatter:tooltip},xAxis:{type:'category',data:S.map(s=>s.quarter),axisTick:{show:false},axisLine:{lineStyle:{color:'#d8e1dd'}},axisLabel:{interval:0,rotate:45,fontSize:10,color:'#8a9998',margin:9,formatter:short}},yAxis:axes(),dataZoom:[{type:'slider',startValue:first,endValue:last,height:20,bottom:10,left:56,right:51,borderColor:'#e3ebe5',backgroundColor:'#f8faf7',fillerColor:'rgba(20,123,118,.08)',handleStyle:{color:'#fff',borderColor:'#9ab6aa'},moveHandleSize:0,dataBackground:{lineStyle:{color:'#b4c9c0'},areaStyle:{color:'#e5ece6'}},selectedDataBackground:{lineStyle:{color:'#739c90'},areaStyle:{color:'#c8dad0'}},textStyle:{fontSize:9,color:'#8fa197'},brushSelect:false,showDetail:true,filterMode:'none'},{type:'inside',filterMode:'none',startValue:first,endValue:last,zoomOnMouseWheel:'ctrl',moveOnMouseWheel:false}],series:series()});
function syncControls(){ $('from-quarter').value=first;$('to-quarter').value=last;document.querySelectorAll('[data-range]').forEach(b=>b.classList.toggle('active',last===S.length-1&&((b.dataset.range==='all'&&first===0)||Number(b.dataset.range)===last-first+1)));}
syncControls();
function redraw(){chart.setOption({yAxis:axes(),series:series(),xAxis:{axisLabel:{rotate:last-first>38?90:45,fontSize:last-first>38?8:10}}});syncControls();}
function setRange(a,b){first=a;last=b;chart.dispatchAction({type:'dataZoom',startValue:first,endValue:last});redraw();}
chart.on('datazoom',e=>{const z=e.batch?e.batch[0]:e; if(z.startValue!=null){first=Math.round(z.startValue);last=Math.round(z.endValue);}else if(z.start!=null){first=Math.round(z.start/100*(S.length-1));last=Math.round(z.end/100*(S.length-1));}redraw();});
document.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click',()=>setRange(b.dataset.range==='all'?0:Math.max(0,S.length-Number(b.dataset.range)),S.length-1)));
$('from-quarter').addEventListener('change',e=>{const a=Number(e.target.value);setRange(a,Math.max(a,last));});
$('to-quarter').addEventListener('change',e=>{const b=Number(e.target.value);setRange(Math.min(first,b),b);});
$('labels').addEventListener('change',e=>{showLabels=e.target.checked;redraw();});
new ResizeObserver(()=>chart.resize()).observe($('chart').parentElement);
function renderCoverage(){
const E=D.estimates[0];
if(E){
$('estimate-panel').innerHTML=`<div><h3>最新季度估算：${L.reportedCount} 家实报，${L.estimatedCount} 家估算</h3><p>截至 ${D.meta.asOf}，数据源未返回中芯国际（688981.SH）三季报。最新柱形合计含其估算，斜纹与 * 标出含估算季度。</p><p>估算营收占行业合计 <b>${pct(L.estimatedRevenue/L.revenue,2)}</b>，估算利润占 <b>${pct(L.estimatedProfit/L.profit,2)}</b>。这是机械外推，不是公司业绩指引或券商一致预期。</p></div><div class="estimate-formula"><div>营收依据：2025Q3 单季营收 <b>${fmt(E.priorRevenue,2)} 亿</b> ×（1 + 2026H1 营收同比 <b>${pct(E.growth,2)}</b>）</div><div class="formula-result">中芯国际 2026Q3 估算营收 = <b>${fmt(E.revenue,2)} 亿元</b></div><div>利润依据：估算营收 × 2026H1 归母净利率 <b>${pct(E.margin,2)}</b></div><div class="formula-result">中芯国际 2026Q3 估算归母净利润 = <b>${fmt(E.profit,2)} 亿元</b></div></div>`;
}else{$('estimate-panel').innerHTML=`<h3>最新季度估算</h3><p>${L.companies?'当前所选行业均已取得最新季度财报，无估算公司。':'尚未选择二级行业。'}</p>`;}
const incomplete=S.filter(s=>s.missingCount);const minPe=Math.min(...S.map(s=>s.peCoverage));
const available=S.filter(s=>s.companies>0),minCoverage=available.length?Math.min(...available.map(s=>s.peCoverage)):null;
$('quality-note').innerHTML=available.length?`<b>所选行业数据边界：</b>${incomplete.length?incomplete.map(s=>short(s.quarter)+' 缺 '+s.missingCount+' 家').join('；')+'。标 † 的柱形为已知公司合计，缺失不填零。':'已有样本的各季度财务均完整覆盖（含标注估算）。'} PE 历史市值覆盖最低 ${minCoverage==null?'—':pct(minCoverage,2)}；覆盖不足的点为空心圆，合计 TTM 利润非正时 PE 留空。`:'请选择二级行业。';
$('quality-body').innerHTML=S.map((s,i)=>{const q=D.quality[i],notes=[];if(q.financialMissing.length)notes.push('财务缺失：'+q.financialMissing.map(c=>esc(c.name)+' '+c.code).join('、'));if(q.peMissing.length)notes.push('PE 缺失：'+q.peMissing.map(c=>esc(c.name)).join('、'));if(q.carried.length)notes.push('沿用市值：'+q.carried.map(c=>esc(c.name)+'（'+date(c.date)+'）').join('、'));if(s.estimatedCount)notes.push('财务估算：中芯国际');return`<tr><td>${short(s.quarter)}</td><td>${s.reportedCount}+${s.estimatedCount}估算 / ${s.companies}</td><td>${pct(s.peCoverage,2)}</td><td>${s.carriedCount} 家</td><td>${notes.join('<br>')||(s.companies?'完整覆盖':'无已上市样本')}</td></tr>`;}).join('');
}
renderCoverage();
function renderQuarterTable(){const rows=reverseTable?[...S].reverse():S;$('quarter-body').innerHTML=rows.map(s=>`<tr class="${s.estimatedCount?'estimate-row':''}"><td>${short(s.quarter)}</td><td>${fmt(s.marketCap,2)}</td><td>${fmt(s.pe,2)}${s.peCoverage<.9999?' ◦':''}</td><td>${fmt(s.revenue,2)}${s.estimatedCount?' *':s.missingCount?' †':''}</td><td>${fmt(s.profit,2)}${s.estimatedCount?' *':s.missingCount?' †':''}</td><td>${s.companies}</td><td><span class="tag ${s.estimatedCount?'estimate':s.missingCount?'partial':''}">${!s.companies?'无样本':s.estimatedCount?s.reportedCount+' 实报 + '+s.estimatedCount+' 估算':s.missingCount?'缺 '+s.missingCount+' 家 · 已知合计':'全部实报'}</span></td></tr>`).join('');}
renderQuarterTable();$('table-order').addEventListener('click',()=>{reverseTable=!reverseTable;$('table-order').textContent='当前：'+(reverseTable?'由近到远':'由远到近')+' ⇅';renderQuarterTable();});
function renderCompanies(){const query=$('company-search').value.trim().toLowerCase(),only=$('estimated-only').checked;let rows=D.latestCompanies.filter(r=>(!only||r.status==='estimated')&&(!query||(r.name+r.code).toLowerCase().includes(query))).sort((a,b)=>(b.revenue||0)-(a.revenue||0));$('company-count').textContent=`显示 ${rows.length} / ${D.latestCompanies.length} 家，按营收从高到低排列`;$('company-body').innerHTML=rows.map(r=>`<tr class="${r.status==='estimated'?'estimate-row':''}"><td>${esc(r.name)}</td><td>${r.code}</td><td>${fmt(r.revenue,2)}</td><td>${fmt(r.profit,2)}</td><td>${date(r.announcementDate)}</td><td><span class="tag ${r.status==='estimated'?'estimate':''}">${r.status==='estimated'?'估算':'已披露'}</span></td></tr>`).join('')||'<tr><td colspan="6" style="text-align:center">没有匹配的公司</td></tr>';}
$('company-search').addEventListener('input',renderCompanies);$('estimated-only').addEventListener('change',renderCompanies);renderCompanies();
$('source-links').innerHTML=D.meta.sourceLinks.map(s=>`<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.name} ↗</a>`).join('');
window.RESEARCH_STATE=()=>({first,last,showLabels,selectedSectors:[...selectedSectors],latest:L});

// Supplementary data: only the selected panel is expanded; initial state is closed.
const supplementButtons=[...document.querySelectorAll('.supplement-tabs button')];
function openSupplement(panelId){
 for(const button of supplementButtons){
  const open=button.getAttribute('aria-controls')===panelId;
  button.setAttribute('aria-expanded',String(open));
  button.querySelector('span').textContent=open?'−':'＋';
  $(button.getAttribute('aria-controls')).hidden=!open;
 }
}
for(const button of supplementButtons)button.addEventListener('click',()=>openSupplement(button.getAttribute('aria-expanded')==='true'?null:button.getAttribute('aria-controls')));
function showLinkedSupplement(){
 const panelId=location.hash.slice(1);
 if(supplementButtons.some(button=>button.getAttribute('aria-controls')===panelId)){
  openSupplement(panelId);
  requestAnimationFrame(()=>$(panelId).scrollIntoView({block:'start'}));
 }
}
window.addEventListener('hashchange',showLinkedSupplement);
showLinkedSupplement();

// Latest-quarter amounts in the industry picker remain independent of the chart cursor.
function marketLabel(value){return value==null?'—':value>=10000?fmt(value/10000,2)+'万亿':fmt(value,0)+'亿';}
$('all-market-cap').textContent=marketLabel(BASE.series.at(-1).marketCap);
$('sector-options').innerHTML=GROUPS.map(g=>`<label class="sector-option"><input type="checkbox" data-sector="${g.code}" checked><span>${esc(g.name)}</span><strong>${marketLabel(g.series.at(-1).marketCap)}</strong></label>`).join('');
const additiveFields=['companies','marketCapObserved','peMarketCap','peProfit','peMissingCount','peRebuiltCount','revenue','profit','reportedCount','estimatedCount','missingCount','estimatedRevenue','estimatedProfit','carriedCount','marketMissingCount'];
function selectedDataset(){
 if(selectedSectors.size===GROUPS.length)return BASE;
 const groups=GROUPS.filter(g=>selectedSectors.has(g.code)),codes=new Set(groups.flatMap(g=>g.codes));
 const series=BASE.series.map((base,i)=>{
  const row={quarter:base.quarter,endDate:base.endDate,tradeDate:base.tradeDate};
  for(const field of additiveFields)row[field]=groups.reduce((sum,g)=>sum+(g.series[i][field]||0),0);
  row.marketCap=row.companies&&!row.marketMissingCount?row.marketCapObserved:null;
  row.pe=row.peProfit>0?row.peMarketCap/row.peProfit:null;
  row.peCoverage=row.marketCapObserved?row.peMarketCap/row.marketCapObserved:0;
  row.financialCoverage=row.companies?(row.reportedCount+row.estimatedCount)/row.companies:0;
  if(!row.companies){row.revenue=null;row.profit=null;}
  return row;
 });
 const quality=BASE.quality.map((q,i)=>({quarter:q.quarter,...Object.fromEntries(['financialMissing','peMissing','marketMissing','carried'].map(key=>[key,groups.flatMap(g=>g.quality[i][key])]))}));
 return {meta:{...BASE.meta,universeCount:groups.reduce((n,g)=>n+g.universeCount,0)},series,quality,estimates:BASE.estimates.filter(e=>codes.has(e.code)),latestCompanies:BASE.latestCompanies.filter(c=>codes.has(c.code))};
}
function syncSectorPicker(){
 const chosen=GROUPS.filter(g=>selectedSectors.has(g.code)),all=chosen.length===GROUPS.length;
 $('sector-all').checked=all;$('sector-all').indeterminate=chosen.length>0&&!all;
 document.querySelectorAll('[data-sector]').forEach(input=>input.checked=selectedSectors.has(input.dataset.sector));
 const label=all?'全部二级行业':chosen.length===1?chosen[0].name:chosen.length?'已选 '+chosen.length+' 个二级行业':'选择二级行业';
 $('sector-selection').textContent=label;
 $('selected-market-cap').textContent=marketLabel(L.marketCap);
 $('selected-market-cap').title='2026Q3 季末总市值';
 $('selection-total').textContent=marketLabel(L.marketCap);
 $('sector-trigger').setAttribute('aria-label',label+'，2026Q3总市值 '+marketLabel(L.marketCap));
 $('selection-method').textContent=chosen.length?'当前范围：'+chosen.map(g=>g.name).join('、')+'；固定成分 '+D.meta.universeCount+' 家，2026Q3 纳入 '+L.companies+' 家。':'当前未选择二级行业。';
 $('chart').setAttribute('aria-label','电子：'+(chosen.map(g=>g.name).join('、')||'未选行业')+'；总市值、PE、单季营收和归母净利润季度图');
}
function applySectorSelection(){
 chart.dispatchAction({type:'hideTip'});
 D=selectedDataset();S=D.series;L=S.at(-1);
 syncSectorPicker();focus(L);redraw();renderCoverage();renderQuarterTable();renderCompanies();
 chart.setOption({graphic:[{id:'empty-selection',type:'text',left:'center',top:'middle',silent:true,style:{text:selectedSectors.size?'':'请选择二级行业',fontSize:13,fill:'#7b8f84'}}]});
}
function closeSectorMenu(){ $('sector-menu').hidden=true;$('sector-trigger').setAttribute('aria-expanded','false');}
$('sector-trigger').addEventListener('click',()=>{const open=$('sector-menu').hidden;$('sector-menu').hidden=!open;$('sector-trigger').setAttribute('aria-expanded',String(open));});
$('sector-all').addEventListener('change',e=>{selectedSectors.clear();if(e.target.checked)GROUPS.forEach(g=>selectedSectors.add(g.code));applySectorSelection();});
$('sector-options').addEventListener('change',e=>{const code=e.target.dataset.sector;if(!code)return;if(e.target.checked)selectedSectors.add(code);else selectedSectors.delete(code);applySectorSelection();});
document.addEventListener('click',e=>{if(!$('sector-picker').contains(e.target))closeSectorMenu();});
$('sector-picker').addEventListener('keydown',e=>{if(e.key==='Escape'){closeSectorMenu();$('sector-trigger').focus();}});
$('sector-picker').addEventListener('focusout',e=>{if(e.relatedTarget&&!$('sector-picker').contains(e.relatedTarget))closeSectorMenu();});
syncSectorPicker();
