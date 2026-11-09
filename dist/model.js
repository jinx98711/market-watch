import {DEFAULT_DISPLAY} from './settings.js?v=risk-levels-3';
export function fresh(now, timestamp, ttl) {return Number.isFinite(timestamp) && timestamp>0 && now-timestamp>=-5 && now-timestamp<=ttl;}
export function momentum(signed,grades=DEFAULT_DISPLAY.grades) {
  if(!Number.isFinite(signed)||Math.abs(signed)>100)return {label:'—',strength:'',score:null};
  const score=Math.abs(signed),strength=score>=grades.strong?'强':score>=grades.medium?'中':score>=grades.weak?'弱':'中性';
  return {score,strength,tone:strength==='中性'?'neutral':signed>0?'rise':'fall',directionText:strength==='中性'?'中性':signed>0?'↑ 多头':'↓ 空头',levelLabel:{强:'强势',中:'中等',弱:'偏弱',中性:'盘整'}[strength],label:strength==='中性'?`中性 ${score}`:`${signed>0?'多':'空'} ${score} ${strength}`};
}
export function recommendation(row){
  const price=value=>typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))&&Number(value)>0;
  const valid=row.live&&[-1,1].includes(row.direction)&&['ready','watch','structure'].includes(row.state)&&price(row.stop)&&typeof row.take==='string'&&row.take.split('/').every(price);
  return valid?{stop:row.stop,take:row.take,note:row.source==='IC'?'结构参考 · 费用待核实':row.state==='ready'?'计划已确认 · 请核对':'观察预案 · 等待入场确认'}:{stop:'等待',take:'等待',note:'等待有效观察计划'};
}
export function view(snapshot, now=Date.now()/1000) {
  if(!snapshot||snapshot.schema!==1||!Array.isArray(snapshot.rows))return {sources:{},rows:[],ready:0,stale:true};
  const independent=snapshot.mode==='gate-direct',running=independent||fresh(now,snapshot.generated_at,95),sources={};
  for(const name of ['Gate','IC']){
    const state=snapshot.sources?.[name]||{};
    sources[name]={live:running&&state.state==='正常'&&fresh(now,state.updated,name==='Gate'?150:45),updated:state.updated||0};
  }
  const rows=snapshot.rows.map(row=>{
    const live=!!sources[row.source]?.live&&row.valid_until>0&&now<=row.valid_until;
    const state=live?row.state:'wait';
    return {...row,live,state,price:live?row.price:'—',bid:live?row.bid||'—':'—',ask:live?row.ask||'—':'—',periods:live?row.periods:['等待','等待','等待'],
      crosses:live?row.crosses||{}:{},momentum:live?row.momentum:null,ratio:live?row.ratio:null,entry:live?row.entry:'—',stop:live?row.stop:'—',take:live?row.take:'—',
      reason:live||sources[row.source]?.live&&row.valid_until===0?row.reason:independent&&row.source==='Gate'?'Gate 行情或计划已过期，等待直连更新':'行情或同步已过期，暂停观察；等待电脑恢复更新'};
  });
  return {sources,rows,ready:rows.filter(r=>r.state==='ready').length,stale:independent?!sources.Gate.live&&!sources.IC.live:!running};
}
export function filterRows(rows,source,search,readyOnly){
  const q=search.trim().toUpperCase();
  const aligned = row => row.direction
    ? Object.values(row.crosses || {}).filter(value => value === row.direction).length
    : 0;
  return rows.filter(r=>(source==='all'||r.source===source)&&r.symbol.includes(q)&&(!readyOnly||r.state==='ready'))
    .sort((a,b)=>Number(b.state==='ready')-Number(a.state==='ready')||aligned(b)-aligned(a));
}
export function snapshotURLs(base,now=Date.now()/1000){
  const bucket=Math.floor((now-6)/20);
  return [bucket,bucket-1].map(value=>new URL(`${value}.json`,base).href);
}
export function combineDirect(gate,ic){
  const placeholders=['XAUUSD','BTCUSD','ETHUSD','UNIUSD'].map(symbol=>({source:'IC',symbol,price:'—',periods:['等待','等待','等待'],state:'wait',direction:0,momentum:null,ratio:null,entry:'—',stop:'—',take:'—',reason:'IC 需要电脑运行 MT5；当前同步不可用',updated:0,valid_until:0}));
  const gateRows=gate?.rows||[],icRows=ic?.rows?.filter(row=>row.source==='IC')||placeholders,remaining=[...icRows],rows=[];
  const gold=remaining.find(row=>row.symbol==='XAUUSD');if(gold){rows.push(gold);remaining.splice(remaining.indexOf(gold),1);}
  for(const row of gateRows){rows.push(row);const symbol=row.symbol.replace('_USDT','USD'),match=remaining.find(row=>row.symbol===symbol);if(match){rows.push(match);remaining.splice(remaining.indexOf(match),1);}}
  rows.push(...remaining);
  return {schema:1,mode:'gate-direct',generated_at:gate?.generated_at||0,sources:{Gate:gate?.source||{state:'暂停',updated:0},IC:ic?.sources?.IC||{state:'暂停',updated:0}},
    screening:{Gate:gate?.screening||{evaluated:0,ready:0,watch:0,structure:0},IC:ic?.screening?.IC||{evaluated:0,ready:0,watch:0,structure:0}},rows};
}
