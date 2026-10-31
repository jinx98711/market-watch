export function fresh(now, timestamp, ttl) {return Number.isFinite(timestamp) && timestamp>0 && now-timestamp>=-5 && now-timestamp<=ttl;}
export function momentum(signed) {
  if(!Number.isFinite(signed)||Math.abs(signed)>100)return {label:'—',strength:'',score:null};
  const score=Math.abs(signed),strength=score>=70?'强':score>=40?'中':score>=20?'弱':'中性';
  return {score,strength,label:score<20?`中性 ${score}`:`${signed>0?'多':'空'} ${score} ${strength}`};
}
export function view(snapshot, now=Date.now()/1000) {
  if(!snapshot||snapshot.schema!==1||!Array.isArray(snapshot.rows))return {sources:{},rows:[],ready:0,stale:true};
  const running=fresh(now,snapshot.generated_at,95),sources={};
  for(const name of ['Gate','IC']){
    const state=snapshot.sources?.[name]||{};
    sources[name]={live:running&&state.state==='正常'&&fresh(now,state.updated,name==='Gate'?150:45),updated:state.updated||0};
  }
  const rows=snapshot.rows.map(row=>{
    const live=!!sources[row.source]?.live&&row.valid_until>0&&now<=row.valid_until;
    const state=live?row.state:'wait';
    return {...row,live,state,price:live?row.price:'—',periods:live?row.periods:['等待','等待','等待'],
      momentum:live?row.momentum:null,ratio:live?row.ratio:null,entry:live?row.entry:'—',stop:live?row.stop:'—',take:live?row.take:'—',
      reason:live||sources[row.source]?.live&&row.valid_until===0?row.reason:'行情或同步已过期，暂停观察；等待电脑恢复更新'};
  });
  return {sources,rows,ready:rows.filter(r=>r.state==='ready').length,stale:!running};
}
export function filterRows(rows,source,search,readyOnly){
  const q=search.trim().toUpperCase();
  return rows.filter(r=>(source==='all'||r.source===source)&&r.symbol.includes(q)&&(!readyOnly||r.state==='ready'))
    .sort((a,b)=>Number(b.state==='ready')-Number(a.state==='ready'));
}
