import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {analyse,buildPlan,volumeSignal,ema,atr,parseCandles,closedCandles,rounded,quality,selectRows,evaluate,displayRow,trendObservation} from '../dist/gate-engine.js';
import {GateClient} from '../dist/gate-client.js';
import {combineDirect,view,momentum} from '../dist/model.js';
import {defaults,validateSettings,loadSettings} from '../dist/settings.js';
const data=JSON.parse(fs.readFileSync(new URL('./gate-parity.json',import.meta.url))),cfg=JSON.parse(fs.readFileSync(new URL('../dist/gate-config.json',import.meta.url)));
for(const c of data.cases)c.frames=Object.fromEntries(Object.entries(c.frames).map(([frame,index])=>[frame,data.frames[index]]));
const base=data.cases[0];
for(const c of data.cases)test('desktop Python parity: '+c.name,()=>{
  const built=buildPlan('BTC_USDT',c.frames,c.meta,c.cfg,data.analysisTime),row=analyse('BTC_USDT',c.frames,c.raw,c.meta,c.ticker,c.cfg,data.analysisTime,c.now);
  assert.equal(row.state,c.expected.state);assert.equal(row.side,c.expected.side);assert.equal(row.momentum,c.expected.momentum);assert.deepEqual(built.volume,c.expected.volume);
  if(c.expected.plan){for(const key of ['side','confirmed','created_at','expires_at','entry_low','entry_high','stop','tp1','tp2'])assert.equal(built.plan[key],c.expected.plan[key],key);assert.ok(Math.abs(built.plan.atr_15m-c.expected.plan.atr_15m)<1e-10);}else assert.equal(built.plan,null);
});
test('quarter tick is rounded as a step',()=>{assert.equal(rounded(10.12,'.25'),10);assert.equal(rounded(10.12,'.25',true),10.25);});
test('closed candles exclude current bar, reject stale bars and recent gaps',()=>{
 const bars=base.frames['15m'],live={...bars.at(-1),t:bars.at(-1).t+900};assert.equal(closedCandles([...bars,live],900,data.analysisTime).length,200);
 assert.throws(()=>closedCandles(bars.slice(0,-1),900,data.analysisTime));assert.throws(()=>closedCandles(bars.filter((_,i)=>i!==190),900,data.analysisTime));
});
test('strict quote turnover, geometry and duplicate validation',()=>{
 const raw=base.frames['15m'].map(b=>({...b,sum:b.v}));assert.equal(parseCandles(raw,900,data.analysisTime).length,200);
 assert.throws(()=>parseCandles([{...raw[0],sum:undefined,v:100000}],900,data.analysisTime));assert.throws(()=>parseCandles([raw[0],raw[0]],900,data.analysisTime));assert.throws(()=>parseCandles([{...raw[0],l:999}],900,data.analysisTime));
});
test('volume thresholds change confirmation and adverse blocking',()=>{
 const bars=base.frames['15m'],ma=ema(bars.map(b=>b.c)),a=atr(bars);
 assert.equal(volumeSignal(bars,'long',ma,a,{confirmation_volume_ratio:1.6}).confirmed,false);
 assert.equal(volumeSignal(bars,'long',ma,a,{pullback_volume_ratio:.5}).confirmed,false);
 const adverse=structuredClone(bars);adverse.at(-2).v=1200;assert.equal(volumeSignal(adverse,'long',ma,a,{adverse_volume_ratio:1.1}).blocked,true);
});
test('touching a target permanently invalidates the plan even after return',()=>{
 const row=analyse('BTC_USDT',base.frames,[],base.meta,base.ticker,base.cfg,data.analysisTime),invalid=new Map();
 evaluate(row,{...base.ticker,last:row.plan.tp1},[],data.analysisTime,invalid,base.cfg);assert.equal(row.state,'invalid');
 evaluate(row,base.ticker,[],data.analysisTime,invalid,base.cfg);assert.equal(row.state,'invalid');
});
test('fixed twelve remain visible when blocked; extras require eligible plans',()=>{
 const rows=cfg.pinned.map(contract=>({contract,state:'blocked'}));rows.push({contract:'LINK_USDT',state:'blocked'});assert.equal(selectRows(rows,cfg).length,12);
});
test('missing metadata and unknown delisting fail closed',()=>{assert.equal(quality(base.ticker,null,cfg,data.analysisTime).ok,false);assert.equal(quality(base.ticker,{...base.meta,in_delisting:null},cfg,data.analysisTime).ok,false);});
test('offline IC and hostile relay Gate rows cannot replace direct Gate',()=>{
 const row={source:'Gate',symbol:'UNI_USDT',price:'6.8',state:'ready',momentum:70,periods:['↑多','↑多','↑多'],valid_until:1200};
 const gate={generated_at:1000,source:{state:'正常',updated:1000},rows:[row]};
 const mixed=combineDirect(gate,{rows:[{...row,price:'9999'}],sources:{IC:{state:'暂停',updated:0}}});assert.equal(view(mixed,1100).rows.find(r=>r.source==='Gate').price,'6.8');assert.equal(view(mixed,1100).stale,false);
 assert.equal(view(combineDirect(gate,null),1151).ready,0);
});
test('settings validate boundaries, cross-field ordering, whitelist and storage',()=>{
 const x=defaults(cfg);assert.equal(x.display.rise,'#ff6b78');assert.deepEqual(validateSettings(x,x),x);
 x.display.grades.strong=30;assert.throws(()=>validateSettings(x,defaults(cfg)));x.display.grades.strong=80;x.gate.strategy.min_stop_pct=4;assert.throws(()=>validateSettings(x,defaults(cfg)));
 const y=defaults(cfg);y.gate.pinned=[];y.gate.positions=[{enabled:true}];const cleaned=validateSettings(y,defaults(cfg));assert.equal(cleaned.gate.pinned.length,12);assert.equal(cleaned.gate.positions,undefined);
 assert.deepEqual(loadSettings(cfg,{getItem:()=>'{bad'}),defaults(cfg));assert.equal(momentum(70,{weak:10,medium:30,strong:80}).strength,'中');
});
test('client only sends anonymous public GET and falls back on network failure',async()=>{
 const calls=[],c=new GateClient(cfg,{fetcher:async(url,options)=>{calls.push({url,options});if(calls.length===1)throw Error('offline');return {ok:true,json:async()=>({server_time:Date.now()})};}});c.controller=new AbortController();
 await c.request('/spot/time');assert.equal(calls.length,2);for(const {url,options} of calls){assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.headers,undefined);assert.match(url,/gateio.ws\/api\/v4\/spot\/time/);}await assert.rejects(c.request('/futures/usdt/orders'));
});
test('clock anomalies and duplicate tickers stop analysis',async()=>{
 const c=new GateClient(cfg);c.request=async()=>({server_time:Date.now()-60000});await assert.rejects(c.syncClock());assert.throws(()=>c.tickers([{contract:'BTC_USDT'},{contract:'BTC_USDT'}]));
});
test('eligible extras are ranked by readiness, distance then net reward/risk',()=>{
 const rows=[{contract:'BTC_USDT',state:'blocked'},...['LINK_USDT','AAVE_USDT','ADA_USDT','AVAX_USDT'].map((contract,i)=>({contract,state:i===0?'watch':'ready',plan:{side:'long'},entry_distance_atr:i===2?1:0,net_rr:2+i}))];
 assert.deepEqual(selectRows(rows,{...cfg,extra_count:2}).map(r=>r.contract),['BTC_USDT','AAVE_USDT','AVAX_USDT']);
});
test('hourly history is cached only inside the same closed-bar interval',async()=>{
 const c=new GateClient(cfg),bars=base.frames['1h'];c.serverAt=data.analysisTime;c.clockAt=performance.now();c.cache.set('BTC_USDT:1h',{raw:bars,fetched:data.analysisTime});let calls=0;c.request=async()=>{calls++;return bars.slice(-3).map(b=>({...b,sum:b.v}));};
 await c.candles('BTC_USDT','1h',data.analysisTime);assert.equal(calls,0);
 await assert.rejects(c.candles('BTC_USDT','1h',data.analysisTime+3600));assert.equal(calls,1);
});
test('Gate quotes use the final verified ticker for every selected state',async()=>{
 const c=new GateClient({...cfg,pinned:['BTC_USDT'],extra_candidates:[]});let quotes=0;
 c.syncClock=async()=>{c.serverAt=data.analysisTime;c.clockAt=performance.now();};
 c.metadata=async()=>{c.contracts=new Map([['BTC_USDT',base.meta]]);};
 c.candles=async(_symbol,frame)=>({closed:base.frames[frame],raw:base.frames[frame]});
 c.request=async path=>{assert.equal(path,'/futures/usdt/tickers');quotes++;return [{...base.ticker,highest_bid:quotes===1?'100.49':'100.48',lowest_ask:quotes===1?'100.51':'100.52'}];};
 const result=await c.scan();assert.equal(quotes,2);assert.equal(result.rows[0].bid,'100.48');assert.equal(result.rows[0].ask,'100.52');assert.equal(result.rows[0].price,'100.5');
 c.metadata=async()=>{c.contracts=new Map();};
 const blocked=await c.scan();assert.equal(blocked.rows[0].state,'wait');assert.equal(blocked.rows[0].bid,'100.48');assert.equal(blocked.rows[0].ask,'100.52');
});
test('Gate missing, crossed and nonnumeric books show dashes; expiry hides all quotes',()=>{
 const row={contract:'BTC_USDT',last:100.5,state:'wait'};
 for(const ticker of [null,{}, {highest_bid:101,lowest_ask:100},{highest_bid:true,lowest_ask:101},{highest_bid:100,lowest_ask:'NaN'}]){
  const displayed=displayRow(row,1000,ticker);assert.equal(displayed.bid,'—');assert.equal(displayed.ask,'—');
 }
 const good=displayRow(row,1000,{highest_bid:'100.4',lowest_ask:'100.6'}),source={state:'正常',updated:1000};
 const combined=combineDirect({generated_at:1000,source,rows:[good]},null);
 assert.equal(view(combined,1001).rows.find(r=>r.source==='Gate').bid,'100.4');
 const expired=view(combined,1151).rows.find(r=>r.source==='Gate');for(const key of ['price','bid','ask'])assert.equal(expired[key],'—');
});

test('EMA crossings require a new closed-bar intersection and cannot outrank a closer plan',()=>{
 const history=Array.from({length:60},()=>({c:100}));
 assert.equal(trendObservation([...history,{c:110}]).cross,1);
 assert.equal(trendObservation([...history,{c:90}]).cross,-1);
 assert.equal(trendObservation([...history,{c:110},{c:110}]).cross,0);
 const row=(contract,state,cross,entry_distance_atr)=>({contract,state,crosses:{'15m':cross},plan:{side:'long'},entry_distance_atr,net_rr:2});
 const rows=[row('ADA_USDT','ready',0,0),row('AAVE_USDT','ready',1,.5),row('LINK_USDT','wait',1,0)];
 assert.deepEqual(selectRows(rows,{...cfg,pinned:[],extra_count:1}).map(x=>x.contract),['ADA_USDT']);
 const d=displayRow(rows[1],1000,null);
 const data={schema:1,mode:'gate-direct',sources:{Gate:{state:'正常',updated:1000}},rows:[d]};
 assert.deepEqual(view(data,1000).rows[0].crosses,{'15m':1});
 assert.deepEqual(view(data,1151).rows[0].crosses,{});
});
