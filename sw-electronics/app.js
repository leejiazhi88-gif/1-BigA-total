'use strict';
window.RESEARCH_MODULES={};
const GLOBAL_VIEW={first:47,last:86,showLabels:true,expandSectors:false,financeMode:'rolling',metrics:{mv:true,pe:false,revenue:true,profit:true}};
function rollingFinancialRows(rows){return rows.map((s,i)=>{
 const windowRows=rows.slice(Math.max(0,i-3),i+1),complete=windowRows.length===4&&windowRows.every(r=>r.companies>0&&!r.missingCount&&Number.isFinite(r.revenue)&&Number.isFinite(r.profit));
 return {...s,rolling:true,revenue:complete?windowRows.reduce((sum,r)=>sum+r.revenue,0):null,profit:complete?windowRows.reduce((sum,r)=>sum+r.profit,0):null,windowStart:windowRows[0].quarter,financialReason:complete?'':windowRows.length<4?'不足4个季度':windowRows.some(r=>!r.companies)?'窗口内部分季度无上市样本':'窗口内有财务缺失',windowEstimatedCount:windowRows.reduce((sum,r)=>sum+r.estimatedCount,0),windowMissingCount:windowRows.reduce((sum,r)=>sum+r.missingCount,0),estimatedRevenue:complete?windowRows.reduce((sum,r)=>sum+r.estimatedRevenue,0):null,estimatedProfit:complete?windowRows.reduce((sum,r)=>sum+r.estimatedProfit,0):null};
});}

