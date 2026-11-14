import {DEFAULT_DISPLAY} from './settings.js?v=risk-levels-3';
import {compareOpportunities} from './ranking.js?v=opportunity-quality-1';
export function fresh(now, timestamp, ttl) {return Number.isFinite(timestamp) && timestamp>0 && now-timestamp>=-5 && now-timestamp<=ttl;}
export function momentum(signed,grades=DEFAULT_DISPLAY.grades) {
  if(!Number.isFinite(signed)||Math.abs(signed)>100)return {label:'—',strength:'',score:null};
  const score=Math.abs(signed),strength=score>=grades.strong?'强':score>=grades.medium?'中':score>=grades.weak?'弱':'中性';
  return {score,strength,tone:strength==='中性'?'neutral':signed>0?'rise':'fall',directionText:strength==='中性'?'中性':signed>0?'↑ 多头':'↓ 空头',levelLabel:{强:'强势',中:'中等',弱:'偏弱',中性:'盘整'}[strength],label:strength==='中性'?`中性 ${score}`:`${signed>0?'多':'空'} ${score} ${strength}`};
}
export function trend(row){
  if(!row.live)return {label:'暂停',tone:'paused'};
  const [,h1,h4]=row.periods||[];
  if(h1==='↑多'&&h4===h1)return {label:'偏多',tone:'rise'};
  if(h1==='↓空'&&h4===h1)return {label:'偏空',tone:'fall'};
  return {label:'观望',tone:'neutral'};
}
export function recommendation(row){
  const price=value=>typeof value==='string'&&value.trim()!==''&&Number.isFinite(Number(value))&&Number(value)>0;
  const levels=(value,separator)=>typeof value==='string'&&value.split(separator).length<=2&&value.split(separator).every(price);
  if(!row.live||![-1,1].includes(row.direction)||!['ready','watch','structure'].includes(row.state)||
    !levels(row.entry,'~')||!price(row.stop)||!levels(row.take,'/'))return null;
  const confirmed=row.source==='IC'?row.structure_confirmed===true:row.state==='ready';
  return {entry:row.entry,stop:row.stop,take:row.take,confirmed};
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
      net_rr:live?row.net_rr??null:null,entry_distance_atr:live?row.entry_distance_atr??null:null,
      reference_rr:live&&row.source==='IC'&&state==='structure'&&row.direction&&Number.isFinite(row.reference_rr)&&row.reference_rr>0
        ? row.reference_rr : null,
      structure_confirmed:live&&row.structure_confirmed===true,
      crosses:live?row.crosses||{}:{},momentum:live?row.momentum:null,ratio:live?row.ratio:null,entry:live?row.entry:'—',stop:live?row.stop:'—',take:live?row.take:'—',
      reason:live||sources[row.source]?.live&&row.valid_until===0?row.reason:independent&&row.source==='Gate'?'Gate 行情或计划已过期，等待直连更新':'行情或同步已过期，暂停观察；等待电脑恢复更新'};
  });
  return {sources,rows,ready:rows.filter(r=>r.state==='ready').length,stale:independent?!sources.Gate.live&&!sources.IC.live:!running};
}
export function filterRows(rows,source,search,plansOnly){
  const q=search.trim().toUpperCase();
  return rows.filter(r=>(source==='all'||r.source===source)&&r.symbol.includes(q)&&(!plansOnly||recommendation(r)))
    .sort(compareOpportunities);
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
