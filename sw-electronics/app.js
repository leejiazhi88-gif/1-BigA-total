'use strict';
const BASE=window.RESEARCH_DATA,GROUPS=[...window.SECTOR_DATA.groups].sort((a,b)=>(b.series.at(-1).marketCap||0)-(a.series.at(-1).marketCap||0)),$=id=>document.getElementById(id);
const D=BASE,S=BASE.series,L=S.at(-1);
const selectedSectors=new Set(GROUPS.map(g=>g.code));
const visibleMetrics={mv:true,pe:true,revenue:true,profit:true};
const miniCharts=new Map();
const fmt=(v,n=1)=>v==null?'—':Number(v).toLocaleString('zh-CN',{minimumFractionDigits:n,maximumFractionDigits:n});
const pct=(v,n=1)=>fmt(v*100,n)+'%';
const date=v=>v?v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6,8):'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=q=>q.replace('Q',' Q');
function marketLabel(value){return value==null?'—':value>=10000?fmt(value/10000,2)+'万亿':fmt(value,0)+'亿';}
function peText(s){return s.pe!=null?fmt(s.pe,2):s.companies&&s.peProfit<=0?'不适用':'—';}
// Empirical percentile within the selected quarterly window; invalid PE is excluded.
function pePercentile(rows,value){
 if(!Number.isFinite(value)||value<=0)return null;
 const values=rows.slice(first,last+1).map(s=>s.pe).filter(v=>Number.isFinite(v)&&v>0);
 return values.length?values.filter(v=>v<=value).length/values.length:null;
}
function pePercentileText(rows,value){const rank=pePercentile(rows,value);return rank==null?'—':pct(rank,1);}
function pePercentileHint(rows,s){const count=rows.slice(first,last+1).filter(r=>Number.isFinite(r.pe)&&r.pe>0).length;return `${short(s.quarter)} PE；区间 ${short(S[first].quarter)}—${short(S[last].quarter)}，${count} 个有效季度；不高于该 PE 的季度占比`;}
function peReason(s){return !s.companies?'无已上市样本':s.peProfit<=0?'TTM利润合计非正，PE不适用':s.pe>500?'TTM净利润相对市值接近零，PE对利润变化高度敏感':'';}
let first=Math.max(0,S.length-20),last=S.length-1,showLabels=true,reverseTable=true,focusedQuarter=L;
for(const id of ['from-quarter','to-quarter'])$(id).innerHTML=S.map((s,i)=>`<option value="${i}">${short(s.quarter)}</option>`).join('');
function focus(s){focusedQuarter=s;$('focus-row').innerHTML=`<strong class="focus-quarter">电子 · ${short(s.quarter)}</strong>${visibleMetrics.mv?`<div><span>总市值</span><strong>${fmt(s.marketCap==null?null:s.marketCap/10000,2)}<small> 万亿</small></strong></div>`:''}${visibleMetrics.pe?`<div><span>PE</span><strong>${peText(s)}<small>${s.pe==null?'':' 倍'}</small></strong></div>`:''}${visibleMetrics.revenue?`<div><span>营收</span><strong>${fmt(s.revenue)}<small> 亿${s.estimatedCount?'*':s.missingCount?'†':''}</small></strong></div>`:''}${visibleMetrics.profit?`<div><span>归母净利</span><strong>${fmt(s.profit)}<small> 亿${s.estimatedCount?'*':s.missingCount?'†':''}</small></strong></div>`:''}${visibleMetrics.pe?`<div class="pe-percentile" title="${pePercentileHint(S,s)}"><span>PE分位</span><strong>${pePercentileText(S,s.pe)}</strong></div>`:''}<small class="focus-coverage">${s.reportedCount} 家实报${s.estimatedCount?' / '+s.estimatedCount+' 家估算':''}</small>`;}
focus(L);
const C={mv:'#147b76',pe:'#c47a36',rev:'#ccdde4',profit:'#427f93',loss:'#c47b6c'};
const chart=echarts.init($('chart'),null,{renderer:'canvas'});window.researchChart=chart;
function nice(x){if(!x||x<0)return 1;const p=10**Math.floor(Math.log10(x));return Math.ceil(x/p*2)/2*p;}
function chartAxes(rows,mini){
 const visible=rows.slice(first,last+1);
 const mvmax=nice(Math.max(0,...visible.map(s=>(s.marketCap||s.marketCapObserved||0)/10000)))*1.08;
 const pemax=nice(Math.max(0,...visible.map(s=>s.pe||0)))*1.08;
 const financial=visibleMetrics.revenue||visibleMetrics.profit;
 const finmax=nice(Math.max(0,...visible.map(s=>visibleMetrics.revenue?(s.revenue||0):visibleMetrics.profit?Math.max(0,s.profit||0):0)))*1.17;
 const negative=visibleMetrics.profit?Math.min(0,...visible.map(s=>s.profit||0)):0;
 const negRatio=negative<0?Math.max(.08,-negative/finmax*1.25):0;
 const scale=financial?`${visibleMetrics.revenue?'柱':'利润'}：${negRatio?fmt(-finmax*negRatio,0):'0'}—${fmt(finmax,0)}亿元`:'';
 return {scale,finmax,axes:[
 {type:'value',min:-mvmax*negRatio,max:mvmax,show:visibleMetrics.mv,splitNumber:mini?3:5,axisLabel:{color:'#6f8f8c',fontSize:mini?8:10,formatter:v=>v<0?'':fmt(v,v<1?2:v<2?1:0)},axisLine:{show:false},axisTick:{show:false},splitLine:{show:true,lineStyle:{color:'#edf1ee',type:'dashed'}}},
 {type:'value',min:-pemax*negRatio,max:pemax,show:visibleMetrics.pe,position:'right',splitNumber:mini?3:5,axisLabel:{color:'#af8b63',fontSize:mini?8:10,formatter:v=>v<0?'':fmt(v,0)},axisLine:{show:false},axisTick:{show:false},splitLine:{show:false}},
 {type:'value',min:-finmax*negRatio,max:finmax,show:false}
 ]};
}
function bars(rows,key,mini,finmax){return rows.map(s=>{
 if(!s.companies)return{value:null,label:{show:false}};
 const v=key==='revenue'?s.revenue-(visibleMetrics.profit?Math.max(0,s.profit):0):key==='profit'?Math.max(0,s.profit):Math.min(0,s.profit);
 const color=key==='revenue'?C.rev:key==='profit'?C.profit:C.loss;
 const metric=key==='loss'?'profit':key;
 const label={show:showLabels,position:key==='revenue'?'insideTop':'inside',rotate:last-first>(mini?10:38)?90:0,distance:mini?2:5,color:key==='revenue'?'#4f6e7b':'#fff',fontSize:mini?8:last-first>38?8:10,formatter:fmt(s[metric],0)+(s.estimatedCount?'*':s.missingCount?'†':'')};
 if(key!=='revenue'&&Math.abs(v)<finmax*.04){label.position=key==='loss'?'bottom':'top';label.color=key==='loss'?C.loss:C.profit;label.distance=3;}
 if((key==='profit'&&s.profit<=0)||(key==='loss'&&s.profit>=0))label.show=false;
 if(key==='revenue'&&s.revenue<finmax*.1){label.position='top';label.distance=4;}
 return {value:v,itemStyle:{color,opacity:s.missingCount?.65:1,borderColor:s.estimatedCount?'#aa884f':color,borderWidth:s.estimatedCount?1:0,decal:s.estimatedCount?{symbol:'rect',dashArrayX:[1,0],dashArrayY:[2,4],rotation:Math.PI/4,color:'rgba(137,99,38,.18)'}:undefined},label};
});}
function lossAreas(rows){const areas=[];let start=null;for(let i=first;i<=last+1;i++){const loss=i<=last&&rows[i].companies>0&&rows[i].peProfit<=0;if(loss&&start===null)start=i;if(!loss&&start!==null){if(i-1>start)areas.push([{name:'PE不适用',xAxis:rows[start].quarter},{xAxis:rows[i-1].quarter}]);start=null;}}return areas;}
function makeSeries(rows,mini,finmax){const series=[],barMaxWidth=mini?24:43;
 if(visibleMetrics.profit)series.push({id:'profit',name:'归母净利润',type:'bar',stack:'finance',yAxisIndex:2,barMaxWidth,barCategoryGap:'24%',z:1,data:bars(rows,'profit',mini,finmax)});
 if(visibleMetrics.revenue)series.push({id:'revenue',name:'单季营收',type:'bar',stack:'finance',yAxisIndex:2,barMaxWidth,z:1,data:bars(rows,'revenue',mini,finmax)});
 if(visibleMetrics.profit)series.push({id:'loss',name:'归母净亏损',type:'bar',stack:'finance',yAxisIndex:2,barMaxWidth,z:1,data:bars(rows,'loss',mini,finmax)});
 if(visibleMetrics.mv)series.push({id:'mv',name:'总市值',type:'line',yAxisIndex:0,z:6,smooth:false,showSymbol:!mini||last-first<30,symbol:'circle',symbolSize:mini?3:last-first>40?3:5,lineStyle:{color:C.mv,width:mini?1.8:2.5},itemStyle:{color:C.mv,borderColor:'#fff',borderWidth:1},data:rows.map(s=>s.marketCap==null?null:s.marketCap/10000)});
 if(visibleMetrics.pe)series.push({id:'pe',name:'PE（TTM）',type:'line',yAxisIndex:1,z:7,connectNulls:false,smooth:false,markArea:{silent:true,itemStyle:{color:'rgba(193,136,91,.07)'},label:{show:true,position:'insideTop',fontSize:mini?8:9,color:'#a18c77'},data:lossAreas(rows)},showSymbol:!mini||last-first<30,symbolSize:mini?3:4,lineStyle:{color:C.pe,width:mini?1.5:2},itemStyle:{color:C.pe,borderColor:'#fff',borderWidth:1},data:rows.map(s=>({value:s.pe,symbol:s.peCoverage<.9999?'emptyCircle':'circle',symbolSize:s.peCoverage<.9999?mini?4:6:mini?2:4}))});
 return series;
}
function tooltipFor(rows,name,main){return params=>{
 const p=params.find(p=>p.dataIndex!=null);if(!p)return'';const s=rows[p.dataIndex];if(main)focus(s);
 let body=`<div class="tooltip"><div class="tooltip-title">${esc(name)} · ${short(s.quarter)}${s.estimatedCount?' <small>含估算</small>':''}</div>`;
 const row=(label,v,color='')=>`<div class="tooltip-row"><span>${label}</span><b style="color:${color}">${v}</b></div>`;
 if(visibleMetrics.mv)body+=row('总市值 · 亿元',fmt(s.marketCap,2),C.mv);
 if(visibleMetrics.pe)body+=row('整体 PE（TTM）',peText(s)+(s.pe==null?'':' 倍'),C.pe);
 if(visibleMetrics.revenue)body+=row('单季营收'+(s.missingCount?'（已知合计）':''),fmt(s.revenue,2)+' 亿');
 if(visibleMetrics.profit)body+=row('归母净利润'+(s.missingCount?'（已知合计）':''),fmt(s.profit,2)+' 亿');
 if(visibleMetrics.pe)body+=row('PE分位 · 所选区间',pePercentileText(rows,s.pe),C.pe);
 body+='<div class="tooltip-footer">';
 if(visibleMetrics.pe)body+=`${peReason(s)?'<b>'+peReason(s)+'</b><br>':''}PE 分子市值 ${fmt(s.peMarketCap,2)} 亿<br>PE 分母 TTM 归母净利润 ${fmt(s.peProfit,4)} 亿<br>PE 市值覆盖 ${pct(s.peCoverage,2)}<br>`;
 body+=`财报 ${s.reportedCount} / ${s.companies} 家；估算 ${s.estimatedCount} 家${s.missingCount?'；缺失 '+s.missingCount+' 家':''}<br>季度末 ${date(s.tradeDate)}`;
 if(visibleMetrics.mv)body+=`；市值沿用 ${s.carriedCount} 家`;
 if(s.estimatedCount&&visibleMetrics.revenue)body+=`<br>估算营收 ${fmt(s.estimatedRevenue,2)} 亿`;
 if(s.estimatedCount&&visibleMetrics.profit)body+=`<br>估算利润 ${fmt(s.estimatedProfit,2)} 亿`;
 return body+'</div></div>';
};}
function miniSummary(group){const s=group.series.at(-1),parts=[];if(visibleMetrics.pe)parts.push('PE '+peText(s));if(visibleMetrics.revenue)parts.push('营收 '+fmt(s.revenue,0)+'亿'+(s.estimatedCount?'*':''));if(visibleMetrics.profit)parts.push('净利 '+fmt(s.profit,1)+'亿'+(s.estimatedCount?'*':''));if(visibleMetrics.pe)parts.push('PE分位 '+pePercentileText(group.series,s.pe));return parts.map(part=>`<span${part.startsWith('PE分位 ')?' class="pe-percentile" title="'+pePercentileHint(group.series,s)+'"':''}>${esc(part)}</span>`).join('');}
function updateChart(instance,rows,name,mini=false,code=''){
 const {axes,scale,finmax}=chartAxes(rows,mini);
 if(mini){const el=instance.getDom().closest('.mini-card');el.querySelector('.mini-axis-mv').textContent=visibleMetrics.mv?'市值·万亿':'';el.querySelector('.mini-axis-pe').textContent=visibleMetrics.pe?'PE·倍':'';el.querySelector('.mini-axis-finance').textContent=scale;el.querySelector('.mini-summary').innerHTML=miniSummary(GROUPS.find(g=>g.code===code));el.querySelector('.mini-cap').hidden=!visibleMetrics.mv;}
 else{$('finance-scale').textContent=scale;document.querySelector('.axis-caption>.mv-text').textContent=visibleMetrics.mv?'市值 · 万亿元':'';document.querySelector('.axis-caption>.pe-text').textContent=visibleMetrics.pe?'PE · 倍':'';}
 const zoom={startValue:first,endValue:last,filterMode:'none'};
 instance.setOption({animation:false,textStyle:{fontFamily:'-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif'},grid:{left:mini?40:56,right:mini?35:51,top:mini?12:16,bottom:mini?49:76},tooltip:{trigger:'axis',confine:true,backgroundColor:'rgba(255,255,255,.98)',borderColor:'#dce5df',borderWidth:1,padding:mini?10:16,extraCssText:'box-shadow:0 6px 24px #1b42351a;border-radius:8px;',axisPointer:{type:'line',lineStyle:{color:'#aebeb5',type:'dashed'}},formatter:tooltipFor(rows,name,!mini)},xAxis:{type:'category',data:rows.map(s=>s.quarter),axisTick:{show:false},axisLine:{lineStyle:{color:'#d8e1dd'}},axisLabel:{interval:mini?Math.max(0,Math.floor((last-first+1)/8)-1):0,rotate:mini?45:last-first>38?90:45,fontSize:mini?8:last-first>38?8:10,color:'#8a9998',margin:mini?6:9,formatter:short}},yAxis:axes,dataZoom:mini?[{type:'inside',...zoom,disabled:true}]:[{type:'slider',...zoom,height:20,bottom:10,left:56,right:51,borderColor:'#e3ebe5',backgroundColor:'#f8faf7',fillerColor:'rgba(20,123,118,.08)',handleStyle:{color:'#fff',borderColor:'#9ab6aa'},moveHandleSize:0,dataBackground:{lineStyle:{color:'#b4c9c0'},areaStyle:{color:'#e5ece6'}},selectedDataBackground:{lineStyle:{color:'#739c90'},areaStyle:{color:'#c8dad0'}},textStyle:{fontSize:9,color:'#8fa197'},brushSelect:false,showDetail:true},{type:'inside',...zoom,zoomOnMouseWheel:'ctrl',moveOnMouseWheel:false}],series:makeSeries(rows,mini,finmax),graphic:[{id:'all-hidden',type:'text',left:'center',top:'middle',silent:true,style:{text:Object.values(visibleMetrics).some(Boolean)?'':'点击上方图例显示指标',fontSize:mini?10:12,fill:'#8b9b92'}}]}, {replaceMerge:['series']});
}
function syncControls(){ $('from-quarter').value=first;$('to-quarter').value=last;document.querySelectorAll('[data-range]').forEach(b=>b.classList.toggle('active',last===S.length-1&&((b.dataset.range==='all'&&first===0)||Number(b.dataset.range)===last-first+1)));}
function redraw(){if(!S.slice(first,last+1).includes(focusedQuarter))focusedQuarter=S[last];focus(focusedQuarter);updateChart(chart,S,'电子');for(const [code,item]of miniCharts)updateChart(item.chart,item.group.series,item.group.name,true,code);syncControls();}
function setRange(a,b){first=Math.max(0,Math.min(a,S.length-1));last=Math.max(first,Math.min(b,S.length-1));redraw();}
chart.on('datazoom',e=>{const z=e.batch?e.batch[0]:e;if(z.startValue!=null){first=Math.round(z.startValue);last=Math.round(z.endValue);}else if(z.start!=null){first=Math.round(z.start/100*(S.length-1));last=Math.round(z.end/100*(S.length-1));}redraw();});
document.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click',()=>setRange(b.dataset.range==='all'?0:Math.max(0,S.length-Number(b.dataset.range)),S.length-1)));
$('from-quarter').addEventListener('change',e=>{const a=Number(e.target.value);setRange(a,Math.max(a,last));});
$('to-quarter').addEventListener('change',e=>{const b=Number(e.target.value);setRange(Math.min(first,b),b);});
$('labels').addEventListener('change',e=>{showLabels=e.target.checked;redraw();});
document.querySelectorAll('[data-metric]').forEach(button=>button.addEventListener('click',()=>{const key=button.dataset.metric;visibleMetrics[key]=!visibleMetrics[key];button.setAttribute('aria-pressed',String(visibleMetrics[key]));chart.dispatchAction({type:'hideTip'});for(const item of miniCharts.values())item.chart.dispatchAction({type:'hideTip'});focus(focusedQuarter);redraw();}));
const chartObserver=new ResizeObserver(entries=>{for(const entry of entries){const instance=echarts.getInstanceByDom(entry.target);if(instance&&!instance.isDisposed())instance.resize();}});chartObserver.observe($('chart'));