function mountIndustry(root,BASE,sectorData,prefix=''){
const GROUPS=[...sectorData.groups].sort((a,b)=>(b.series.at(-1).marketCap||0)-(a.series.at(-1).marketCap||0)),$=id=>root.querySelector('#'+CSS.escape(id))||root.querySelector('#'+CSS.escape(prefix+id));
const D=BASE,S=BASE.series,L=S.at(-1),official=D.meta.valuationMethod==='sw_daily';
const dailyByCode=new Map([[D.meta.indexCode,D.valuationDaily||[]],...GROUPS.map(g=>[g.code,g.valuationDaily||[]])]);
const percentileCache=new Map();
const peLabel=official?'申万PE':'整体 PE（TTM）';
const selectedSectors=new Set(GLOBAL_VIEW.expandSectors?GROUPS.map(g=>g.code):[]);
const visibleMetrics={...GLOBAL_VIEW.metrics};
let financeMode=GLOBAL_VIEW.financeMode;
const rollingCache=new Map();
function displayRows(rows){if(financeMode!=='rolling')return rows;if(!rollingCache.has(rows))rollingCache.set(rows,rollingFinancialRows(rows));return rollingCache.get(rows);}
function financeTag(s){return (s.rolling?s.windowEstimatedCount:s.estimatedCount)?'*':(s.rolling?s.windowMissingCount:s.missingCount)?'†':'';}
function financeLabel(label){return financeMode==='rolling'?'近4季'+label:label;}
const miniCharts=new Map();
const fmt=(v,n=1)=>v==null?'—':Number(v).toLocaleString('zh-CN',{minimumFractionDigits:n,maximumFractionDigits:n});
const pct=(v,n=1)=>fmt(v*100,n)+'%';
const date=v=>v?v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6,8):'—';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=q=>q.replace('Q',' Q');
function marketLabel(value){return value==null?'—':value>=10000?fmt(value/10000,2)+'万亿':fmt(value,0)+'亿';}
function peText(s){return s.pe!=null?fmt(s.pe,2):official?s.peStatus==='nonpositive'?'不适用':'—':s.companies&&s.peProfit<=0?'不适用':'—';}
// Use all valid SW daily observations for aligned modules; other modules retain quarterly ranks.
function percentileBounds(){const q=S[first].quarter;return {start:q.slice(0,4)+String((Number(q.at(-1))-1)*3+1).padStart(2,'0')+'01',end:S[last].endDate};}
function percentileValues(rows){
 if(!official)return rows.slice(first,last+1).map(s=>s.pe).filter(v=>Number.isFinite(v)&&v>0);
 const code=rows[0]?.valuationCode||D.meta.indexCode,key=code+':'+first+':'+last;
 if(!percentileCache.has(key)){const {start,end}=percentileBounds();percentileCache.set(key,(dailyByCode.get(code)||[]).filter(([day,value])=>day>=start&&day<=end&&Number.isFinite(value)&&value>0).map(([,value])=>value));}
 return percentileCache.get(key);
}
function pePercentile(rows,value){if(!Number.isFinite(value)||value<=0)return null;const values=percentileValues(rows);return values.length?values.filter(v=>v<=value).length/values.length:null;}
function percentileWindowLabel(){const n=last-first+1;return n===4?'近1年':n===12?'近3年':n===20?'近5年':n===40?'近10年':n===80?'近20年':n===87?'全部':'所选区间';}
function pePercentileText(rows,value){const rank=pePercentile(rows,value);return rank==null?'—':pct(rank,1);}
function pePercentileMarkup(rows,s,extraClass=''){
 const rank=pePercentile(rows,s.pe),text=rank==null?'—':pct(rank,1),position=rank==null?0:Math.max(0,Math.min(100,rank*100)),color=rank==null?'#839194':rank<=.2?'#28866a':rank>=.8?'#b55766':'#a28130';
 return `<span class="pe-percentile ${extraClass}${rank==null?' percentile-unavailable':''}" title="${pePercentileHint(rows,s)}" style="--pe-color:${color}"><span class="pe-percentile-label">PE分位 · ${percentileWindowLabel()}</span><strong>${text}</strong><i class="pe-percentile-track" aria-hidden="true">${rank==null?'':`<b style="left:${position}%"></b>`}</i></span>`;
}
function pePercentileHint(rows,s){const count=percentileValues(rows).length,{start,end}=percentileBounds();return `${short(s.quarter)} PE；区间 ${date(start)}—${date(end)}，${count} 个有效${official?'日度':'季度'}样本；不高于该 PE 的样本占比`;}
function peReason(s){if(official)return s.peNote||'';return !s.companies?'无已上市样本':s.peProfit<=0?'TTM利润合计非正，PE不适用':s.pe>500?'TTM净利润相对市值接近零，PE对利润变化高度敏感':'';}
let first=GLOBAL_VIEW.first,last=GLOBAL_VIEW.last,showLabels=GLOBAL_VIEW.showLabels,reverseTable=true,focusedQuarter=L;
function focus(s){focusedQuarter=S.find(r=>r.quarter===s.quarter)||s;s=displayRows(S)[S.indexOf(focusedQuarter)]||s;$('focus-row').innerHTML=`<strong class="focus-quarter">${esc(D.meta.industry)} · ${short(s.quarter)}</strong><div><span>总市值</span><strong>${fmt(s.marketCap==null?null:s.marketCap/10000,2)}<small> 万亿</small></strong></div><div><span>${official?'申万PE':'PE'}</span><strong>${peText(s)}<small>${s.pe==null?'':' 倍'}</small></strong></div><div><span>${financeLabel('营收')}</span><strong>${fmt(s.revenue)}<small> 亿${financeTag(s)}</small></strong></div><div><span>${financeLabel('归母净利')}</span><strong>${fmt(s.profit)}<small> 亿${financeTag(s)}</small></strong></div>${pePercentileMarkup(S,s,'focus-pe-percentile')}<small class="focus-coverage">${s.reportedCount} 家实报${s.estimatedCount?' / '+s.estimatedCount+' 家估算':''}</small>`;}
focus(L);
const C={mv:'#147b76',pe:'#c47a36',rev:'#ccdde4',profit:'#427f93',loss:'#c47b6c'};
const chart=echarts.init($('chart'),null,{renderer:'canvas'});if(!prefix)window.researchChart=chart;
function nice(x){if(!x||x<0)return 1;const p=10**Math.floor(Math.log10(x));return Math.ceil(x/p*2)/2*p;}
function positivePE(value){return Number.isFinite(value)&&value>0;}
function quantile(sorted,p){const index=(sorted.length-1)*p,lo=Math.floor(index),weight=index-lo;return sorted[lo]+((sorted[lo+1]??sorted[lo])-sorted[lo])*weight;}
function peView(rows){
 const values=rows.slice(first,last+1).map(s=>s.pe).filter(positivePE).sort((a,b)=>a-b);
 const threshold=values.length>=8?Math.max(quantile(values,.75)+3*(quantile(values,.75)-quantile(values,.25)),3*quantile(values,.5)):Infinity;
 const spikes=new Set();for(let i=first;i<=last;i++)if(positivePE(rows[i].pe)&&rows[i].pe>threshold)spikes.add(i);
 const normal=values.filter(v=>v<=threshold),max=nice(Math.max(0,...normal))*(spikes.size?1.18:1.08);
 // Statistical candidates that still fit the regular axis keep their true-height solid line.
 for(const i of spikes)if(rows[i].pe<=max)spikes.delete(i);
 return {threshold,spikes,max,cap:max*.92,count:values.length};
}
function chartAxes(rows,mini,view){
 const visible=rows.slice(first,last+1);
 const mvmax=nice(Math.max(0,...visible.map(s=>(s.marketCap||s.marketCapObserved||0)/10000)))*1.08;
 const pemax=view.max;
 const financial=visibleMetrics.revenue||visibleMetrics.profit;
 const finmax=nice(Math.max(0,...visible.map(s=>visibleMetrics.revenue?(s.revenue||0):visibleMetrics.profit?Math.max(0,s.profit||0):0)))*1.17;
 const negative=visibleMetrics.profit?Math.min(0,...visible.map(s=>s.profit||0)):0;
 const labelSpace=visibleMetrics.profit&&showLabels?(mini?.18:.12):0;
 const negRatio=negative<0?Math.max(.08,-negative/finmax*1.25,-negative/finmax+labelSpace):labelSpace;
 const scale=financial?`${visibleMetrics.revenue?'柱':'利润'}：${negRatio?fmt(-finmax*negRatio,0):'0'}—${fmt(finmax,0)}亿元`:'';
 return {scale,finmax,axes:[
 {type:'value',min:-mvmax*negRatio,max:mvmax,show:visibleMetrics.mv,splitNumber:mini?3:5,axisLabel:{color:'#6f8f8c',fontSize:mini?8:10,formatter:v=>v<0?'':fmt(v,v<1?2:v<2?1:0)},axisLine:{show:false},axisTick:{show:false},splitLine:{show:true,lineStyle:{color:'#edf1ee',type:'dashed'}}},
 {type:'value',min:-pemax*negRatio,max:pemax,show:visibleMetrics.pe,position:'right',splitNumber:mini?3:5,axisLabel:{color:'#af8b63',fontSize:mini?8:10,formatter:v=>v<0?'':fmt(v,0)},axisLine:{show:false},axisTick:{show:false},splitLine:{show:false}},
 {type:'value',min:-finmax*negRatio,max:finmax,show:false}
 ]};
}
function bars(rows,key,mini,finmax){return rows.map(s=>{
 if(!s.companies||!Number.isFinite(key==='revenue'?s.revenue:s.profit))return{value:null,label:{show:false}};
 const v=key==='revenue'?s.revenue-(visibleMetrics.profit?Math.max(0,s.profit):0):key==='profit'?Math.max(0,s.profit):Math.min(0,s.profit);
 const color=key==='revenue'?C.rev:key==='profit'?C.profit:C.loss;
 const metric=key==='loss'?'profit':key;
 const label={show:showLabels,position:key==='revenue'?'insideTop':'inside',rotate:last-first>(mini?10:38)?90:0,distance:mini?2:5,color:key==='revenue'?'#4f6e7b':'#fff',fontSize:mini?8:last-first>38?8:10,formatter:fmt(s[metric],0)+financeTag(s)};
 if(key!=='revenue'){label.position='bottom';label.color=key==='loss'?C.loss:C.profit;label.distance=4;}
 if((key==='profit'&&s.profit<=0)||(key==='loss'&&s.profit>=0))label.show=false;
 if(key==='revenue'&&s.revenue<finmax*.1){label.position='top';label.distance=4;}
 return {value:v,itemStyle:{color,opacity:s.missingCount?.65:1,borderColor:financeTag(s)==='*'?'#aa884f':color,borderWidth:financeTag(s)==='*'?1:0,decal:financeTag(s)==='*'?{symbol:'rect',dashArrayX:[1,0],dashArrayY:[2,4],rotation:Math.PI/4,color:'rgba(137,99,38,.18)'}:undefined},label};
});}
function lossAreas(rows){const areas=[];let start=null;for(let i=first;i<=last+1;i++){const loss=i<=last&&(official?rows[i].peStatus==='nonpositive':rows[i].companies>0&&rows[i].peProfit<=0);if(loss&&start===null)start=i;if(!loss&&start!==null){if(i-1>start)areas.push([{name:'PE不适用',xAxis:rows[start].quarter},{xAxis:rows[i-1].quarter}]);start=null;}}return areas;}
function makeSeries(rows,mini,finmax,view){const series=[],barMaxWidth=mini?24:43;
 if(visibleMetrics.profit)series.push({id:'profit',name:'归母净利润',type:'bar',stack:'finance',yAxisIndex:2,barMaxWidth,barCategoryGap:'24%',z:1,data:bars(rows,'profit',mini,finmax)});
 if(visibleMetrics.revenue)series.push({id:'revenue',name:financeLabel('营收'),type:'bar',stack:'finance',yAxisIndex:2,barMaxWidth,z:1,data:bars(rows,'revenue',mini,finmax)});
 if(visibleMetrics.profit)series.push({id:'loss',name:'归母净亏损',type:'bar',stack:'finance',yAxisIndex:2,barMaxWidth,z:1,data:bars(rows,'loss',mini,finmax)});
 if(visibleMetrics.mv)series.push({id:'mv',name:'总市值',type:'line',yAxisIndex:0,z:6,smooth:false,showSymbol:!mini||last-first<30,symbol:'circle',symbolSize:mini?3:last-first>40?3:5,lineStyle:{color:C.mv,width:mini?1.8:2.5},itemStyle:{color:C.mv,borderColor:'#fff',borderWidth:1},data:rows.map(s=>s.marketCap==null?null:s.marketCap/10000)});
 if(visibleMetrics.pe){series.push({id:'pe',name:peLabel,type:'line',yAxisIndex:1,z:7,connectNulls:false,smooth:false,markArea:{silent:true,itemStyle:{color:'rgba(193,136,91,.07)'},label:{show:true,position:'insideTop',fontSize:mini?8:9,color:'#a18c77'},data:lossAreas(rows)},showSymbol:!mini||last-first<30,symbolSize:mini?3:4,lineStyle:{color:C.pe,width:mini?1.5:2},itemStyle:{color:C.pe,borderColor:'#fff',borderWidth:1},data:rows.map((s,i)=>({value:positivePE(s.pe)&&!view.spikes.has(i)?s.pe:null,symbol:!official&&s.peCoverage<.9999?'emptyCircle':'circle',symbolSize:!official&&s.peCoverage<.9999?mini?4:6:mini?2:4}))});
  // Each spike run gets its own dashed path. Full-length arrays retain quarter indices
  // for tooltips; null/negative PE never becomes a bridge across a missing quarter.
  const indices=[...view.spikes];
  for(let k=0;k<indices.length;k++){
   const start=indices[k];let end=start;while(k+1<indices.length&&indices[k+1]===end+1)end=indices[++k];
   series.push({id:'pe-spike-'+start,name:'PE尖峰（原值见标签）',type:'line',yAxisIndex:1,z:8,connectNulls:false,smooth:false,showSymbol:true,showAllSymbol:true,clip:true,lineStyle:{color:C.pe,width:mini?1.5:2,type:'dashed'},itemStyle:{color:C.pe,borderColor:'#fff',borderWidth:1},labelLayout:{hideOverlap:true},data:rows.map((s,i)=>{
    const active=i>=Math.max(first,start-1)&&i<=Math.min(last,end+1)&&positivePE(s.pe),spike=view.spikes.has(i)&&i>=start&&i<=end,compressed=spike&&s.pe>view.cap;
    return {value:active?(spike?Math.min(s.pe,view.cap):s.pe):null,symbol:spike?'triangle':'none',symbolSize:spike?(mini?6:8):0,label:{show:spike,position:'top',distance:4,fontSize:mini?8:10,color:C.pe,backgroundColor:'rgba(255,255,255,.88)',padding:[1,2],formatter:(compressed?'↑':'')+fmt(s.pe,1)}};
   })});
  }
 }

 return series;
}
function tooltipFor(rows,name,main,view){return params=>{
 const p=params.find(p=>p.dataIndex!=null);if(!p)return'';const s=rows[p.dataIndex];if(main)focus(s);
 let body=`<div class="tooltip"><div class="tooltip-title">${esc(name)} · ${short(s.quarter)}${financeTag(s)==='*'?' <small>含估算</small>':''}</div>`;
 const row=(label,v,color='')=>`<div class="tooltip-row"><span>${label}</span><b style="color:${color}">${v}</b></div>`;
 if(visibleMetrics.mv)body+=row('总市值 · 亿元',fmt(s.marketCap,2),C.mv);
 if(visibleMetrics.pe)body+=row(peLabel,peText(s)+(s.pe==null?'':' 倍'),C.pe);
 if(visibleMetrics.revenue)body+=row(financeLabel('营收')+(!s.rolling&&s.missingCount?'（已知合计）':''),fmt(s.revenue,2)+' 亿');
 if(visibleMetrics.profit)body+=row(financeLabel('归母净利润')+(!s.rolling&&s.missingCount?'（已知合计）':''),fmt(s.profit,2)+' 亿');
 if(visibleMetrics.pe)body+=row('PE分位 · 所选区间',pePercentileText(rows,s.pe),C.pe);
 body+='<div class="tooltip-footer">';
 if(s.rolling)body+=`财务窗口 ${short(s.windowStart)}—${short(s.quarter)}${s.financialReason?'；'+s.financialReason:''}${s.windowEstimatedCount?'；含估算':''}<br>`;
 if(visibleMetrics.pe&&view.spikes.has(p.dataIndex))body+=`<b>PE尖峰：原值 ${fmt(s.pe,2)} 倍</b><br>区间门槛 ${fmt(view.threshold,2)} 倍；虚线为示意，不按高度读取<br>`;
 if(visibleMetrics.pe&&!official)body+=`${peReason(s)?'<b>'+peReason(s)+'</b><br>':''}PE 分子市值 ${fmt(s.peMarketCap,2)} 亿<br>PE 分母 TTM 归母净利润 ${fmt(s.peProfit,4)} 亿<br>PE 市值覆盖 ${pct(s.peCoverage,2)}<br>`;
 body+=`本季财报 ${s.reportedCount} / ${s.companies} 家；估算 ${s.estimatedCount} 家${s.missingCount?'；缺失 '+s.missingCount+' 家':''}<br>季度末 ${date(s.tradeDate)}`;
 if(official){body+=`<br>市值 / PE：申万公布${s.valuationDate?'（'+date(s.valuationDate)+'）':'，该日暂无行情'}；财务：成分公司报表汇总`;if(!positivePE(s.pe))body+=`<br>${peReason(s)}`;}else if(visibleMetrics.mv)body+=`；市值沿用 ${s.carriedCount} 家`;
 if(financeTag(s)==='*'&&visibleMetrics.revenue)body+=`<br>估算营收 ${fmt(s.estimatedRevenue,2)} 亿`;
 if(financeTag(s)==='*'&&visibleMetrics.profit)body+=`<br>估算利润 ${fmt(s.estimatedProfit,2)} 亿`;
 return body+'</div></div>';
};}
function miniSummary(group){const s=displayRows(group.series).at(-1);return `<span>${official?'申万PE':'PE'} ${esc(peText(s))}</span><span>${esc(financeLabel('营收')+' '+fmt(s.revenue,0)+'亿'+financeTag(s))}</span><span>${esc(financeLabel('净利')+' '+fmt(s.profit,1)+'亿'+financeTag(s))}</span>${pePercentileMarkup(group.series,s,'mini-pe-percentile')}`;}
function updateChart(instance,rows,name,mini=false,code=''){
 rows=displayRows(rows);
 const view=peView(rows),{axes,scale,finmax}=chartAxes(rows,mini,view);
 const peCaption=visibleMetrics.pe?('PE'+(mini?'·':' · ')+'倍'+(view.spikes.size?' · 虚线尖峰':'')):'';
 if(mini){const el=instance.getDom().closest('.mini-card');el.querySelector('.mini-axis-mv').textContent=visibleMetrics.mv?'市值·万亿':'';el.querySelector('.mini-axis-pe').textContent=peCaption;el.querySelector('.mini-axis-finance').textContent=scale;el.querySelector('.mini-summary').innerHTML=miniSummary(GROUPS.find(g=>g.code===code));el.querySelector('.mini-cap').hidden=false;}
 else{$('finance-scale').textContent=scale;root.querySelector('.axis-caption>.mv-text').textContent=visibleMetrics.mv?'市值 · 万亿元':'';root.querySelector('.axis-caption>.pe-text').textContent=peCaption;}
 const zoom={startValue:first,endValue:last,filterMode:'none'};
 instance.setOption({animation:false,textStyle:{fontFamily:'-apple-system, BlinkMacSystemFont, PingFang SC, Microsoft YaHei, sans-serif'},grid:{left:mini?40:56,right:mini?35:51,top:mini?12:16,bottom:mini?49:76},tooltip:{trigger:'axis',confine:true,backgroundColor:'rgba(255,255,255,.98)',borderColor:'#dce5df',borderWidth:1,padding:mini?10:16,extraCssText:'box-shadow:0 6px 24px #1b42351a;border-radius:8px;',axisPointer:{type:'line',lineStyle:{color:'#aebeb5',type:'dashed'}},formatter:tooltipFor(rows,name,!mini,view)},xAxis:{type:'category',data:rows.map(s=>s.quarter),axisTick:{show:false},axisLine:{lineStyle:{color:'#d8e1dd'}},axisLabel:{interval:mini?Math.max(0,Math.floor((last-first+1)/8)-1):0,rotate:mini?45:last-first>38?90:45,fontSize:mini?8:last-first>38?8:10,color:'#8a9998',margin:mini?6:9,formatter:short}},yAxis:axes,dataZoom:mini?[{type:'inside',...zoom,disabled:true}]:[{type:'slider',...zoom,height:20,bottom:10,left:56,right:51,borderColor:'#e3ebe5',backgroundColor:'#f8faf7',fillerColor:'rgba(20,123,118,.08)',handleStyle:{color:'#fff',borderColor:'#9ab6aa'},moveHandleSize:0,dataBackground:{lineStyle:{color:'#b4c9c0'},areaStyle:{color:'#e5ece6'}},selectedDataBackground:{lineStyle:{color:'#739c90'},areaStyle:{color:'#c8dad0'}},textStyle:{fontSize:9,color:'#8fa197'},brushSelect:false,showDetail:true},{type:'inside',...zoom,disabled:true}],series:makeSeries(rows,mini,finmax,view),graphic:[{id:'all-hidden',type:'text',left:'center',top:'middle',silent:true,style:{text:!Object.values(visibleMetrics).some(Boolean)?'点击上方图例显示指标':official&&!rows.slice(first,last+1).some(s=>s.marketCap!=null||s.pe!=null||s.revenue!=null||s.profit!=null)?'该区间暂无数据':'',fontSize:mini?10:12,fill:'#8b9b92'}}]}, {notMerge:true});
}
function redraw(){if(!S.slice(first,last+1).includes(focusedQuarter))focusedQuarter=S[last];focus(focusedQuarter);updateChart(chart,S,D.meta.industry);for(const [code,item]of miniCharts)updateChart(item.chart,item.group.series,item.group.name,true,code);}
function applyGlobal(){first=GLOBAL_VIEW.first;last=GLOBAL_VIEW.last;showLabels=GLOBAL_VIEW.showLabels;financeMode=GLOBAL_VIEW.financeMode;Object.assign(visibleMetrics,GLOBAL_VIEW.metrics);redraw();}
function setRange(a,b){setGlobalRange(a,b);}
$('chart').addEventListener('pointerleave',()=>focus(L));
chart.getZr().on('globalout',()=>focus(L));
chart.on('datazoom',e=>{const z=e.batch?e.batch[0]:e;let a=first,b=last;if(z.startValue!=null){a=Math.round(z.startValue);b=Math.round(z.endValue);}else if(z.start!=null){a=Math.round(z.start/100*(S.length-1));b=Math.round(z.end/100*(S.length-1));}setGlobalRange(a,b);});
const chartObserver=new ResizeObserver(entries=>{for(const entry of entries){const instance=echarts.getInstanceByDom(entry.target);if(instance&&!instance.isDisposed())instance.resize();}});chartObserver.observe($('chart'));

