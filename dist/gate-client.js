import {FRAMES,num,quality,parseCandles,closedCandles,analyse,selectRows,displayRow} from './gate-engine.js?v=opportunity-quality-1';
const BASES=['https://api.gateio.ws/api/v4','https://fx-api.gateio.ws/api/v4'];
const ALLOWED=new Set(['/spot/time','/futures/usdt/tickers','/futures/usdt/contracts','/futures/usdt/candlesticks']);
const wait=ms=>new Promise(resolve=>setTimeout(resolve,Math.max(0,ms)));
export class GateClient{
  constructor(config,{fetcher=globalThis.fetch,onProgress=()=>{}}={}){
    this.config=config;this.fetcher=fetcher.bind(globalThis);this.onProgress=onProgress;this.cache=new Map();this.contracts=new Map();this.metadataAt=0;this.invalid=new Map();this.nextAt=0;this.serverAt=0;this.clockAt=0;this.base=BASES[0];this.controller=null;
  }
  now(){return this.serverAt+(performance.now()-this.clockAt)/1000;}
  cancel(){this.controller?.abort();this.nextAt=0;}
  async request(path,params={}){
    if(!ALLOWED.has(path))throw Error('拒绝非公开行情接口');
    const signal=this.controller.signal;
    const bases=[this.base,...BASES.filter(b=>b!==this.base)];
    for(const base of bases){
      const slot=Math.max(this.nextAt,performance.now());this.nextAt=slot+260;await wait(slot-performance.now());
      if(signal.aborted)throw new DOMException('Aborted','AbortError');
      const url=new URL(base+path);for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
      const timeout=new AbortController(),timer=setTimeout(()=>timeout.abort(),15000),abort=()=>timeout.abort();signal.addEventListener('abort',abort,{once:true});
      try{
        const response=await this.fetcher(url.href,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',signal:timeout.signal});
        if(!response.ok)throw Error(`Gate HTTP ${response.status}`);
        const data=await response.json();this.base=base;return data;
      }catch(e){
        if(signal.aborted)throw new DOMException('Aborted','AbortError');
        if(base===bases.at(-1))throw e;
      }finally{clearTimeout(timer);signal.removeEventListener('abort',abort);}
    }
    throw Error('Gate 公开行情不可用');
  }
  async syncClock(){
    const started=performance.now(),data=await this.request('/spot/time');
    let stamp=num(data.server_time_ms??data.server_time);if(stamp>1e11)stamp/=1000;
    if(performance.now()-started>10000||Math.abs(stamp-Date.now()/1000)>5)throw Error('手机时间或接口时间异常，请核对自动日期与时间');
    this.serverAt=stamp;this.clockAt=performance.now();return stamp;
  }
  async metadata(now){
    if(this.contracts.size&&now-this.metadataAt<3600)return;
    const collected=new Map();let done=false;
    for(let offset=0;offset<10000;offset+=100){
      const page=await this.request('/futures/usdt/contracts',{limit:100,offset});
      if(!Array.isArray(page)||page.length>100)throw Error('合约列表分页异常');
      for(const c of page){if(!c||typeof c.name!=='string'||!c.name.trim()||collected.has(c.name))throw Error('合约列表包含无效或重复条目');collected.set(c.name,c);}
      if(page.length<100){done=true;break;}
    }
    if(!done||!collected.size)throw Error('合约列表不完整');
    this.contracts=collected;this.metadataAt=now;
  }
  async candles(symbol,frame,now){
    const step=FRAMES[frame],key=symbol+':'+frame,old=this.cache.get(key),s=this.config.strategy;
    if(frame!=='15m'&&old&&Math.floor((old.fetched-s.close_grace_seconds)/step)===Math.floor((now-s.close_grace_seconds)/step)){
      try{return {closed:closedCandles(old.raw,step,now,s.min_candles,s.close_grace_seconds),raw:old.raw};}catch{}
    }
    const incremental=old&&now-old.raw.at(-1).t<2*step;
    const data=await this.request('/futures/usdt/candlesticks',{contract:symbol,interval:frame,limit:incremental?3:s.candle_limit});
    const fresh=parseCandles(data,step,this.now());
    const raw=incremental?[...new Map([...old.raw,...fresh].map(b=>[b.t,b])).values()].sort((a,b)=>a.t-b.t).slice(-s.candle_limit):fresh;
    const closed=closedCandles(raw,step,now,s.min_candles,s.close_grace_seconds);this.cache.set(key,{raw,fetched:Math.min(this.now(),now)});return {closed,raw};
  }
  tickers(raw){
    if(!Array.isArray(raw)||!raw.length)throw Error('Ticker 列表为空或结构异常');
    const map=new Map();for(const r of raw){if(!r||typeof r.contract!=='string'||map.has(r.contract))throw Error('Ticker 条目异常或重复');map.set(r.contract,r);}return map;
  }
  async scan(){
    this.controller=new AbortController();this.nextAt=performance.now();const started=performance.now();
    this.onProgress('校准 Gate 时间');await this.syncClock();const analysisTime=this.now();
    let tickers=this.tickers(await this.request('/futures/usdt/tickers'));this.onProgress('读取合约与历史 K 线');await this.metadata(analysisTime);
    const symbols=[...new Set([...this.config.pinned,...this.config.extra_candidates])],histories=new Map();let index=0,completed=0;
    const worker=async()=>{while(index<symbols.length){
      const symbol=symbols[index++],q=quality(tickers.get(symbol),this.contracts.get(symbol),this.config,analysisTime);
      if(!q.ok&&!this.config.pinned.includes(symbol)){histories.set(symbol,{blocked:q.reason});completed++;continue;}
      try{
        const frames={},raws={};for(const frame of Object.keys(FRAMES)){const data=await this.candles(symbol,frame,analysisTime);frames[frame]=data.closed;raws[frame]=data.raw;}
        histories.set(symbol,{frames,raw15:raws['15m']});
      }catch(e){if(this.controller.signal.aborted)throw e;histories.set(symbol,{error:e.message});}
      completed++;this.onProgress(`历史分析 ${completed}/${symbols.length}`);
    }};
    await Promise.all(Array.from({length:4},worker));
    if(this.controller.signal.aborted)throw new DOMException('Aborted','AbortError');
    // A second quote is required after history loading; never promote using the cold-start quote.
    this.onProgress('核对最新可成交报价');tickers=this.tickers(await this.request('/futures/usdt/tickers'));await this.syncClock();const now=this.now();
    if(performance.now()-started>90000)throw Error('分析耗时过长，等待下一轮新数据');
    this.invalid=new Map([...this.invalid].filter(([,until])=>until>now));
    const analysed=symbols.map(symbol=>{
      const data=histories.get(symbol),ticker=tickers.get(symbol);
      if(data.blocked)return {contract:symbol,last:ticker?num(ticker.last,0):null,state:'blocked',reason:data.blocked,side:'wait',plan:null};
      if(data.error)return {contract:symbol,last:ticker?num(ticker.last,0):null,state:'error',reason:'历史数据不完整：'+data.error,side:'wait',plan:null};
      return analyse(symbol,data.frames,data.raw15,this.contracts.get(symbol),ticker,this.config,analysisTime,now,this.invalid);
    });
    const selected=selectRows(analysed,this.config);
    return {generated_at:now,source:{state:'正常',updated:now,generated_at:now},rows:selected.map(r=>displayRow(r,now,tickers.get(r.contract))),
      screening:{evaluated:symbols.length,ready:analysed.filter(r=>r.state==='ready').length,watch:analysed.filter(r=>r.state==='watch').length,structure:0}};
  }
}
