(() => {
  'use strict';
  const root = document.getElementById('leadtime-trends-root');
  if (!root) return;
  const base = document.currentScript?.src || document.baseURI;
  const url = new URL('trends.json', base), projectionURL = new URL('projections.json', base);
  const token = {}; root.__leadtimeTrends = token;
  const active = () => root.__leadtimeTrends === token;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; };
  const add = (n, ...children) => { n.append(...children); return n; };
  const svg = (tag, attrs, text) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs).forEach(([k,v]) => n.setAttribute(k,v)); if (text != null) n.textContent = text; return n; };
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const ordinal = q => { const m = /^(\d{4})-Q([1-4])$/.exec(q); return m ? Number(m[1])*4 + Number(m[2])-1 : NaN; };
  const quarterOf = n => `${Math.floor(n/4)}-Q${n%4+1}`;
  const button = (label, fn) => { const b = el('button', label); b.type = 'button'; b.onclick = fn; return b; };
  const num = n => n.toLocaleString('ko-KR', {maximumFractionDigits:1});
  const signed = n => `${n > 0 ? '+' : ''}${num(n)}%`;
  const flags = p => [p.source_change && '출처 변경', p.scope_break && '제품 범위 변경', p.evidence_tier === 'secondary' && '재인용'].filter(Boolean).join(' · ');
  const STATUSES = ['observed','historical_estimate','nowcast','forecast','unavailable'];
  const STATUS_KO = {observed:'실측', historical_estimate:'과거 추정 (모델)', nowcast:'현재 분기 추정 (모델)', forecast:'전망 (모델)', unavailable:'추정 산출 불가'};
  const cell = v => { let s = v == null ? '' : Array.isArray(v) || (typeof v === 'object') ? JSON.stringify(v) : String(v); if (typeof v !== 'number' && /^[\s﻿]*[=+@\-\t\r]/.test(s)) s = "'"+s; return '"'+s.replace(/"/g,'""')+'"'; };
  const safeHref = u => { try { const x = new URL(u); if (/^https?:$/.test(x.protocol)) return x.href; } catch {} return null; };
  function source(p) {
    const href = safeHref(p.source_url);
    const a = el(href ? 'a' : 'span', href ? p.source_title || '원문 출처' : '출처 없음');
    if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  }
  // Actual-data validation: identical to the previous release. Estimates never pass through here.
  function validate(d) {
    const check = b => { if (!b) throw Error('schema'); };
    const unique = a => new Set(a.map(x => x.id)).size === a.length;
    check(d?.schema_version === 1 && Array.isArray(d.groups) && unique(d.groups));
    for (const g of d.groups) {
      check(typeof g.id === 'string' && typeof g.label === 'string' && Array.isArray(g.tracks) && unique(g.tracks));
      for (const t of g.tracks) {
        check(typeof t.id === 'string' && typeof t.label === 'string' && ['weeks','months','days'].includes(t.unit) && Array.isArray(t.points) && unique(t.points));
        if (!Array.isArray(t.quarterly_points)) throw Error('refresh');
        check(t.quarterly_stats && typeof t.quarterly_methodology_ko === 'string' && unique(t.quarterly_points));
        const rawIDs = new Set(t.points.map(p => p.id));
        t.points.forEach(p => check(typeof p.id === 'string' && typeof p.date === 'string' && typeof p.level?.label === 'string'));
        let previous;
        for (const p of t.quarterly_points) {
          const q = ordinal(p.quarter);
          check(finite(q) && (previous === undefined || q === previous+1) && p.date === p.quarter);
          previous = q;
          check(typeof p.id === 'string' && typeof p.has_observation === 'boolean' && ['latest','missing','ambiguous'].includes(p.selection_status));
          check(typeof p.connect_previous === 'boolean' && typeof p.source_change === 'boolean' && typeof p.scope_break === 'boolean');
          check(typeof p.selection_note === 'string' && Number.isInteger(p.observation_count) && p.observation_count >= 0 && Array.isArray(p.observation_ids));
          check(p.observation_count === p.observation_ids.length && new Set(p.observation_ids).size === p.observation_ids.length && p.observation_ids.every(id => rawIDs.has(id)));
          check(p.level && typeof p.level.label === 'string' && [p.level.lower,p.level.upper].every(v => v === null || finite(v)));
          for (const key of ['change','index','yoy']) {
            const m = p[key], fields = key === 'index' ? ['exact','lower','upper'] : ['exact_pct','lower_pct','upper_pct'];
            check(m && typeof m.available === 'boolean' && ['exact','endpoints','lower_only','unavailable'].includes(m.kind) && typeof m.label === 'string');
            check(fields.every(k => m[k] === null || finite(m[k])));
            if (m.available) { check(m.kind !== 'unavailable'); check(m.kind === 'exact' ? finite(m[fields[0]]) : finite(m[fields[1]])); if (m.kind === 'endpoints') check(finite(m[fields[2]])); }
          }
          if (p.selection_status !== 'latest') {
            check(p.level.lower === null && p.level.upper === null && p.level.qualifier === 'missing' && p.original_date === null && p.source_url === null && !p.connect_previous);
            check(['change','index','yoy'].every(k => !p[k].available && typeof p[k].reason === 'string' && (k === 'index' ? ['exact','lower','upper'] : ['exact_pct','lower_pct','upper_pct']).every(f => p[k][f] === null)));
            check(p.id === 'quarter:'+p.quarter);
          } else check(p.has_observation && rawIDs.has(p.id) && p.observation_ids.includes(p.id) && typeof p.original_date === 'string');
          if (p.scope_break) check(!p.change.available && !p.index.available);
        }
        for (const k of ['observed_quarters','total_quarters','missing_quarters','ambiguous_quarters','raw_observations']) check(Number.isInteger(t.quarterly_stats[k]) && t.quarterly_stats[k] >= 0);
        check(t.quarterly_stats.total_quarters === t.quarterly_points.length);
      }
    }
    return d;
  }
  // Model-layer validation (projections.json). Top-level failure => whole layer unavailable; per-track failure => that track actual-only.
  function validateProjections(d, data) {
    const check = (b, why) => { if (!b) throw Error(why); };
    check(d && typeof d === 'object' && !Array.isArray(d) && d.schema_version === 1, 'schema_version');
    check(typeof d.model_version === 'string' && d.model_version.length > 0, 'model_version');
    check(typeof d.as_of === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.as_of), 'as_of');
    check(finite(ordinal(d.current_quarter)), 'current_quarter');
    check(Number.isInteger(d.horizon_quarters) && d.horizon_quarters >= 0 && d.horizon_quarters <= 12, 'horizon_quarters');
    check(typeof d.methodology_ko === 'string', 'methodology_ko');
    check(d.config && typeof d.config === 'object' && d.stats && typeof d.stats === 'object', 'config/stats');
    check(d.leadtime && typeof d.leadtime === 'object' && !Array.isArray(d.leadtime), 'leadtime');
    check(d.unsupported === undefined || Array.isArray(d.unsupported), 'unsupported');
    const tracks = new Map(), rejected = new Map();
    for (const g of data.groups) for (const t of g.tracks) {
      if (!Object.prototype.hasOwnProperty.call(d.leadtime, t.id)) continue;
      try { tracks.set(t.id, validateTrack(d.leadtime[t.id], t, d)); } catch (e) { rejected.set(t.id, e.message || 'schema'); }
    }
    const unsupported = new Map();
    for (const u of d.unsupported || []) if (u && typeof u === 'object' && typeof u.id === 'string') unsupported.set(u.id, typeof u.reason_ko === 'string' ? u.reason_ko : typeof u.reason === 'string' ? u.reason : '사유 미제공');
    return {data: d, tracks, rejected, unsupported};
  }
  function validateModel(m, check) {
    check(m && typeof m === 'object' && !Array.isArray(m), '모델 객체 없음');
    check(typeof m.method === 'string' && m.method && typeof m.method_label_ko === 'string' && typeof m.explanation_ko === 'string', '모델 설명 필드');
    check(Array.isArray(m.anchor_ids) && m.anchor_ids.every(x => typeof x === 'string') && Array.isArray(m.anchor_quarters) && m.anchor_quarters.every(x => typeof x === 'string'), '앵커 ID');
    check(Array.isArray(m.anchor_sources) && m.anchor_sources.every(s => s && typeof s === 'object' && typeof s.id === 'string' && typeof s.quarter === 'string' && [s.value_lower,s.value_upper].every(v => v === null || v === undefined || finite(v))), '앵커 출처');
    check(m.parameters && typeof m.parameters === 'object', '파라미터');
    check(m.last_actual_quarter === null || finite(ordinal(m.last_actual_quarter)), '마지막 실측 분기');
    check(m.quarters_since_actual === null || (Number.isInteger(m.quarters_since_actual) && m.quarters_since_actual >= 0), '실측 경과 분기');
    check(typeof m.confidence_label_ko === 'string' && Array.isArray(m.limitations_ko) && m.limitations_ko.every(s => typeof s === 'string'), '신뢰도·한계');
    if (m.sensitivity != null) {
      const s = m.sensitivity;
      check(typeof s === 'object' && typeof s.label_ko === 'string' && [s.lower,s.upper].every(v => v === null || finite(v)), '민감도');
      if (finite(s.lower) && finite(s.upper)) check(s.lower <= s.upper && s.lower >= 0, '민감도 순서');
    }
  }
  function validateTrack(pt, t, d) {
    const check = (b, why) => { if (!b) throw Error(why); };
    const current = ordinal(d.current_quarter), last = current + d.horizon_quarters;
    check(pt && typeof pt === 'object' && pt.id === t.id && pt.kind === 'leadtime' && typeof pt.label === 'string' && pt.unit === t.unit, '트랙 머리글');
    check(typeof pt.methodology_ko === 'string' && pt.stats && typeof pt.stats === 'object' && Array.isArray(pt.points) && new Set(pt.points.map(p => p?.id)).size === pt.points.length, '트랙 필드');
    check(pt.backtest === null || (pt.backtest && typeof pt.backtest === 'object'), '백테스트');
    for (const k of STATUSES) check(Number.isInteger(pt.stats[k]) && pt.stats[k] >= 0, '상태 통계');
    const actual = new Map(t.quarterly_points.map(p => [p.quarter, p])), rawIDs = new Set(t.points.map(p => p.id));
    check(pt.points.length > 0, '빈 포인트');
    if (t.quarterly_points.length) check(pt.points[0].quarter === t.quarterly_points[0].quarter, '첫 분기 불일치');
    check(ordinal(pt.points.at(-1).quarter) === last, '마지막 분기 불일치');
    const counts = Object.fromEntries(STATUSES.map(s => [s,0])), seen = new Set();
    let previous;
    for (const p of pt.points) {
      check(p && typeof p === 'object', '포인트');
      const q = ordinal(p.quarter);
      check(finite(q) && (previous === undefined || q === previous+1) && p.date === p.quarter, '분기 순서');
      previous = q; seen.add(p.quarter);
      check(typeof p.id === 'string' && STATUSES.includes(p.status) && typeof p.is_estimate === 'boolean' && typeof p.has_observation === 'boolean', '포인트 머리글');
      check(['latest','missing','ambiguous','estimated'].includes(p.selection_status) && typeof p.selection_note === 'string', '선택 상태');
      check(Number.isInteger(p.observation_count) && p.observation_count >= 0 && Array.isArray(p.observation_ids) && p.observation_count === p.observation_ids.length && new Set(p.observation_ids).size === p.observation_ids.length && p.observation_ids.every(id => rawIDs.has(id)), '관측 ID');
      check(typeof p.connect_previous === 'boolean' && typeof p.source_change === 'boolean' && typeof p.scope_break === 'boolean', '플래그');
      check(p.level && typeof p.level === 'object' && typeof p.level.label === 'string' && [p.level.lower,p.level.upper].every(v => v === null || finite(v)), '수준');
      for (const key of ['change','index','yoy']) {
        const m = p[key], fields = key === 'index' ? ['exact','lower','upper'] : ['exact_pct','lower_pct','upper_pct'];
        check(m && typeof m.available === 'boolean' && ['exact','endpoints','lower_only','unavailable'].includes(m.kind) && typeof m.label === 'string', `${key} 형식`);
        check(fields.every(k => m[k] === null || finite(m[k])) && (m.is_estimate === undefined || typeof m.is_estimate === 'boolean'), `${key} 값`);
        if (m.available) { check(m.kind !== 'unavailable', `${key} kind`); check(m.kind === 'exact' ? finite(m[fields[0]]) : finite(m[fields[1]]), `${key} 값 누락`); if (m.kind === 'endpoints') check(finite(m[fields[2]]), `${key} 상단 누락`); }
        else check(fields.every(k => m[k] === null), `${key} 비가용 값`);
      }
      const est = p.status === 'historical_estimate' || p.status === 'nowcast' || p.status === 'forecast';
      check(p.is_estimate === est, 'is_estimate 불일치');
      const a = actual.get(p.quarter);
      if (p.status === 'observed') {
        check(a && a.selection_status === 'latest' && a.has_observation, '실측 없는 observed');
        check(p.has_observation && p.id === a.id && p.selection_status === 'latest' && p.observation_ids.length === a.observation_ids.length && p.observation_ids.every((id,i) => id === a.observation_ids[i]), '실측 관측 불일치');
        check(p.level.lower === a.level.lower && p.level.upper === a.level.upper && p.level.qualifier === a.level.qualifier && p.level.label === a.level.label && !!p.level.upper_open === !!a.level.upper_open, '실측 수준 불일치');
        check(p.source_url === a.source_url && p.original_date === a.original_date && p.publisher === a.publisher && p.scope_break === a.scope_break && p.source_change === a.source_change && p.connect_previous === a.connect_previous, '실측 출처 불일치');
        check(p.model === null || p.model === undefined, '실측에 모델 부착');
        check(['change','yoy','index'].every(k => p[k].is_estimate || (p[k].available === a[k].available && p[k].kind === a[k].kind && p[k].label === a[k].label)), '실측 지표 불일치');
      } else {
        check(!a || a.selection_status !== 'latest', '실측 분기를 추정으로 덮어씀');
        check(!p.has_observation && p.observation_count === 0 && p.publisher == null && p.source_url == null && p.original_date == null, '추정에 출처 필드');
        if (est) {
          check(p.selection_status === 'estimated', '추정 선택 상태');
          check(!a || a.selection_status === 'missing', '대표값 미확인 분기를 추정');
          check(p.status !== 'historical_estimate' || q < current, '과거 추정 분기 범위');
          check(p.status !== 'nowcast' || q === current, '현재 추정 분기');
          check(p.status !== 'forecast' || q > current, '전망 분기');
          check(finite(p.level.lower) || finite(p.level.upper), '추정 수준 없음');
          check([p.level.lower,p.level.upper].every(v => v === null || v >= 0), '음수 수준');
          if (finite(p.level.lower) && finite(p.level.upper)) check(p.level.lower <= p.level.upper, '수준 끝점 순서');
          validateModel(p.model, check);
        } else {
          check(['missing','ambiguous'].includes(p.selection_status), '비가용 선택 상태');
          check(p.level.lower === null && p.level.upper === null && !p.connect_previous, '비가용 수준');
          check(['change','index','yoy'].every(k => !p[k].available), '비가용 지표');
          check(p.model === null || p.model === undefined || typeof p.model === 'object', '비가용 모델');
        }
      }
      if (p.scope_break) check(!p.change.available && !p.index.available, '범위 변경 지표');
      counts[p.status]++;
    }
    check(STATUSES.every(s => pt.stats[s] === counts[s]), '상태 통계 불일치');
    for (const a of t.quarterly_points) check(seen.has(a.quarter), '실측 분기 누락');
    const sourceIDs = new Set();
    const sourceEstimates = Array.isArray(pt.source_estimates) ? pt.source_estimates : [];
    for (const e of sourceEstimates) {
      check(e && typeof e === 'object' && typeof e.id === 'string' && !sourceIDs.has(e.id), '출처 추정 식별자');
      sourceIDs.add(e.id);
      check(finite(ordinal(e.quarter)) && (e.flag === 'e' || e.flag === 'f'), '출처 추정 분기·구분');
      check(e.level && typeof e.level.label === 'string' && finite(e.level.lower) && finite(e.level.upper) && e.level.lower >= 0 && e.level.upper >= e.level.lower, '출처 추정 수준');
      check(e.is_observation === false && e.counted_in_observations === false && e.used_as_model_truth === false, '출처 추정 실측 분리');
      check(typeof e.publisher === 'string' && typeof e.vintage === 'string' && typeof e.source_url === 'string', '출처 추정 근거');
    }
    pt.source_estimates = sourceEstimates.slice().sort((a,b) => ordinal(a.quarter) - ordinal(b.quarter) || a.id.localeCompare(b.id));
    return pt;
  }
  // ---- Estimate basis: own model vs publisher-reported estimate (e) / forecast (f). ----
  // Source-estimate provenance lives inside p.model (point-level publisher/source_url stay null by contract).
  const SOURCE_RE = /^(source|publisher)([_-]|$)/i;
  const FLAG = v => v === 'e' || v === 'f' ? v : null;
  function basisOf(p) {
    if (!p || !p.is_estimate) return null;
    const m = p.model && typeof p.model === 'object' ? p.model : {};
    const tag = [p.basis, m.basis, m.method].find(v => typeof v === 'string' && SOURCE_RE.test(v)) || null;
    const flag = FLAG(m.source_flag) || FLAG(m.publisher_flag) || FLAG(m.flag);
    if (!tag && !flag) return {kind:'model', flag:null, publisher:null, vintage:null};
    const publisher = [m.publisher, m.source_publisher].find(v => typeof v === 'string' && v) || null;
    const vintage = [m.vintage, m.edition_date, m.edition, m.source_date].find(v => typeof v === 'string' && v) || null;
    return {kind:'source', flag: flag || (/forecast/i.test(tag) ? 'f' : 'e'), publisher, vintage};
  }
  // Visual tone: actual (solid teal) | hist (amber dashed) | fwd (violet dashed) | src (blue dotted) | none (gap)
  const tone = p => p.is_estimate ? (basisOf(p).kind === 'source' ? 'src' : p.status === 'historical_estimate' ? 'hist' : 'fwd') : p.selection_status === 'latest' ? 'actual' : 'none';
  const TONE_KO = {actual:'실측', hist:'과거 추정 (자체 모델)', fwd:'전망 (자체 모델)', src:'출처 추정·전망', none:'값 없음'};
  function statusText(p, current) {
    if (p.is_estimate) {
      const b = basisOf(p);
      if (b.kind === 'source') return `출처 ${b.flag === 'f' ? '전망 (f)' : '추정 (e)'}${b.publisher ? ' · ' + b.publisher : ''}${b.vintage ? ' · ' + b.vintage + ' 판' : ''}`;
      return STATUS_KO[p.status];
    }
    if (p.selection_status === 'latest') return current && current === p.quarter ? '실측 · 현재 분기 (부분)' : '실측';
    if (p.status === 'unavailable') return p.selection_status === 'ambiguous' ? '추정 산출 불가 · 실측 후보 복수' : STATUS_KO.unavailable;
    return p.selection_status === 'ambiguous' ? '실측 후보 복수 (대표값 미확정)' : '실측 없음';
  }
  const basisKey = p => p.is_estimate ? (basisOf(p).kind === 'source' ? 'source' : 'model') : p.selection_status === 'latest' ? 'actual' : null;
  const BASIS_KO = {actual:'실측', source:'출처 추정·전망', model:'자체 모델'};
  // ---- Metric access (level / change / yoy / index), always endpoint-preserving. ----
  const MODES = [['level','수준'],['change','전분기 대비'],['yoy','전년 동기 대비'],['index','지수']];
  const MODE_KO = Object.fromEntries(MODES);
  const PERIODS = [['all','전체 기간'],['12','최근 12분기'],['8','최근 8분기'],['4','최근 4분기']];
  function metric(p, mode) {
    if (mode === 'level') {
      const lo = finite(p.level.lower) ? p.level.lower : null, hi = finite(p.level.upper) ? p.level.upper : null;
      return {available: lo !== null || hi !== null, lower: lo, upper: hi, open: !!p.level.upper_open || (lo !== null && hi === null), label: p.level.label, reason: p.selection_note, is_estimate: !!p.is_estimate, kind: lo !== null && hi !== null ? (lo === hi ? 'exact' : 'endpoints') : lo !== null ? 'lower_only' : hi !== null ? 'upper_only' : 'unavailable'};
    }
    const m = p[mode], pct = mode !== 'index';
    const ex = pct ? m.exact_pct : m.exact, lo = pct ? m.lower_pct : m.lower, hi = pct ? m.upper_pct : m.upper;
    const estimate = !!m.is_estimate || !!p.is_estimate;
    if (!m.available) return {available:false, lower:null, upper:null, open:false, label:m.label, reason: typeof m.reason === 'string' ? m.reason : '', is_estimate: estimate, kind:m.kind};
    const lower = m.kind === 'exact' ? ex : lo, upper = m.kind === 'exact' ? ex : m.kind === 'endpoints' ? hi : null;
    return {available:true, lower, upper, open: m.kind === 'lower_only', label:m.label, reason:'', is_estimate: estimate, kind:m.kind};
  }
  const fmt = (v, mode) => mode === 'level' || mode === 'index' ? num(v) : signed(v);
  function valueText(mv, mode) {
    if (!mv.available) return '—';
    if (mode === 'level') return mv.label;
    if (mv.lower !== null && mv.upper !== null) return mv.lower === mv.upper ? fmt(mv.lower, mode) : `${fmt(mv.lower, mode)}~${fmt(mv.upper, mode)}`;
    if (mv.lower !== null) return `${fmt(mv.lower, mode)} 이상`;
    return `${fmt(mv.upper, mode)} 이하`;
  }
  function directionClass(mv, mode) {
    if (!mv.available || mode === 'level') return 'tr-neutral';
    const baseline = mode === 'index' ? 100 : 0, v = mv.lower !== null ? mv.lower : mv.upper;
    return v > baseline ? 'tr-positive' : v < baseline ? 'tr-negative' : 'tr-neutral';
  }
  const unitKo = u => ({weeks:'주', months:'개월', days:'일'})[u] || u;
  // ---- State and data loading. Actual layer and model layer are fetched and failed independently. ----
  const state = {group:null, track:null, period:'all', mode:'level', overlay:true, selected:null, focus:null};
  let data = null, proj = null, projStatus = {state:'loading', message:'추정 레이어(projections.json)를 불러오는 중…'};
  const lastActualQuarter = t => t?.quarterly_points.filter(p => p.selection_status === 'latest').at(-1)?.quarter ?? t?.quarterly_points.at(-1)?.quarter ?? null;
  function initState() {
    const want = root.dataset.track;
    let g = data.groups[0], t = g?.tracks[0];
    if (want) for (const gg of data.groups) { const tt = gg.tracks.find(x => x.id === want); if (tt) { g = gg; t = tt; break; } }
    state.group = g?.id ?? null; state.track = t?.id ?? null; state.selected = lastActualQuarter(t);
  }
  const groupOf = () => data.groups.find(g => g.id === state.group) || data.groups[0] || null;
  const trackOf = g => g ? (g.tracks.find(t => t.id === state.track) || g.tracks[0] || null) : null;
  function layerFor(t) {
    if (!proj) return {pt:null, kind: projStatus.state === 'loading' ? 'loading' : 'layer', note: projStatus.message};
    if (proj.tracks.has(t.id)) return {pt: proj.tracks.get(t.id), kind:'ready', note:null};
    if (proj.rejected.has(t.id)) return {pt:null, kind:'rejected', note:`이 트랙의 추정 데이터가 스키마 검증에 실패했습니다 (${proj.rejected.get(t.id)}). 실측만 표시합니다.`};
    if (proj.unsupported.has(t.id)) return {pt:null, kind:'unsupported', note:`추정 미지원 트랙: ${proj.unsupported.get(t.id)}`};
    return {pt:null, kind:'absent', note:'이 트랙에는 추정 레이어 항목이 없습니다. 실측만 표시합니다.'};
  }
  function displayed(t, layer) {
    const overlay = state.overlay && !!layer.pt;
    const all = overlay ? layer.pt.points : t.quarterly_points;
    const lastQ = t.quarterly_points.length ? ordinal(t.quarterly_points.at(-1).quarter) : null;
    const n = state.period === 'all' ? null : Number(state.period);
    const points = n === null || lastQ === null ? all : all.filter(p => ordinal(p.quarter) > lastQ - n);
    const sourceEstimates = overlay ? layer.pt.source_estimates.filter(e => n === null || lastQ === null || ordinal(e.quarter) > lastQ - n) : [];
    return {points, all, overlay, sourceEstimates, sourceBasisChange: overlay ? layer.pt.source_estimate_basis_change : null};
  }
  async function loadActual() {
    try {
      const r = await fetch(url, {cache:'no-cache'});
      if (!r.ok) throw Error('http');
      const d = await r.json();
      if (!active()) return;
      data = validate(d);
    } catch (e) {
      if (!active()) return;
      root.replaceChildren(el('div', e?.message === 'refresh' ? '분기 추세 데이터 형식이 갱신되었습니다. 페이지를 새로고침해 주세요.' : '분기 추세 데이터를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', 'tr-empty'));
      return;
    }
    initState(); render();
    loadProjections();
  }
  async function loadProjections() {
    proj = null; projStatus = {state:'loading', message:'추정 레이어(projections.json)를 불러오는 중…'}; render();
    let d;
    try {
      const r = await fetch(projectionURL, {cache:'no-cache'});
      if (!active()) return;
      if (r.status === 404) { projStatus = {state:'missing', message:'추정 레이어 파일(projections.json)이 없습니다. 실측만 표시합니다.'}; render(); return; }
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      d = await r.json();
      if (!active()) return;
    } catch (e) {
      if (!active()) return;
      const why = e instanceof SyntaxError ? 'JSON 해석 실패' : e?.message || '네트워크 오류';
      projStatus = {state:'network', message:`추정 레이어를 불러오지 못했습니다 (${why}). 실측만 표시합니다.`}; render(); return;
    }
    try { proj = validateProjections(d, data); }
    catch (e) { proj = null; projStatus = {state:'invalid', message:`추정 레이어 스키마 검증 실패 (${e?.message || 'schema'}). 실측만 표시합니다.`}; render(); return; }
    const horizonEnd = quarterOf(ordinal(proj.data.current_quarter) + proj.data.horizon_quarters);
    projStatus = {state:'ready', message:`추정 레이어 준비됨 · 모델 ${proj.data.model_version} · 기준일 ${proj.data.as_of} · 현재 분기 ${proj.data.current_quarter} · 전망 ${proj.data.horizon_quarters}분기 (~${horizonEnd})`};
    render();
  }
  // ---- Rendering: full rebuild per state change; focus restored via data-focus keys. ----
  let layerError = null;
  function render() {
    if (!active() || !data) return;
    const g = groupOf(), t = trackOf(g);
    state.group = g?.id ?? null; state.track = t?.id ?? null;
    const frag = document.createDocumentFragment();
    frag.append(header(), controls(g, t));
    if (!t) { frag.append(el('div', '표시할 트랙이 없습니다.', 'tr-empty')); root.replaceChildren(frag); return; }
    const layer = layerFor(t), view = displayed(t, layer);
    ensureSelection(view);
    let parts;
    try { parts = body(t, layer, view); }
    catch (e) {
      // Fail open: a drawing failure inside the model layer falls back to the established actual-only interface.
      if (!view.overlay) throw e;
      layerError = `추정 레이어 표시 중 오류가 발생해 실측만 표시합니다 (${e?.message || e}).`;
      state.overlay = false;
      return render();
    }
    frag.append(layerBar(layer, view), ...parts);
    root.replaceChildren(frag);
    restoreFocus();
    scrollChart();
  }
  function ensureSelection(view) {
    if (view.points.some(p => p.quarter === state.selected)) return;
    const pick = view.points.filter(p => p.selection_status === 'latest').at(-1) || view.points.filter(p => metric(p, 'level').available).at(-1) || view.points.at(-1);
    state.selected = pick ? pick.quarter : null;
  }
  function restoreFocus() {
    const key = state.focus; state.focus = null;
    if (!key) return;
    const n = [...root.querySelectorAll('[data-focus]')].find(x => x.dataset.focus === key);
    if (n) { try { n.focus({preventScroll:true}); } catch { n.focus(); } }
  }
  function scrollChart() {
    const chart = root.querySelector('.tr-chart'), hit = chart && [...chart.querySelectorAll('.tr-hit')].find(x => x.dataset.quarter === state.selected);
    if (!chart || !hit) return;
    const x = Number(hit.getAttribute('x')) + Number(hit.getAttribute('width'))/2;
    if (finite(x)) chart.scrollLeft = Math.max(0, x - chart.clientWidth/2);
  }
  function header() {
    const h = el('header');
    h.append(el('p', 'LEAD-TIME QUARTERLY TRENDS', 'tr-eyebrow'), el('h2', '리드타임 분기 추세'));
    h.append(el('p', '출처가 보고한 실측 리드타임을 분기 대표값으로 정리한 추세입니다. 추정·전망은 별도 모델 레이어로만 제공되며 점선으로 구분하고, 실측 원장과 실측 CSV에는 포함되지 않습니다.', 'tr-muted'));
    if (proj) {
      const d = proj.data, c = ordinal(d.current_quarter), meta = el('div', null, 'tr-head-meta');
      meta.append(el('span', `현재 분기 ${d.current_quarter}`), el('span', d.horizon_quarters > 0 ? `전망 범위 ${quarterOf(c+1)}~${quarterOf(c+d.horizon_quarters)}` : '전망 없음'), el('span', `모델 ${d.model_version}`), el('span', `기준일 ${d.as_of}`));
      h.append(meta);
    }
    return h;
  }
  function controls(g, t) {
    const wrap = el('div', null, 'tr-controls');
    const select = (key, labelText, options, value, onchange) => {
      const lab = el('label', labelText), s = el('select'); s.dataset.focus = key;
      for (const [v, text] of options) { const o = el('option', text); o.value = v; s.append(o); }
      s.value = value; s.onchange = () => { state.focus = key; onchange(s.value); };
      if (!options.length) s.disabled = true;
      return add(lab, s);
    };
    wrap.append(
      select('group', '제품군', data.groups.map(x => [x.id, x.label]), g?.id ?? '', v => { state.group = v; const gg = groupOf(); state.track = gg?.tracks[0]?.id ?? null; state.selected = lastActualQuarter(trackOf(gg)); render(); }),
      select('track', '트랙', (g?.tracks || []).map(x => [x.id, x.label]), t?.id ?? '', v => { state.track = v; state.selected = lastActualQuarter(trackOf(groupOf())); render(); }),
      select('period', '기간', PERIODS, state.period, v => { state.period = v; render(); })
    );
    return wrap;
  }
  function pressed(key, text, on, fn) { const b = button(text, fn); b.dataset.focus = key; b.setAttribute('aria-pressed', String(on)); return b; }
  function tabs() {
    const wrap = el('div', null, 'tr-tabs'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', '표시 지표');
    for (const [m, text] of MODES) wrap.append(pressed('mode:'+m, text, state.mode === m, () => { state.mode = m; state.focus = 'mode:'+m; render(); }));
    return wrap;
  }
  function layerBar(layer, view) {
    const bar = el('div', null, 'tr-layer');
    bar.append(el('span', '표시 범위', 'tr-layer-label'));
    const tg = el('div', null, 'tr-toggle'); tg.setAttribute('role', 'group'); tg.setAttribute('aria-label', '실측만 또는 실측+추정 표시 전환');
    tg.append(pressed('layer:actual', '실측만', !view.overlay, () => { state.overlay = false; state.focus = 'layer:actual'; render(); }));
    const est = pressed('layer:est', '실측+추정', view.overlay, () => { state.overlay = true; layerError = null; state.focus = 'layer:est'; render(); });
    if (!layer.pt) { est.disabled = true; est.setAttribute('aria-disabled', 'true'); est.title = layer.note || ''; }
    tg.append(est);
    const st = el('div', null, 'tr-status'); st.setAttribute('role', 'status'); st.setAttribute('aria-live', 'polite');
    const warn = layer.kind !== 'ready' || !!layerError;
    st.classList.add(warn ? 'tr-status-warn' : 'tr-status-ok');
    st.append(el('span', layerError || layer.note || `${view.overlay ? '실측+추정' : '실측만'} 표시 중 · ${projStatus.message}`));
    if (layer.kind !== 'loading' && layer.kind !== 'ready') { const retry = button('추정 레이어 다시 불러오기', () => { layerError = null; state.focus = 'layer:retry'; loadProjections(); }); retry.dataset.focus = 'layer:retry'; st.append(retry); }
    return add(bar, tg, st);
  }
  // ---- Badges, model summaries ----
  const badge = (text, kind) => el('span', text, 'tr-badge' + (kind ? ' tr-badge-' + kind : ''));
  const isPartial = (p, current) => p.selection_status === 'latest' && !!current && current === p.quarter;
  function statusBadge(p, current) {
    const tn = tone(p);
    return badge(statusText(p, current), tn === 'actual' ? (isPartial(p, current) ? 'partial' : '') : tn === 'none' ? 'unavailable' : tn);
  }
  function basisChanged(p, ctx) {
    const prev = ctx.byQuarter.get(quarterOf(ordinal(p.quarter) - 1));
    return !!(prev && p.is_estimate && prev.is_estimate && basisKey(prev) !== basisKey(p));
  }
  function crossBasis(p, ctx, mode) {
    if (mode === 'level' || !metric(p, mode).available) return null;
    const other = mode === 'change' ? ctx.byQuarter.get(quarterOf(ordinal(p.quarter) - 1)) : mode === 'yoy' ? ctx.byQuarter.get(quarterOf(ordinal(p.quarter) - 4)) : null;
    if (!other) return null;
    const a = basisKey(other), b = basisKey(p);
    return a && b && a !== b ? `${BASIS_KO[a]} → ${BASIS_KO[b]}` : null;
  }
  function badgesFor(p, ctx, mode) {
    const wrap = el('span', null, 'tr-badges');
    wrap.append(statusBadge(p, ctx.current));
    if (isPartial(p, ctx.current)) wrap.append(badge('분기 미완료 · 기준일 이전 관측', 'partial'));
    const f = flags(p); if (f) wrap.append(badge(f, 'muted'));
    const mv = metric(p, mode);
    if (mode !== 'level' && mv.available && mv.is_estimate) wrap.append(badge('추정 포함', tone(p) === 'actual' ? 'fwd' : tone(p)));
    const cross = crossBasis(p, ctx, mode); if (cross) wrap.append(badge(`기준 혼합 ${cross}`, 'warn'));
    if (basisChanged(p, ctx)) wrap.append(badge('산출 기준 변경', 'warn'));
    if (p.is_estimate && (p.level.upper_open || metric(p, 'level').kind === 'lower_only')) wrap.append(badge('경계 조건부 시나리오', 'warn'));
    return wrap;
  }
  function backtestText(bt) {
    if (!bt || typeof bt !== 'object') return '백테스트 없음 (모델 정확도 미검증)';
    const n = [bt.n, bt.folds, bt.n_folds].find(finite), mae = [bt.mae, bt.MAE].find(finite), base = [bt.baseline_mae, bt.naive_mae].find(finite), method = [bt.chosen_method, bt.method, bt.selected].find(v => typeof v === 'string' && v);
    const parts = [];
    if (method) parts.push(`선택 방법 ${method}`);
    parts.push(finite(n) ? `롤링 검증 ${n}회` : '검증 횟수 미보고');
    if (finite(mae)) parts.push(`MAE ${num(mae)}`);
    if (finite(base)) parts.push(`기준(last-level) MAE ${num(base)}`);
    if (finite(n) && n < 3) parts.push('검증 부족 → 보수적 기본값');
    return parts.join(' · ');
  }
  const modelOf = p => p && p.is_estimate && p.model && typeof p.model === 'object' ? p.model : null;
  function ageText(m) {
    if (!m) return '';
    const parts = [];
    if (m.last_actual_quarter) parts.push(`마지막 실측 ${m.last_actual_quarter}`);
    if (finite(m.quarters_since_actual)) parts.push(`실측 경과 ${m.quarters_since_actual}분기`);
    if (Array.isArray(m.anchor_ids)) parts.push(`앵커 ${m.anchor_ids.length}개`);
    return parts.join(' · ');
  }
  const isStale = m => !!m && ((finite(m.quarters_since_actual) && m.quarters_since_actual >= 4) || (Array.isArray(m.anchor_ids) && m.anchor_ids.length <= 1) || /flat_sparse|sparse/i.test(m.method || ''));
  // ---- KPI cards ----
  function kpi(title, value, subs, cls, badges) {
    const c = el('div', null, 'tr-kpi' + (cls ? ' ' + cls : ''));
    c.append(el('p', title, 'tr-kpi-title'));
    if (badges) c.append(badges);
    c.append(el('strong', value));
    for (const s of [].concat(subs).filter(Boolean)) c.append(el('p', s, 'tr-kpi-sub'));
    return c;
  }
  function kpis(ctx) {
    const {t, view} = ctx, wrap = el('div', null, 'tr-kpis'), unit = unitKo(t.unit);
    const latest = t.quarterly_points.filter(p => p.selection_status === 'latest').at(-1);
    const st = t.quarterly_stats;
    if (latest) {
      const b = el('span', null, 'tr-badges'); b.append(statusBadge(latest, ctx.current)); const f = flags(latest); if (f) b.append(badge(f, 'muted'));
      wrap.append(kpi(`최신 실측 (${latest.quarter})`, `${latest.level.label}`, [`${latest.original_date} · ${latest.publisher || '출처 미기재'}`, `관측 ${latest.observation_count}건 · 단위 ${unit}`], '', b));
    } else wrap.append(kpi('최신 실측', '—', `실측 대표값이 확정된 분기가 없습니다 (총 ${st.total_quarters}분기).`));
    if (!view.overlay) {
      const ch = latest ? metric(latest, 'change') : {available:false, reason:'실측 없음', label:''};
      const v = el('strong', valueText(ch, 'change')); v.className = directionClass(ch, 'change');
      const c = kpi(latest ? `전분기 대비 (${latest.quarter})` : '전분기 대비', '', [ch.available ? ch.label : (ch.reason || ch.label || '산출 불가')]);
      c.replaceChild(v, c.querySelector('strong'));
      wrap.append(c);
      wrap.append(kpi('분기 커버리지 (실측)', `${st.observed_quarters}/${st.total_quarters}분기`, [`미확인 ${st.missing_quarters} · 후보 복수 ${st.ambiguous_quarters} · 원시 관측 ${st.raw_observations}건`, '추정·전망은 관측 수에 포함하지 않습니다.']));
      return wrap;
    }
    const pts = ctx.layer.pt.points, byQ = new Map(pts.map(p => [p.quarter, p]));
    const cur = byQ.get(ctx.current), last = pts.at(-1), h = proj.data.horizon_quarters;
    const card = (title, p) => {
      if (!p) return kpi(title, '—', '해당 분기 항목이 없습니다.');
      const tn = tone(p), m = modelOf(p), subs = [];
      const b = basisOf(p);
      if (p.selection_status === 'latest') subs.push(`${p.original_date} 관측 · 분기 미완료 (부분 실측)`, '분기 종료 후 확정값이 아닙니다.');
      else if (m && b.kind === 'source') subs.push(`발행사 공개 ${b.flag === 'f' ? '전망 (f)' : '추정 (e)'}${b.publisher ? ' · ' + b.publisher : ''}${b.vintage ? ' · ' + b.vintage + ' 판' : ''}`, '실측도 자체 모델 결과도 아닙니다.');
      else if (m) subs.push(`${m.method_label_ko} · 신뢰도 ${m.confidence_label_ko}`, ageText(m), backtestText(ctx.layer.pt.backtest));
      else subs.push(p.selection_note || STATUS_KO.unavailable);
      return kpi(title, metric(p, 'level').available ? p.level.label : '—', subs, tn === 'actual' || tn === 'none' ? '' : 'tr-kpi-' + tn, badgesFor(p, ctx, 'level'));
    };
    wrap.append(card(`현재 분기 (${ctx.current})`, cur));
    wrap.append(card(h > 0 ? `${h}분기 후 전망 (${last.quarter})` : `전망 (${last.quarter})`, last));
    return wrap;
  }
  // ---- Prominent warnings and the coverage banner ----
  function warnings(ctx) {
    const {t, view} = ctx, out = document.createDocumentFragment(), st = t.quarterly_stats;
    const banner = el('p', null, 'tr-banner');
    banner.textContent = `실측 ${st.observed_quarters}/${st.total_quarters}분기 · 미확인 ${st.missing_quarters} · 후보 복수 ${st.ambiguous_quarters} · 원시 관측 ${st.raw_observations}건` + (view.points.some(p => p.scope_break) ? ' · 제품 범위 변경 구간은 이전 구간과 연결·비교하지 않습니다' : '') + (view.points.some(p => p.source_change) ? ' · 출처 변경 분기는 ▢ 표식으로 표시' : '');
    out.append(banner);
    if (!view.overlay) return out;
    const ests = view.all.filter(p => p.is_estimate), models = ests.filter(p => basisOf(p).kind === 'model').map(modelOf).filter(Boolean), sourceEstimates = view.sourceEstimates;
    const stale = models.filter(isStale);
    if (stale.length) {
      const m = stale.at(-1);
      out.append(el('p', `주의: 오래되었거나 단일 앵커에 기반한 추정입니다. ${ageText(m)}. 표시된 최신 값은 권위 있는 관측이 아니라 가정 기반 시나리오입니다.`, 'tr-warn'));
    }
    if (ests.some(p => p.level.upper_open || metric(p, 'level').kind === 'lower_only')) out.append(el('p', '주의: 상한이 열린(이상) 앵커에 기반한 구간은 경계 조건부 시나리오(bound-only)이며 정확한 값·상한·변화율을 만들지 않습니다.', 'tr-warn'));
    const change = view.all.find(p => basisChanged(p, ctx));
    if (change) out.append(el('p', `주의: ${change.quarter}부터 산출 기준이 ${BASIS_KO[basisKey(ctx.byQuarter.get(quarterOf(ordinal(change.quarter) - 1)))]}에서 ${BASIS_KO[basisKey(change)]}(으)로 바뀝니다. 두 기준의 수준 차이를 그대로 표시하며, 기준이 섞인 변화율은 '기준 혼합'으로 표시합니다.`, 'tr-warn'));
    const sourceChange = view.sourceBasisChange;
    if (sourceChange) {
      const lastPublisher = sourceChange.last_publisher_quarter || '확인된 출처 분기', nextModel = sourceChange.next_own_model_quarter || '그 다음 분기';
      out.append(el('p', `출처 추정·전망은 ${lastPublisher}까지 별도 기준으로 표시하고 ${nextModel}부터 자체 모델 전망으로 전환합니다. 같은 분기의 실측·자체 모델과 교차 변화율·지수를 계산하지 않습니다.`, 'tr-warn'));
    }
    if (sourceEstimates.length) out.append(el('p', `출처 추정 (e)·전망 (f) ${sourceEstimates.length}건은 발행사가 공개한 수치입니다. 실측도 자체 모델 결과도 아니며 관측 수·모델 정확도 계산에 포함하지 않습니다.`, 'tr-muted'));
    return out;
  }
  function body(t, layer, view) {
    const current = view.overlay ? proj.data.current_quarter : null;
    const ctx = {t, layer, view, current, mode: state.mode, byQuarter: new Map(view.all.map(p => [p.quarter, p]))};
    return [tabs(), kpis(ctx), warnings(ctx), plot(ctx), strip(ctx), detail(ctx), actions(ctx), table(ctx), methodology(ctx)];
  }
  // ---- Chart ----
  function niceStep(span) {
    const raw = span / 4, pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    for (const k of [1,2,2.5,5,10]) if (raw <= k*pow) return k*pow;
    return 10*pow;
  }
  function plot(ctx) {
    const {view, mode, t, current} = ctx, pts = view.points, wrap = el('div', null, 'tr-plot');
    const vals = pts.map(p => ({p, m: metric(p, mode), env: mode === 'level' ? modelOf(p)?.sensitivity : null}));
    const sourceRows = mode === 'level' ? view.sourceEstimates.filter(e => e?.level && (finite(e.level.lower) || finite(e.level.upper))) : [];
    const avail = vals.filter(v => v.m.available);
    if (!avail.length) { wrap.append(el('div', `선택한 기간에 ${MODE_KO[mode]} 값이 없습니다.`, 'tr-empty')); return wrap; }
    const baseline = mode === 'level' ? null : mode === 'index' ? 100 : 0;
    const ys = [];
    for (const v of avail) { if (v.m.lower !== null) ys.push(v.m.lower); if (v.m.upper !== null) ys.push(v.m.upper); if (v.env && finite(v.env.lower) && finite(v.env.upper)) ys.push(v.env.lower, v.env.upper); }
    for (const e of sourceRows) { if (finite(e.level.lower)) ys.push(e.level.lower); if (finite(e.level.upper)) ys.push(e.level.upper); }
    if (baseline !== null) ys.push(baseline);
    let lo = Math.min(...ys), hi = Math.max(...ys);
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
    if (mode === 'level' && lo < 0) lo = 0;
    const step = niceStep(hi - lo), tick0 = Math.ceil(lo/step)*step, ticks = [];
    for (let v = tick0; v <= hi + 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
    const W = Math.max(640, 60 + pts.length*64), H = 352, L = 60, R = 24, T = 28, B = 44, slot = (W - L - R) / Math.max(pts.length, 1);
    const x = i => L + slot*(i + 0.5), y = v => T + (H - T - B) * (1 - (v - lo)/(hi - lo));
    const pointIndex = new Map(pts.map((p, i) => [p.quarter, i]));
    const s = svg('svg', {viewBox:`0 0 ${W} ${H}`, width:W, height:H, role:'img', 'aria-label': `${t.label} ${MODE_KO[mode]} 분기 추세 차트`});
    s.append(svg('title', {}, `${t.label} · ${MODE_KO[mode]} · ${pts[0].quarter}~${pts.at(-1).quarter}`));
    // Forecast shading + NOW separator (overlay only)
    const ci = current ? pts.findIndex(p => p.quarter === current) : -1;
    if (ci >= 0) {
      s.append(svg('rect', {x: x(ci) - slot/2, y: T, width: W - R - (x(ci) - slot/2), height: H - T - B, class:'tr-future'}));
      s.append(svg('line', {x1: x(ci), x2: x(ci), y1: T - 6, y2: H - B, class:'tr-now'}));
      s.append(svg('text', {x: x(ci) + 4, y: T - 10, class:'tr-text-now'}, `NOW ${current} (기준일 ${proj.data.as_of})`));
    }
    for (const v of ticks) {
      const zero = baseline !== null && v === baseline;
      s.append(svg('line', {x1: L, x2: W - R, y1: y(v), y2: y(v), class: zero ? 'tr-zero' : 'tr-grid'}));
      s.append(svg('text', {x: L - 8, y: y(v) + 4, 'text-anchor':'end'}, mode === 'level' || mode === 'index' ? num(v) : signed(v)));
    }
    if (baseline !== null && !ticks.includes(baseline)) s.append(svg('line', {x1: L, x2: W - R, y1: y(baseline), y2: y(baseline), class:'tr-zero'}));
    s.append(svg('text', {x: L - 8, y: T - 10, 'text-anchor':'end'}, mode === 'level' ? unitKo(t.unit) : mode === 'index' ? '지수' : '%'));
    // Segment i-1 -> i exists only when both endpoints are available and joined; dashed when any endpoint is an estimate.
    // An observed point copies the actual connect_previous flag, which is false when the preceding actual quarter was missing;
    // when the model layer fills that quarter, the estimate -> actual bridge is still drawn (dashed) unless the actual is a scope break.
    // Estimates keep their own connect_previous (the engine may deliberately leave a break, e.g. across a source/timing break).
    const joined = (a, b) => b.connect_previous || (view.overlay && a.is_estimate && !b.is_estimate && !b.scope_break);
    const segTone = (a, b) => b.is_estimate ? tone(b) : a.is_estimate ? tone(a) : 'actual';
    const envelopes = [], bands = [], lines = [];
    for (let i = 1; i < pts.length; i++) {
      const a = vals[i-1], b = vals[i];
      if (!a.m.available || !b.m.available || !joined(a.p, b.p)) continue;
      const tn = segTone(a.p, b.p), est = a.p.is_estimate || b.p.is_estimate;
      const cls = `tr-line${est ? ' tr-line-est' : ''}${tn !== 'actual' ? ' tr-line-' + tn : ''}`;
      const aLo = a.m.lower ?? a.m.upper, bLo = b.m.lower ?? b.m.upper, aHi = a.m.upper ?? a.m.lower, bHi = b.m.upper ?? b.m.lower;
      lines.push(svg('line', {x1: x(i-1), y1: y(aLo), x2: x(i), y2: y(bLo), class: cls}));
      if (aHi !== aLo || bHi !== bLo) lines.push(svg('line', {x1: x(i-1), y1: y(aHi), x2: x(i), y2: y(bHi), class: cls + ' tr-line-upper'}));
      if (a.m.lower !== null && a.m.upper !== null && b.m.lower !== null && b.m.upper !== null && (a.m.lower !== a.m.upper || b.m.lower !== b.m.upper))
        bands.push(svg('polygon', {points: `${x(i-1)},${y(a.m.lower)} ${x(i)},${y(b.m.lower)} ${x(i)},${y(b.m.upper)} ${x(i-1)},${y(a.m.upper)}`, class: 'tr-band' + (tn !== 'actual' ? ' tr-band-' + tn : '')}));
      if (a.env && b.env && [a.env.lower, a.env.upper, b.env.lower, b.env.upper].every(finite) && a.p.is_estimate && b.p.is_estimate)
        envelopes.push(svg('polygon', {points: `${x(i-1)},${y(a.env.lower)} ${x(i)},${y(b.env.lower)} ${x(i)},${y(b.env.upper)} ${x(i-1)},${y(a.env.upper)}`, class: 'tr-envelope' + (tn === 'hist' ? ' tr-envelope-hist' : '')}));
    }
    const sourceLines = [], sourceDots = [];
    let priorSource = null;
    for (const e of sourceRows) {
      const i = pointIndex.get(e.quarter); if (i === undefined) continue;
      const lower = finite(e.level.lower) ? e.level.lower : e.level.upper, upper = finite(e.level.upper) ? e.level.upper : lower;
      if (priorSource && i === priorSource.i + 1) {
        sourceLines.push(svg('line', {x1:x(priorSource.i), y1:y(priorSource.lower), x2:x(i), y2:y(lower), class:'tr-line tr-line-est tr-line-src'}));
        if (priorSource.upper !== priorSource.lower || upper !== lower) sourceLines.push(svg('line', {x1:x(priorSource.i), y1:y(priorSource.upper), x2:x(i), y2:y(upper), class:'tr-line tr-line-est tr-line-src tr-line-upper'}));
      }
      if (upper !== lower) sourceDots.push(svg('line', {x1:x(i), x2:x(i), y1:y(lower), y2:y(upper), class:'tr-range tr-range-src'}));
      for (const value of [...new Set([lower, upper])]) sourceDots.push(svg('rect', {x:x(i)-4, y:y(value)-4, width:8, height:8, class:'tr-dot tr-dot-est tr-dot-src'}));
      sourceDots.push(svg('text', {x:x(i), y:y(upper)-10, 'text-anchor':'middle', class:'tr-text-src'}, `출처 (${e.flag})`));
      priorSource = {i, lower, upper};
    }
    s.append(...envelopes, ...bands, ...lines, ...sourceLines);
    // Points, range bars, markers
    const dots = [];
    vals.forEach((v, i) => {
      const p = v.p, tn = tone(p), sel = p.quarter === state.selected;
      if (p.scope_break) { dots.push(svg('line', {x1: x(i) - slot/2, x2: x(i) - slot/2, y1: T, y2: H - B, class:'tr-marker-scope'})); dots.push(svg('text', {x: x(i) - slot/2 + 4, y: H - B - 6, class:'tr-text-flag'}, '범위 변경')); }
      if (basisChanged(p, ctx)) { dots.push(svg('line', {x1: x(i) - slot/2, x2: x(i) - slot/2, y1: T, y2: H - B, class:'tr-marker-basis'})); dots.push(svg('text', {x: x(i) - slot/2 + 4, y: T + 12, class:'tr-text-src'}, '기준 변경')); }
      if (!v.m.available) return;
      const yl = v.m.lower !== null ? y(v.m.lower) : null, yu = v.m.upper !== null ? y(v.m.upper) : null;
      if (yl !== null && yu !== null && yl !== yu) dots.push(svg('line', {x1: x(i), x2: x(i), y1: yl, y2: yu, class: 'tr-range' + (tn !== 'actual' ? ' tr-range-' + tn : '')}));
      for (const yy of [yl, yu].filter(v2 => v2 !== null)) {
        const cls = `tr-dot${p.is_estimate ? ' tr-dot-est tr-dot-' + tn : ''}${isPartial(p, current) ? ' tr-dot-partial' : ''}${sel ? ' tr-dot-selected' : ''}`;
        dots.push(p.is_estimate && tn === 'src' ? svg('rect', {x: x(i) - 4, y: yy - 4, width: 8, height: 8, class: cls}) : svg('circle', {cx: x(i), cy: yy, r: sel ? 5 : 3.8, class: cls}));
      }
      const yTop = yu ?? yl, yBottom = yl ?? yu;
      if (v.m.open) { dots.push(svg('path', {d: `M${x(i)} ${yTop - 7} l-4 5 h8 z`, class:'tr-open'})); dots.push(svg('text', {x: x(i), y: yTop - 11, 'text-anchor':'middle', class:'tr-text-flag'}, mode === 'level' ? '이상' : '하한만')); }
      else if (p.is_estimate) dots.push(svg('text', {x: x(i), y: yTop - 10, 'text-anchor':'middle', class: 'tr-text-' + tn}, tn === 'src' ? `출처 (${basisOf(p).flag})` : tn === 'hist' ? '추정' : p.status === 'nowcast' ? '현재 추정' : '전망'));
      else if (isPartial(p, current)) dots.push(svg('text', {x: x(i), y: yTop - 10, 'text-anchor':'middle', class:'tr-text-flag'}, '부분'));
      if (p.source_change) { dots.push(svg('rect', {x: x(i) - 5, y: yBottom + 9, width: 10, height: 10, class:'tr-marker'})); dots.push(svg('text', {x: x(i), y: yBottom + 31, 'text-anchor':'middle', class:'tr-text-flag'}, '출처 변경')); }
    });
    s.append(...dots, ...sourceDots);
    // Axis labels and keyboard/click hit targets
    pts.forEach((p, i) => {
      s.append(svg('text', {x: x(i), y: H - B + 18, 'text-anchor':'middle'}, p.quarter));
      const mv = vals[i].m;
      const hit = svg('rect', {x: x(i) - slot/2, y: T, width: slot, height: H - T - B, class:'tr-hit', tabindex:'0', role:'button', 'aria-pressed': String(p.quarter === state.selected), 'aria-label': `${p.quarter} ${statusText(p, current)} ${MODE_KO[mode]} ${mv.available ? valueText(mv, mode) : '값 없음'}`});
      hit.dataset.quarter = p.quarter; hit.dataset.focus = 'hit:' + p.quarter;
      const choose = () => { state.selected = p.quarter; state.focus = 'hit:' + p.quarter; render(); };
      hit.addEventListener('click', choose);
      hit.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); const j = e.key === 'ArrowLeft' ? i - 1 : i + 1; if (pts[j]) { state.selected = pts[j].quarter; state.focus = 'hit:' + pts[j].quarter; render(); } }
      });
      s.append(hit);
    });
    const chart = el('div', null, 'tr-chart'); chart.append(s);
    wrap.append(chart, legend(ctx));
    return wrap;
  }
  function legend(ctx) {
    const lg = el('div', null, 'tr-legend'); lg.setAttribute('aria-label', '범례');
    const item = (cls, text, dashed) => { const i = el('span', null, 'tr-legend-item'); const s = svg('svg', {viewBox:'0 0 30 10', 'aria-hidden':'true'}); s.append(svg('line', {x1:1, x2:29, y1:5, y2:5, class: cls + (dashed ? ' tr-line-est' : '')})); i.append(s, el('span', text)); return i; };
    lg.append(item('tr-line', '실측 (실선)'));
    if (ctx.view.overlay) {
      lg.append(item('tr-line tr-line-hist', '과거 추정 · 자체 모델 (주황 점선)', true), item('tr-line tr-line-fwd', '현재 분기 추정·전망 · 자체 모델 (보라 점선)', true), item('tr-line tr-line-src', '출처 추정 (e)·전망 (f) (파랑 점선, 사각 표식)'));
      if (ctx.mode === 'level' && ctx.view.points.some(p => modelOf(p)?.sensitivity)) lg.append(el('span', '옅은 영역: 가정 기반 민감도 범위 (검증된 신뢰구간 아님)', 'tr-legend-item'));
      lg.append(el('span', '음영: 현재 분기 이후 전망 구간 · NOW 선: 현재 분기', 'tr-legend-item'));
    }
    lg.append(el('span', '▢ 출처 변경 · 붉은 점선: 제품 범위 변경(비교 단절) · 세로 막대: 하한~상한 끝점', 'tr-legend-item'));
    return lg;
  }
  // ---- Quarter strip ----
  const shortStatus = (p, current) => p.is_estimate ? (basisOf(p).kind === 'source' ? `출처 (${basisOf(p).flag})` : p.status === 'historical_estimate' ? '추정' : p.status === 'nowcast' ? '현재 추정' : '전망') : p.selection_status === 'latest' ? (isPartial(p, current) ? '실측·부분' : '실측') : p.selection_status === 'ambiguous' ? '후보 복수' : '없음';
  function strip(ctx) {
    const {view, mode, current} = ctx, wrap = el('div', null, 'tr-strip'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', '분기별 값 선택');
    for (const p of view.points) {
      const mv = metric(p, mode), tn = tone(p);
      const b = pressed('strip:' + p.quarter, null, p.quarter === state.selected, () => { state.selected = p.quarter; state.focus = 'strip:' + p.quarter; render(); });
      if (p.is_estimate) b.classList.add('tr-est', 'tr-est-' + tn);
      b.append(el('span', p.quarter), el('span', mv.available ? valueText(mv, mode) : '—', mv.available ? directionClass(mv, mode) : 'tr-unavailable'), el('span', shortStatus(p, current), 'tr-strip-status'));
      b.setAttribute('aria-label', `${p.quarter} ${statusText(p, current)} ${MODE_KO[mode]} ${mv.available ? valueText(mv, mode) : '값 없음'}`);
      wrap.append(b);
    }
    return wrap;
  }
  // ---- Detail panel: exact source for actuals, formula/anchors/assumptions for estimates, reason for gaps ----
  const fmtParam = v => v == null ? '—' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toLocaleString('ko-KR', {maximumFractionDigits:6})) : typeof v === 'string' ? v : JSON.stringify(v);
  const anchorValue = a => finite(a.value_lower) && finite(a.value_upper) ? (a.value_lower === a.value_upper ? num(a.value_lower) : `${num(a.value_lower)}~${num(a.value_upper)}`) : finite(a.value_lower) ? `${num(a.value_lower)} 이상` : finite(a.value_upper) ? `${num(a.value_upper)} 이하` : '값 미기재';
  function candidates(p, t) {
    const det = el('details'); det.append(el('summary', `분기 대표값 선택 (관측 ${p.observation_count}건)`), el('p', p.selection_note));
    const list = el('div', null, 'tr-candidates'), raw = new Map(t.points.map(r => [r.id, r]));
    for (const id of p.observation_ids) { const r = raw.get(id); list.append(el('span', r ? `${r.date} · ${r.level.label}${id === p.id ? ' (대표)' : ''}` : id)); }
    if (!p.observation_ids.length) list.append(el('span', '관측 없음', 'tr-muted'));
    return add(det, list);
  }
  function detail(ctx) {
    const {t, mode, current} = ctx, p = ctx.view.points.find(x => x.quarter === state.selected);
    const box = el('section', null, 'tr-detail'); box.setAttribute('aria-live', 'polite');
    if (!p) { box.append(el('p', '차트의 점이나 분기 버튼을 선택하면 상세 근거를 표시합니다.', 'tr-muted')); return box; }
    const tn = tone(p);
    if (p.is_estimate) box.classList.add('tr-detail-est', tn === 'hist' ? 'tr-detail-hist' : tn === 'src' ? 'tr-detail-src' : 'tr-detail-fwd');
    const title = el('div', null, 'tr-detail-title'); title.append(el('h3', `${p.quarter} · ${t.label}`), badgesFor(p, ctx, mode));
    const dl = el('dl', null, 'tr-params');
    for (const [m, label] of MODES) { const mv = metric(p, m); dl.append(el('dt', label), el('dd', mv.available ? `${valueText(mv, m)}${m === 'level' ? (mv.open ? ' (상한 미확정)' : '') : ` · ${mv.label}`}${mv.is_estimate && m !== 'level' ? ' · 추정 포함' : ''}` : `— ${mv.reason || mv.label || '산출 불가'}`)); }
    box.append(title, dl);
    if (p.selection_status === 'latest') box.append(actualProvenance(p, ctx));
    else if (p.is_estimate) box.append(modelProvenance(p, ctx));
    else box.append(unavailableProvenance(p, ctx));
    const sourceBlock = sourceEstimateProvenance(p.quarter, ctx);
    if (sourceBlock) box.append(sourceBlock);
    return box;
  }
  function sourceEstimateProvenance(quarter, ctx) {
    const rows = ctx.view.sourceEstimates.filter(e => e.quarter === quarter);
    if (!rows.length) return null;
    const d = el('div', null, 'tr-provenance tr-source-provenance');
    d.append(el('h4', `발행사 출처 추정·전망 (${rows.length}건)`), el('p', '아래 값은 발행사가 해당 빈티지에 공개한 추정(e)·전망(f)입니다. 실측·자체 모델·모델 검증 정답에 포함하지 않으며, 같은 분기의 다른 기준값과 변화율을 계산하지 않습니다.', 'tr-warn'));
    const ul = el('ul', null, 'tr-anchors');
    for (const e of rows) {
      const li = el('li'), link = source(e);
      li.append(link, el('span', ` · ${e.flag === 'f' ? '전망 (f)' : '추정 (e)'} · ${e.level.label}${e.publisher ? ' · ' + e.publisher : ''}${e.vintage ? ' · ' + e.vintage + ' 판' : ''}${e.specification ? ' · ' + e.specification : ''}${e.locator ? ' · 위치 ' + e.locator : ''}`));
      ul.append(li);
    }
    d.append(ul);
    return d;
  }
  function actualProvenance(p, ctx) {
    const d = el('div', null, 'tr-provenance'), line = el('p'); line.append(source(p));
    const meta = [p.publisher, p.original_date && `원문 일자 ${p.original_date}`, p.locator && `위치 ${p.locator}`, p.evidence_tier && `근거 등급 ${p.evidence_tier}`, p.scope && `범위 ${p.scope}`, p.comparison_key && `비교 키 ${p.comparison_key}`].filter(Boolean).join(' · ');
    d.append(line, el('p', meta, 'tr-muted'));
    if (typeof p.narrative_ko === 'string' && p.narrative_ko) d.append(el('p', p.narrative_ko));
    if (p.approximate) d.append(el('p', '근사값으로 보고된 수치입니다.', 'tr-muted'));
    if (p.scope_break) d.append(el('p', '제품 범위가 바뀐 분기입니다. 이전 구간과 연결하지 않으며 전분기 대비·지수를 산출하지 않습니다.', 'tr-muted'));
    if (p.source_change) d.append(el('p', '출처가 바뀐 분기입니다 (실측이며 점선이 아닌 ▢ 표식으로 구분).', 'tr-muted'));
    if (isPartial(p, ctx.current)) d.append(el('p', `현재 분기(${ctx.current})는 기준일 ${proj.data.as_of} 기준 미완료입니다. 이 값은 분기 내 관측 중 선택된 대표값이며 분기 종료 후 확정값이 아닙니다.`, 'tr-warn'));
    return add(d, candidates(p, ctx.t));
  }
  function modelProvenance(p, ctx) {
    const m = p.model, b = basisOf(p), d = el('div', null, 'tr-provenance');
    d.append(el('h4', b.kind === 'source' ? `출처 ${b.flag === 'f' ? '전망 (f)' : '추정 (e)'} · 발행사 공개 수치` : `자체 모델 추정 · ${m.method_label_ko}`));
    if (b.kind === 'source') d.append(el('p', `${b.publisher ? b.publisher + '이(가) ' : '발행사가 '}공개한 ${b.flag === 'f' ? '전망' : '추정'} 값입니다${b.vintage ? ` (${b.vintage} 판)` : ''}. 실측이 아니며 자체 모델 산출값도 아닙니다. 관측 수·모델 정확도 계산에 포함하지 않습니다.`, 'tr-warn'));
    else d.append(el('p', '자체 모델이 실측 앵커로부터 산출한 값입니다. 출처가 보고한 수치가 아닙니다.', 'tr-muted'));
    d.append(el('p', m.explanation_ko));
    if (b.kind === 'model' && isStale(m)) d.append(el('p', `주의: ${ageText(m)}. 오래되었거나 단일 앵커 기반 추정이므로 권위 있는 최신 값이 아닙니다.`, 'tr-warn'));
    if (p.level.upper_open || metric(p, 'level').kind === 'lower_only') d.append(el('p', '경계 조건부 시나리오: 상한이 열린 앵커를 그대로 유지하며 정확한 값·상한·변화율을 만들지 않습니다.', 'tr-warn'));
    const dl = el('dl', null, 'tr-params'), row = (k, v) => dl.append(el('dt', k), el('dd', v));
    row('방법', `${m.method} (${m.method_label_ko})`); row('신뢰도', m.confidence_label_ko);
    row('마지막 실측', m.last_actual_quarter ?? '—'); row('실측 경과', finite(m.quarters_since_actual) ? `${m.quarters_since_actual}분기` : '—');
    row('앵커 분기', m.anchor_quarters.length ? m.anchor_quarters.join(', ') : '—'); row('앵커 ID', m.anchor_ids.length ? m.anchor_ids.join(', ') : '—');
    if (m.sensitivity) row(m.sensitivity.label_ko || '민감도', finite(m.sensitivity.lower) && finite(m.sensitivity.upper) ? `${num(m.sensitivity.lower)}~${num(m.sensitivity.upper)} ${unitKo(ctx.t.unit)} (가정 기반 범위, 검증된 신뢰구간 아님)` : '—');
    d.append(dl);
    if (typeof m.formula === 'string' && m.formula) d.append(el('pre', m.formula, 'tr-formula'));
    const params = Object.entries(m.parameters);
    if (params.length) { const pl = el('dl', null, 'tr-params'); for (const [k, v] of params) pl.append(el('dt', k), el('dd', fmtParam(v))); const det = el('details'); det.append(el('summary', `파라미터·수식 (${params.length})`), pl); d.append(det); }
    if (m.anchor_sources.length) {
      const ul = el('ul', null, 'tr-anchors');
      for (const a of m.anchor_sources) { const li = el('li'), href = safeHref(a.url), link = el(href ? 'a' : 'span', a.title || a.id); if (href) { link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; } li.append(link, el('span', ` · ${a.quarter} · ${anchorValue(a)}`)); ul.append(li); }
      const det = el('details'); det.append(el('summary', `앵커 출처 (${m.anchor_sources.length})`), ul); d.append(det);
    } else d.append(el('p', '앵커 출처 없음', 'tr-muted'));
    if (m.limitations_ko.length) { const ul = el('ul'); m.limitations_ko.forEach(s => ul.append(el('li', s))); const det = el('details'); det.append(el('summary', `한계·가정 (${m.limitations_ko.length})`), ul); d.append(det); }
    if (b.kind === 'model') d.append(el('p', `백테스트: ${backtestText(ctx.layer.pt.backtest)}`, 'tr-muted'));
    return d;
  }
  function unavailableProvenance(p, ctx) {
    const d = el('div', null, 'tr-provenance');
    d.append(el('p', p.selection_note || '이 분기에는 대표값이 없습니다.'));
    if (p.status === 'unavailable' && p.model && typeof p.model === 'object') { const why = [p.model.reason_ko, p.model.reason, p.model.explanation_ko].find(v => typeof v === 'string' && v); if (why) d.append(el('p', `추정 산출 불가 사유: ${why}`, 'tr-warn')); }
    if (p.selection_status === 'ambiguous') d.append(el('p', '실측 후보가 복수여서 대표값을 자동 선택하지 않았습니다. 추정도 이 분기를 대체하지 않습니다.', 'tr-warn'));
    if (p.observation_ids.length) d.append(candidates(p, ctx.t));
    return d;
  }
  // ---- CSV export. Actual CSV semantics unchanged (actual quarterly points only); modeled CSV is a separate labeled file. ----
  const METRIC_COLS = key => key === 'index' ? ['exact','lower','upper'] : ['exact_pct','lower_pct','upper_pct'];
  const metricCells = p => ['change','yoy','index'].flatMap(k => [p[k].kind, ...METRIC_COLS(k).map(f => p[k][f]), p[k].label]);
  const metricHead = ['change','yoy','index'].flatMap(k => [`${k}_kind`, ...METRIC_COLS(k).map(f => `${k}_${f}`), `${k}_label`]);
  function csv(rows) { return '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'; }
  function actualCSV(t) {
    const head = ['track_id','track_label','unit','quarter','selection_status','has_observation','observation_count','observation_ids','level_label','level_lower','level_upper','level_qualifier','upper_open', ...metricHead, 'source_change','scope_break','connect_previous','original_date','publisher','source_title','source_url','locator','evidence_tier','scope','comparison_key','selection_note'];
    const rows = t.quarterly_points.map(p => [t.id, t.label, t.unit, p.quarter, p.selection_status, p.has_observation, p.observation_count, p.observation_ids.join('|'), p.level.label, p.level.lower, p.level.upper, p.level.qualifier ?? null, !!p.level.upper_open, ...metricCells(p), p.source_change, p.scope_break, p.connect_previous, p.original_date ?? null, p.publisher ?? null, p.source_title ?? null, p.source_url ?? null, p.locator ?? null, p.evidence_tier ?? null, p.scope ?? null, p.comparison_key ?? null, p.selection_note]);
    return csv([head, ...rows]);
  }
  function modelCSV(t, pt) {
    const d = proj.data;
    const head = ['layer','track_id','track_label','unit','model_version','as_of','current_quarter','horizon_quarters','quarter','status','status_ko','basis','is_estimate','selection_status','has_observation','observation_count','observation_ids','level_label','level_lower','level_upper','level_qualifier','upper_open', ...metricHead, 'change_is_estimate','yoy_is_estimate','index_is_estimate','method','method_label_ko','publisher_flag','publisher','vintage','anchor_ids','anchor_quarters','last_actual_quarter','quarters_since_actual','confidence_label_ko','sensitivity_lower','sensitivity_upper','sensitivity_label_ko','parameters','source_change','scope_break','connect_previous','original_date','publisher_actual','source_url','selection_note'];
    const rows = pt.points.map(p => {
      const m = modelOf(p), b = basisOf(p), key = basisKey(p);
      return ['model', t.id, t.label, t.unit, d.model_version, d.as_of, d.current_quarter, d.horizon_quarters, p.quarter, p.status, statusText(p, d.current_quarter), key ? BASIS_KO[key] : '없음', p.is_estimate, p.selection_status, p.has_observation, p.observation_count, p.observation_ids.join('|'), p.level.label, p.level.lower, p.level.upper, p.level.qualifier ?? null, !!p.level.upper_open, ...metricCells(p), !!p.change.is_estimate, !!p.yoy.is_estimate, !!p.index.is_estimate, m ? m.method : null, m ? m.method_label_ko : null, b ? b.flag : null, b ? b.publisher : null, b ? b.vintage : null, m ? m.anchor_ids.join('|') : null, m ? m.anchor_quarters.join('|') : null, m ? m.last_actual_quarter : null, m ? m.quarters_since_actual : null, m ? m.confidence_label_ko : null, m?.sensitivity ? m.sensitivity.lower : null, m?.sensitivity ? m.sensitivity.upper : null, m?.sensitivity ? m.sensitivity.label_ko : null, m ? JSON.stringify(m.parameters) : null, p.source_change, p.scope_break, p.connect_previous, p.original_date ?? null, p.publisher ?? null, p.source_url ?? null, p.selection_note];
    });
    return csv([head, ...rows]);
  }
  function sourceCSV(t, pt) {
    const head = ['layer','track_id','track_label','unit','quarter','publisher_flag','publisher','vintage','source_published_at','temporal_role','level_label','level_lower','level_upper','qualifier','specification','region','source_id','source_url','locator','is_observation','counted_in_observations','used_as_model_truth','note_ko'];
    const rows = (pt.source_estimates || []).map(e => ['publisher_source_estimate',t.id,t.label,t.unit,e.quarter,e.flag,e.publisher,e.vintage,e.source_published_at,e.temporal_role,e.level.label,e.level.lower,e.level.upper,e.level.qualifier,e.specification,e.region,e.source_id,e.source_url,e.locator,e.is_observation,e.counted_in_observations,e.used_as_model_truth,e.note_ko]);
    return csv([head, ...rows]);
  }
  function download(name, text) {
    const blob = new Blob([text], {type:'text/csv;charset=utf-8'}), href = URL.createObjectURL(blob), a = el('a'); a.href = href; a.download = name; a.style.display = 'none';
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  }
  function actions(ctx) {
    const {t, layer} = ctx, wrap = el('div', null, 'tr-actions');
    const raw = button('실측 분기 CSV 내려받기', () => download(`leadtime-quarterly-${t.id}.csv`, actualCSV(t))); raw.dataset.focus = 'csv:actual'; wrap.append(raw);
    if (layer.pt) {
      const b = button('추정 포함 CSV 내려받기 (모델 레이어 · 실측 원장 아님)', () => download(`leadtime-model-${t.id}-${proj.data.as_of}.csv`, modelCSV(t, layer.pt))); b.classList.add('tr-action-model'); b.dataset.focus = 'csv:model'; wrap.append(b);
      if (layer.pt.source_estimates?.length) { const src = button('발행사 추정·전망 CSV 내려받기 (별도 근거)', () => download(`leadtime-publisher-estimates-${t.id}-${proj.data.as_of}.csv`, sourceCSV(t, layer.pt))); src.classList.add('tr-action-model'); src.dataset.focus = 'csv:source'; wrap.append(src); }
    }
    wrap.append(el('span', '실측 CSV는 추정을 포함하지 않습니다. 모델·발행사 출처 CSV는 각각 별도 파일이며, 상태·기준·방법·빈티지를 보존합니다.', 'tr-muted'));
    return wrap;
  }
  // ---- Table ----
  function table(ctx) {
    const {view, t} = ctx, wrap = el('div', null, 'tr-table-wrap'), tb = el('table');
    tb.append(el('caption', `${t.label} · 분기별 ${view.overlay ? '실측+추정' : '실측'} 표 (${view.points[0]?.quarter ?? '—'}~${view.points.at(-1)?.quarter ?? '—'}) · 단위 ${unitKo(t.unit)}`));
    const thead = el('thead'), hr = el('tr');
    for (const h of ['분기','상태','수준','전분기 대비','전년 동기 대비','지수','근거']) { const th = el('th', h); th.scope = 'col'; hr.append(th); }
    thead.append(hr);
    const tbody = el('tbody');
    for (const p of view.points) {
      const row = el('tr'), tn = tone(p);
      if (p.is_estimate) row.classList.add('tr-row-est', 'tr-row-' + tn);
      row.append(el('td', p.quarter));
      const st = el('td'); st.append(badgesFor(p, ctx, 'level')); row.append(st);
      for (const m of ['level','change','yoy','index']) {
        const mv = metric(p, m), td = el('td');
        td.append(el('span', mv.available ? valueText(mv, m) : '—', mv.available ? directionClass(mv, m) : 'tr-neutral'));
        if (mv.available && mv.is_estimate && m !== 'level') td.append(' ', badge('추정 포함', tn === 'actual' ? 'fwd' : tn));
        row.append(td);
      }
      const ev = el('td');
      if (p.selection_status === 'latest') ev.append(source(p), el('span', ` · ${p.original_date}${p.publisher ? ' · ' + p.publisher : ''}`));
      else if (p.is_estimate) { const m = p.model, b = basisOf(p); ev.append(el('span', b.kind === 'source' ? `출처 ${b.flag === 'f' ? '전망 (f)' : '추정 (e)'}${b.publisher ? ' · ' + b.publisher : ''}${b.vintage ? ' · ' + b.vintage + ' 판' : ''}` : `${m.method_label_ko} · 앵커 ${m.anchor_quarters.join(', ') || '—'} · ${m.confidence_label_ko}`)); }
      else ev.append(el('span', p.selection_note || '—', 'tr-muted'));
      row.append(ev); tbody.append(row);
      for (const e of view.sourceEstimates.filter(x => x.quarter === p.quarter)) {
        const src = el('tr', null, 'tr-row-est tr-row-src');
        src.append(el('td', e.quarter), el('td', `출처 ${e.flag === 'f' ? '전망 (f)' : '추정 (e)'} · 별도 기준`), el('td', e.level.label), el('td', '—'), el('td', '—'), el('td', '—'));
        const sourceCell = el('td'); sourceCell.append(source(e), el('span', ` · ${e.publisher || '발행사 미기재'}${e.vintage ? ' · ' + e.vintage + ' 판' : ''}${e.specification ? ' · ' + e.specification : ''}`)); src.append(sourceCell); tbody.append(src);
      }
    }
    tb.append(thead, tbody);
    return add(wrap, tb);
  }
  // ---- Methodology ----
  function methodology(ctx) {
    const det = el('details'); det.append(el('summary', '산출 방법 · 데이터 출처 설명'));
    det.append(el('h4', '실측 분기 대표값'), el('p', ctx.t.quarterly_methodology_ko));
    if (ctx.layer.pt) {
      det.append(el('h4', `추정 레이어 (모델 ${proj.data.model_version} · 기준일 ${proj.data.as_of} · 현재 분기 ${proj.data.current_quarter})`), el('p', proj.data.methodology_ko), el('p', ctx.layer.pt.methodology_ko));
      det.append(el('p', `백테스트: ${backtestText(ctx.layer.pt.backtest)}`, 'tr-muted'));
      det.append(el('p', '실선은 실측, 점선은 추정·전망입니다. 자체 모델 값은 실측 앵커로부터 산출되며, 출처 추정 (e)·전망 (f)은 발행사가 공개한 수치입니다. 어느 쪽도 관측 수·실측 CSV에 포함되지 않습니다.', 'tr-muted'));
      const cfg = el('details'); cfg.append(el('summary', '모델 설정 (config)'), el('pre', JSON.stringify(proj.data.config, null, 2), 'tr-formula')); det.append(cfg);
    } else det.append(el('h4', '추정 레이어'), el('p', ctx.layer.note || projStatus.message, 'tr-muted'));
    return det;
  }
  loadActual();
})();
