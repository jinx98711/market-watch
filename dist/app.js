import {view,momentum,filterRows,snapshotURLs} from './model.js';
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let snapshot=null,source='all',dataURL='',loading=false,lastMask='',error='',opened=new Set();
const time=t=>t?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Kuala_Lumpur',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(t*1000)):'—';
const ago=t=>t?`${Math.max(0,Math.floor(Date.now()/1000-t))}秒前`:'无数据';
const stateLabel=r=>!r.live?'过期 / 暂停':({ready:'条件满足 · 请核对',watch:'等待入场确认',structure:'结构候选 · 费用待核实',wait:'等待'}[r.state]||'等待');
function render(){
  const result=view(snapshot),rows=filterRows(result.rows,source,$('search').value,$('ready-only').checked);
  const ready=rows.filter(r=>r.state==='ready').length;
  $('ready-count').textContent=snapshot?ready:'—';
  const g=snapshot?.screening?.Gate?.evaluated||0,i=snapshot?.screening?.IC?.evaluated||0;
  $('overview-reason').textContent=!snapshot?'连接数据源后显示筛选结果。':result.stale?'同步已中断，旧信号已暂停。':result.ready?'先展开查看入场、止损与失效条件。':`Gate 筛选 ${g} 个候选 · IC 筛选 ${i} 个候选，继续等待。`;
  $('row-count').textContent=`显示 ${rows.length} / ${result.rows.length} 行`;
  $('notice').hidden=!error&&!result.stale;
  $('notice').textContent=error||'电脑同步已停止或快照过期；已隐藏旧报价、评分和入场价位。';
  const html=rows.map(r=>{
    const key=r.source+':'+r.symbol,m=momentum(r.momentum),ratio=Number.isFinite(r.ratio)?r.ratio.toFixed(2)+'x':'—';
    const periods=r.periods.map((p,index)=>`<span><span class="frame-label">${['15m','1h','4h'][index]}</span>${esc(p)}</span>`).join(' <span class="desktop-separator"> / </span> ');
    return `<details class="market-row ${r.state} ${r.live?'':'stale'}" data-key="${esc(key)}" ${opened.has(key)?'open':''}>
      <summary class="row-main"><span class="identity"><strong>${esc(r.symbol)}</strong><span>${esc(r.source)} · ${r.source==='IC'?'CFD 报价':'USDT 永续'}</span></span>
      <span class="price">${esc(r.price)}</span><span class="periods">${periods}</span>
      <span class="momentum"><strong>${esc(m.label)}</strong><small>${r.source==='Gate'?'量比':'Tick 比'} ${esc(ratio)}</small></span>
      <span class="opportunity">${esc(stateLabel(r))}<small>展开详情</small></span></summary>
      <div class="row-detail"><p>${esc(r.reason)}</p>${r.live&&r.direction?`<div class="levels"><div><span>入场观察</span><strong>${esc(r.entry)}</strong></div><div><span>止损参考</span><strong>${esc(r.stop)}</strong></div><div><span>止盈参考</span><strong>${esc(r.take)}</strong></div></div>`:''}
      <p>来源更新 ${esc(time(r.updated))} · ${r.live?'有效至 '+esc(time(r.valid_until)):'等待新快照'}</p>
      ${r.source==='IC'?'<p>Bid / Ask 为 IC 独立报价；Tick 比不是交易所成交量。</p>':'<p>成交额量比基于已收盘 15 分钟 K 线，不能单独作为入场依据。</p>'}</div></details>`;
  }).join('');
  $('markets').innerHTML=html||`<p class="empty">${!snapshot?'正在读取监控快照…':$('ready-only').checked?'当前筛选范围没有条件满足的机会。':'没有匹配的品种，请更改搜索或来源。'}</p>`;
  lastMask=result.rows.map(r=>r.live?'1':'0').join('')+result.stale;
  clock();
}
function clock(){
  const result=view(snapshot);
  $('updated').textContent=snapshot?`快照 ${time(snapshot.generated_at)} · ${ago(snapshot.generated_at)}`:'正在读取行情…';
  for(const [name,id] of [['Gate','gate-health'],['IC','ic-health']]){
    const state=result.sources[name];$(id).textContent=`${name} ${state?.live?'正常':'暂停'} · ${ago(state?.updated)}`;$(id).classList.toggle('off',!state?.live);
  }
  const mask=result.rows.map(r=>r.live?'1':'0').join('')+result.stale;
  if(mask!==lastMask)render();
}
async function refresh(){
  if(loading)return;loading=true;$('refresh').disabled=true;$('refresh').textContent='读取中';
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
  try{
    if(!dataURL){const response=await fetch('./config.json',{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();dataURL=(await response.json()).data_base;}
    let data=null;
    for(const url of snapshotURLs(dataURL)){
      const response=await fetch(url,{signal:controller.signal});
      if(response.ok){data=await response.json();break;}
    }
    if(data?.schema!==1||!Array.isArray(data.rows))throw Error();
    snapshot=data;error='';
  }catch{error=snapshot?'行情同步暂时不可用；保留最近快照，过期后自动暂停。':'无法连接行情快照，请稍后刷新。';}
  finally{clearTimeout(timeout);loading=false;$('refresh').disabled=false;$('refresh').textContent='刷新';render();}
}
document.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',()=>{source=button.dataset.source;document.querySelectorAll('[data-source]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();}));
$('refresh').addEventListener('click',refresh);$('search').addEventListener('input',render);$('ready-only').addEventListener('change',render);
$('markets').addEventListener('toggle',event=>{const key=event.target.dataset.key;if(key){if(event.target.open)opened.add(key);else opened.delete(key);}},true);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setInterval(()=>{if(!document.hidden)refresh();},5000);setInterval(clock,1000);refresh();
