import test from 'node:test';
import assert from 'node:assert/strict';
import {view,momentum,recommendation,filterRows,snapshotURLs} from '../dist/model.js';
const fixture=()=>({schema:1,generated_at:1000,sources:{Gate:{state:'正常',updated:999},IC:{state:'正常',updated:999}},rows:[
  {source:'Gate',symbol:'UNI_USDT',price:'6.8',periods:['↑多','↑多','↑多'],state:'ready',direction:1,momentum:70,ratio:1.5,entry:'6.7~6.8',stop:'6.6',take:'7.0',updated:999,valid_until:1100},
  {source:'IC',symbol:'UNIUSD',price:'6.7/6.8',periods:['↑多','↑多','↑多'],state:'structure',direction:1,momentum:69,ratio:.9,entry:'6.7',stop:'6.6',take:'7',updated:999,valid_until:1040}
]});
test('ready count excludes IC structures',()=>assert.equal(view(fixture(),1001).ready,1));
test('source prices and momentum remain independent',()=>{const r=view(fixture(),1001).rows;assert.notEqual(r[0].price,r[1].price);assert.equal(r[0].momentum,70);assert.equal(r[1].momentum,69);});
test('IC expires independently of Gate',()=>{const r=view(fixture(),1045);assert.equal(r.rows[1].price,'—');assert.equal(r.rows[1].momentum,null);assert.equal(r.rows[0].state,'ready');});
test('plan expiry hides entry and old signal before source expires',()=>{const x=fixture();x.rows[0].valid_until=1002;const r=view(x,1003).rows[0];assert.equal(r.entry,'—');assert.equal(r.state,'wait');assert.equal(r.price,'—');});
test('relay shutdown does not leave apparently actionable signals',()=>{const x=fixture();x.sources.Gate.updated=1100;x.rows[0].valid_until=1200;const r=view(x,1096);assert.equal(r.stale,true);assert.equal(r.ready,0);assert.equal(r.rows[0].take,'—');});
test('future clock anomalies are paused',()=>assert.equal(view(fixture(),990).ready,0));
test('source health failure is respected',()=>{const x=fixture();x.sources.Gate.state='暂停';assert.equal(view(x,1001).rows[0].state,'wait');});
test('momentum threshold boundaries and zero are explicit',()=>{for(const [score,level] of [[0,'中性'],[19,'中性'],[20,'弱'],[39,'弱'],[40,'中'],[69,'中'],[70,'强'],[100,'强']])assert.equal(momentum(score).strength,level);assert.match(momentum(-70).label,/空/);assert.equal(momentum(null).label,'—');});
test('filters follow source, query and ready state',()=>{const r=view(fixture(),1001).rows;assert.equal(filterRows(r,'IC','uni',false).length,1);assert.equal(filterRows(r,'IC','uni',true).length,0);assert.equal(filterRows(r,'all','BTC',false).length,0);});
test('stopped individual quote retains its explanation',()=>{const x=fixture();x.rows[1].valid_until=0;x.rows[1].reason='报价停止更新，可能休市';assert.match(view(x,1001).rows[1].reason,/休市/);});
test('invalid schema has no ready opportunity',()=>assert.equal(view({schema:9,rows:[]},1001).ready,0));
test('immutable file lookup waits six seconds for publication and has one fallback',()=>{
  assert.deepEqual(snapshotURLs('https://example.com/snapshots/',1005),['https://example.com/snapshots/49.json','https://example.com/snapshots/48.json']);
  assert.equal(snapshotURLs('https://example.com/snapshots/',1006)[0],'https://example.com/snapshots/50.json');
  assert.equal(snapshotURLs('https://example.com/snapshots/',1026)[0],'https://example.com/snapshots/51.json');
});
test('recommendations expose confirmed, pending and IC structure plans separately',()=>{
 const x=fixture();let rows=view(x,1001).rows;
 assert.deepEqual(recommendation(rows[0]),{stop:'6.6',take:'7.0',note:'计划已确认 · 请核对'});
 assert.match(recommendation(rows[1]).note,/结构参考.*费用待核实/);
 x.rows[0].state='watch';rows=view(x,1001).rows;assert.match(recommendation(rows[0]).note,/观察预案/);
 x.rows[0].direction=-1;x.rows[0].stop='7.0';x.rows[0].take='6.4/6.2';assert.equal(recommendation(view(x,1001).rows[0]).take,'6.4/6.2');
});
test('recommendations disappear with expired plans, stopped sources and missing levels',()=>{
 const x=fixture();x.rows[0].valid_until=1002;assert.equal(recommendation(view(x,1003).rows[0]).stop,'等待');
 for(const change of [{state:'wait'},{stop:'—'},{take:'NaN'},{direction:0},{take:'7/'}]){
  const data=fixture();Object.assign(data.rows[0],change);const risk=recommendation(view(data,1001).rows[0]);assert.equal(risk.stop,'等待');assert.equal(risk.take,'等待');
 }
 const stopped=fixture();stopped.sources.Gate.state='暂停';assert.equal(recommendation(view(stopped,1001).rows[0]).take,'等待');
});

test('ranking prioritizes ready and executable plans before directional momentum and crosses',()=>{
 const plan={source:'Gate',state:'ready',direction:-1,entry_distance_atr:0,net_rr:2};
 const rows=[
   {...plan,symbol:'OPPOSITE',momentum:95,crosses:{'15m':-1}},
   {...plan,symbol:'LOWRR',net_rr:1.6,momentum:-98,crosses:{'15m':-1}},
   {...plan,symbol:'FAR',entry_distance_atr:.2,net_rr:3,momentum:-90},
   {...plan,symbol:'BEST',momentum:-61},
   {...plan,symbol:'WAITING',state:'watch',momentum:-100,net_rr:5},
   {...plan,symbol:'IC',source:'IC',state:'structure',structure_confirmed:true},
 ];
 assert.deepEqual(filterRows(rows,'all','',false).map(row=>row.symbol),
   ['BEST','OPPOSITE','LOWRR','FAR','IC','WAITING']);
});

test('IC reference reward/risk only appears on live structure plans',()=>{
 const data=fixture();
 data.rows[1].reference_rr=1.78;
 assert.equal(view(data,1001).rows[1].reference_rr,1.78);
 assert.equal(view(data,1045).rows[1].reference_rr,null);
 data.rows[1].state='wait';
 assert.equal(view(data,1001).rows[1].reference_rr,null);
});