function prepareOfficialModule(){
 root.querySelector('.heading-main>span').textContent='申万一级 · 2021分类';
 root.querySelector('.company-table thead th:nth-child(3)').innerHTML='公司总市值 <small>亿元</small>';
 root.querySelector('.table-section thead th:nth-child(2)').innerHTML='申万总市值 <small>亿元</small>';
 root.querySelector('.table-section thead th:nth-child(3)').innerHTML='申万PE <small>倍</small>';
 root.querySelector('.table-section thead th:nth-child(6)').textContent='财务样本数';
 root.querySelector('.method-grid').innerHTML=`<article><h3>与项目2统一的申万行情</h3><p>一级、二级行业市值和PE均直接使用 Tushare sw_daily 的对应申万指数公布值，与项目2使用同一份截至2026-11-10的行情快照。市值 total_mv 原单位为万元，除以10000转为亿元；PE直接使用 pe，不用公司财报重算、不把一级PE分摊给二级行业。季度点取该季度最后交易日，缺少当天数据则留空。</p><p>申万公布总市值与PE是两个独立指标。不能把总市值÷PE认定为实际归母净利润，也不能认为财务柱就是其PE分母。指数权重、利润切换规则与个股汇总可能不同，页面不宣称复现申万内部算法。</p></article><article><h3>财务与公司范围</h3><p class="universe-method"></p><p>申万日行情接口不提供营收或净利润。柱形仍按最新在市SW2021公司归属固定回溯，上市后纳入，汇总全公司合并营业总收入（缺失时营业收入）及归母净利润；不按自由流通比例缩放，也不使用市值÷PE代替财报。与项目2“隐含TTM利润”不是同一指标。固定成分财务存在存续样本偏差，不能称为申万历史成分财务或用于无前视回测。</p><p>公司明细市值与项目2同样使用 daily_basic.total_mv÷10000，即全部普通股股本按A股价估值。含H股股份时并非A股实际市值加港股实际市值；这不是申万指数市值的逐股分拆，不能要求公司金额之和等于申万行业市值。组间按申万二级市值排序，组内按公司总市值排序。公司数是财务样本数，不是已核实的历史指数成分数。</p></article><article><h3>单季度财务与估算</h3><p>Q1取一季报；Q2＝半年报−Q1；Q3＝三季报−半年报；Q4＝年报−三季报。采用截至2026-11-10已披露版本；早期缺报可使用次年调整合并表，存在追溯调整影响。最新季度缺报才使用上年同季营收×最近累计同比倍数，再乘最近累计归母净利率估算并标*；缺少依据则留空，不填零。</p></article>`;
 const reading=root.querySelector('.reading-notes'),links=$('source-links');
 reading.innerHTML=`<div class="industry-data-notes"></div><h3>日度PE分位与时间</h3><p>与项目2采用同一公式：区间内不高于目标PE的有效正日度PE数量÷全部有效正日度PE数量，包含相等值。采用所选起始季度第一天至结束季度最后一天的全部日度样本，不使用图中季度点代替；显示1位小数，项目2卡片通常为整数。PE分位与汇总数值始终显示，颜色为低分位绿、中间黄、高分位红。</p><p>两页只有同一指数、同一观察日期、同一起止日期才可直接对比分位。2.2默认近10年为2016-10-01至2026-09-30、末值取2026Q3；项目2截至2026-11-10的近10年为2016-11-10至2026-11-10，因此默认分位可不同。全部范围或早期区间只使用接口实际可得历史，不补造数据。悬停大图时读取对应季度，移出后恢复最后一季；小图汇总取最后一季。</p><h3>历史覆盖</h3><p class="sw-history-note"></p><p>使用SW2021代码对应的接口历史，早期记录可能沿用旧分类名称及指数延续历史，不宣称2005年已存在2021版分类。官方一级与二级历史各自取数；历史分类变更时，二级市值之和也未必严格等于一级。银行“其他银行”分类无公布行情、无当前公司，显示暂无数据。</p><h3>最近4季与图表读法</h3><p>最近4季为当前季及此前连续3季的实际财报汇总，窗口可超出显示区间；不足4季、无上市样本或存在财务缺失时留空。市值和PE仍取对应季末申万值。季度表、公司明细保留单季度口径。利润位于柱底，标签在下方；亏损在零线下方。财务柱使用独立亿元刻度，不能读成左侧市值轴。指标开关统一控制大图小图，全部汇总数字始终显示。</p><h3>PE尖峰</h3><p>区间至少8个有效正季度PE时，同时超过Q3＋3×IQR与中位数3倍的点为候选；仅当超过普通纵轴上限时压缩并用虚线、↑真实值显示。范围内的点保持实线；非正或缺失PE留空、不跨缺口连线。原始PE与日度分位不受尖峰显示影响。</p><h3>数据日期</h3><p>申万行情与项目2复用截至2026-11-10的静态快照；图中最新完整财报季度为2026Q3。财报汇总也截至2026-11-10，不自动更新。2005年行情补查于2026-11-13，补查不代表财报日期更新。</p>`;
 reading.appendChild(links);
 root.querySelector('.quality-details summary').innerHTML='逐季度查看财务覆盖与申万行情日期 <span>＋</span>';
 root.querySelector('.quality-details thead').innerHTML='<tr><th>季度</th><th>财务覆盖</th><th>申万行情日</th><th>公司报价沿用</th><th>需要留意</th></tr>';
}
function renderOfficialCoverage(){
 const universe=root.querySelector('.universe-method');universe.textContent=`${D.meta.industry}（${D.meta.indexCode}）财务样本共 ${D.meta.universeCount} 家当前在市公司，每季仅计入已上市公司；北交所最早从2021-11-15纳入。最新季度 ${L.companies} 家，其中 ${L.reportedCount} 家实报、${L.estimatedCount} 家估算。`;
 root.querySelector('.sw-history-note').textContent=[{name:D.meta.industry,rows:D.valuationDaily},...GROUPS.map(g=>({name:g.name,rows:g.valuationDaily}))].map(g=>g.name+'：'+(g.rows.length?'从 '+date(g.rows[0][0])+' 起':'暂无申万行情')).join('；')+'。更早的市值/PE留空，财报柱按实际资料展示。';
 root.querySelector('.industry-data-notes').innerHTML=D.meta.indexCode==='801080.SI'?'<h3>电子财务历史</h3><p>智新电子从北交所开市日2021-11-15纳入财务样本。此前自算整体法的2009Q2高PE已不用于该图，2009年申万行情接口无值，保持缺口。</p>':'<h3>银行财务历史</h3><p>2007Q2中信银行缺少Q1差分依据，单季度财务显示已知合计并标†；相应最近4季窗口留空。银行营收按利润表口径，贷款和存款余额不计入营收。</p>';
 $('estimate-panel').innerHTML=D.estimates.length?`<h3>最新季度估算</h3>${D.estimates.map(e=>`<p>${esc(e.name)} ${esc(e.code)}：单季营收 ${fmt(e.revenue,2)} 亿元，归母净利润 ${fmt(e.profit,2)} 亿元；参考期 ${esc(e.referencePeriod)}，营收同比 ${pct(e.growth,2)}，归母净利率 ${pct(e.margin,2)}。估算只用于财务柱，不用于申万PE。</p>`).join('')}`:`<h3>最新季度估算</h3><p>${L.reportedCount} 家实报，无估算。</p>`;
 $('quality-note').textContent=`行情：申万公布；财务：公司财报汇总。${S.filter(s=>s.missingCount).length} 个季度存在财务缺失；${S.filter(s=>!s.valuationDate).length} 个季度无申万一级行情。接口未提供PE公司覆盖率或实际利润分母，不推定为100%。`;
 $('quality-body').innerHTML=S.map((s,i)=>{const q=D.quality[i],notes=[];if(q.financialMissing.length)notes.push('财务缺失：'+q.financialMissing.map(c=>esc(c.name)).join('、'));if(!s.valuationDate)notes.push('申万无季末行情');else if(!positivePE(s.pe))notes.push(esc(peReason(s)));if(q.carried.length)notes.push('公司明细沿用：'+q.carried.map(c=>esc(c.name)+' '+date(c.date)).join('、'));if(s.estimatedCount)notes.push('财务含估算');return `<tr><td>${short(s.quarter)}</td><td>${s.reportedCount}+${s.estimatedCount}估算 / ${s.companies}</td><td>${date(s.valuationDate)}</td><td>${s.carriedCount} 家</td><td>${notes.join('；')||'财务与申万行情均有数据'}</td></tr>`;}).join('');
}
if(official)prepareOfficialModule();