function renderCoverage(){
const E=D.estimates[0];
if(E){
$('estimate-panel').innerHTML=`<div><h3>最新季度估算：${L.reportedCount} 家实报，${L.estimatedCount} 家估算</h3><p>截至 ${D.meta.asOf}，数据源未返回中芯国际（688981.SH）三季报。最新柱形合计含其估算，斜纹与 * 标出含估算季度。</p><p>估算营收占行业合计 <b>${pct(L.estimatedRevenue/L.revenue,2)}</b>，估算利润占 <b>${pct(L.estimatedProfit/L.profit,2)}</b>。这是机械外推，不是公司业绩指引或券商一致预期。</p></div><div class="estimate-formula"><div>营收依据：2025Q3 单季营收 <b>${fmt(E.priorRevenue,2)} 亿</b> ×（1 + 2026H1 营收同比 <b>${pct(E.growth,2)}</b>）</div><div class="formula-result">中芯国际 2026Q3 估算营收 = <b>${fmt(E.revenue,2)} 亿元</b></div><div>利润依据：估算营收 × 2026H1 归母净利率 <b>${pct(E.margin,2)}</b></div><div class="formula-result">中芯国际 2026Q3 估算归母净利润 = <b>${fmt(E.profit,2)} 亿元</b></div></div>`;
}else{$('estimate-panel').innerHTML=`<h3>最新季度估算</h3><p>${L.companies?'当前所选行业均已取得最新季度财报，无估算公司。':'尚未选择二级行业。'}</p>`;}
const incomplete=S.filter(s=>s.missingCount);
const available=S.filter(s=>s.companies>0),minCoverage=available.length?Math.min(...available.map(s=>s.peCoverage)):null;
$('quality-note').innerHTML=available.length?`<b>电子整体数据边界：</b>${incomplete.length?incomplete.map(s=>short(s.quarter)+' 缺 '+s.missingCount+' 家').join('；')+'。标 † 的柱形为已知公司合计，缺失不填零。':'已有样本的各季度财务均完整覆盖（含标注估算）。'} PE 历史市值覆盖最低 ${minCoverage==null?'—':pct(minCoverage,2)}；覆盖不足的点为空心圆，合计 TTM 利润非正时 PE 留空。`:'请选择二级行业。';
$('quality-body').innerHTML=S.map((s,i)=>{const q=D.quality[i],notes=[];if(q.financialMissing.length)notes.push('财务缺失：'+q.financialMissing.map(c=>esc(c.name)+' '+c.code).join('、'));if(q.peMissing.length)notes.push('PE 缺失：'+q.peMissing.map(c=>esc(c.name)).join('、'));if(q.carried.length)notes.push('沿用市值：'+q.carried.map(c=>esc(c.name)+'（'+date(c.date)+'）').join('、'));if(s.estimatedCount)notes.push('财务估算：中芯国际');return`<tr><td>${short(s.quarter)}</td><td>${s.reportedCount}+${s.estimatedCount}估算 / ${s.companies}</td><td>${pct(s.peCoverage,2)}</td><td>${s.carriedCount} 家</td><td>${notes.join('<br>')||(s.companies?'完整覆盖':'无已上市样本')}</td></tr>`;}).join('');
}
renderCoverage();
function renderQuarterTable(){const rows=reverseTable?[...S].reverse():S;$('quarter-body').innerHTML=rows.map(s=>`<tr class="${s.estimatedCount?'estimate-row':''}"><td>${short(s.quarter)}</td><td>${fmt(s.marketCap,2)}</td><td title="${peReason(s)}；TTM利润 ${fmt(s.peProfit,4)}亿元">${peText(s)}${s.peCoverage<.9999?' ◦':''}</td><td>${fmt(s.revenue,2)}${s.estimatedCount?' *':s.missingCount?' †':''}</td><td>${fmt(s.profit,2)}${s.estimatedCount?' *':s.missingCount?' †':''}</td><td>${s.companies}</td><td><span class="tag ${s.estimatedCount?'estimate':s.missingCount?'partial':''}">${!s.companies?'无样本':s.estimatedCount?s.reportedCount+' 实报 + '+s.estimatedCount+' 估算':s.missingCount?'缺 '+s.missingCount+' 家 · 已知合计':'全部实报'}</span></td></tr>`).join('');}
renderQuarterTable();$('table-order').addEventListener('click',()=>{reverseTable=!reverseTable;$('table-order').textContent='当前：'+(reverseTable?'由近到远':'由远到近')+' ⇅';renderQuarterTable();});
function renderCompanies(){const query=$('company-search').value.trim().toLowerCase(),only=$('estimated-only').checked;let rows=D.latestCompanies.filter(r=>(!only||r.status==='estimated')&&(!query||(r.name+r.code).toLowerCase().includes(query))).sort((a,b)=>(b.revenue||0)-(a.revenue||0));$('company-count').textContent=`显示 ${rows.length} / ${D.latestCompanies.length} 家，按营收从高到低排列`;$('company-body').innerHTML=rows.map(r=>`<tr class="${r.status==='estimated'?'estimate-row':''}"><td>${esc(r.name)}</td><td>${r.code}</td><td>${fmt(r.revenue,2)}</td><td>${fmt(r.profit,2)}</td><td>${date(r.announcementDate)}</td><td><span class="tag ${r.status==='estimated'?'estimate':''}">${r.status==='estimated'?'估算':'已披露'}</span></td></tr>`).join('')||'<tr><td colspan="6" style="text-align:center">没有匹配的公司</td></tr>';}
$('company-search').addEventListener('input',renderCompanies);$('estimated-only').addEventListener('change',renderCompanies);renderCompanies();
$('source-links').innerHTML=D.meta.sourceLinks.map(s=>`<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.name} ↗</a>`).join('');


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


