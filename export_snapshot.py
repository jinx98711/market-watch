"""Export only public market observations; account and position data are never copied."""
import math
import re


def number(value, default=0):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) else default


def reason(text):
    # Do not forward arbitrary exception strings, paths, server IDs, or account notes.
    choices = [
        ('成交额不足', '24 小时成交额低于筛选门槛'),
        ('支撑或阻力', '附近支撑或阻力压缩目标空间'),
        ('成本', '扣除估计成本后空间不足'),
        ('方向不一致', '三周期方向不一致或盘整'),
        ('盘整', '三周期方向不一致或盘整'),
        ('放量逆向', '出现放量逆向，暂停计划'),
        ('滞涨', '出现放量滞涨或滞跌，暂停计划'),
        ('未缩量', '回踩或反弹尚未缩量'),
        ('未放量', '确认 K 线尚未放量'),
        ('报价停止', '报价停止更新，可能休市'),
        ('不完整', '行情或历史数据不完整'),
        ('过期', '行情或观察计划已过期'),
        ('费用待核实', '账户费用未核实，仅作结构观察'),
        ('未纳入', '仅显示行情与趋势，未纳入机会筛选'),
        ('已确认', '收盘条件已确认，仍需人工核对'),
        ('等待', '等待新的收盘确认'),
    ]
    return next((public for key, public in choices if key in str(text)), '等待完整行情与收盘确认')


def export(snapshot):
    sources = {}
    for name, key in [('Gate', 'gate'), ('IC', 'mt5')]:
        state = snapshot.get(key, {})
        sources[name] = dict(state='正常' if state.get('state') == '正常' else '暂停',
                             updated=number(state.get('updated')))
    rows = []
    for item in snapshot.get('rows', []):
        source, symbol = item.get('source'), item.get('symbol', '')
        if source not in sources or not re.fullmatch(r'[A-Z][A-Z0-9_.+-]{0,29}', symbol):
            continue
        periods = item.get('periods', [])
        if len(periods) != 3:
            periods = ['等待']*3
        periods = [p if p in ('↑多', '↓空', '盘整', '等待') else '等待' for p in periods]
        raw_crosses = item.get('crosses')
        crosses = {}
        if isinstance(raw_crosses, dict):
            crosses = {frame: raw_crosses[frame] for frame in ('15m', '1h', '4h')
                       if type(raw_crosses.get(frame)) is int and raw_crosses[frame] in (-1, 1)}
        raw_momentum = item.get('momentum') or {}
        signed = number(raw_momentum.get('signed_score'), None)
        momentum = int(signed) if raw_momentum.get('state') == 'valid' and signed is not None and -100 <= signed <= 100 else None
        raw_volume = item.get('volume' if source == 'Gate' else 'activity') or {}
        ratio = number(raw_volume.get('latest_ratio'), None)
        direction = item.get('direction') if type(item.get('direction')) is int and item['direction'] in (-1, 0, 1) else 0
        opportunity = item.get('opportunity', '')
        state = 'ready' if source == 'Gate' and opportunity.startswith('条件满足') else (
            'structure' if source == 'IC' and item.get('opportunity_state') == 'structure' else
            'watch' if opportunity.startswith('等待入场确认') else 'wait')
        if not direction:
            state = 'wait'
        distance = number(item.get('entry_distance_atr'), None)
        net_rr = number(item.get('net_rr'), None)
        reference_rr = number(item.get('reference_rr'), None)
        def price(key):
            value = str(item.get(key, '—'))
            return value if re.fullmatch(r'[0-9.,/~— -]{1,60}', value) else '—'
        explanation = '已通过当前脚本筛选；请人工核对实时报价与风险' if state == 'ready' else reason(item.get('reason'))
        rows.append(dict(source=source, symbol=symbol, price=price('price'), periods=periods, crosses=crosses,
                         direction=direction, state=state, momentum=momentum,
                         entry_distance_atr=distance if state != 'wait' and distance is not None and distance >= 0 else None,
                         net_rr=net_rr if source == 'Gate' and state in ('ready', 'watch') and net_rr is not None and net_rr > 0 else None,
                         reference_rr=reference_rr if source == 'IC' and state == 'structure' and reference_rr is not None and reference_rr > 0 else None,
                         structure_confirmed=state == 'structure' and item.get('structure_confirmed') is True,
                         ratio=round(ratio, 3) if ratio is not None and ratio >= 0 else None,
                         entry=price('entry'), stop=price('stop'), take=price('take'), reason=explanation,
                         updated=number(item.get('updated')), valid_until=number(item.get('valid_until'))))
    screening = {}
    for name, key in [('Gate', 'gate'), ('IC', 'ic')]:
        original = snapshot.get('screening', {}).get(key, {})
        screening[name] = {k: max(0, int(number(original.get(k)))) for k in ('evaluated', 'ready', 'watch', 'structure')}
    return dict(schema=1, generated_at=number(snapshot.get('generated_at')), sources=sources,
                screening=screening, rows=rows)