function renderCoverage(){
if(official){renderOfficialCoverage();return;}
$('estimate-panel').innerHTML=D.estimates.length?`<h3>最新季度估算：${L.reportedCount} 家实报，${L.estimatedCount} 家估算</h3><p>估算营收＝上年同季营收×最近累计营收同比倍数；估算利润＝估算营收×最近累计归母净利率。估算只补最新季度缺失值，不用于季末PE分母；斜纹与*标记含估算季度。</p>${D.estimates.map(E=>`<p><b>${esc(E.name)} ${esc(E.code)}</b>：营收 ${fmt(E.revenue,2)} 亿，归母净利润 ${fmt(E.profit,2)} 亿；参考期 ${esc(E.referencePeriod)}，营收同比 ${pct(E.growth,2)}，归母净利率 ${pct(E.margin,2)}。</p>`).join('')}`:`<h3>最新季度估算</h3><p>${L.reportedCount} 家实报，无估算${L.missingCount?'；'+L.missingCount+' 家资料不足，保留缺失':''}。</p>`;
if(L.missingCount)$('estimate-panel').insertAdjacentHTML('beforeend',`<p>资料不足、未作估算：${D.latestCompanies.filter(r=>r.status==='missing').map(r=>esc(r.name)+' '+esc(r.code)).join('、')}。保留缺失，不填零。</p>`);
const universe=root.querySelector('.universe-method');if(universe)universe.textContent=`申万2021版一级「${D.meta.industry}」（${D.meta.indexCode}），原始成分 ${D.meta.rawMembershipCount} 个代码；与当前在市公司交叉后固定为 ${D.meta.universeCount} 家，每季仅纳入该季末已上市的公司；北交所公司最早从2021-11-15起纳入，不含此前新三板阶段。数据截至 ${D.meta.asOf}，最新统计季度 ${D.meta.latestQuarter}。`;
const extra=root.querySelector('.industry-data-notes');if(extra)extra.innerHTML=D.meta.indexCode==='801080.SI'?`<h3>电子历史PE核查</h3><p>2009Q2整体PE为2,698.99倍，市值2,033.96亿元，TTM利润0.7536亿元；正负利润相抵使分母接近零。已补查原始与调整报表，真实值及亏损缺口保留。智新电子从北交所开市日2021-11-15起纳入，已剔除2021Q2/Q3精选层阶段。</p>`:D.meta.indexCode==='801780.SI'?`<h3>银行数据边界</h3><p>2007Q2中信银行缺少用于累计差分的Q1报表，显示已知财务合计并标†。2005Q4招商银行、2017Q1张家港行因季末可得TTM不全，从当期PE分子和分母同时剔除，覆盖率见下表。银行营收使用利润表口径，贷款和存款余额不计作营收。</p>`:'';
const incomplete=S.filter(s=>s.missingCount);
const available=S.filter(s=>s.companies>0),minCoverage=available.length?Math.min(...available.map(s=>s.peCoverage)):null;
$('quality-note').innerHTML=available.length?`<b>${esc(D.meta.industry)}整体数据边界：</b>${incomplete.length?incomplete.map(s=>short(s.quarter)+' 缺 '+s.missingCount+' 家').join('；')+'。标 † 的柱形为已知公司合计，缺失不填零。':'已有样本的各季度财务均完整覆盖（含标注估算）。'} PE 历史市值覆盖最低 ${minCoverage==null?'—':pct(minCoverage,2)}；覆盖不足的点为空心圆，合计 TTM 利润非正时 PE 留空。`:'请选择二级行业。';
$('quality-body').innerHTML=S.map((s,i)=>{const q=D.quality[i],notes=[];if(q.financialMissing.length)notes.push('财务缺失：'+q.financialMissing.map(c=>esc(c.name)+' '+c.code).join('、'));if(q.peMissing.length)notes.push('PE 缺失：'+q.peMissing.map(c=>esc(c.name)).join('、'));if(q.carried.length)notes.push('沿用市值：'+q.carried.map(c=>esc(c.name)+'（'+date(c.date)+'）').join('、'));if(s.estimatedCount)notes.push('财务估算：'+D.estimates.filter(e=>e.quarter===s.quarter).map(e=>esc(e.name)).join('、'));return`<tr><td>${short(s.quarter)}</td><td>${s.reportedCount}+${s.estimatedCount}估算 / ${s.companies}</td><td>${pct(s.peCoverage,2)}</td><td>${s.carriedCount} 家</td><td>${notes.join('<br>')||(s.companies?'完整覆盖':'无已上市样本')}</td></tr>`;}).join('');
}
let coverageReady=false,quarterReady=false,companiesReady=false;
function renderQuarterTable(){const rows=reverseTable?[...S].reverse():S;$('quarter-body').innerHTML=rows.map(s=>`<tr class="${s.estimatedCount?'estimate-row':''}"><td>${short(s.quarter)}</td><td>${fmt(s.marketCap,2)}</td><td title="${official?peLabel+'；'+(s.valuationDate?date(s.valuationDate):peReason(s)):peReason(s)+'；TTM利润 '+fmt(s.peProfit,4)+'亿元'}">${peText(s)}${!official&&s.peCoverage<.9999?' ◦':''}</td><td>${fmt(s.revenue,2)}${s.estimatedCount?' *':s.missingCount?' †':''}</td><td>${fmt(s.profit,2)}${s.estimatedCount?' *':s.missingCount?' †':''}</td><td>${s.companies}</td><td><span class="tag ${s.estimatedCount?'estimate':s.missingCount?'partial':''}">${!s.companies?'无样本':s.estimatedCount?s.reportedCount+' 实报 + '+s.estimatedCount+' 估算':s.missingCount?'缺 '+s.missingCount+' 家 · 已知合计':'全部实报'}</span></td></tr>`).join('');}
$('table-order').addEventListener('click',()=>{reverseTable=!reverseTable;$('table-order').textContent='当前：'+(reverseTable?'由近到远':'由远到近')+' ⇅';renderQuarterTable();});
const companySector=new Map(GROUPS.flatMap(g=>g.codes.map(code=>[code,g])));
function renderCompanies(){
 const query=$('company-search').value.trim().toLowerCase(),only=$('estimated-only').checked;
 const rows=D.latestCompanies.filter(r=>(!only||r.status==='estimated')&&(!query||(r.name+r.code+(companySector.get(r.code)?.name||'')).toLowerCase().includes(query)));
 $('company-count').textContent=`${short(L.quarter)} · 显示 ${rows.length} / ${D.latestCompanies.length} 家 · 二级行业及公司按市值降序`;
 const sections=GROUPS.map(group=>({group,rows:rows.filter(r=>companySector.get(r.code)?.code===group.code)}));
 const unassigned=rows.filter(r=>!companySector.has(r.code));if(unassigned.length)sections.push({group:{code:'unassigned',name:'未分类',series:[]},rows:unassigned});
 $('company-body').innerHTML=sections.filter(section=>section.rows.length).map(({group,rows:groupRows})=>{
  groupRows.sort((a,b)=>(b.marketCap??-Infinity)-(a.marketCap??-Infinity)||a.code.localeCompare(b.code));
  const header=`<tr class="company-group" data-company-group="${esc(group.code)}"><th colspan="7" scope="rowgroup"><span>${esc(group.name)}</span><small>${groupRows.length} 家</small><strong>${official?'申万行业市值':'行业总市值'} ${fmt(group.series.at(-1)?.marketCap,2)} 亿</strong></th></tr>`;
  return header+groupRows.map(r=>`<tr data-company-code="${esc(r.code)}" data-company-sector="${esc(group.code)}" class="${r.status==='estimated'?'estimate-row':''}"><td>${esc(r.name)}</td><td>${esc(r.code)}</td><td class="company-market-cap" title="${short(L.quarter)}季末公司总股本×A股价${r.quoteCarried?'；沿用 '+date(r.quoteDate):''}">${fmt(r.marketCap,2)}</td><td>${fmt(r.revenue,2)}</td><td>${fmt(r.profit,2)}</td><td>${date(r.announcementDate)}</td><td><span class="tag ${r.status==='estimated'?'estimate':r.status==='missing'?'partial':''}">${r.status==='estimated'?'估算':r.status==='missing'?'财务缺失':'已披露'}</span></td></tr>`).join('');
 }).join('')||'<tr><td colspan="7" style="text-align:center">没有匹配的公司</td></tr>';
}
$('company-search').addEventListener('input',renderCompanies);$('estimated-only').addEventListener('change',renderCompanies);
$('source-links').innerHTML=D.meta.sourceLinks.map(s=>`<a href="${s.url}" target="_blank" rel="noopener noreferrer">${s.name} ↗</a>`).join('');


