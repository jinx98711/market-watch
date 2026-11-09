// Read-only port of the desktop Gate rules. No accounts, positions or order endpoints.
import {compareOpportunities} from './ranking.js?v=opportunity-quality-1';
export const FRAMES={'15m':900,'1h':3600,'4h':14400};
export function num(value,fallback){
  const n=(typeof value==='number'||typeof value==='string'&&value.trim()!=='')?Number(value):NaN;
  if(!Number.isFinite(n)){if(fallback!==undefined)return fallback;throw Error('接口或配置包含无效数字');}
  return n;
}
const positive=value=>{const n=num(value);if(n<=0)throw Error('价格、数量或间隔必须大于 0');return n;};
const mean=values=>values.reduce((a,b)=>a+b,0)/values.length;
export function ema(values,period=20){const a=2/(period+1),out=[values[0]];for(const v of values.slice(1))out.push(a*v+(1-a)*out.at(-1));return out;}
export function atr(bars,allowZero=false){
  if(bars.length<=14)throw Error('波动率数据不足');
  const tr=bars.slice(1).map((b,i)=>Math.max(b.h-b.l,Math.abs(b.h-bars[i].c),Math.abs(b.l-bars[i].c)));
  let value=mean(tr.slice(0,14));for(const x of tr.slice(14))value=(13*value+x)/14;
  return allowZero&&value===0?0:positive(value);
}
export function trendObservation(bars) {
  const closes = bars.map(bar => bar.c);
  const fast = ema(closes), slow = ema(closes, 50);
  const previous = fast.at(-2) - slow.at(-2);
  const current = fast.at(-1) - slow.at(-1);
  let cross = 0;
  if (closes.length >= 51) {
    if (previous <= 0 && current > 0) cross = 1;
    else if (previous >= 0 && current < 0) cross = -1;
  }
  const close = closes.at(-1);
  let direction = 'wait';
  if (close > fast.at(-1) && current > 0 && fast.at(-1) > fast.at(-4)) direction = 'long';
  else if (close < fast.at(-1) && current < 0 && fast.at(-1) < fast.at(-4)) direction = 'short';
  return {direction, cross};
}
export function trend(bars) { return trendObservation(bars).direction; }
export function parseCandles(raw,step,now){
  if(!Array.isArray(raw)||!raw.length)throw Error('未收到有效 K 线');
  const seen=new Set();return raw.map(r=>{
    const b={t:num(r.t),o:positive(r.o),h:positive(r.h),l:positive(r.l),c:positive(r.c),v:num(r.sum)};
    if(!Number.isInteger(b.t)||b.t>now+5||b.t%step)throw Error('K 线时间不对齐或来自未来');
    if(b.v<0||b.l>Math.min(b.o,b.c)||b.h<Math.max(b.o,b.c)||b.l>b.h)throw Error('K 线价格或成交量异常');
    if(seen.has(b.t))throw Error('重复 K 线');seen.add(b.t);return b;
  }).sort((a,b)=>a.t-b.t);
}
export function closedCandles(bars,step,now,minimum=180,grace=5){
  const closed=bars.filter(b=>b.t+step<=now-grace);
  if(closed.length<minimum)throw Error('历史 K 线不足；暂停该合约信号');
  if(closed.at(-1).t!==Math.floor((now-grace)/step)*step-step)throw Error('最新收盘 K 线未更新；不使用旧数据');
  const recent=closed.slice(-minimum);if(recent.slice(1).some((b,i)=>b.t-recent[i].t!==step))throw Error('近期 K 线有缺口；暂停信号');return closed;
}
// Decimal tick arithmetic: .25 means a quarter-point step, not two decimal places.
function decimal(value){const [m,e='0']=String(value).toLowerCase().split('e'),[whole,fraction='']=m.split('.');let n=BigInt(whole+fraction),scale=fraction.length-Number(e);if(scale<0){n*=10n**BigInt(-scale);scale=0;}return {n,scale};}
export function rounded(value,tick,up=false){
  positive(value);positive(tick);const a=decimal(value),b=decimal(tick),s=Math.max(a.scale,b.scale),x=a.n*10n**BigInt(s-a.scale),y=b.n*10n**BigInt(s-b.scale);
  const units=x/y+(up&&x%y!==0n?1n:0n);return Number(units*b.n)/10**b.scale;
}
export function quality(ticker,contract,cfg,now){
  try{
    if(!ticker||!contract)throw Error('缺少合约或行情数据');
    if(contract.type!=='direct')throw Error('不是线性 USDT 合约');
    if(contract.in_delisting!==false)throw Error('退市状态未确认或处于退市中');
    if(!['trading','tradable','active',''].includes(String(contract.status===undefined?'trading':contract.status).toLowerCase()))throw Error('合约不处于正常交易状态');
    if(!['','crypto','cryptocurrency','0'].includes(String(contract.contract_type||'').toLowerCase()))throw Error('非普通加密货币合约或分类未识别');
    positive(contract.order_price_round);positive(ticker.last);
    const bid=positive(ticker.highest_bid),ask=positive(ticker.lowest_ask);if(ask<bid)throw Error('买卖报价交叉');
    const spread=(ask-bid)/((ask+bid)/2)*100,volume=positive(ticker.volume_24h_quote??ticker.volume_24h_usd),change=num(ticker.change_percentage),hi=positive(ticker.high_24h),lo=positive(ticker.low_24h);
    if(hi<lo)throw Error('24 小时高低价异常');
    const funding=num(ticker.funding_rate)*28800/positive(contract.funding_interval)*100,f=cfg.filters;
    if(volume<f.min_quote_volume_24h)throw Error('24 小时成交额不足');
    if(spread>f.max_spread_pct)throw Error('买卖价差偏大');
    if(Math.abs(change)>f.max_abs_change_24h_pct||(hi-lo)/lo*100>f.max_range_24h_pct)throw Error('当日波动异常，暂停新信号');
    if(Math.abs(funding)>f.max_abs_funding_8h_pct)throw Error('资金费率偏高，暂停新信号');
    const launched=num(contract.launch_time,0)||num(contract.create_time,0);if(launched&&now-launched<f.min_listing_days*86400)throw Error('新合约历史不足');
    return {ok:true,reason:'筛选通过'};
  }catch(e){return {ok:false,reason:e.message};}
}
export function volumeSignal(bars,side,averages,a,rules={}){
  const baseline=mean(bars.slice(-24,-4).map(b=>b.v)),result={basis:'quote_turnover_usdt',latest_ratio:null,pullback_ratio:null,confirmed:false,blocked:false,status:'量能数据不足'};
  if(baseline<=0)return result;
  const last=bars.at(-1),ratio=last.v/baseline;result.latest_ratio=ratio;
  if(!['long','short'].includes(side)){result.status='量能待方向';return result;}
  const sign=side==='long'?1:-1,pullbacks=bars.slice(-4,-1).filter((b,i)=>{const e=averages.at(-4+i);return sign*(b.c-b.o)<0&&b.l<=e+.2*a&&b.h>=e-.2*a;});
  if(pullbacks.length)result.pullback_ratio=mean(pullbacks.map(b=>b.v))/baseline;
  const adverse=bars.slice(-4).some(b=>sign*(b.c-b.o)<0&&b.v>=(rules.adverse_volume_ratio??1.5)*baseline),span=last.h-last.l,strength=span>0?(side==='long'?last.c-last.l:last.h-last.c)/span:0;
  const exhaustion=ratio>=(rules.exhaustion_volume_ratio??2)&&(span<=0||Math.abs(last.c-last.o)<=.25*span||strength<.6);
  if(adverse||exhaustion)Object.assign(result,{blocked:true,status:adverse?'放量逆向，暂停':'放量滞涨/滞跌，暂停'});
  else if(!pullbacks.length)result.status='等待回踩/反弹';
  else if(result.pullback_ratio>(rules.pullback_volume_ratio??.8))result.status='回踩/反弹未缩量';
  else if(ratio<(rules.confirmation_volume_ratio??1.5))result.status='确认K线未放量';
  else Object.assign(result,{confirmed:true,status:'缩量回踩/反弹·放量达标'});
  return result;
}
function obstacles(bars,side,entry){
  const b=bars.slice(-100),out=[];for(let i=2;i<b.length-2;i++){const near=[...b.slice(i-2,i),...b.slice(i+1,i+3)];if(side==='long'&&b[i].h>entry&&near.every(n=>b[i].h>n.h))out.push(b[i].h);if(side==='short'&&b[i].l<entry&&near.every(n=>b[i].l<n.l))out.push(b[i].l);}return out;
}
export function buildPlan(symbol,frames,contract,cfg,now){
  const m=frames['15m'],h=frames['1h'],h4=frames['4h'],directions=[trend(h),trend(h4)],side=directions[0]===directions[1]?directions[0]:'wait';
  const result={contract:symbol,state:'wait',side:'wait',plan:null,reason:'1 小时与 4 小时方向不一致'},a=atr(m),ma=ema(m.map(b=>b.c));
  result.volume=volumeSignal(m,side,ma,a,cfg.strategy);if(side==='wait')return result;
  if(result.volume.blocked){result.reason=result.volume.status;return result;}
  const s=cfg.strategy,last=m.at(-1),prev=m.at(-2),pct=a/last.c*100;
  if(pct<s.min_atr_15m_pct||pct>s.max_atr_15m_pct){result.reason='15 分钟波动过小或过大';return result;}
  const touched=m.slice(-4,-1).some((b,i)=>b.l<=ma.at(-4+i)+.2*a&&b.h>=ma.at(-4+i)-.2*a);
  const reversal=side==='long'?last.c>last.o&&last.c>prev.h&&last.c>ma.at(-1):last.c<last.o&&last.c<prev.l&&last.c<ma.at(-1);
  const confirmed=touched&&reversal&&result.volume.confirmed&&last.h-last.l<=2.5*a,anchor=confirmed?last.c:ma.at(-1),tick=String(contract.order_price_round);
  const low=rounded(anchor-.15*a,tick),high=rounded(anchor+.15*a,tick,true);
  if(low<=0||high<=low){result.reason='价格步长不适合当前观察区间';return result;}
  const entry=side==='long'?high:low,stop=side==='long'?rounded(Math.min(...m.slice(-6).map(b=>b.l))-.2*a,tick):rounded(Math.max(...m.slice(-6).map(b=>b.h))+.2*a,tick,true),risk=side==='long'?entry-stop:stop-entry;
  if(stop<=0||risk<=0){result.reason='止损结构无效';return result;}
  if(risk/entry*100<s.min_stop_pct||risk/entry*100>s.max_stop_pct){result.reason='合理止损距离不在筛选范围';return result;}
  const sign=side==='long'?1:-1,tp1=rounded(entry+sign*2*risk,tick,side==='short'),tp2=rounded(entry+sign*3*risk,tick,side==='short');
  if(Math.min(tp1,tp2)<=0){result.reason='目标价无效';return result;}
  const fee=Math.max(s.assumed_taker_fee_rate,num(contract.taker_fee_rate,0)),cost=2*(fee+s.assumed_slippage_rate)*entry,reward=Math.abs(tp1-entry),rr=(reward-cost)/(risk+cost);
  if(rr<s.min_net_reward_risk){result.reason='扣除估计交易成本后空间不足';return result;}
  const barriers=[...obstacles(h,side,entry),...obstacles(h4,side,entry)];
  if(barriers.length&&Math.min(...barriers.map(x=>Math.abs(x-entry)))<reward+.1*a){result.reason='附近小时级支撑或阻力压缩目标空间';return result;}
  const end=last.t+900,expires=end+900;if(now>=expires){result.reason='旧观察计划已到期；等待新收盘数据';return result;}
  return {...result,side,reason:confirmed?'收盘量价条件已确认，仍需核对实时价格':!result.volume.confirmed?result.volume.status:'方向一致，等待 15 分钟价格形态收盘确认',plan:{
    id:`${symbol}:${end}:${side}:${confirmed?'confirm':'watch'}`,side,confirmed,created_at:end,expires_at:expires,entry_low:low,entry_high:high,stop,tp1,tp2,atr_15m:a,atr_15m_pct:pct,tick}};
}
export function evaluate(row,ticker,raw15,now,invalid,cfg){
  const p=row.plan;if(!p)return row;
  if(now>=p.expires_at){row.state='expired';row.reason='旧观察计划已到期；不再发出入场提醒';return row;}
  const after=raw15.filter(b=>b.t>=p.created_at&&b.t<=now),last=positive(ticker.last),low=Math.min(last,...after.map(b=>b.l)),high=Math.max(last,...after.map(b=>b.h));
  if(p.side==='long'?low<=p.stop||high>=p.tp1:high>=p.stop||low<=p.tp1)invalid.set(p.id,p.expires_at);
  if(invalid.has(p.id)){row.state='invalid';row.reason='参考止损或首个目标已被触及；本计划停用';return row;}
  if(!p.confirmed){row.state='watch';return row;}
  const entry=positive(p.side==='long'?ticker.lowest_ask:ticker.highest_bid),risk=Math.abs(entry-p.stop),fee=Math.max(cfg.strategy.assumed_taker_fee_rate,row.taker_fee_rate||0),spread=positive(ticker.lowest_ask)-positive(ticker.highest_bid),cost=2*(fee+cfg.strategy.assumed_slippage_rate)*entry+spread;
  if(entry>=p.entry_low&&entry<=p.entry_high&&(Math.abs(p.tp1-entry)-cost)/(risk+cost)>=cfg.strategy.min_net_reward_risk){row.state='ready';row.reason='小时方向一致、15 分钟已收盘确认，报价在观察区间；请人工核对';}
  else{row.state='watch';row.reason='收盘条件已确认，但报价离开区间或成本过高；不追价';}return row;
}
function bankersRound(x){const floor=Math.floor(x);return x-floor===.5?(floor%2===0?floor:floor+1):Math.round(x);}
export function momentumScore(frames){
  let total=0;for(const [frame,weight] of [['15m',.5],['1h',.3],['4h',.2]]){
    const bars=frames[frame],closes=bars.map(b=>b.c),a=atr(bars,true),averages=[closes[0]];
    for(const close of closes.slice(1))averages.push(averages.at(-1)+2/21*(close-averages.at(-1)));
    const displacement=a>0?(closes.at(-1)-closes.at(-7))/(a*Math.sqrt(6)):0,slope=a>0?(averages.at(-1)-averages.at(-4))/(a*.5):0,clip=x=>Math.max(-1,Math.min(1,x));
    total+=(70*clip(displacement)+30*clip(slope))*weight;
  }return bankersRound(total);
}
export function analyse(symbol,frames,raw15,contract,ticker,cfg,analysisTime,now=analysisTime,invalid=new Map()){
  const row={contract:symbol,last:ticker?num(ticker.last,0):null,state:'wait',side:'wait',plan:null};
  const q=quality(ticker,contract,cfg,now);
  try{
    row.periods = {};
    row.crosses = {};
    for (const [frame, bars] of Object.entries(frames)) {
      const {direction, cross} = trendObservation(bars);
      row.periods[frame] = direction;
      if (cross) row.crosses[frame] = cross;
    }
    row.momentum=momentumScore(frames);
    if(!q.ok)return {...row,state:'blocked',reason:q.reason};
    Object.assign(row,buildPlan(symbol,frames,contract,cfg,analysisTime));row.taker_fee_rate=Math.max(0,num(contract.taker_fee_rate,0));
    evaluate(row,ticker,raw15,now,invalid,cfg);
    if(['ready','watch'].includes(row.state)&&row.plan){
      const p=row.plan;
      if(row.state==='ready'&&!row.volume?.confirmed)return {...row,state:'wait',side:'wait',plan:null,reason:'量能未确认，暂停新入场'};
      if(Object.values(row.periods).some(direction=>direction!==p.side))return {...row,state:'wait',side:'wait',plan:null,reason:'三周期尚未全部同向'};
      const entry=positive(p.side==='long'?ticker.lowest_ask:ticker.highest_bid),sign=p.side==='long'?1:-1,risk=sign*(entry-p.stop),reward=sign*(p.tp1-entry),spread=positive(ticker.lowest_ask)-positive(ticker.highest_bid),fee=Math.max(cfg.strategy.assumed_taker_fee_rate,row.taker_fee_rate),cost=2*(fee+cfg.strategy.assumed_slippage_rate)*entry+spread,rr=(reward-cost)/(risk+cost);
      if(Math.min(risk,reward)<=0||!Number.isFinite(rr)||rr<cfg.strategy.min_net_reward_risk)return {...row,state:'wait',side:'wait',plan:null,reason:'新报价下扣除估计成本后空间不足'};
      row.net_rr=rr;row.entry_distance_atr=Math.max(p.entry_low-entry,entry-p.entry_high,0)/p.atr_15m;
    }return row;
  }catch(e){return {...row,state:'error',side:'wait',plan:null,reason:'数据不完整，暂停信号：'+e.message};}
}
export function selectRows(rows,cfg){
  const extra=rows.filter(r=>!cfg.pinned.includes(r.contract)&&['ready','watch'].includes(r.state)&&r.plan)
    .sort((a,b)=>compareOpportunities(a,b)||a.contract.localeCompare(b.contract)).slice(0,cfg.extra_count);
  const selected=new Set([...cfg.pinned,...extra.map(r=>r.contract)]);return rows.filter(r=>selected.has(r.contract));
}
export function displayRow(row,updated,ticker){
  const active=['ready','watch'].includes(row.state)&&row.plan&&row.plan.expires_at>updated,fmt=value=>Number.isFinite(value)?String(value):'—';
  const bid=num(ticker?.highest_bid,0),ask=num(ticker?.lowest_ask,0),bookValid=bid>0&&ask>=bid;
  return {source:'Gate',symbol:row.contract,price:fmt(row.last),bid:bookValid?fmt(bid):'—',ask:bookValid?fmt(ask):'—',periods:['15m','1h','4h'].map(frame=>({long:'↑多',short:'↓空',wait:'盘整'}[row.periods?.[frame]]||'等待')),
    net_rr:active?row.net_rr??null:null,entry_distance_atr:active?row.entry_distance_atr??null:null,
    crosses:row.crosses||{},direction:active?(row.plan.side==='long'?1:-1):0,state:active?row.state:'wait',momentum:row.momentum??null,ratio:row.volume?.latest_ratio??null,
    entry:active?`${fmt(row.plan.entry_low)}~${fmt(row.plan.entry_high)}`:'—',stop:active?fmt(row.plan.stop):'—',take:active?`${fmt(row.plan.tp1)}/${fmt(row.plan.tp2)}`:'—',reason:row.reason,
    updated,valid_until:active?Math.min(updated+150,row.plan.expires_at):updated+150};
}
