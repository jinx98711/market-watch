export const DEFAULT_DISPLAY={rise:'#ff6b78',fall:'#4ed69a',grades:{weak:20,medium:40,strong:70}};
export const FIELDS=[
  ['动能分级','display.grades.weak','弱势起点',1,98],['动能分级','display.grades.medium','中等起点',2,99],['动能分级','display.grades.strong','强势起点',3,100],
  ['流动性与风险','gate.filters.min_quote_volume_24h','24h 最小成交额（USDT）',1,1e12],
  ['流动性与风险','gate.filters.max_spread_pct','最大买卖价差（%）',.00001,10],
  ['流动性与风险','gate.filters.max_abs_change_24h_pct','24h 最大涨跌幅绝对值（%）',.01,1000],
  ['流动性与风险','gate.filters.max_range_24h_pct','24h 最大高低振幅（%）',.01,2000],
  ['流动性与风险','gate.filters.max_abs_funding_8h_pct','最大 8h 资金费率绝对值（%）',.000001,10],
  ['流动性与风险','gate.filters.min_listing_days','最小上市天数',1,3650],
  ['量能确认','gate.strategy.pullback_volume_ratio','回踩最大量比',.01,1],
  ['量能确认','gate.strategy.confirmation_volume_ratio','确认最小量比',1.01,20],
  ['量能确认','gate.strategy.adverse_volume_ratio','逆向放量暂停倍数',1.01,20],
  ['量能确认','gate.strategy.exhaustion_volume_ratio','滞涨或滞跌暂停倍数',1.01,30],
  ['波动与止损','gate.strategy.min_atr_15m_pct','15m 最小 ATR（%）',.00001,10],
  ['波动与止损','gate.strategy.max_atr_15m_pct','15m 最大 ATR（%）',.00002,100],
  ['波动与止损','gate.strategy.min_stop_pct','最小止损距离（%）',.00001,20],
  ['波动与止损','gate.strategy.max_stop_pct','最大止损距离（%）',.00002,50],
  ['成本与盈亏比','gate.strategy.min_net_reward_risk','最小扣费后盈亏比',1,20],
  ['成本与盈亏比','gate.strategy.assumed_taker_fee_rate','估计单边手续费（%）',.000001,5,100],
  ['成本与盈亏比','gate.strategy.assumed_slippage_rate','估计单边滑点（%）',.000001,5,100],
];
export const get=(object,path)=>path.split('.').reduce((value,key)=>value?.[key],object);
export function set(object,path,value){const keys=path.split('.'),last=keys.pop();let parent=object;for(const key of keys)parent=parent[key];parent[last]=value;}
export function defaults(config){
  const gate=JSON.parse(JSON.stringify(config));
  gate.strategy={pullback_volume_ratio:.8,confirmation_volume_ratio:1.5,adverse_volume_ratio:1.5,exhaustion_volume_ratio:2,...gate.strategy};
  return {version:1,display:JSON.parse(JSON.stringify(DEFAULT_DISPLAY)),gate};
}
export function validateSettings(candidate,base){
  const result=JSON.parse(JSON.stringify(base));
  for(const key of ['rise','fall']){
    const color=candidate?.display?.[key];if(typeof color!=='string'||!/^#[a-f0-9]{6}$/i.test(color))throw Error('颜色必须是有效的六位色值');result.display[key]=color;
  }
  for(const [,path,label,min,max,scale=1] of FIELDS){
    const value=get(candidate,path);if(typeof value!=='number'||!Number.isFinite(value)||value*scale<min||value*scale>max)throw Error(`${label}须在 ${min}–${max} 之间`);set(result,path,value);
  }
  const g=result.display.grades,s=result.gate.strategy;
  if(!Number.isInteger(g.weak)||!Number.isInteger(g.medium)||!Number.isInteger(g.strong)||!(g.weak<g.medium&&g.medium<g.strong))throw Error('动能起点须为整数，且弱势 < 中等 < 强势');
  if(s.min_atr_15m_pct>=s.max_atr_15m_pct)throw Error('最小 ATR 必须小于最大 ATR');
  if(s.min_stop_pct>=s.max_stop_pct)throw Error('最小止损距离必须小于最大止损距离');
  return result;
}
export function loadSettings(config,storage=globalThis.localStorage){
  const base=defaults(config);
  try{const saved=storage?.getItem('market-watch-settings-v1');return saved?validateSettings(JSON.parse(saved),base):base;}catch{return base;}
}
export function applyColors(display,root=document.documentElement){
  for(const key of ['rise','fall']){root.style.setProperty('--'+key,display[key]);root.style.setProperty('--'+key+'-soft',display[key]+'22');}
}