// Supplementary data: only the selected panel is expanded; initial state is closed.
const supplementButtons=[...root.querySelectorAll('.supplement-tabs button')];
function openSupplement(panelId){
 if(panelId&&panelId.endsWith('data-table')&&!quarterReady){renderQuarterTable();quarterReady=true;}
 if(panelId&&panelId.endsWith('company-data')&&!companiesReady){renderCompanies();companiesReady=true;}
 if(panelId&&panelId.endsWith('methodology')&&!coverageReady){renderCoverage();coverageReady=true;}

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
$('sector-options').innerHTML=GROUPS.map(g=>`<label class="sector-option"><input type="checkbox" data-sector="${g.code}"><span>${esc(g.name)}</span><strong>${marketLabel(g.series.at(-1).marketCap)}</strong></label>`).join('');
function syncSectorPicker(){
 const count=selectedSectors.size;
 $('sector-all').checked=count===GROUPS.length;$('sector-all').indeterminate=count>0&&count<GROUPS.length;
 root.querySelectorAll('[data-sector]').forEach(input=>input.checked=selectedSectors.has(input.dataset.sector));
 $('sector-selection').textContent='二级行业';$('selected-market-cap').textContent=count+' / '+GROUPS.length;
 $('sector-trigger').setAttribute('aria-label','二级行业，已选 '+count+' 个，下方显示独立图表');
 $('selection-total').textContent=String(count)+' 个小图';
 $('selection-method').textContent=D.meta.industry+'主图显示整体；勾选二级行业后，在主图下方分别显示，按2026Q3季末市值降序排列。图例开关和时间范围同时控制主图及所有小图，勾选不改变整体统计或底部明细范围。各图纵轴独立缩放，比较金额请看数字和轴刻度。';
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
function setAllSectors(expanded){selectedSectors.clear();if(expanded)GROUPS.forEach(g=>selectedSectors.add(g.code));renderMiniCharts();}
$('sector-all').addEventListener('change',e=>setAllSectors(e.target.checked));
$('sector-options').addEventListener('change',e=>{const code=e.target.dataset.sector;if(!code)return;if(e.target.checked)selectedSectors.add(code);else selectedSectors.delete(code);renderMiniCharts();});
document.addEventListener('click',e=>{if(!$('sector-picker').contains(e.target))closeSectorMenu();});
$('sector-picker').addEventListener('keydown',e=>{if(e.key==='Escape'){closeSectorMenu();$('sector-trigger').focus();}});
$('sector-picker').addEventListener('focusout',e=>{if(e.relatedTarget&&!$('sector-picker').contains(e.relatedTarget))closeSectorMenu();});
const getState=()=>({first,last,showLabels,financeMode,selectedSectors:[...selectedSectors],visibleMetrics:{...visibleMetrics},latest:L,miniOrder:[...$('sector-grid').children].map(e=>e.dataset.sectorCard)});
const getCharts=()=>({main:chart,children:Object.fromEntries([...miniCharts].map(([code,item])=>[code,item.chart]))});
redraw();renderMiniCharts();

const api={getState,getCharts,setRange,peView,pePercentile,focus,applyGlobal,setAllSectors};
window.RESEARCH_MODULES[root.dataset.industry]=api;
if(!prefix){window.RESEARCH_STATE=getState;window.RESEARCH_CHARTS=getCharts;}
return api;
}

const moduleTemplate=document.getElementById('industry-template');
const industryList=document.getElementById('industry-list');
const industryLoads=new Map();
const assetVersion='20261113-sw-alignment';
function loadIndustryJSON(path){return fetch(path+'?v='+assetVersion).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();});}
function activateIndustry(root){
 const key=root.dataset.industry;if(industryLoads.has(key))return industryLoads.get(key);
 const item=window.INDUSTRY_CATALOG.industries.find(g=>g.key===key);
 const job=Promise.all([loadIndustryJSON(item.path+'data.json'),loadIndustryJSON(item.path+'sectors.json')]).then(([data,sectors])=>{
  root.querySelector('.module-loading')?.remove();mountIndustry(root,data,sectors,key==='electronics'?'':key+'-');root.dataset.loaded='true';return window.RESEARCH_MODULES[key];
 }).catch(error=>{industryLoads.delete(key);const status=root.querySelector('.module-loading');if(status){status.textContent='数据加载失败，点击重试';status.onclick=()=>activateIndustry(root);}throw error;});
 industryLoads.set(key,job);return job;
}
const moduleObserver=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){moduleObserver.unobserve(entry.target);activateIndustry(entry.target).catch(()=>{});}},{rootMargin:'700px 0px'});
for(const item of window.INDUSTRY_CATALOG.industries){
 const root=document.createElement('section');root.id='industry-'+item.key;root.className='industry-module';root.dataset.industry=item.key;
 root.appendChild(moduleTemplate.content.cloneNode(true));
 const prefix=item.key==='electronics'?'':item.key+'-';
 if(prefix)for(const el of root.querySelectorAll('[id],[aria-controls],[aria-labelledby]'))for(const attr of ['id','aria-controls','aria-labelledby'])if(el.hasAttribute(attr))el.setAttribute(attr,prefix+el.getAttribute(attr));
 root.querySelector('.heading-main h2').textContent=item.name;root.dataset.valuationSource=item.valuationSource||'company_aggregate';root.querySelector('.sector-menu-title strong').textContent=item.name+' · 申万二级';root.querySelector('.research-chart').setAttribute('aria-label',item.name+'季度市值、PE、营收与归母净利润');
 root.querySelector('#'+CSS.escape(prefix+'selected-market-cap')).textContent='0 / '+item.subIndustryCount;
 root.querySelector('.focus-row').textContent=item.name+' · '+item.latest.quarter+' · 总市值 '+(item.latest.marketCap/10000).toLocaleString('zh-CN',{maximumFractionDigits:2})+' 万亿';
 const status=document.createElement('div');status.className='module-loading';status.textContent='加载图表…';root.querySelector('.research-chart').appendChild(status);
 industryList.appendChild(root);moduleObserver.observe(root);
 root.addEventListener('pointerdown',()=>activateIndustry(root).catch(()=>{}),{once:true});
}
window.ACTIVATE_INDUSTRY=key=>activateIndustry(document.getElementById('industry-'+key));