// Selected industries appear as separate cards; the main chart always shows electronics.
$('all-market-cap').textContent=marketLabel(L.marketCap);
$('sector-options').innerHTML=GROUPS.map(g=>`<label class="sector-option"><input type="checkbox" data-sector="${g.code}" checked><span>${esc(g.name)}</span><strong>${marketLabel(g.series.at(-1).marketCap)}</strong></label>`).join('');
function syncSectorPicker(){
 const count=selectedSectors.size;
 $('sector-all').checked=count===GROUPS.length;$('sector-all').indeterminate=count>0&&count<GROUPS.length;
 document.querySelectorAll('[data-sector]').forEach(input=>input.checked=selectedSectors.has(input.dataset.sector));
 $('sector-selection').textContent='二级行业';$('selected-market-cap').textContent=count+' / '+GROUPS.length;
 $('sector-trigger').setAttribute('aria-label','二级行业，已选 '+count+' 个，下方显示独立图表');
 $('selection-total').textContent=String(count)+' 个小图';
 $('selection-method').textContent='主图固定为电子整体；勾选二级行业后，在主图下方分别显示，按2026Q3季末市值降序排列。图例开关和时间范围同时控制主图及所有小图，勾选不改变整体统计或底部明细范围。各图纵轴独立缩放，比较金额请看数字和轴刻度。';
}
function renderMiniCharts(){
 for(const [code,item]of miniCharts){if(!selectedSectors.has(code)){chartObserver.unobserve(item.chart.getDom());item.chart.dispose();item.card.remove();miniCharts.delete(code);}}
 for(const group of GROUPS){if(!selectedSectors.has(group.code))continue;let item=miniCharts.get(group.code);
  if(!item){const card=document.createElement('article');card.className='mini-card';card.dataset.sectorCard=group.code;card.innerHTML=`<header class="mini-head"><h2>${esc(group.name)}</h2><span class="mini-cap" title="2026Q3季末总市值">${marketLabel(group.series.at(-1).marketCap)}</span></header><div class="mini-summary"></div><div class="mini-axes"><span class="mini-axis-mv"></span><span class="mini-axis-finance"></span><span class="mini-axis-pe"></span></div><div class="mini-chart" role="img" aria-label="${esc(group.name)}季度市值、PE、营收和归母净利润"></div>`;const node=card.querySelector('.mini-chart');$('sector-grid').appendChild(card);item={group,card,chart:echarts.init(node,null,{renderer:'canvas'})};miniCharts.set(group.code,item);chartObserver.observe(node);}
  $('sector-grid').appendChild(item.card);
  updateChart(item.chart,group.series,group.name,true,group.code);
 }
 $('sector-grid').hidden=selectedSectors.size===0;
 syncSectorPicker();
}
function closeSectorMenu(){ $('sector-menu').hidden=true;$('sector-trigger').setAttribute('aria-expanded','false');}
$('sector-trigger').addEventListener('click',()=>{const open=$('sector-menu').hidden;$('sector-menu').hidden=!open;$('sector-trigger').setAttribute('aria-expanded',String(open));});
$('sector-all').addEventListener('change',e=>{selectedSectors.clear();if(e.target.checked)GROUPS.forEach(g=>selectedSectors.add(g.code));renderMiniCharts();});
$('sector-options').addEventListener('change',e=>{const code=e.target.dataset.sector;if(!code)return;if(e.target.checked)selectedSectors.add(code);else selectedSectors.delete(code);renderMiniCharts();});
document.addEventListener('click',e=>{if(!$('sector-picker').contains(e.target))closeSectorMenu();});
$('sector-picker').addEventListener('keydown',e=>{if(e.key==='Escape'){closeSectorMenu();$('sector-trigger').focus();}});
$('sector-picker').addEventListener('focusout',e=>{if(e.relatedTarget&&!$('sector-picker').contains(e.relatedTarget))closeSectorMenu();});
window.RESEARCH_STATE=()=>({first,last,showLabels,selectedSectors:[...selectedSectors],visibleMetrics:{...visibleMetrics},latest:L,miniOrder:[...$('sector-grid').children].map(e=>e.dataset.sectorCard)});
window.RESEARCH_CHARTS=()=>({main:chart,children:Object.fromEntries([...miniCharts].map(([code,item])=>[code,item.chart]))});
redraw();renderMiniCharts();
