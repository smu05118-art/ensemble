#!/usr/bin/env python3
"""grid-composite 계약 검사기 — 실적(actuals)·프록시(proxies) 파일이 CONTRACT.md 를 지키는지 본다.

사용: python3 validate_contract.py [파일 ...]   (인자가 없으면 data/ 전체)
오류가 하나라도 있으면 종료코드 1. 경고는 종료코드에 영향 없음.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FQ = re.compile(r'^FY\d{4}(Q[1-4]|H[12])$')
YM = re.compile(r'^\d{4}-(0[1-9]|1[0-2])$')
DATE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
METHODS = {'direct_reported_quarter', 'ytd_difference', 'annual_minus_9m', 'sum_of_monthly',
           'reported', 'direct_reported_month', 'direct_reported_half', 'annual_minus_h1'}
AGG = {'sum', 'mean', 'last'}


def check_actuals(path, doc, errs, warns):
    p = path.name
    for key in ('schema', 'id', 'name', 'listed', 'targets', 'profile'):
        if key not in doc:
            errs.append(f'{p}: 필수 키 누락 {key}')
    if doc.get('schema') != 'grid-composite-actuals/1':
        errs.append(f'{p}: schema 가 grid-composite-actuals/1 이 아님')
    if doc.get('id') and path.stem != doc['id']:
        errs.append(f'{p}: 파일명과 id 불일치 ({doc.get("id")})')
    targets = doc.get('targets') or {}
    if doc.get('listed') and not targets:
        warns.append(f'{p}: 상장사인데 targets 비어 있음')
    if targets:
        if doc.get('primary_target') not in targets:
            errs.append(f'{p}: primary_target 이 targets 에 없음')
        for key in ('currency', 'unit'):
            if not doc.get(key):
                errs.append(f'{p}: {key} 누락')
    for tname, t in targets.items():
        freq = t.get('freq')
        if freq not in ('Q', 'M', 'H'):
            errs.append(f'{p}:{tname}: freq 는 Q/M/H')
            continue
        if not t.get('scope'):
            errs.append(f'{p}:{tname}: scope 누락')
        if t.get('scope') == 'segment' and not t.get('segment_name'):
            warns.append(f'{p}:{tname}: segment_name 권장')
        pts = t.get('points') or []
        if not pts:
            warns.append(f'{p}:{tname}: points 비어 있음')
        seen = set()
        last_key = None
        for i, pt in enumerate(pts):
            tag = f'{p}:{tname}[{i}]'
            key = pt.get('month') if freq == 'M' else pt.get('fiscal_key')
            if freq == 'M':
                if not key or not YM.match(key):
                    errs.append(f'{tag}: month 형식 YYYY-MM')
            else:
                if not key or not FQ.match(key):
                    errs.append(f'{tag}: fiscal_key 형식 FYyyyyQn/Hn ({key})')
                for dk in ('period_start', 'period_end'):
                    v = pt.get(dk)
                    if v is not None and not DATE.match(str(v)):
                        errs.append(f'{tag}: {dk} 형식 YYYY-MM-DD')
                if not pt.get('period_end') and not pt.get('period_end_note'):
                    errs.append(f'{tag}: period_end 또는 period_end_note 필요')
            if key in seen:
                errs.append(f'{tag}: 중복 키 {key}')
            seen.add(key)
            if last_key and key and key < last_key and freq == 'M':
                errs.append(f'{tag}: 월 오름차순 아님')
            last_key = key
            v = pt.get('value')
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                errs.append(f'{tag}: value 숫자 아님')
            elif v < 0:
                warns.append(f'{tag}: 음수 매출 {v}')
            c = pt.get('prior_year_comparative')
            if c is not None and (not isinstance(c, (int, float)) or c <= 0):
                errs.append(f'{tag}: prior_year_comparative 는 양수')
            if not pt.get('source_url'):
                errs.append(f'{tag}: source_url 누락')
            if not pt.get('locator'):
                warns.append(f'{tag}: locator 누락')
            m = pt.get('method')
            if m not in METHODS:
                errs.append(f'{tag}: method 허용값 아님 ({m})')
        if freq == 'Q':
            ends = [pt.get('period_end') for pt in pts if pt.get('period_end')]
            if ends != sorted(ends):
                errs.append(f'{p}:{tname}: period_end 오름차순 아님')
            vals = [pt['value'] for pt in pts if isinstance(pt.get('value'), (int, float))]
            for a, b, pt in zip(vals, vals[1:], pts[1:]):
                if a > 0 and b > 0 and (b / a > 3 or a / b > 3):
                    warns.append(f'{p}:{tname}: {pt.get("fiscal_key")} 직전 대비 3배 이상 변화 — 단위·범위 확인')


def check_proxy(path, doc, errs, warns):
    p = path.name
    if doc.get('schema') != 'grid-composite-proxy/1':
        errs.append(f'{p}: schema 가 grid-composite-proxy/1 이 아님')
    for key in ('family', 'fetched_at', 'source', 'series'):
        if key not in doc:
            errs.append(f'{p}: 필수 키 누락 {key}')
    for sid, s in (doc.get('series') or {}).items():
        tag = f'{p}:{sid}'
        if not re.match(r'^[a-z0-9_\-A-Z\.]+$', sid):
            errs.append(f'{tag}: series id 문자 제한')
        for key in ('label', 'unit', 'freq', 'agg', 'kind', 'obs'):
            if key not in s:
                errs.append(f'{tag}: {key} 누락')
        if s.get('agg') not in AGG:
            errs.append(f'{tag}: agg 허용값 아님')
        if s.get('freq') not in ('M', 'Q'):
            errs.append(f'{tag}: freq 는 M/Q')
        obs = s.get('obs') or {}
        if not obs:
            warns.append(f'{tag}: obs 비어 있음')
        for k, v in obs.items():
            okkey = YM.match(k) if s.get('freq') == 'M' else re.match(r'^\d{4}Q[1-4]$', k)
            if not okkey:
                errs.append(f'{tag}: 관측 키 형식 오류 {k}')
                break
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                errs.append(f'{tag}: {k} 값 숫자 아님')
                break


def main(argv):
    files = [Path(a) for a in argv] if argv else sorted((ROOT / 'data' / 'actuals').glob('*.json')) + sorted((ROOT / 'data' / 'proxies').glob('*.json'))
    errs, warns = [], []
    for f in files:
        try:
            doc = json.loads(Path(f).read_text(encoding='utf-8'))
        except Exception as e:  # noqa: BLE001 — 파싱 실패는 곧 계약 위반
            errs.append(f'{f}: JSON 파싱 실패 {e}')
            continue
        if 'actuals' in Path(f).parent.name or str(doc.get('schema', '')).startswith('grid-composite-actuals'):
            check_actuals(Path(f), doc, errs, warns)
        else:
            check_proxy(Path(f), doc, errs, warns)
    for w in warns:
        print('WARN', w)
    for e in errs:
        print('ERROR', e)
    print(f'checked {len(files)} files: {len(errs)} errors, {len(warns)} warnings')
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