// Keep the active industry visible in the sticky navigation without moving the page.
const industryNav=document.querySelector('.floating-controls');
const navLinks=document.getElementById('industry-navigation-links');
const navSections=[...industryList.querySelectorAll('.industry-module')];
const navAnchors=window.INDUSTRY_CATALOG.industries.map(item=>{
 const link=document.createElement('a');link.href='#industry-'+item.key;link.textContent=item.name;link.dataset.industry=item.key;navLinks.appendChild(link);return link;
});
let currentNavIndex=-1,navFrame=0;
function updateIndustryNavigation(){
 navFrame=0;const threshold=industryNav.getBoundingClientRect().bottom+24;
 let index=0;for(let i=0;i<navSections.length;i++){if(navSections[i].getBoundingClientRect().top<=threshold)index=i;else break;}
 if(window.scrollY>0&&window.innerHeight+window.scrollY>=document.documentElement.scrollHeight-2)index=navSections.length-1;
 if(index===currentNavIndex)return;
 currentNavIndex=index;navAnchors.forEach((link,i)=>{if(i===index)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
 const active=navAnchors[index],box=navLinks.getBoundingClientRect(),rect=active.getBoundingClientRect();
 if(rect.left<box.left+8||rect.right>box.right-8)navLinks.scrollTo({left:navLinks.scrollLeft+rect.left-box.left-(box.width-rect.width)/2,behavior:'instant'});
}
function scheduleIndustryNavigation(){if(!navFrame)navFrame=requestAnimationFrame(updateIndustryNavigation);}
async function navigateIndustry(root,behavior='smooth'){
 await activateIndustry(root).catch(()=>{});
 root.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':behavior});
 scheduleIndustryNavigation();
}
navLinks.addEventListener('click',event=>{
 const link=event.target.closest('a');if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
 event.preventDefault();const root=document.getElementById('industry-'+link.dataset.industry);
 if(location.hash!==link.hash)history.pushState(null,'',link.hash);
 navigateIndustry(root);
});
function navigateIndustryHash(){const root=navSections.find(section=>'#'+section.id===location.hash);if(root)navigateIndustry(root,'instant');}
window.addEventListener('scroll',scheduleIndustryNavigation,{passive:true});
window.addEventListener('resize',scheduleIndustryNavigation);
window.addEventListener('hashchange',navigateIndustryHash);
new ResizeObserver(()=>{document.documentElement.style.setProperty('--industry-nav-height',industryNav.offsetHeight+'px');scheduleIndustryNavigation();}).observe(industryNav);
new ResizeObserver(scheduleIndustryNavigation).observe(industryList);
updateIndustryNavigation();navigateIndustryHash();

const globalControls=document.getElementById('global-controls');
const globalQuarters=Array.from({length:87},(_,i)=>(2005+Math.floor(i/4))+' Q'+(i%4+1));
for(const id of ['from-quarter','to-quarter'])document.getElementById(id).innerHTML=globalQuarters.map((q,i)=>`<option value="${i}">${q}</option>`).join('');
function syncGlobalControls(){
 const sectorsToggle=document.getElementById('global-sectors-toggle');
 sectorsToggle.textContent=GLOBAL_VIEW.expandSectors?'收拢全部二级':'展开全部二级';
 sectorsToggle.setAttribute('aria-pressed',String(GLOBAL_VIEW.expandSectors));
 document.getElementById('from-quarter').value=GLOBAL_VIEW.first;document.getElementById('to-quarter').value=GLOBAL_VIEW.last;
 globalControls.querySelectorAll('[data-range]').forEach(b=>b.classList.toggle('active',GLOBAL_VIEW.last===86&&(b.dataset.range==='all'?GLOBAL_VIEW.first===0:Number(b.dataset.range)===GLOBAL_VIEW.last-GLOBAL_VIEW.first+1)));
 globalControls.querySelectorAll('[data-finance-mode]').forEach(b=>{const active=b.dataset.financeMode===GLOBAL_VIEW.financeMode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
 globalControls.querySelectorAll('[data-metric]').forEach(b=>b.setAttribute('aria-pressed',String(GLOBAL_VIEW.metrics[b.dataset.metric])));
 document.getElementById('revenue-mode-label').textContent=GLOBAL_VIEW.financeMode==='rolling'?'近4季营收':'单季营收';
}
function updateGlobalCharts(){syncGlobalControls();for(const module of Object.values(window.RESEARCH_MODULES))module.applyGlobal();}
function setGlobalRange(a,b){GLOBAL_VIEW.first=Math.max(0,Math.min(a,86));GLOBAL_VIEW.last=Math.max(GLOBAL_VIEW.first,Math.min(b,86));updateGlobalCharts();}
globalControls.querySelectorAll('[data-range]').forEach(b=>b.addEventListener('click',()=>setGlobalRange(b.dataset.range==='all'?0:Math.max(0,87-Number(b.dataset.range)),86)));
globalControls.querySelectorAll('[data-finance-mode]').forEach(b=>b.addEventListener('click',()=>{GLOBAL_VIEW.financeMode=b.dataset.financeMode;updateGlobalCharts();}));
globalControls.querySelectorAll('[data-metric]').forEach(b=>b.addEventListener('click',()=>{GLOBAL_VIEW.metrics[b.dataset.metric]=!GLOBAL_VIEW.metrics[b.dataset.metric];updateGlobalCharts();}));
document.getElementById('global-sectors-toggle').addEventListener('click',()=>{
 GLOBAL_VIEW.expandSectors=!GLOBAL_VIEW.expandSectors;syncGlobalControls();
 for(const module of Object.values(window.RESEARCH_MODULES))module.setAllSectors(GLOBAL_VIEW.expandSectors);
 scheduleIndustryNavigation();
});
document.getElementById('labels').addEventListener('change',e=>{GLOBAL_VIEW.showLabels=e.target.checked;updateGlobalCharts();});
document.getElementById('from-quarter').addEventListener('change',e=>setGlobalRange(Number(e.target.value),Math.max(Number(e.target.value),GLOBAL_VIEW.last)));
document.getElementById('to-quarter').addEventListener('change',e=>setGlobalRange(Math.min(Number(e.target.value),GLOBAL_VIEW.first),Number(e.target.value)));
syncGlobalControls();
