"""Local display/filter preferences; never reads or changes positions or orders."""
import copy
import json
import math
from pathlib import Path
import re
import os

ROOT = Path(__file__).resolve().parent
SCHEMA = json.loads((ROOT / 'settings-schema.json').read_text())
PATH = ROOT / 'monitor_settings.json'


def get(value, path):
    for key in path.split('.'):
        value = value[key]
    return value


def put(value, path, item):
    keys = path.split('.')
    for key in keys[:-1]:
        value = value[key]
    value[keys[-1]] = item


def validate(value):
    result = copy.deepcopy(SCHEMA['defaults'])
    for key in ('rise', 'fall'):
        color = value['display'][key]
        if not isinstance(color, str) or not re.fullmatch(r'#[0-9a-fA-F]{6}', color):
            raise ValueError('颜色必须为 #RRGGBB')
        result['display'][key] = color
    for field in SCHEMA['fields']:
        _, path, label, low, high, *scale = field
        number = get(value, path)
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or not low <= number * (scale[0] if scale else 1) <= high:
            raise ValueError(label + ' 超出范围')
        put(result, path, number)
    grades, strategy = result['display']['grades'], result['gate']['strategy']
    if any(v != int(v) for v in grades.values()) or not grades['weak'] < grades['medium'] < grades['strong']:
        raise ValueError('分级须为整数且弱 < 中 < 强')
    if strategy['min_atr_15m_pct'] >= strategy['max_atr_15m_pct'] or strategy['min_stop_pct'] >= strategy['max_stop_pct']:
        raise ValueError('最小 ATR / 止损须小于最大值')
    return result


def load():
    return validate(json.loads(PATH.read_text())) if PATH.exists() else copy.deepcopy(SCHEMA['defaults'])


def apply_gate(cfg, preferences):
    result = copy.deepcopy(cfg)
    # With no saved overrides, preserve the project's existing Gate configuration.
    if PATH.exists():
        for _, path, *_ in SCHEMA['fields']:
            if path.startswith('gate.'):
                put(result, path[5:], get(preferences, path))
    return result


def classify(result, display):
    if not result or result.get('state') != 'valid':
        return result
    result = copy.deepcopy(result)
    signed = result['signed_score']
    score, grades = abs(signed), display['grades']
    direction = (1 if signed > 0 else -1) if score >= grades['weak'] else 0
    strength = '强' if score >= grades['strong'] else '中' if score >= grades['medium'] else '弱' if direction else '中性'
    result.update(direction=direction, strength=strength, label=(f"{'多' if direction > 0 else '空'}{score}{strength}" if direction else f'中性{score}'))
    return result


def project(snapshot, preferences):
    snapshot['display'] = preferences['display']
    for row in snapshot['rows']:
        before = row.get('momentum')
        if before:
            after = classify(before, preferences['display'])
            row['momentum'] = after
            if before.get('label'):
                row['reason'] = row['reason'].replace('动能'+before['label']+'/100', '动能'+after['label']+'/100')
    return snapshot


def ansi(color):
    return '38;2;'+';'.join(str(int(color[i:i+2], 16)) for i in (1, 3, 5))


COLORS = [('红色', '#ff6b78'), ('绿色', '#4ed69a'), ('蓝色', '#73aaf0'),
          ('黄色', '#dfb569'), ('橙色', '#ffad66'), ('紫色', '#c69aff'), ('白色', '#f7f7f8')]


def pick_color(label, current):
    print(' / '.join(f'{i} {name}' for i, (name, _) in enumerate(COLORS, 1))+' / 8 自定义色值')
    while True:
        answer = input(label+'（输入编号，回车保留，q 放弃）：').strip().lower()
        if not answer:
            return current
        if answer == 'q':
            return None
        if answer in [str(i) for i in range(1, 8)]:
            return COLORS[int(answer)-1][1]
        if answer == '8':
            custom = input('自定义颜色 #RRGGBB（回车保留，q 放弃）：').strip()
            if not custom:
                return current
            if custom.lower() == 'q':
                return None
            if re.fullmatch(r'#[0-9a-fA-F]{6}', custom):
                return custom
        print('请选择 1–8；只有自定义颜色需要填写色值。')


def edit():
    value = load()
    # Initialize editable filters from the current local config on first use.
    if not PATH.exists():
        cfg = json.loads((ROOT.parent / 'gate' / 'config.json').read_text())
        for _, path, *_ in SCHEMA['fields']:
            if path.startswith('gate.'):
                try:
                    put(value, path, get(cfg, path[5:]))
                except KeyError:
                    pass
    print('本机动态设置：常用颜色直接选编号；保存后显示立即更新，Gate 下轮重算。')
    try:
        while True:
            print('1 红涨绿跌 / 2 绿涨红跌 / 3 分别选颜色 / 4 动能分级 / 5 Gate 筛选 / 0 保存 / q 放弃')
            choice = input('选择编号：').strip().lower()
            if choice == 'q':
                return
            if choice == '0':
                break
            if choice in ('1', '2'):
                rise, fall = (COLORS[0][1], COLORS[1][1]) if choice == '1' else (COLORS[1][1], COLORS[0][1])
                value['display'].update(rise=rise, fall=fall)
                print('已选择'+('红涨绿跌' if choice == '1' else '绿涨红跌')+'；输入 0 保存。')
            elif choice == '3':
                for key, label in [('rise', '上涨/多头颜色'), ('fall', '下跌/空头颜色')]:
                    color = pick_color(label, value['display'][key])
                    if color is None:
                        return
                    value['display'][key] = color
            elif choice in ('4', '5'):
                for field in SCHEMA['fields']:
                    _, path, label, _, _, *scale = field
                    if path.startswith('display.') != (choice == '4'):
                        continue
                    scale = scale[0] if scale else 1
                    answer = input(f'{label} [{get(value,path)*scale:g}]（回车保留，q 放弃）：').strip()
                    if answer.lower() == 'q':
                        return
                    if answer:
                        put(value, path, float(answer)/scale)
            else:
                print('请输入菜单中的编号。')
        value = validate(value)
        temp = PATH.with_suffix('.tmp')
        temp.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n')
        temp.chmod(0o600)
        os.replace(temp, PATH)
        print('已保存。网页与本机设置分别管理。')
    except (ValueError, KeyError, EOFError) as exc:
        print('未保存：'+str(exc))


if __name__ == '__main__':
    edit()
