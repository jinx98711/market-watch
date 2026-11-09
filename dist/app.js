import {view,momentum,recommendation,filterRows,snapshotURLs,combineDirect} from './model.js?v=ic-reference-rr-1';
import {GateClient} from './gate-client.js?v=opportunity-quality-1';
import {FIELDS,defaults,loadSettings,validateSettings,applyColors,get,set} from './settings.js?v=risk-levels-3';
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let gate=null,ic=null,snapshot=null,source='all',dataURL='',loadingIC=false,lastMask='',error='',progress='',opened=new Set(),settings=null,base=null,client=null,generation=0,loadingGate=false;
const time=t=>t?new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Kuala_Lumpur',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(t*1000)):'—';
const ago=t=>t?`${Math.max(0,Math.floor(Date.now()/1000-t))}秒前`:'无数据';
const stateLabel=r=>!r.live?'过期 / 暂停':({ready:'条件满足 · 请核对',watch:'等待入场确认',structure:'结构候选 · 费用待核实',wait:'等待'}[r.state]||'等待');
const tone=text=>/[↑多]/.test(text)?'rise':/[↓空]/.test(text)?'fall':'neutral';
function render(){
  snapshot=combineDirect(gate,ic);
  const result=view(snapshot),rows=filterRows(result.rows,source,$('search').value,$('ready-only').checked),ready=rows.filter(r=>r.state==='ready').length;
  $('ready-count').textContent=gate?ready:'—';
  const g=snapshot.screening.Gate.evaluated||0,i=snapshot.screening.IC.evaluated||0;
  $('overview-reason').textContent=progress||(!gate?'正在连接 Gate 公开行情。':result.stale?'行情已过期，旧信号已暂停。':result.ready?'先展开查看入场、止损与失效条件。':`Gate 筛选 ${g} 个候选 · IC 筛选 ${i} 个候选，继续等待。`);
  $('row-count').textContent=`显示 ${rows.length} / ${result.rows.length} 行`;
  $('notice').hidden=!error;
  $('notice').textContent=error;
  $('markets').innerHTML=rows.map(r=>{
    const key=r.source+':'+r.symbol,m=momentum(r.momentum,settings?.display.grades),risk=recommendation(r),ratio=Number.isFinite(r.ratio)?r.ratio.toFixed(2)+'x':'—';
    const crosses = ['15m', '1h', '4h'].map(frame => {
      const side = r.crosses[frame];
      if (side === 1) return `<span class="rise">${frame} 金叉</span>`;
      if (side === -1) return `<span class="fall">${frame} 死叉</span>`;
      return '';
    }).filter(Boolean).join('');
    const distance = r.direction && Number.isFinite(r.entry_distance_atr)
      ? (r.entry_distance_atr === 0 ? '在观察区间' : '距区间 ' + r.entry_distance_atr.toFixed(2) + ' ATR') : '';
    const netRR = r.direction && Number.isFinite(r.net_rr) ? '估算净盈亏比 ' + r.net_rr.toFixed(2) + ':1' : '';
    const referenceRR = Number.isFinite(r.reference_rr) ? '参考盈亏比 ' + r.reference_rr.toFixed(2) + ':1（费用待核实）' : '';
    const quality = [distance, netRR, referenceRR].filter(Boolean).join(' · ');
    const periods=r.periods.map((p,index)=>`<span class="${tone(p)}"><span class="frame-label">${['15m','1h','4h'][index]}</span>${esc(p)}</span>`).join(' <span class="desktop-separator"> / </span> ');
    return `<details class="market-row ${r.state} ${r.live?'':'stale'}" data-key="${esc(key)}" ${opened.has(key)?'open':''}>
      <summary class="row-main"><span class="identity"><strong>${esc(r.symbol)}</strong><span>${esc(r.source)} · ${r.source==='IC'?'CFD 报价':'USDT 永续'}</span></span>
      <span class="price">${r.source==='Gate'?`<span class="last-price"><span class="quote-label">Last</span>${esc(r.price)}</span><span class="book-price"><span class="quote-label">Bid</span>${esc(r.bid)}</span><span class="book-price"><span class="quote-label">Ask</span>${esc(r.ask)}</span>`:esc(r.price)}</span><span class="periods">${periods}</span>
      <span class="momentum ${m.tone||'neutral'}"><span class="momentum-heading"><strong>${esc(m.directionText||'等待')}</strong><b>${esc(m.score??'—')}<small>/100</small></b></span><span class="strength">${esc(m.levelLabel||'无评分')}</span><small>${r.source==='Gate'?'量比':'Tick 比'} ${esc(ratio)}</small></span>
      <span class="opportunity ${r.direction>0?'rise':r.direction<0?'fall':''}">${r.direction?`<b>${r.direction>0?'↑ 做多':'↓ 做空'}</b>`:''}${esc(stateLabel(r))}<small>展开详情</small></span>
      ${quality ? `<span class="plan-quality">${esc(quality)}</span>` : ''}
      ${crosses ? `<span class="crosses"><span>均线交叉</span>${crosses}</span>` : ''}
      <span class="recommendations"><span><small>推荐止损</small><strong>${esc(risk.stop)}</strong></span><span><small>推荐止盈 · TP1 / TP2</small><strong>${esc(risk.take)}</strong></span><small class="recommendation-note">${esc(risk.note)}</small></span></summary>
      <div class="row-detail"><p>${esc(r.reason)}</p>${r.live&&r.direction?`<div class="levels"><div><span>入场观察</span><strong>${esc(r.entry)}</strong></div><div><span>推荐止损</span><strong>${esc(risk.stop)}</strong></div><div><span>推荐止盈 · TP1 / TP2</span><strong>${esc(risk.take)}</strong></div></div>`:''}
      <p>来源更新 ${esc(time(r.updated))} · ${r.live?'有效至 '+esc(time(r.valid_until)):'等待新行情'}</p>
      ${r.source==='IC'?'<p>Bid / Ask 为 IC 独立报价；Tick 比不是交易所成交量。</p>':'<p>成交额量比基于已收盘 15 分钟 K 线，不能单独作为入场依据。</p>'}</div></details>`;
  }).join('')||`<p class="empty">${!gate?'正在连接 Gate…':$('ready-only').checked?'当前筛选范围没有条件满足的机会。':'没有匹配的品种，请更改搜索或来源。'}</p>`;
  lastMask=result.rows.map(r=>r.live?'1':'0').join('')+result.stale;clock();
}
function clock(){
  const result=view(snapshot);
  $('updated').textContent=gate?`Gate ${time(gate.generated_at)} · ${ago(gate.generated_at)}`:'正在读取 Gate 行情…';
  for(const [name,id] of [['Gate','gate-health'],['IC','ic-health']]){
    const state=result.sources[name];$(id).textContent=`${name} ${name==='Gate'?'直连':'电脑'} · ${state?.live?'正常':'暂停'}`;$(id).title=ago(state?.updated);$(id).classList.toggle('off',!state?.live);
  }
  const mask=result.rows.map(r=>r.live?'1':'0').join('')+result.stale;if(mask!==lastMask)render();
}
async function refreshGate(){
  if(!client||loadingGate||document.hidden)return;
  const current=client,token=generation;loadingGate=true;$('refresh').disabled=true;$('refresh').textContent='分析中';
  try{const result=await current.scan();if(token!==generation||document.hidden)return;gate=result;error='';}
  catch(e){if(token!==generation)return;if(e.name!=='AbortError'){error=`Gate 直连暂停：${e.message}。请稍后刷新。`;if(gate)gate={...gate,source:{...gate.source,state:'暂停'}};}}
  finally{if(token===generation){loadingGate=false;progress='';$('refresh').disabled=false;$('refresh').textContent='刷新';render();}}
}
async function refreshIC(){
  if(loadingIC||document.hidden)return;loadingIC=true;
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  try{
    if(!dataURL){const r=await fetch('./config.json',{cache:'no-store',signal:controller.signal});if(!r.ok)throw Error();dataURL=(await r.json()).data_base;}
    for(const url of snapshotURLs(dataURL)){
      const response=await fetch(url,{signal:controller.signal});if(!response.ok)continue;
      const data=await response.json();if(data?.schema!==1||!Array.isArray(data.rows))throw Error();ic=data;break;
    }
  }catch{/* IC relay is optional and cannot pause Gate. Its original timestamps expire normally. */}
  finally{clearTimeout(timeout);loadingIC=false;render();}
}
function configureGate(){
  client?.cancel();generation++;loadingGate=false;progress='正在按当前设置重新分析';
  if(!gate)gate={generated_at:0,source:{state:'暂停',updated:0},rows:settings.gate.pinned.map(symbol=>({source:'Gate',symbol,price:'—',periods:['等待','等待','等待'],state:'wait',direction:0,entry:'—',stop:'—',take:'—',updated:0,valid_until:0,reason:'等待 Gate 直连分析'}))};
  if(gate)gate={...gate,source:{...gate.source,state:'暂停'},rows:gate.rows.map(row=>({...row,state:'wait',direction:0,entry:'—',stop:'—',take:'—',valid_until:0}))};
  const token=generation;
  client=new GateClient(settings.gate,{onProgress:value=>{if(token===generation){progress=value;render();}}});
  render();refreshGate();
}
function fillSettings(value){
  $('settings-form').elements.rise.value=value.display.rise;$('settings-form').elements.fall.value=value.display.fall;
  let group='';$('settings-fields').innerHTML=FIELDS.map(([title,path,label,min,max,scale=1])=>{
    const heading=title!==group?(group?'</div></fieldset>':'')+`<fieldset><legend>${title}</legend><div class="setting-grid">`:'';group=title;
    return heading+`<label>${esc(label)}<input type="number" name="${path}" min="${min}" max="${max}" step="${path.includes('grades')||path.endsWith('min_listing_days')?'1':'any'}" required value="${get(value,path)*scale}"></label>`;
  }).join('')+'</div></fieldset>';$('settings-error').textContent='';
}
$('settings-open').addEventListener('click',()=>{if(!settings)return;fillSettings(settings);$('settings-dialog').showModal();});
$('settings-close').addEventListener('click',()=>$('settings-dialog').close());
$('settings-reset').addEventListener('click',()=>fillSettings(base));
$('swap-colors').addEventListener('click',()=>{const f=$('settings-form').elements;[f.rise.value,f.fall.value]=[f.fall.value,f.rise.value];});
$('settings-form').addEventListener('submit',event=>{
  event.preventDefault();const next=structuredClone(settings),f=event.target.elements;
  next.display.rise=f.rise.value;next.display.fall=f.fall.value;for(const [,path,,, ,scale=1] of FIELDS)set(next,path,Number(f.namedItem(path).value)/scale);
  try{
    const valid=validateSettings(next,base),rulesChanged=JSON.stringify(valid.gate)!==JSON.stringify(settings.gate);
    localStorage.setItem('market-watch-settings-v1',JSON.stringify(valid));settings=valid;applyColors(settings.display);$('settings-dialog').close();
    if(rulesChanged)configureGate();else render();
  }catch(e){$('settings-error').textContent=e.message;}
});
document.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',()=>{source=button.dataset.source;document.querySelectorAll('[data-source]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));render();}));
$('refresh').addEventListener('click',()=>{refreshGate();refreshIC();});$('search').addEventListener('input',render);$('ready-only').addEventListener('change',render);
$('markets').addEventListener('toggle',event=>{const key=event.target.dataset.key;if(key){if(event.target.open)opened.add(key);else opened.delete(key);}},true);
document.addEventListener('visibilitychange',()=>{if(document.hidden){client?.cancel();generation++;loadingGate=false;progress='';$('refresh').disabled=false;$('refresh').textContent='刷新';}else{configureGate();refreshIC();}});
setInterval(refreshGate,60000);setInterval(refreshIC,10000);setInterval(clock,1000);
async function start(){
  render();refreshIC();
  try{const r=await fetch('./gate-config.json?v=risk-levels-3');if(!r.ok)throw Error('规则文件不可用');const config=await r.json();base=defaults(config);settings=loadSettings(config);applyColors(settings.display);configureGate();}
  catch(e){error=`无法加载 Gate 筛选规则：${e.message}`;render();}
}
start();
