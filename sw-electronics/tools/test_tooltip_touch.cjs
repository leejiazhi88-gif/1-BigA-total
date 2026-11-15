const fs=require('fs'),vm=require('vm'),assert=require('assert');const source=fs.readFileSync('app.js','utf8');const events={},windowEvents={};let timer,restored=0;const c={document:{addEventListener:(n,f)=>events[n]=f},window:{addEventListener:(n,f)=>windowEvents[n]=f},setTimeout:f=>(timer=f,1),clearTimeout:()=>timer=null,requestAnimationFrame:f=>f()};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('// Touch browsers'),source.indexOf('// End touch tooltip lifecycle.'))+ '\nthis.register=(i,r)=>tooltipCharts.set(i,r);',c);const actions=[];const chart={isDisposed:()=>false,getDom:()=>({contains:t=>t==='inside'}),dispatchAction:a=>actions.push(a)};c.register(chart,()=>restored++);
events.pointerdown({target:'inside'});assert.equal(actions.length,0);
events.touchend();assert.equal(actions.length,0);timer();assert.equal(actions.at(-1).type,'hideTip');assert.equal(restored,1);
actions.length=0;events.pointerdown({target:'outside'});assert.equal(actions.at(-1).type,'hideTip');
events.touchend();events.touchstart();assert.equal(timer,null);
for(const event of ['scroll','touchmove','touchcancel']){actions.length=0;events[event]();assert.equal(actions.at(-1).type,'hideTip');}
windowEvents.blur();console.log('PASS: delayed touch dismissal, outside tap, scroll, drag, cancel, timer cancellation, summary restore');
