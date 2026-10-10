(() => {
  'use strict';
  const scriptURL = document.currentScript && document.currentScript.src;
  const mount = document.getElementById('inventory-root');
  if (!mount) return;
  const SVG = 'http://www.w3.org/2000/svg';
  const metrics = {
    reported_wos: '직접 보고 · 제품 재고 주수 (WOS)',
    reported_dio_weeks: '기업 전체 보고 DIO ÷ 7 · 재무 회전기간',
    financial_dio_proxy: '계산된 재무 DIO 대용치 · 제품 재고 주수 아님'
  };
  const qualifiers = { exact: '보고값', range: '보고 범위', about: '약', at_least: '이상', more_than: '초과', less_than: '미만', at_most: '이하' };
  const conversions = {
    identity: '원문 주수 그대로',
    days_div_7: '원문 일수 ÷ 7',
    average_inventory_cogs_period_days_div_7: '평균재고 ÷ 분기 매출원가 × 실제 분기 일수 ÷ 7'
  };
  // Model layer (projections.json) vocabulary. Actual ledger data never passes through these.
  const STATUSES = ['observed', 'historical_estimate', 'nowcast', 'forecast', 'unavailable'];
  const ESTIMATE_STATUSES = ['historical_estimate', 'nowcast', 'forecast'];
  const statusLabels = { observed: '실측', historical_estimate: '과거 공백 추정', nowcast: '현재 분기 추정', forecast: '전망', unavailable: '추정 불가', missing: '모델 레이어 없음' };
  const statusClasses = { historical_estimate: 'iv-st-hist', nowcast: 'iv-st-now', forecast: 'iv-st-fc' };
  let data, chosen = '', query = '';
  // Projection state. The actual-only dashboard never depends on these values.
  let projections = null;
  let projectionStatus = { state: 'idle', message: '' };
  let overlay = 'estimate';
  const seriesChoice = new Map();
  let refreshSelected = () => {};
  let updateEstimateBar = () => {};
  const fmt = n => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(n);
  const fmt1 = n => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(n);
  const fmt4 = n => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 4 }).format(n);
  const safeURL = value => {
    try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; }
  };
  function el(tag, text, cls) {
    const n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = String(text);
    if (cls) n.className = cls;
    return n;
  }
  function svg(tag, attrs, text) {
    const n = document.createElementNS(SVG, tag);
    Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, String(v)));
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function link(source) {
    const url = safeURL(source.url);
    if (!url) return el('span', `${source.publisher} · ${source.title} (유효한 원문 URL 없음)`);
    const a = el('a', `${source.publisher} · ${source.title}`);
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    return a;
  }
  function companywide(s) { return s.scope_level === 'company'; }
  function metricLabel(s) {
    if(s.metric === 'reported_dio_weeks' && !companywide(s)) return '제품별 보고 재고일수 ÷ 7 · 공급가능 주수와 구분';
    return metrics[s.metric];
  }
  function periodLabel(o,s) { return (s.calendar === 'fiscal' ? 'FY ' : '') + o.quarter + (String(o.period_label).includes('초') ? ' 초' : ''); }
  function bound(o, raw = false) {
    const lo = raw ? o.raw_value_min : o.value_min, hi = raw ? o.raw_value_max : o.value_max;
    const unit = raw && o.raw_unit === 'days' ? '일' : '주';
    const prefix = {at_least:'≥ ',more_than:'> ',less_than:'< ',at_most:'≤ ',about:'약 '}[o.qualifier] || (o.approximate ? '약 ' : '');
    const range = hi !== null && hi !== undefined && hi !== lo ? `${fmt(lo)}–${fmt(hi)}${o.upper_open ? '+' : ''}` : fmt(lo);
    return `${prefix}${range} ${unit}`;
  }
  function rawLabel(s) { return s.metric === 'financial_dio_proxy' ? '계산 재고일수' : '원문'; }
  // Ordinal quarters preserve fiscal labels and give missing quarters real space.
  function quarterPosition(o) {
    const [year, q] = o.quarter.split('-Q').map(Number);
    return year * 4 + q - 1;
  }
  function quarterAt(position) { return `${Math.floor(position / 4)}-Q${position % 4 + 1}`; }
  function timing(o, s) {
    const explicit = o.observation_timing || s.observation_timing;
    if (explicit) return String(explicit);
    const label = String(o.period_label || ''), text = String(o.narrative_ko || '');
    if (/초/.test(label) || /분기\s*초/.test(text)) return 'quarter_start';
    if (s.metric === 'financial_dio_proxy') return 'quarter_calculation';
    if (o.as_of && o.period_end && o.as_of === o.period_end) return 'quarter_end';
    // Match an affirmative source statement, never the phrase "분기말 여부 미명시".
    if (/분기\s*말 기준|\dQ\d{2}말로 설명/.test(text)) return 'quarter_end';
    if (/분기 중/.test(label + ' ' + text)) return 'within_quarter';
    return 'quarter_reported';
  }
  function timingLabel(o, s) {
    return { quarter_start: '분기 초', quarter_end: '분기말', within_quarter: '분기 중 조사', quarter_calculation: '분기 재무 계산', quarter_reported: '분기 보고 · 측정시점 미확인' }[timing(o, s)] || `관측 기준: ${timing(o, s)}`;
  }
  function pointValue(o) { return ['exact', 'range', 'about'].includes(o.qualifier); }
  function closedUpper(o) { return o.upper_open ? null : (o.value_max === null ? o.value_min : o.value_max); }
  function quarterly(obs, s) {
    const groups = new Map();
    obs.forEach(o => { const q = quarterPosition(o); if (!groups.has(q)) groups.set(q, []); groups.get(q).push(o); });
    const first = Math.min(...groups.keys()), last = Math.max(...groups.keys()), rows = [];
    for (let pos = first; pos <= last; pos++) {
      const items = groups.get(pos) || [], previous = groups.get(pos - 1) || [];
      const row = { quarter: quarterAt(pos), position: pos, items, change: null, comparable: false, reason: '' };
      if (!items.length) row.reason = '공개 관측 없음';
      else if (items.length > 1) row.reason = '동일 분기 복수 관측 · 비교값 미선택';
      else if (previous.length !== 1) row.reason = previous.length ? '전분기 복수 관측 · 비교값 미선택' : '직전 분기 자료 없음';
      else {
        const o = items[0], p = previous[0];
        const pub = id => data.sources.find(source => source.id === id)?.publisher || '';
        const basis = v => [timing(v, s), v.conversion, v.raw_unit, v.measure_type || 'reported', v.reported_metric_label || ''].join('|');
        if (o.series_id !== p.series_id || basis(o) !== basis(p)) row.reason = '측정 기준 변경 · 전분기 비교 중단';
        else if (pub(o.source_id) !== pub(p.source_id)) row.reason = '출처 변경 · 전분기 비교 중단';
        else if (!pointValue(o) || !pointValue(p)) row.reason = '미만·이상 경계값 · 변화율 미계산';
        else {
          row.comparable = true;
          const upper = closedUpper(o), previousUpper = closedUpper(p);
          const lowerPct = p.value_min === 0 ? null : (o.value_min / p.value_min - 1) * 100;
          const upperPct = upper === null || previousUpper === null || previousUpper === 0 ? null : (upper / previousUpper - 1) * 100;
          const single = upper === o.value_min && previousUpper === p.value_min;
          row.change = { lowerPct, upperPct, lowerDelta: o.value_min - p.value_min, upperDelta: upper === null || previousUpper === null ? null : upper - previousUpper, single, previous: p, reference: timing(o, s) === 'quarter_reported', approximate: !!(o.approximate || p.approximate || o.qualifier === 'about' || p.qualifier === 'about') };
          if (lowerPct === null && upperPct === null) row.reason = '전분기 0 또는 열린 경계 · 변화율 미계산';
        }
      }
      rows.push(row);
    }
    return rows;
  }
  function signed(value, unit = '%') {
    if (value === null || !Number.isFinite(value)) return '—';
    const rounded = Math.abs(value) < 0.0000001 ? 0 : value;
    return `${rounded > 0 ? '+' : ''}${fmt(rounded)}${unit}`;
  }
  function changeText(row, delta = false) {
    const c = row.change;
    if (!c) return '비교 불가';
    const lo = delta ? c.lowerDelta : c.lowerPct, hi = delta ? c.upperDelta : c.upperPct, unit = delta ? '주' : '%';
    if (lo === null && hi === null) return '비교 불가';
    if (c.single) return signed(lo, unit);
    return `하단 ${signed(lo, unit)} · 상단 ${signed(hi, unit)}`;
  }
  function changeDetails(row, s) {
    const box = el('div', null, 'iv-comparison');
    box.append(el('strong', row.change ? `전분기 대비 ${changeText(row)}` : row.reason));
    if (row.change) {
      box.append(el('p', `${periodLabel(row.change.previous, s)} → ${periodLabel(row.items[0], s)} · 증감 ${changeText(row, true)}`));
      if (row.change.reference) box.append(el('p', '분기 보고값 참고 비교 · 정확한 측정시점은 미확인'));
      if (row.change.approximate) box.append(el('p', '원문의 근삿값을 포함한 변화율'));
      if (!row.change.single) box.append(el('p', '하단끼리 · 상단끼리 계산합니다. 두 변화율은 하나의 최솟값~최댓값 범위가 아닙니다.'));
    }
    return box;
  }
  function isDate(x) {
    if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
    const date = new Date(x + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === x;
  }
  function validate(d) {
    if (!d || d.schema_version !== 1 || !['products', 'sources', 'series', 'observations', 'coverage'].every(k => Array.isArray(d[k]))) throw new Error('지원하지 않는 데이터 구조입니다.');
    const ids = key => {
      const a = d[key].map(x => x.id);
      if (a.some(x => typeof x !== 'string' || !x) || new Set(a).size !== a.length) throw new Error(`${key}: 식별자가 올바르지 않습니다.`);
      return new Set(a);
    };
    const products = ids('products'), sources = ids('sources'), series = ids('series'); ids('observations');
    const validDate = x => {
      if (x === null) return true;
      if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x)) return false;
      const date = new Date(x + 'T00:00:00Z');
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === x;
    };
    if (!validDate(d.updated_at) || !d.updated_at) throw new Error('갱신일이 올바르지 않습니다.');
    d.series.forEach(s => {
      if (!products.has(s.product_id) || !['manufacturer', 'customer', 'channel'].includes(s.role) || !Object.hasOwn(metrics, s.metric) || typeof s.scope !== 'string') throw new Error('시리즈 분류가 올바르지 않습니다.');
    });
    d.observations.forEach(o => {
      if (!series.has(o.series_id) || !sources.has(o.source_id) || !/^\d{4}-Q[1-4]$/.test(o.quarter) || !Object.hasOwn(qualifiers, o.qualifier) || !Object.hasOwn(conversions, o.conversion) || !['days', 'weeks'].includes(o.raw_unit)) throw new Error('관측치 연결 또는 분류가 올바르지 않습니다.');
      for (const [lo, hi] of [[o.value_min, o.value_max], [o.raw_value_min, o.raw_value_max]]) {
        if (!Number.isFinite(lo) || lo < 0 || !(hi === null || (Number.isFinite(hi) && hi >= lo))) throw new Error('관측치 범위가 올바르지 않습니다.');
      }
      if (o.qualifier === 'range' && o.value_max === null) throw new Error('범위 상한이 없습니다.');
      if (![o.period_start, o.period_end, o.as_of].every(validDate) || (o.period_start && o.period_end && o.period_start > o.period_end)) throw new Error('관측 기간이 올바르지 않습니다.');
    });
    return d;
  }
  function evidence(o, s) {
    const box = el('div', null, 'iv-evidence');
    box.append(el('h4', `${o.quarter} · ${o.period_label || '기간 명칭 미제공'}`), el('p', bound(o), 'iv-value'));
    box.append(el('p', `계열: ${s.name} · ${s.entity}`), el('p', `${metricLabel(s)} · 범위: ${s.scope}`));
    box.append(el('p', timingLabel(o,s), 'iv-timing'));
    box.append(el('p', `기간 시작: ${o.period_start || '미제공'} / 종료: ${o.period_end || '미제공'} / 관측 기준일 (as_of): ${o.as_of || '미제공'}`));
    box.append(el('p', `${rawLabel(s)}: ${bound(o, true)} → ${bound(o)} · ${conversions[o.conversion]}`));
    box.append(el('p', o.narrative_ko), el('p', s.method_ko));
    if (o.inputs) {
      const i=o.inputs, inputs=el('details');inputs.append(el('summary','계산 근거와 원문'));
      inputs.append(el('p',`기초 재고 ${fmt(i.inventory_begin)} · 기말 재고 ${fmt(i.inventory_end)} · 분기 매출원가 ${fmt(i.cogs)} (${i.unit})`),el('p',`기간 ${i.period_days}일 · 연결 재무제표 · 기초일 ${i.inventory_begin_date}`));
      if(i.cogs_formula) inputs.append(el('p',`4분기 매출원가 = 연간 − 9개월 누적: ${i.cogs_formula}`));
      (o.source_ids || []).forEach(id=>{const supporting=data.sources.find(v=>v.id===id);if(supporting) inputs.append(el('p',supporting.published_at),link(supporting));});box.append(inputs);
    }
    const source = data.sources.find(x => x.id === o.source_id);
    box.append(link(source), el('p', `발행일: ${source.published_at || '미제공'} · 위치: ${o.locator || source.locator || '미제공'} · 관측 ID: ${o.id}`));
    return box;
  }
  function graph(rows, s, detail, mode, scale) {
    const wrap = el('div', null, 'iv-chart'), width = Math.max(560, rows.length * 68 + 90), height = 300;
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'group', 'aria-label': `${s.name} · ${mode === 'level' ? '분기 재고 주수' : '전분기 대비 변화율'} · 누락 분기는 공백` });
    chart.style.width = `${width}px`;
    chart.append(svg('title', {}, `${s.name}: 분기별 ${mode === 'level' ? '재고 주수와 보고 범위' : '변화율'}`));
    const left = 58, right = width - 28, top = 28, bottom = 230;
    const step = (right - left) / rows.length, x = i => left + step * (i + .5);
    const values = mode === 'level' ? rows.flatMap(r => r.items.flatMap(o => [o.value_min, o.value_max ?? o.value_min])) : rows.flatMap(r => r.change ? [r.change.lowerPct, r.change.upperPct].filter(v => v !== null) : []);
    const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 1;
    let low, high;
    if (mode === 'change') { const extent = Math.max(5, Math.abs(min), Math.abs(max)) * 1.15; low = -extent; high = extent; }
    else { const padding = Math.max(1, (max - min) * .2); low = scale === 'focus' ? Math.max(0, min - padding) : 0; high = max + padding; }
    const y = v => bottom - (v - low) / (high - low) * (bottom - top);
    const count = rows.filter(r => r.items.length).length;
    [0, 1, 2, 3, 4].forEach(i => {
      const value = low + (high - low) * i / 4;
      chart.append(svg('line', { x1: left, x2: right, y1: y(value), y2: y(value), class: mode === 'change' && i === 2 ? 'iv-zero' : 'iv-grid' }), svg('text', { x: left - 9, y: y(value) + 4, 'text-anchor': 'end', class: 'iv-axis' }, fmt(value)));
    });
    chart.append(svg('text', { x: left, y: 15, class: 'iv-axis' }, mode === 'change' ? '전분기 대비 % · 증가 / 감소' : `${s.metric === 'financial_dio_proxy' ? '재무 계산값' : '재고'} (주)`));
    rows.forEach((row, i) => {
      if (!row.items.length) {
        chart.append(svg('rect', { x: x(i) - step * .38, y: top, width: step * .76, height: bottom - top, rx: 5, class: 'iv-gap' }));
        chart.append(svg('text', { x: x(i), y: top + 18, 'text-anchor': 'middle', class: 'iv-axis iv-gap-label' }, '자료 없음'));
      }
      const firstOfYear = row.quarter.endsWith('Q1') || i === 0;
      chart.append(svg('text', { x: x(i), y: 253, 'text-anchor': 'middle', class: 'iv-axis' }, row.quarter.split('-')[1]));
      if (firstOfYear) chart.append(svg('text', { x: x(i), y: 275, 'text-anchor': 'middle', class: 'iv-year' }, `${s.calendar === 'fiscal' ? 'FY ' : ''}${row.quarter.slice(0, 4)}`));
      if (mode === 'level' && i && row.comparable) {
        const a = rows[i - 1].items[0], b = row.items[0];
        const upperA = closedUpper(a), upperB = closedUpper(b);
        if (upperA !== null && upperB !== null) chart.append(svg('path', { d: `M ${x(i-1)} ${y(a.value_min)} L ${x(i)} ${y(b.value_min)} L ${x(i)} ${y(upperB)} L ${x(i-1)} ${y(upperA)} Z`, class: 'iv-band' }));
        chart.append(svg('line', { x1: x(i-1), x2: x(i), y1: y(a.value_min), y2: y(b.value_min), class: 'iv-trend' }));
        if (upperA !== null && upperB !== null && (upperA !== a.value_min || upperB !== b.value_min)) chart.append(svg('line', { x1: x(i-1), x2: x(i), y1: y(upperA), y2: y(upperB), class: 'iv-trend iv-upper-line' }));
      }
    });
    rows.forEach((row, i) => {
      const show = o => {
        detail.replaceChildren();
        const headline = el('div', null, 'iv-point-head');
        headline.append(el('strong', `${periodLabel(o, s)} · ${bound(o)}`), el('span', timingLabel(o, s), 'iv-caption'));
        detail.append(headline, changeDetails(row, s));
        const raw = el('details'); raw.append(el('summary', '원문·계산 근거 보기'), evidence(o, s)); detail.append(raw);
        chart.querySelectorAll('.iv-mark').forEach(mark => mark.classList.toggle('iv-active', mark.dataset.observation === o.id));
      };
      if (!row.items.length) return;
      if (mode === 'change' && (!row.change || (row.change.lowerPct === null && row.change.upperPct === null))) {
        chart.append(svg('text', { x: x(i), y: y(0) - 8, 'text-anchor': 'middle', class: 'iv-axis' }, '—'));
      }
      row.items.forEach((o, j) => {
        const px = x(i) + (j - (row.items.length - 1) / 2) * 12;
        const g = svg('g', { tabindex: '0', role: 'button', 'aria-label': `${periodLabel(o,s)}, ${bound(o)}, ${mode === 'change' ? changeText(row) : timingLabel(o,s)}. 상세 및 출처 보기`, class: 'iv-mark', 'data-observation': o.id });
        g.append(svg('title', {}, `${periodLabel(o,s)} · ${bound(o)} · ${row.change ? changeText(row) : row.reason} · ${timingLabel(o,s)}`));
        g.append(svg('rect', { x: px - 21, y: top - 6, width: 42, height: bottom - top + 14, rx: 5, class: 'iv-hit' }));
        if (mode === 'level') {
          const ly = y(o.value_min), uy = y(o.value_max ?? o.value_min), upper = o.value_max;
          if (upper !== null && upper !== o.value_min) {
            g.append(svg('line', { x1: px, x2: px, y1: ly, y2: uy, class: 'iv-whisker' }));
            g.append(svg('circle', { cx: px, cy: uy, r: 4, class: o.upper_open ? 'iv-open' : 'iv-dot iv-upper-dot' }));
          }
          g.append(svg('circle', { cx: px, cy: ly, r: 4.5, class: !pointValue(o) || o.qualifier === 'about' ? 'iv-open' : 'iv-dot' }));
          const symbol = { at_least: '≥', more_than: '>', less_than: '<', at_most: '≤', about: '≈' }[o.qualifier];
          if (symbol) g.append(svg('text', { x: px + 7, y: ly - 7, class: 'iv-bound' }, symbol));
          if (o.upper_open) g.append(svg('text', { x: px + 7, y: uy - 6, class: 'iv-bound' }, '+'));
          if (i === rows.length - 1) g.append(svg('text', { x: px, y: Math.min(ly, uy) - 13, 'text-anchor': 'middle', class: 'iv-last-label' }, bound(o)));
        } else if (row.change) {
          const entries = row.change.single ? [['값', row.change.lowerPct]] : [['하단', row.change.lowerPct], ['상단', row.change.upperPct]];
          entries.forEach(([endpoint, value], k) => {
            if (value === null) return;
            const bx = px + (entries.length === 1 ? -9 : k === 0 ? -17 : 2), yy = y(value), zero = y(0);
            const bar = svg('rect', { x: bx, y: value === 0 ? zero - 1 : Math.min(yy, zero), width: entries.length === 1 ? 18 : 14, height: Math.max(2, Math.abs(yy - zero)), rx: 2, class: `iv-bar ${value === 0 ? 'iv-unchanged' : value > 0 ? 'iv-rise' : 'iv-fall'}${k === 1 ? ' iv-upper-bar' : ''}` });
            bar.append(svg('title', {}, `${endpoint} ${signed(value)}`)); g.append(bar);
          });
        }
        g.addEventListener('mouseenter', () => show(o)); g.addEventListener('focus', () => show(o)); g.addEventListener('click', () => show(o));
        g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(o); } });
        chart.append(g);
      });
    });
    const scroll = el('div', null, 'iv-plot-scroll'); scroll.setAttribute('tabindex', '0'); scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', '분기 그래프 · 모든 분기를 순서대로 표시 · 좌우 이동 가능'); scroll.append(chart);
    const legend = el('div', null, 'iv-legend');
    if (mode === 'level') legend.append(el('span', '● 하단 / 단일값', 'iv-legend-lower'), el('span', '● 상단 · 음영은 보고 범위', 'iv-legend-upper'));
    else legend.append(el('span', '▮ 증가', 'iv-legend-rise'), el('span', '▮ 감소', 'iv-legend-fall'), el('span', '채움=하단 / 단일값 · 윤곽=상단', 'iv-caption'));
    wrap.append(scroll, legend, el('p', `${count}/${rows.length}개 분기 관측 · 누락 ${rows.length - count}분기 · ${s.calendar === 'fiscal' ? 'FY 회계분기' : '달력분기'}${mode === 'level' && scale === 'focus' ? ` · 변화 강조 축 ${fmt(low)}–${fmt(high)}주` : ''}`, 'iv-caption'));
    if (mode === 'change') wrap.append(el('p', '0선 위는 증가, 아래는 감소입니다. 재고 증감은 그 자체로 수급의 좋고 나쁨을 뜻하지 않습니다.', 'iv-caption'));
    return wrap;
  }
  function seriesDashboard(obs, s) {
    const rows = quarterly(obs, s), dashboard = el('div', null, 'iv-dashboard'), latest = rows.at(-1);
    const kpis = el('div', null, 'iv-kpis');
    const card = (label, value, note, cls = '') => { const n = el('div', null, `iv-kpi ${cls}`); n.append(el('span', label), el('strong', value), el('small', note)); return n; };
    kpis.append(card('최근 관측', latest.items.length === 1 ? bound(latest.items[0]) : `${latest.items.length}건`, `${s.calendar === 'fiscal' ? 'FY ' : ''}${latest.quarter}${latest.items.length === 1 ? ` · ${timingLabel(latest.items[0], s)}` : ' · 동일 분기 복수 관측'}`));
    const delta = latest.change && latest.change.single ? latest.change.lowerPct : null;
    kpis.append(card('최근 전분기 대비', changeText(latest), latest.change ? `증감 ${changeText(latest, true)}${latest.change.reference ? ' · 측정시점 미확인' : ''}` : latest.reason, delta === null ? '' : delta > 0 ? 'iv-kpi-rise' : delta < 0 ? 'iv-kpi-fall' : ''));
    kpis.append(card('분기 관측률', `${rows.filter(r => r.items.length).length} / ${rows.length}`, `${rows[0].quarter} → ${latest.quarter} · ${rows.filter(r => !r.items.length).length}개 분기 공백`));
    dashboard.append(kpis);
    const toolbar = el('div', null, 'iv-chart-tools'), modes = el('div', null, 'iv-mode'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '재고 그래프 표현');
    const levelButton = el('button', '재고 주수'), changeButton = el('button', '전분기 대비 %');
    levelButton.type = changeButton.type = 'button'; modes.append(levelButton, changeButton);
    const spanLabel = el('label', '표시 기간'), span = el('select'); span.setAttribute('aria-label', `${s.entity} 재고 표시 기간`);
    [['all', '전체 분기'], ['12', '최근 12분기']].forEach(([value, label]) => { const option = el('option', label); option.value = value; span.append(option); }); spanLabel.append(span);
    const scaleLabel = el('label', '세로축'), scaleSelect = el('select'); scaleSelect.setAttribute('aria-label', `${s.entity} 재고 세로축`);
    [['focus', '변화 강조'], ['zero', '0부터 보기']].forEach(([value, label]) => { const option = el('option', label); option.value = value; scaleSelect.append(option); }); scaleLabel.append(scaleSelect);
    toolbar.append(modes, spanLabel, scaleLabel); dashboard.append(toolbar);
    const plot = el('div'), detail = el('div', null, 'iv-detail'); detail.setAttribute('aria-live', 'polite');
    let mode = 'level';
    const draw = () => {
      levelButton.setAttribute('aria-pressed', String(mode === 'level')); changeButton.setAttribute('aria-pressed', String(mode === 'change')); scaleLabel.hidden = mode !== 'level';
      const visible = span.value === '12' ? rows.slice(-12) : rows;
      plot.replaceChildren(graph(visible, s, detail, mode, scaleSelect.value));
      requestAnimationFrame(() => { const scroll = plot.querySelector('.iv-plot-scroll'); if (scroll) scroll.scrollLeft = scroll.scrollWidth; });
      detail.replaceChildren();
      const o = latest.items.at(-1), head = el('div', null, 'iv-point-head'); head.append(el('strong', `${periodLabel(o,s)} · ${bound(o)}`), el('span', timingLabel(o,s), 'iv-caption'));
      detail.append(head, changeDetails(latest, s));
      const raw = el('details'); raw.append(el('summary', '원문·계산 근거 보기'), evidence(o,s)); detail.append(raw);
    };
    levelButton.addEventListener('click', () => { mode = 'level'; draw(); }); changeButton.addEventListener('click', () => { mode = 'change'; draw(); });
    span.addEventListener('change', draw); scaleSelect.addEventListener('change', draw);
    dashboard.append(plot, el('p', '그래프를 좌우로 이동해 전체 분기를 확인하세요. 관측점을 선택하면 해당 분기 값과 변화율, 원문 근거가 표시됩니다.', 'iv-caption'), detail);
    const notes = el('details', null, 'iv-chart-notes'); notes.append(el('summary', '분기 비교 방법'), el('p', '인접한 두 분기에 각각 한 관측이 있고 계열·출처·측정 기준이 같을 때만 연결하고 전분기 변화율을 계산합니다. 정확한 측정일이 미확인인 동일 분기 표는 참고 비교로 표시합니다. 분기 초/말 변경, 복수 관측, 누락 분기는 연결하지 않습니다. 범위 하단과 상단을 각각 계산하며 중간값·보간·누락값 대입은 하지 않습니다. 미만·이상 경계는 변화율을 계산하지 않으며 열린 상단은 상단 변화율을 비웁니다. 근삿값 여부와 FY 표기는 유지합니다.'));
    dashboard.append(notes);
    const rawTable = el('details', null, 'iv-raw-table'); rawTable.append(el('summary', `관측 원장 · ${obs.length}건`), table(obs, s)); dashboard.append(rawTable); draw();
    return dashboard;
  }
  function table(obs, s) {
    const wrap = el('div', null, 'iv-table-wrap');
    const t = el('table'); t.append(el('caption', '동일 관측치 표 · 모든 범위와 기준일, 원문 근거'));
    const head = el('thead'), hr = el('tr');
    ['분기 / 기간', '주수 / 원문·계산 근거', '기간 / 기준일', '근거'].forEach(text => { const th = el('th', text); th.scope = 'col'; hr.append(th); });
    head.append(hr); t.append(head);
    const body = el('tbody');
    obs.forEach(o => {
      const tr = el('tr');
      tr.append(el('td', `${o.quarter} · ${o.period_label || '명칭 미제공'}`));
      const value = el('td'); value.append(el('strong', bound(o)), el('p', `${rawLabel(s)} ${bound(o, true)}`), el('p', conversions[o.conversion]));
      tr.append(value, el('td', `시작 ${o.period_start || '미제공'} / 종료 ${o.period_end || '미제공'} / as_of ${o.as_of || '미제공'}`));
      const td = el('td'), more = el('details'); more.append(el('summary', '상세·출처'), evidence(o, s)); td.append(more); tr.append(td); body.append(tr);
    });
    t.append(body); wrap.append(t); return wrap;
  }
  // ---------------------------------------------------------------------------
  // Model layer: validation. Any failure here leaves the actual-only UI intact.
  // ---------------------------------------------------------------------------
  const validQuarter = q => typeof q === 'string' && /^\d{4}-Q[1-4]$/.test(q);
  const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const pickNum = (obj, keys) => { for (const k of keys) { if (obj && Number.isFinite(obj[k])) return obj[k]; } return null; };
  const pickStr = (obj, keys) => { for (const k of keys) { if (obj && typeof obj[k] === 'string' && obj[k].trim()) return obj[k].trim(); } return ''; };
  function validateTrack(id, t) {
    if (!isObject(t)) throw new Error('트랙이 객체가 아닙니다');
    if (t.id === undefined || t.id === null) t.id = id; else if (t.id !== id) throw new Error('트랙 id와 키 불일치');
    if (t.kind !== 'inventory') throw new Error('kind가 inventory가 아닙니다');
    if (!Array.isArray(t.points) || !t.points.length) throw new Error('points 배열이 비어 있습니다');
    if (t.calendar !== undefined && t.calendar !== null && !['calendar', 'fiscal'].includes(t.calendar)) throw new Error('calendar 값 오류');
    if (!validQuarter(t.current_quarter)) throw new Error('current_quarter(계열 표기)가 없거나 형식 오류');
    if (!/^(weeks?|주)$/i.test(String(t.unit ?? ''))) throw new Error(`단위 ${t.unit ?? '미제공'} · 재고 주수(weeks)만 지원`);
    if (t.stats !== undefined && t.stats !== null && !isObject(t.stats)) throw new Error('stats 형식 오류');
    if (t.backtest !== undefined && t.backtest !== null && !isObject(t.backtest)) throw new Error('backtest 형식 오류');
    const seen = new Set();
    t.points.forEach((p, i) => {
      if (!isObject(p)) throw new Error(`점 ${i}: 객체가 아닙니다`);
      if (!validQuarter(p.quarter) && validQuarter(p.date)) p.quarter = p.date;
      if (!validQuarter(p.quarter)) throw new Error(`점 ${i}: quarter 형식 오류`);
      if (seen.has(p.quarter)) throw new Error(`점 ${p.quarter}: 분기 중복`);
      seen.add(p.quarter);
      if (!STATUSES.includes(p.status)) throw new Error(`점 ${p.quarter}: status 값 오류`);
      const est = ESTIMATE_STATUSES.includes(p.status);
      if (typeof p.is_estimate !== 'boolean' || p.is_estimate !== est) throw new Error(`점 ${p.quarter}: is_estimate와 status 불일치`);
      if (p.observation_ids !== undefined && p.observation_ids !== null && (!Array.isArray(p.observation_ids) || p.observation_ids.some(x => typeof x !== 'string' || !x))) throw new Error(`점 ${p.quarter}: observation_ids 형식 오류`);
      if (p.observation_ids === undefined || p.observation_ids === null) p.observation_ids = [];
      if (est) {
        if (p.has_observation === true || (Number.isFinite(p.observation_count) && p.observation_count > 0) || p.observation_ids.length) throw new Error(`점 ${p.quarter}: 추정점이 관측으로 표기됨`);
        if (!isObject(p.model) || typeof p.model.method !== 'string' || !p.model.method) throw new Error(`점 ${p.quarter}: model.method 없음`);
        const L = p.level;
        if (!isObject(L) || !Number.isFinite(L.lower) || L.lower < 0) throw new Error(`점 ${p.quarter}: level.lower 오류`);
        if (!(L.upper === null || L.upper === undefined || (Number.isFinite(L.upper) && L.upper >= L.lower))) throw new Error(`점 ${p.quarter}: level.upper 오류`);
        if (L.qualifier !== undefined && L.qualifier !== null && !Object.hasOwn(qualifiers, L.qualifier)) throw new Error(`점 ${p.quarter}: level.qualifier 오류`);
        const sens = p.model.sensitivity;
        if (sens !== undefined && sens !== null) {
          if (!isObject(sens) || !Number.isFinite(sens.lower) || !Number.isFinite(sens.upper) || sens.lower < 0 || sens.upper < sens.lower) throw new Error(`점 ${p.quarter}: sensitivity 범위 오류`);
        }
        const explicitBasis = pickStr(p, ['basis', 'estimate_basis']) || pickStr(p.model, ['basis']);
        if (/^(own|model|internal|자체)/i.test(explicitBasis) && (p.publisher || p.source_url)) throw new Error(`점 ${p.quarter}: 자체 모델 추정점에 출처 필드가 있음`);
      } else if (p.status === 'observed') {
        if (p.has_observation !== true || !p.observation_ids.length) throw new Error(`점 ${p.quarter}: 실측점에 관측 연결 없음`);
        if (p.is_estimate) throw new Error(`점 ${p.quarter}: 실측점이 추정으로 표기됨`);
        if (p.model !== undefined && p.model !== null) throw new Error(`점 ${p.quarter}: 실측점에 model 객체`);
        if (isObject(p.level)) {
          if (!Number.isFinite(p.level.lower) || p.level.lower < 0) throw new Error(`점 ${p.quarter}: level.lower 오류`);
          if (!(p.level.upper === null || p.level.upper === undefined || (Number.isFinite(p.level.upper) && p.level.upper >= p.level.lower))) throw new Error(`점 ${p.quarter}: level.upper 오류`);
        }
      } else if (p.has_observation === true && !p.observation_ids.length) throw new Error(`점 ${p.quarter}: 관측 표기와 ID 불일치`);
    });
    t.points.sort((a, b) => quarterPosition(a) - quarterPosition(b));
    return t;
  }
  function validateProjections(p) {
    if (!isObject(p)) throw new Error('추정 레이어가 객체가 아닙니다');
    if (p.schema_version !== 1) throw new Error('지원하지 않는 추정 레이어 schema_version');
    if (typeof p.model_version !== 'string' || !p.model_version.trim()) throw new Error('model_version 없음');
    if (!isDate(p.as_of)) throw new Error('as_of 날짜 형식 오류');
    if (!validQuarter(p.current_quarter)) throw new Error('current_quarter 형식 오류');
    if (!Number.isInteger(p.horizon_quarters) || p.horizon_quarters < 1 || p.horizon_quarters > 12) throw new Error('horizon_quarters 오류');
    if (!isObject(p.inventory)) throw new Error('inventory 트랙 객체 없음');
    if (p.unsupported !== undefined && p.unsupported !== null && !Array.isArray(p.unsupported)) throw new Error('unsupported 형식 오류');
    const layer = {
      model_version: p.model_version.trim(), as_of: p.as_of, current_quarter: p.current_quarter, horizon_quarters: p.horizon_quarters,
      methodology_ko: typeof p.methodology_ko === 'string' ? p.methodology_ko : '', config: isObject(p.config) ? p.config : null, stats: isObject(p.stats) ? p.stats : null,
      inventory: {}, unsupported: Array.isArray(p.unsupported) ? p.unsupported : [], trackErrors: new Map()
    };
    Object.entries(p.inventory).forEach(([id, t]) => {
      try { layer.inventory[id] = validateTrack(id, t); }
      catch (error) { layer.trackErrors.set(id, error && error.message ? error.message : String(error)); }
    });
    return layer;
  }
  function unsupportedReason(id) {
    if (!projections) return '';
    const entry = projections.unsupported.find(e => typeof e === 'string' ? e === id : (isObject(e) && [e.id, e.series_id, e.track_id].includes(id)));
    if (!entry) return '';
    return typeof entry === 'string' ? '모델 미지원 (사유 미제공)' : `모델 미지원 · ${pickStr(entry, ['reason_ko', 'reason', 'note_ko', 'note']) || '사유 미제공'}`;
  }
  // ---------------------------------------------------------------------------
  // Model layer: basis (own model vs publisher estimate/forecast), labels, levels.
  // ---------------------------------------------------------------------------
  function basisOf(p) {
    const m = isObject(p.model) ? p.model : {};
    const explicit = pickStr(p, ['basis', 'estimate_basis']) || pickStr(m, ['basis']);
    const method = String(m.method || '');
    let kind = 'own';
    if (/publisher|source|출처|발행/i.test(explicit) || /^(publisher|source)[_-]/i.test(method)) kind = 'publisher';
    else if (/^(own|model|internal|자체)/i.test(explicit)) kind = 'own';
    else if (typeof p.publisher === 'string' && p.publisher.trim()) kind = 'publisher';
    const rawFlag = (pickStr(p, ['source_flag', 'estimate_flag', 'publisher_flag', 'flag']) || pickStr(m, ['source_flag', 'estimate_flag', 'publisher_flag', 'flag'])).toLowerCase();
    const flag = /^\(?e\)?$|estimate/.test(rawFlag) ? 'e' : /^\(?f\)?$|forecast/.test(rawFlag) ? 'f' : null;
    const publisher = pickStr(p, ['publisher']) || pickStr(m, ['publisher', 'source_publisher']);
    const vintage = pickStr(p, ['vintage', 'edition_date', 'edition']) || pickStr(m, ['vintage', 'edition_date', 'edition', 'published_at']) || pickStr(isObject(m.parameters) ? m.parameters : {}, ['vintage', 'edition_date', 'edition']);
    const url = safeURL(p.source_url) || safeURL(m.source_url) || null;
    return { kind, flag, publisher, vintage, url };
  }
  function basisLabel(basis, status, short = false) {
    if (!basis) return '';
    if (basis.kind === 'publisher') {
      const role = basis.flag === 'e' ? '출처 추정 (e)' : basis.flag === 'f' ? '출처 전망 (f)' : '출처 추정·전망 (e/f 구분 미제공)';
      if (short) return role;
      return `${role} · ${basis.publisher || '출처명 미제공'} · ${basis.vintage ? `${basis.vintage} 판` : '발간 시점 미제공'}`;
    }
    return status === 'forecast' ? '자체 모델 전망' : '자체 모델 추정';
  }
  function statusClass(status) { return statusClasses[status] || ''; }
  function unitText(track) { return /^(weeks?|주)$/i.test(String(track.unit ?? '')) ? '주' : String(track.unit); }
  function estBound(row, unit = '주') {
    const prefix = { at_least: '≥ ', more_than: '> ', less_than: '< ', at_most: '≤ ', about: '약 ' }[row.qualifier] || (row.approximate ? '약 ' : '');
    const hi = row.upper;
    const range = hi !== null && hi !== undefined && hi !== row.lower ? `${fmt1(row.lower)}–${fmt1(hi)}${row.upperOpen ? '+' : ''}` : fmt1(row.lower);
    return `${prefix}${range} ${unit}`;
  }
  function rowValue(row, unit) { return row.kind === 'actual' ? bound(row.obs) : estBound(row, unit); }
  function rowLabel(row, s) { return row.obs ? periodLabel(row.obs, s) : (s.calendar === 'fiscal' ? 'FY ' : '') + row.quarter; }
  const hasValue = row => (row.kind === 'actual' || row.kind === 'estimate') && Number.isFinite(row.lower);
  const pointValueRow = row => ['exact', 'range', 'about'].includes(row.qualifier);
  const closedUpperRow = row => row.upperOpen ? null : (row.upper === null || row.upper === undefined ? row.lower : row.upper);
  const boundOnly = row => row.kind === 'estimate' && (!pointValueRow(row) || row.upperOpen);
  function sensitivityOf(model) {
    const sens = isObject(model) && isObject(model.sensitivity) ? model.sensitivity : null;
    if (!sens || !Number.isFinite(sens.lower) || !Number.isFinite(sens.upper) || sens.upper < sens.lower) return null;
    return { lower: sens.lower, upper: sens.upper, label: pickStr(sens, ['label_ko', 'label']) };
  }
  function backtestSummary(bt) {
    if (!isObject(bt)) return { text: '백테스트 정보 없음 · 모델 정확도 미검증', weak: true };
    const n = pickNum(bt, ['n', 'folds', 'n_folds', 'fold_count']), mae = pickNum(bt, ['mae', 'MAE', 'model_mae', 'mae_chosen']), base = pickNum(bt, ['baseline_mae', 'mae_baseline', 'naive_mae']);
    const method = pickStr(bt, ['chosen_method', 'chosen', 'method', 'selected_method']), note = pickStr(bt, ['note_ko', 'status_ko', 'reason_ko', 'status', 'note']);
    const parts = [];
    if (n !== null) parts.push(`폴드 n=${fmt(n)}`); if (mae !== null) parts.push(`MAE ${fmt4(mae)}`); if (base !== null) parts.push(`기준(baseline) MAE ${fmt4(base)}`); if (method) parts.push(`선택 ${method}`);
    const weak = n === null || n < 3;
    if (weak) parts.push('폴드 3개 미만 · 보수적 기본값 · 통계적 신뢰도 미검증');
    if (note) parts.push(note);
    return { text: parts.join(' · ') || '백테스트 정보 없음', weak };
  }
  function scalarList(obj) {
    const dl = el('dl', null, 'iv-params');
    Object.entries(obj).forEach(([k, v]) => {
      const text = v === null || v === undefined ? '미제공' : Number.isFinite(v) ? fmt4(v) : typeof v === 'object' ? JSON.stringify(v) : String(v);
      dl.append(el('dt', k), el('dd', text));
    });
    return dl;
  }
  // ---------------------------------------------------------------------------
  // Model layer: bind a validated track to the actual ledger of one series.
  // Rows are the single normalized point list shared by chart, KPIs and detail.
  // ---------------------------------------------------------------------------
  function bindTrack(s, obs) {
    if (!projections) return { error: '추정 레이어 미로드' };
    const track = projections.inventory[s.id];
    if (!track) {
      const err = projections.trackErrors.get(s.id);
      if (err) return { error: `추정 레이어 검증 실패 · ${err}` };
      return { error: unsupportedReason(s.id) || '이 시리즈의 추정 레이어가 없습니다' };
    }
    if (track.calendar && track.calendar !== s.calendar) return { error: `달력 구분 불일치 (모델 ${track.calendar} · 원장 ${s.calendar})` };
    const byId = new Map(obs.map(o => [o.id, o])), used = new Set();
    for (const p of track.points) for (const id of p.observation_ids) {
      if (!byId.has(id)) return { error: `관측 ID ${id}가 이 시리즈 원장에 없음` };
      used.add(id);
    }
    const missing = obs.filter(o => !used.has(o.id));
    if (missing.length) return { error: `원장 관측 ${missing.length}건이 모델 레이어에 없음 (${missing[0].id}${missing.length > 1 ? ' 외' : ''}) · 모델 재생성 필요` };
    const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
    const byPos = new Map(track.points.map(p => [quarterPosition(p), p]));
    const first = quarterPosition(track.points[0]), last = quarterPosition(track.points.at(-1));
    const firstActual = Math.min(...obs.map(quarterPosition));
    const rows = [];
    for (let pos = first; pos <= last; pos++) {
      const p = byPos.get(pos) || null;
      const row = { quarter: quarterAt(pos), position: pos, point: p, kind: 'gap', status: p ? p.status : 'missing', obs: null, extras: [], lower: null, upper: null, upperOpen: false, qualifier: null, approximate: false, basis: null, sens: null, notes: [], reason: '', change: null, comparable: false, connected: false, partial: false, basisChange: false, timing: null, basisKey: null, pubKey: null };
      if (!p) { row.reason = '모델 레이어에 해당 분기 없음'; rows.push(row); continue; }
      const linked = p.observation_ids.map(id => byId.get(id));
      if (p.status === 'observed') {
        let selected = null;
        if (linked.length === 1) selected = linked[0];
        else if (linked.length > 1 && isObject(p.level)) {
          selected = linked.filter(o => near(o.value_min, p.level.lower) && near(o.value_max ?? o.value_min, p.level.upper ?? p.level.lower)).sort((a, b) => String(b.as_of || '').localeCompare(String(a.as_of || '')))[0] || null;
        }
        if (selected) {
          row.kind = 'actual'; row.obs = selected; row.extras = linked.filter(o => o !== selected);
          row.lower = selected.value_min; row.upper = selected.value_max; row.upperOpen = !!selected.upper_open; row.qualifier = selected.qualifier; row.approximate = !!selected.approximate;
          if (isObject(p.level) && (!near(p.level.lower, selected.value_min) || !near(p.level.upper ?? p.level.lower, selected.value_max ?? selected.value_min))) row.notes.push('모델 파일에 복사된 실측값이 원장과 달라 원장 값을 표시합니다.');
          if (row.extras.length) row.notes.push(`같은 분기의 다른 관측 ${row.extras.length}건은 비교값으로 선택되지 않았습니다.`);
        } else if (linked.length) { row.kind = 'ambiguous'; row.extras = linked; row.reason = '동일 분기 복수 관측 · 대표값 미선택'; }
        else { row.reason = '실측 표기이나 연결된 관측 없음'; }
      } else if (p.status === 'unavailable') {
        row.kind = linked.length ? 'ambiguous' : 'gap'; row.extras = linked;
        row.reason = pickStr(p, ['selection_note', 'narrative_ko']) || (linked.length > 1 ? '동일 분기 복수 관측 · 대표값 미선택' : '추정 불가 · 사유 미제공');
      } else {
        if (pos < firstActual) { row.reason = '첫 실측 이전 추정 · 표시하지 않음'; rows.push(row); continue; }
        const L = p.level;
        row.kind = 'estimate'; row.basis = basisOf(p); row.lower = L.lower; row.upper = L.upper === undefined ? null : L.upper; row.upperOpen = L.upper_open === true; row.qualifier = L.qualifier || 'exact'; row.approximate = p.approximate === true; row.sens = sensitivityOf(p.model);
      }
      rows.push(row);
    }
    linkRows(rows, s, track);
    return { track, rows };
  }
  function linkRows(rows, s, track) {
    const pub = id => data.sources.find(source => source.id === id)?.publisher || '';
    const basisKey = o => [timing(o, s), o.conversion, o.raw_unit, o.measure_type || 'reported', o.reported_metric_label || ''].join('|');
    let segment = { basisKey: null, pubKey: null, timing: null };
    rows.forEach((row, i) => {
      if (row.kind === 'actual') {
        segment = { basisKey: basisKey(row.obs), pubKey: pub(row.obs.source_id), timing: timing(row.obs, s) };
        row.partial = row.quarter === track.current_quarter || row.point.partial === true;
      }
      if (hasValue(row)) { row.basisKey = segment.basisKey; row.pubKey = segment.pubKey; row.timing = segment.timing; }
      const prev = rows[i - 1];
      if (!hasValue(row)) { if (!row.reason) row.reason = '값 없음'; return; }
      if (!prev) { row.reason = '직전 분기 자료 없음'; return; }
      if (!hasValue(prev)) { row.reason = prev.kind === 'ambiguous' ? '전분기 복수 관측 · 비교값 미선택' : '직전 분기 자료 없음'; return; }
      const p = row.point;
      if (p.connect_previous === false || p.scope_break === true) { row.reason = '모델 레이어 범위·시점 단절 · 연결 중단'; return; }
      if (row.basisKey !== prev.basisKey) { row.reason = '측정 기준 변경 · 전분기 비교 중단'; return; }
      if (row.pubKey !== prev.pubKey || (p.source_change === true && row.kind === 'actual')) { row.reason = '출처 변경 · 전분기 비교 중단'; return; }
      if (row.kind === 'estimate' && prev.kind === 'estimate' && row.basis.kind !== prev.basis.kind) { row.basisChange = true; row.reason = '추정 기준 변경 (출처 수치 ↔ 자체 모델) · 연결·비교 중단'; return; }
      row.connected = true;
      if (!pointValueRow(row) || !pointValueRow(prev)) { row.reason = '미만·이상 경계값 · 변화율 미계산'; return; }
      const upper = closedUpperRow(row), previousUpper = closedUpperRow(prev);
      const lowerPct = prev.lower === 0 ? null : (row.lower / prev.lower - 1) * 100;
      const upperPct = upper === null || previousUpper === null || previousUpper === 0 ? null : (upper / previousUpper - 1) * 100;
      const single = upper === row.lower && previousUpper === prev.lower;
      row.comparable = true;
      row.change = {
        lowerPct, upperPct, lowerDelta: row.lower - prev.lower, upperDelta: upper === null || previousUpper === null ? null : upper - previousUpper, single, previous: prev,
        reference: row.timing === 'quarter_reported', approximate: !!(row.approximate || prev.approximate || row.qualifier === 'about' || prev.qualifier === 'about'),
        estimated: row.kind === 'estimate' || prev.kind === 'estimate', publisher: (row.basis && row.basis.kind === 'publisher') || (prev.basis && prev.basis.kind === 'publisher')
      };
      if (lowerPct === null && upperPct === null) row.reason = '전분기 0 또는 열린 경계 · 변화율 미계산';
    });
  }
  function modelChangeDetails(row, s, unit) {
    const box = el('div', null, 'iv-comparison');
    box.append(el('strong', row.change ? `전분기 대비 ${changeText(row)}${row.change.estimated ? ' · 추정 포함' : ''}` : row.reason));
    if (row.change) {
      box.append(el('p', `${rowLabel(row.change.previous, s)} (${rowKindLabel(row.change.previous)}) → ${rowLabel(row, s)} (${rowKindLabel(row)}) · 증감 ${changeText(row, true)}`));
      if (row.change.estimated) box.append(el('p', `추정 포함 비교 · 한쪽 이상이 ${row.change.publisher ? '출처 추정·전망' : '자체 모델'} 값이며 실측 변화율이 아닙니다.`));
      if (row.change.reference) box.append(el('p', '분기 보고값 참고 비교 · 정확한 측정시점은 미확인'));
      if (row.change.approximate) box.append(el('p', '근삿값을 포함한 변화율'));
      if (!row.change.single) box.append(el('p', '하단끼리 · 상단끼리 계산합니다. 두 변화율은 하나의 최솟값~최댓값 범위가 아닙니다.'));
    }
    return box;
  }
  function rowKindLabel(row) {
    if (row.kind === 'actual') return row.partial ? '실측 · 부분 분기' : '실측';
    if (row.kind === 'estimate') return `${statusLabels[row.status]} · ${basisLabel(row.basis, row.status, true)}`;
    return statusLabels[row.status] || row.kind;
  }
  function badges(row) {
    const box = el('div', null, 'iv-badges');
    const add = (text, cls) => box.append(el('span', text, `iv-badge ${cls}`));
    if (row.kind === 'actual') { add('실측 · 출처 보고값', 'iv-badge-actual'); if (row.partial) add('현재 분기 · 부분 실측 (분기 미완료)', 'iv-badge-partial'); }
    else if (row.kind === 'estimate') {
      add(statusLabels[row.status], `iv-badge-${row.status === 'historical_estimate' ? 'hist' : row.status === 'nowcast' ? 'now' : 'fc'}`);
      add(basisLabel(row.basis, row.status, true), row.basis.kind === 'publisher' ? 'iv-badge-pub' : 'iv-badge-own');
      if (boundOnly(row)) add('경계 조건부 시나리오 · 정확한 값 아님', 'iv-badge-bound');
      if (row.basisChange) add('추정 기준 변경', 'iv-badge-bound');
    } else if (row.kind === 'ambiguous') add('실측 복수 관측 · 대표값 미선택', 'iv-badge-gap');
    else add(statusLabels[row.status] || '자료 없음', 'iv-badge-gap');
    return box;
  }
  function modelEvidence(row, s, track) {
    const p = row.point, m = p.model, unit = unitText(track), basis = row.basis;
    const box = el('div', null, 'iv-model-evidence');
    box.append(el('h4', `${rowLabel(row, s)} · ${statusLabels[row.status]} · ${basisLabel(basis, row.status, true)}`), el('p', estBound(row, unit), `iv-value ${statusClass(row.status)}`), badges(row));
    box.append(el('p', `계열: ${s.name} · ${s.entity} · ${metricLabel(s)} · 범위: ${s.scope}`));
    if (companywide(s)) box.append(el('p', '기업 전체 참고 · 제품별 재고 아님 · 추정도 같은 범위에 한정', 'iv-warning'));
    if (s.calendar === 'fiscal') {
      const fiscal = isObject(p.fiscal) ? p.fiscal : {}, alignment = isObject(fiscal.calendar_alignment) ? fiscal.calendar_alignment : {};
      const align = pickStr(fiscal, ['calendar_alignment_ko', 'note_ko']) || pickStr(alignment, ['note_ko', 'majority_calendar_quarter']) || pickStr(p, ['calendar_quarter', 'calendar_alignment_ko', 'alignment_ko', 'fiscal_note_ko']);
      const periodEnd = pickStr(fiscal, ['period_end']), assumed = fiscal.period_basis === 'assumed_rule' || fiscal.dates_reported === false;
      const period = periodEnd ? ` · ${assumed ? '가정된 기간 종료(보고값 아님)' : '보고된 기간 종료'}: ${periodEnd}` : '';
      box.append(el('p', `FY 회계분기 표기 보존 · 달력분기 정렬: ${align || '모델 파일에 미제공'}${period}`, 'iv-timing'));
    } else box.append(el('p', `달력분기 · 측정 기준 승계: ${row.timing ? ({ quarter_start: '분기 초', quarter_end: '분기말', within_quarter: '분기 중 조사', quarter_calculation: '분기 재무 계산', quarter_reported: '분기 보고 · 측정시점 미확인' }[row.timing] || row.timing) : '미상'}`, 'iv-timing'));
    if (basis.kind === 'publisher') {
      box.append(el('p', `발행사의 ${basis.flag === 'f' ? '전망 (f)' : basis.flag === 'e' ? '추정 (e)' : '추정·전망'} 수치입니다. 실측이 아니며 자체 모델 산출값도 아닙니다. 관측치나 모델 정확도 기준에 포함하지 않습니다.`, 'iv-warning'));
      const src = el('p'); src.append(`출처: ${basis.publisher || '출처명 미제공'} · 발간 ${basis.vintage || '시점 미제공'}`);
      if (basis.url) { src.append(' · '); const a = el('a', basis.url); a.href = basis.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; src.append(a); }
      box.append(src);
      if (p.source_title) box.append(el('p', `문서: ${p.source_title}${p.locator ? ` · 위치: ${p.locator}` : ''}`));
    } else box.append(el('p', '자체 모델 산출값입니다. 발행사 보고값이 아니며 실측 관측으로 집계하지 않습니다.', 'iv-warning'));
    if (boundOnly(row)) box.append(el('p', '앵커가 미만·이상 경계값 또는 열린 상단이므로 경계를 유지하는 조건부 시나리오입니다. 정확한 값·상한·변화율을 만들어내지 않습니다.', 'iv-warning'));
    box.append(el('p', `방법: ${pickStr(m, ['method_label_ko']) || m.method} (${m.method})`));
    if (pickStr(m, ['explanation_ko'])) box.append(el('p', m.explanation_ko));
    const formula = pickStr(m, ['formula', 'formula_ko', 'formula_text']);
    if (formula) box.append(el('p', formula, 'iv-formula'));
    if (isObject(m.parameters) && Object.keys(m.parameters).length) { box.append(el('p', '모수·가정 (실제 선택·가정값)', 'iv-timing'), scalarList(m.parameters)); }
    const anchors = Array.isArray(m.anchor_sources) ? m.anchor_sources.filter(isObject) : [];
    const anchorIds = Array.isArray(m.anchor_ids) ? m.anchor_ids.filter(id => typeof id === 'string') : [];
    const anchorQuarters = Array.isArray(m.anchor_quarters) ? m.anchor_quarters.filter(q => typeof q === 'string') : [];
    if (anchors.length || anchorIds.length) {
      box.append(el('p', `앵커 (실측 근거) · 분기 ${anchorQuarters.join(', ') || '미제공'}`, 'iv-timing'));
      const ul = el('ul');
      anchors.forEach(a => {
        const li = el('li'), url = safeURL(a.url);
        const text = `${a.quarter || '분기 미상'} · ${Number.isFinite(a.value_lower) ? fmt(a.value_lower) : '?'}${Number.isFinite(a.value_upper) && a.value_upper !== a.value_lower ? `–${fmt(a.value_upper)}` : ''} ${unit} · `;
        li.append(text);
        if (url) { const link_ = el('a', a.title || a.id || url); link_.href = url; link_.target = '_blank'; link_.rel = 'noopener noreferrer'; li.append(link_); }
        else li.append(`${a.title || a.id || '제목 미제공'} (유효한 원문 URL 없음)`);
        ul.append(li);
      });
      anchorIds.forEach(id => {
        const o = data.observations.find(v => v.id === id);
        if (!o) { ul.append(el('li', `${id} · 원장에서 찾을 수 없음`)); return; }
        const os = data.series.find(v => v.id === o.series_id) || s;
        ul.append(el('li', `${id} · ${periodLabel(o, os)} · ${bound(o)} · ${timingLabel(o, os)}${o.series_id !== s.id ? ' · ⚠ 다른 계열의 관측 (교차 차용 금지)' : ''}`));
      });
      box.append(ul);
    } else box.append(el('p', '앵커 정보 미제공 · 근거 추적 불가', 'iv-warning'));
    const qsa = pickNum(m, ['quarters_since_actual']);
    box.append(el('p', `최근 실측 ${pickStr(m, ['last_actual_quarter']) || '미제공'} · 경과 ${qsa === null ? '미제공' : `${fmt(qsa)}분기`} · 신뢰도(정성): ${pickStr(m, ['confidence_label_ko']) || '미제공'}`));
    if (row.sens) box.append(el('p', `민감도 범위 ${fmt1(row.sens.lower)}–${fmt1(row.sens.upper)} ${unit}${row.sens.label ? ` · ${row.sens.label}` : ''} · 가정 기반 포락선이며 검증된 신뢰구간이 아닙니다.`));
    const limits = Array.isArray(m.limitations_ko) ? m.limitations_ko.filter(t => typeof t === 'string' && t) : [];
    if (limits.length) { box.append(el('p', '한계', 'iv-timing')); const ul = el('ul'); limits.forEach(t => ul.append(el('li', t))); box.append(ul); }
    const bt = backtestSummary(track.backtest);
    box.append(el('p', `백테스트: ${bt.text}`, bt.weak ? 'iv-warning' : ''));
    if (pickStr(p, ['narrative_ko'])) box.append(el('p', p.narrative_ko));
    if (isObject(p.level) && pickStr(p.level, ['label'])) box.append(el('p', `모델 표기: ${p.level.label}`, 'iv-caption'));
    box.append(el('p', `모델 ${projections.model_version} · 기준일 ${projections.as_of} · 선택 상태 ${p.selection_status || '미제공'} · 점 ID ${p.id || '미제공'}`, 'iv-caption'));
    return box;
  }
  function actualDetail(detail, row, o, s, unit, note) {
    detail.replaceChildren();
    const head = el('div', null, 'iv-point-head');
    head.append(el('strong', `${periodLabel(o, s)} · ${bound(o)}`), el('span', timingLabel(o, s), 'iv-caption'));
    detail.append(head, badges(row));
    if (note) detail.append(el('p', note, 'iv-model-note'));
    row.notes.forEach(n => detail.append(el('p', n, 'iv-model-note')));
    detail.append(row.kind === 'actual' && row.obs === o ? modelChangeDetails(row, s, unit) : el('p', row.reason || '비교값 미선택', 'iv-comparison'));
    const raw = el('details'); raw.append(el('summary', '원문·계산 근거 보기'), evidence(o, s)); detail.append(raw);
  }
  function estimateDetail(detail, row, s, track, unit) {
    detail.replaceChildren();
    const head = el('div', null, 'iv-point-head');
    head.append(el('strong', `${rowLabel(row, s)} · ${estBound(row, unit)}`), el('span', `${statusLabels[row.status]} · ${basisLabel(row.basis, row.status)}`, 'iv-caption'));
    detail.append(head, badges(row), modelChangeDetails(row, s, unit));
    const more = el('details'); more.open = true; more.append(el('summary', '산식·모수·앵커·가정 보기'), modelEvidence(row, s, track)); detail.append(more);
  }
  // ---------------------------------------------------------------------------
  // Model layer: graph. Actual = solid; any segment touching an estimate = dashed.
  // ---------------------------------------------------------------------------
  function modeledGraph(rows, s, track, detail, mode, scale) {
    const unit = unitText(track);
    const wrap = el('div', null, 'iv-chart'), width = Math.max(560, rows.length * 68 + 90), height = 300;
    const chart = svg('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'group', 'aria-label': `${s.name} · ${mode === 'level' ? '분기 재고 주수 · 실측과 추정' : '전분기 대비 변화율 · 추정 포함 가능'} · 실선 실측 · 점선 추정 · 누락 분기는 공백` });
    chart.style.width = `${width}px`;
    chart.append(svg('title', {}, `${s.name}: 분기별 ${mode === 'level' ? '재고 주수 · 실측(실선)과 추정(점선)' : '변화율 · 추정 포함 막대는 반투명'}`));
    const left = 58, right = width - 28, top = 28, bottom = 230;
    const step = (right - left) / rows.length, x = i => left + step * (i + .5);
    const values = [];
    rows.forEach(r => {
      if (mode === 'level') {
        if (hasValue(r)) values.push(r.lower, r.upper ?? r.lower);
        r.extras.forEach(o => values.push(o.value_min, o.value_max ?? o.value_min));
        if (r.sens) values.push(r.sens.lower, r.sens.upper);
      } else if (r.change) [r.change.lowerPct, r.change.upperPct].forEach(v => { if (v !== null) values.push(v); });
    });
    const finite = values.filter(Number.isFinite);
    const min = finite.length ? Math.min(...finite) : 0, max = finite.length ? Math.max(...finite) : 1;
    let low, high;
    if (mode === 'change') { const extent = Math.max(5, Math.abs(min), Math.abs(max)) * 1.15; low = -extent; high = extent; }
    else { const padding = Math.max(1, (max - min) * .2); low = scale === 'focus' ? Math.max(0, min - padding) : 0; high = max + padding; }
    if (!(high > low)) { low = 0; high = 1; }
    const y = v => bottom - (v - low) / (high - low) * (bottom - top);
    // Forecast area and NOW separator sit beneath everything else.
    const currentIndex = rows.findIndex(r => r.quarter === track.current_quarter), firstForecast = rows.findIndex(r => r.status === 'forecast');
    let separator = null;
    if (currentIndex >= 0) separator = x(currentIndex) + step / 2; else if (firstForecast >= 0) separator = x(firstForecast) - step / 2;
    if (currentIndex >= 0) {
      chart.append(svg('rect', { x: x(currentIndex) - step / 2, y: top, width: step, height: bottom - top, class: 'iv-current-area' }));
      chart.append(svg('text', { x: x(currentIndex), y: top - 8, 'text-anchor': 'middle', class: 'iv-area-label' }, '현재 분기'));
    }
    if (separator !== null && separator < right) {
      chart.append(svg('rect', { x: separator, y: top, width: right - separator, height: bottom - top, class: 'iv-forecast-area' }));
      chart.append(svg('line', { x1: separator, x2: separator, y1: top - 14, y2: bottom, class: 'iv-now-line' }));
      chart.append(svg('text', { x: separator + 4, y: top - 4, class: 'iv-now-label' }, `기준일 ${projections.as_of} ▸ 전망`));
    }
    [0, 1, 2, 3, 4].forEach(i => {
      const value = low + (high - low) * i / 4;
      chart.append(svg('line', { x1: left, x2: right, y1: y(value), y2: y(value), class: (mode === 'change' && i === 2) || (mode === 'level' && value === 0) ? 'iv-zero' : 'iv-grid' }), svg('text', { x: left - 9, y: y(value) + 4, 'text-anchor': 'end', class: 'iv-axis' }, fmt(Math.abs(value) < 1e-9 ? 0 : value)));
    });
    chart.append(svg('text', { x: left, y: 15, class: 'iv-axis' }, mode === 'change' ? '전분기 대비 % · 증가 / 감소 · 추정 포함 가능' : `${s.metric === 'financial_dio_proxy' ? '재무 계산값' : '재고'} (${unit})`));
    // Sensitivity envelope (assumption-based, never a confidence interval) under the lines.
    if (mode === 'level') {
      let run = [];
      const flush = () => {
        if (run.length >= 2) chart.append(svg('path', { d: `M ${run.map(i => `${x(i)} ${y(rows[i].sens.upper)}`).join(' L ')} L ${run.slice().reverse().map(i => `${x(i)} ${y(rows[i].sens.lower)}`).join(' L ')} Z`, class: 'iv-sens' }));
        else if (run.length === 1) { const i = run[0]; chart.append(svg('line', { x1: x(i), x2: x(i), y1: y(rows[i].sens.upper), y2: y(rows[i].sens.lower), class: 'iv-sens-whisker' })); }
        run = [];
      };
      rows.forEach((r, i) => {
        if (!r.sens) { flush(); return; }
        if (run.length && !r.connected) flush();
        run.push(i);
      });
      flush();
    }
    rows.forEach((row, i) => {
      if (!hasValue(row) && !row.extras.length) {
        chart.append(svg('rect', { x: x(i) - step * .38, y: top, width: step * .76, height: bottom - top, rx: 5, class: 'iv-gap' }));
        chart.append(svg('text', { x: x(i), y: top + 18, 'text-anchor': 'middle', class: 'iv-axis iv-gap-label' }, row.status === 'unavailable' ? '추정 불가' : row.status === 'missing' ? '레이어 없음' : '자료 없음'));
      }
      const firstOfYear = row.quarter.endsWith('Q1') || i === 0;
      chart.append(svg('text', { x: x(i), y: 253, 'text-anchor': 'middle', class: 'iv-axis' }, row.quarter.split('-')[1]));
      if (firstOfYear) chart.append(svg('text', { x: x(i), y: 275, 'text-anchor': 'middle', class: 'iv-year' }, `${s.calendar === 'fiscal' ? 'FY ' : ''}${row.quarter.slice(0, 4)}`));
      if (i && hasValue(row) && !row.connected && /출처 변경/.test(row.reason)) chart.append(svg('text', { x: x(i) - step / 2, y: bottom - 4, 'text-anchor': 'middle', class: 'iv-source-mark' }, '출처 변경'));
      if (i && row.basisChange) chart.append(svg('text', { x: x(i) - step / 2, y: bottom - 4, 'text-anchor': 'middle', class: 'iv-source-mark' }, '기준 변경'));
      if (mode === 'level' && i && row.connected) {
        const a = rows[i - 1], b = row, est = a.kind === 'estimate' || b.kind === 'estimate';
        const st = est ? statusClass(b.kind === 'estimate' ? b.status : a.status) : '';
        const pubBasis = est && ((b.basis && b.basis.kind === 'publisher') || (a.basis && a.basis.kind === 'publisher'));
        const ua = closedUpperRow(a), ub = closedUpperRow(b);
        const lineClass = `${est ? ` iv-trend-est ${st}` : ''}${pubBasis ? ' iv-trend-pub' : ''}`;
        if (ua !== null && ub !== null) chart.append(svg('path', { d: `M ${x(i-1)} ${y(a.lower)} L ${x(i)} ${y(b.lower)} L ${x(i)} ${y(ub)} L ${x(i-1)} ${y(ua)} Z`, class: `iv-band${est ? ` iv-band-est ${st}` : ''}` }));
        chart.append(svg('line', { x1: x(i-1), x2: x(i), y1: y(a.lower), y2: y(b.lower), class: `iv-trend${lineClass}` }));
        if (ua !== null && ub !== null && (ua !== a.lower || ub !== b.lower)) chart.append(svg('line', { x1: x(i-1), x2: x(i), y1: y(ua), y2: y(ub), class: `iv-trend iv-upper-line${lineClass}` }));
      }
    });
    const unit_ = unit;
    rows.forEach((row, i) => {
      const activate = key => chart.querySelectorAll('.iv-mark').forEach(mark => mark.classList.toggle('iv-active', mark.dataset.key === key));
      if (!hasValue(row) && !row.extras.length) return;
      if (mode === 'change' && hasValue(row) && (!row.change || (row.change.lowerPct === null && row.change.upperPct === null))) {
        chart.append(svg('text', { x: x(i), y: y(0) - 8, 'text-anchor': 'middle', class: 'iv-axis' }, '—'));
      }
      const symbols = { at_least: '≥', more_than: '>', less_than: '<', at_most: '≤', about: '≈' };
      const hit = (g, px) => g.append(svg('rect', { x: px - 21, y: top - 6, width: 42, height: bottom - top + 14, rx: 5, class: 'iv-hit' }));
      const wire = (g, handler) => {
        g.addEventListener('mouseenter', handler); g.addEventListener('focus', handler); g.addEventListener('click', handler);
        g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
        chart.append(g);
      };
      const marks = [];
      if (row.kind === 'actual') marks.push({ o: row.obs, primary: true });
      row.extras.forEach(o => marks.push({ o, primary: false }));
      const total = marks.length + (row.kind === 'estimate' ? 1 : 0);
      marks.forEach(({ o, primary }, j) => {
        const px = x(i) + (j - (total - 1) / 2) * 12, key = `obs:${o.id}`;
        const g = svg('g', { tabindex: '0', role: 'button', 'aria-label': `${periodLabel(o, s)}, 실측 ${bound(o)}, ${mode === 'change' && primary ? changeText(row) : timingLabel(o, s)}${primary ? '' : ', 비교값 미선택'}${row.partial && primary ? ', 현재 분기 부분 실측' : ''}. 상세 및 출처 보기`, class: 'iv-mark', 'data-key': key, 'data-observation': o.id });
        g.append(svg('title', {}, `${periodLabel(o, s)} · 실측 ${bound(o)} · ${primary ? (row.change ? changeText(row) : row.reason) : '비교값 미선택'} · ${timingLabel(o, s)}`));
        hit(g, px);
        if (mode === 'level') {
          const ly = y(o.value_min), uy = y(o.value_max ?? o.value_min), upper = o.value_max;
          if (upper !== null && upper !== o.value_min) {
            g.append(svg('line', { x1: px, x2: px, y1: ly, y2: uy, class: 'iv-whisker' }));
            g.append(svg('circle', { cx: px, cy: uy, r: 4, class: o.upper_open ? 'iv-open' : 'iv-dot iv-upper-dot' }));
          }
          g.append(svg('circle', { cx: px, cy: ly, r: 4.5, class: !pointValue(o) || o.qualifier === 'about' ? 'iv-open' : 'iv-dot' }));
          const symbol = symbols[o.qualifier];
          if (symbol) g.append(svg('text', { x: px + 7, y: ly - 7, class: 'iv-bound' }, symbol));
          if (o.upper_open) g.append(svg('text', { x: px + 7, y: uy - 6, class: 'iv-bound' }, '+'));
          if (primary && row.partial) g.append(svg('text', { x: px, y: Math.max(ly, uy) + 13, 'text-anchor': 'middle', class: 'iv-partial-mark' }, '부분 분기'));
          if (primary && i === rows.length - 1) g.append(svg('text', { x: px, y: Math.min(ly, uy) - 13, 'text-anchor': 'middle', class: 'iv-last-label' }, bound(o)));
        } else if (primary && row.change) {
          const entries = row.change.single ? [['값', row.change.lowerPct]] : [['하단', row.change.lowerPct], ['상단', row.change.upperPct]];
          entries.forEach(([endpoint, value], k) => {
            if (value === null) return;
            const bx = px + (entries.length === 1 ? -9 : k === 0 ? -17 : 2), yy = y(value), zero = y(0);
            const bar = svg('rect', { x: bx, y: value === 0 ? zero - 1 : Math.min(yy, zero), width: entries.length === 1 ? 18 : 14, height: Math.max(2, Math.abs(yy - zero)), rx: 2, class: `iv-bar ${value === 0 ? 'iv-unchanged' : value > 0 ? 'iv-rise' : 'iv-fall'}${k === 1 ? ' iv-upper-bar' : ''}${row.change.estimated ? ' iv-bar-est' : ''}` });
            bar.append(svg('title', {}, `${endpoint} ${signed(value)}${row.change.estimated ? ' · 추정 포함' : ''}`)); g.append(bar);
          });
        }
        wire(g, () => { actualDetail(detail, row, o, s, unit_, primary ? '' : '동일 분기의 다른 관측 · 비교값으로 선택되지 않음'); activate(key); });
      });
      if (row.kind === 'estimate') {
        const px = x(i) + (marks.length - (total - 1) / 2) * 12, key = `est:${row.quarter}`, st = statusClass(row.status), pub = row.basis.kind === 'publisher';
        const g = svg('g', { tabindex: '0', role: 'button', 'aria-label': `${rowLabel(row, s)}, ${statusLabels[row.status]}, ${basisLabel(row.basis, row.status)}, ${estBound(row, unit_)}, ${mode === 'change' ? changeText(row) : (pickStr(row.point.model, ['method_label_ko']) || row.point.model.method)}. 산식과 근거 보기`, class: 'iv-mark', 'data-key': key });
        g.append(svg('title', {}, `${rowLabel(row, s)} · ${statusLabels[row.status]} · ${basisLabel(row.basis, row.status)} · ${estBound(row, unit_)} · ${row.change ? changeText(row) + (row.change.estimated ? ' (추정 포함)' : '') : row.reason}`));
        hit(g, px);
        if (mode === 'level') {
          const ly = y(row.lower), uy = y(row.upper ?? row.lower);
          if (row.upper !== null && row.upper !== undefined && row.upper !== row.lower) {
            g.append(svg('line', { x1: px, x2: px, y1: ly, y2: uy, class: `iv-whisker iv-whisker-est ${st}` }));
            g.append(pub ? svg('path', { d: `M ${px} ${uy - 5} L ${px + 5} ${uy} L ${px} ${uy + 5} L ${px - 5} ${uy} Z`, class: `iv-dot-est iv-dot-pub iv-dot-upper ${st}` }) : svg('circle', { cx: px, cy: uy, r: 4, class: `iv-dot-est iv-dot-upper ${st}` }));
          }
          g.append(pub ? svg('path', { d: `M ${px} ${ly - 5.5} L ${px + 5.5} ${ly} L ${px} ${ly + 5.5} L ${px - 5.5} ${ly} Z`, class: `iv-dot-est iv-dot-pub ${st}` }) : svg('circle', { cx: px, cy: ly, r: 4.5, class: `iv-dot-est ${st}` }));
          const symbol = symbols[row.qualifier];
          if (symbol) g.append(svg('text', { x: px + 7, y: ly - 7, class: `iv-bound ${st}` }, symbol));
          if (row.upperOpen) g.append(svg('text', { x: px + 7, y: uy - 6, class: `iv-bound ${st}` }, '+'));
          const tag = pub ? (row.basis.flag === 'f' ? '출처(f)' : row.basis.flag === 'e' ? '출처(e)' : '출처') : row.status === 'forecast' ? '전망' : row.status === 'nowcast' ? '현재 추정' : '추정';
          g.append(svg('text', { x: px, y: Math.max(ly, uy) + 13, 'text-anchor': 'middle', class: `iv-status-label ${st}` }, tag));
          if (i === rows.length - 1) g.append(svg('text', { x: px, y: Math.min(ly, uy) - 13, 'text-anchor': 'middle', class: `iv-last-label ${st}` }, `${estBound(row, unit_)} (${tag})`));
        } else if (row.change) {
          const entries = row.change.single ? [['값', row.change.lowerPct]] : [['하단', row.change.lowerPct], ['상단', row.change.upperPct]];
          entries.forEach(([endpoint, value], k) => {
            if (value === null) return;
            const bx = px + (entries.length === 1 ? -9 : k === 0 ? -17 : 2), yy = y(value), zero = y(0);
            const bar = svg('rect', { x: bx, y: value === 0 ? zero - 1 : Math.min(yy, zero), width: entries.length === 1 ? 18 : 14, height: Math.max(2, Math.abs(yy - zero)), rx: 2, class: `iv-bar ${value === 0 ? 'iv-unchanged' : value > 0 ? 'iv-rise' : 'iv-fall'}${k === 1 ? ' iv-upper-bar' : ''} iv-bar-est` });
            bar.append(svg('title', {}, `${endpoint} ${signed(value)} · 추정 포함`)); g.append(bar);
          });
          g.append(svg('text', { x: px, y: bottom - 4, 'text-anchor': 'middle', class: `iv-status-label ${st}` }, '추정'));
        }
        wire(g, () => { estimateDetail(detail, row, s, track, unit_); activate(key); });
      }
    });
    const scroll = el('div', null, 'iv-plot-scroll'); scroll.setAttribute('tabindex', '0'); scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', '분기 그래프 · 실측과 추정을 순서대로 표시 · 좌우 이동 가능'); scroll.append(chart);
    const legend = el('div', null, 'iv-legend');
    const anyPub = rows.some(r => r.kind === 'estimate' && r.basis.kind === 'publisher'), anySens = rows.some(r => r.sens);
    if (mode === 'level') {
      legend.append(el('span', '● 실측 · 실선', 'iv-legend-lower'), el('span', '● 상단 · 음영은 범위', 'iv-legend-upper'), el('span', '◌ 자체 모델 추정 · 점선', 'iv-legend-own'));
      if (anyPub) legend.append(el('span', '◆ 출처 추정 (e) / 출처 전망 (f) · 점선', 'iv-legend-pub'));
      legend.append(el('span', '과거 공백 추정 (황색)', 'iv-legend-hist'), el('span', '현재 분기 추정 (청색)', 'iv-legend-now'), el('span', '전망 (보라)', 'iv-legend-fc'));
      if (anySens) legend.append(el('span', '▒ 민감도 범위 · 가정 기반, 신뢰구간 아님', 'iv-legend-sens'));
    } else legend.append(el('span', '▮ 증가', 'iv-legend-rise'), el('span', '▮ 감소', 'iv-legend-fall'), el('span', '채움=하단 / 단일값 · 윤곽=상단 · 반투명=추정 포함', 'iv-caption'));
    const actualCount = rows.filter(r => r.kind === 'actual').length, ambiguous = rows.filter(r => r.kind === 'ambiguous').length;
    const counts = { historical_estimate: 0, nowcast: 0, forecast: 0 };
    rows.forEach(r => { if (r.kind === 'estimate') counts[r.status] += 1; });
    const estimated = counts.historical_estimate + counts.nowcast + counts.forecast;
    wrap.append(scroll, legend, el('p', `${actualCount}/${rows.length}개 분기 실측${ambiguous ? ` · 복수 관측 ${ambiguous}분기` : ''} · 추정 ${estimated}분기 (과거 ${counts.historical_estimate} · 현재 ${counts.nowcast} · 전망 ${counts.forecast}) · 공백 ${rows.length - actualCount - ambiguous - estimated}분기 · ${s.calendar === 'fiscal' ? 'FY 회계분기' : '달력분기'}${mode === 'level' && scale === 'focus' ? ` · 변화 강조 축 ${fmt(low)}–${fmt(high)}${unit}` : ''} · 추정은 관측으로 집계하지 않음`, 'iv-caption'));
    if (mode === 'change') wrap.append(el('p', '0선 위는 증가, 아래는 감소입니다. 반투명 막대는 한쪽 이상이 추정값인 비교입니다. 재고 증감은 그 자체로 수급의 좋고 나쁨을 뜻하지 않습니다.', 'iv-caption'));
    return wrap;
  }
  // ---------------------------------------------------------------------------
  // Model layer: dashboard for one series (actual + estimate). Toggle off → seriesDashboard.
  // ---------------------------------------------------------------------------
  function modeledDashboard(obs, s, track, rows) {
    const unit = unitText(track), dashboard = el('div', null, 'iv-dashboard iv-dashboard-model');
    const actualRows = rows.filter(r => r.kind === 'actual'), lastActual = actualRows.at(-1) || null;
    const currentRow = rows.find(r => r.quarter === track.current_quarter) || null;
    const currentPos = quarterPosition({ quarter: track.current_quarter });
    const forecastRows = rows.filter(r => r.kind === 'estimate' && r.status === 'forecast'), horizonRow = forecastRows.at(-1) || null;
    const headModel = (horizonRow || (currentRow && currentRow.kind === 'estimate' ? currentRow : null));
    const m = headModel ? headModel.point.model : null;
    const qsa = m ? pickNum(m, ['quarters_since_actual']) : null, anchorCount = m && Array.isArray(m.anchor_ids) ? m.anchor_ids.length : null;
    const staleReasons = [];
    if (qsa !== null && qsa >= 4) staleReasons.push(`최근 실측이 ${fmt(qsa)}분기 전`);
    if (anchorCount !== null && anchorCount <= 1) staleReasons.push(`앵커 ${anchorCount}개`);
    if (actualRows.length <= 1) staleReasons.push('실측 1개 분기');
    if (m && /sparse|flat/i.test(String(m.method))) staleReasons.push(`${pickStr(m, ['method_label_ko']) || m.method} (평탄·희소 시나리오)`);
    if (staleReasons.length) dashboard.append(el('p', `주의: ${staleReasons.join(' · ')} · 추정값은 최신 실측값이 아니며 새 증거가 아닙니다.`, 'iv-warning iv-stale'));
    const kpis = el('div', null, 'iv-kpis iv-kpis-model');
    const card = (label, value, note, cls = '', badge = null) => { const n = el('div', null, `iv-kpi ${cls}`); n.append(el('span', label)); if (badge) n.append(el('span', badge[0], `iv-badge ${badge[1]}`)); n.append(el('strong', value), el('small', note)); return n; };
    if (lastActual) kpis.append(card('최근 실측 (실제 분기)', bound(lastActual.obs), `${periodLabel(lastActual.obs, s)} · ${timingLabel(lastActual.obs, s)}${lastActual.partial ? ' · 현재 분기 부분 실측' : ''}`, lastActual.partial ? 'iv-kpi-partial' : '', ['실측', 'iv-badge-actual']));
    else kpis.append(card('최근 실측', '—', '대표 실측값 미선택 (복수 관측)', '', ['실측 없음', 'iv-badge-gap']));
    const currentLabel = `현재 분기 ${s.calendar === 'fiscal' ? 'FY ' : ''}${track.current_quarter}`;
    if (!currentRow) kpis.append(card(currentLabel, '—', '모델 레이어에 현재 분기 행 없음', '', ['없음', 'iv-badge-gap']));
    else if (currentRow.kind === 'actual') kpis.append(card(currentLabel, bound(currentRow.obs), `실측 · 부분 분기 (분기 미완료, 기준일 ${projections.as_of}) · ${timingLabel(currentRow.obs, s)}`, 'iv-kpi-partial', ['부분 실측', 'iv-badge-partial']));
    else if (currentRow.kind === 'estimate') kpis.append(card(currentLabel, estBound(currentRow, unit), `${basisLabel(currentRow.basis, currentRow.status)} · ${pickStr(currentRow.point.model, ['method_label_ko']) || currentRow.point.model.method}${boundOnly(currentRow) ? ' · 경계 시나리오' : ''}`, 'iv-kpi-now', [statusLabels[currentRow.status], 'iv-badge-now']));
    else kpis.append(card(currentLabel, currentRow.kind === 'ambiguous' ? `${currentRow.extras.length}건` : '—', currentRow.reason || statusLabels[currentRow.status], '', [currentRow.kind === 'ambiguous' ? '복수 관측' : '추정 불가', 'iv-badge-gap']));
    if (horizonRow) {
      const ahead = horizonRow.position - currentPos, hm = horizonRow.point.model, hq = pickNum(hm, ['quarters_since_actual']);
      kpis.append(card(`${s.calendar === 'fiscal' ? 'FY ' : ''}${horizonRow.quarter} 전망 (+${ahead}분기)`, estBound(horizonRow, unit), `${basisLabel(horizonRow.basis, horizonRow.status)} · ${pickStr(hm, ['method_label_ko']) || hm.method} · 신뢰도 ${pickStr(hm, ['confidence_label_ko']) || '미제공'} · 최근 실측 이후 ${hq === null ? '?' : fmt(hq)}분기${boundOnly(horizonRow) ? ' · 경계 시나리오' : ''}`, 'iv-kpi-fc', [horizonRow.basis.kind === 'publisher' ? basisLabel(horizonRow.basis, 'forecast', true) : '자체 모델 전망', horizonRow.basis.kind === 'publisher' ? 'iv-badge-pub' : 'iv-badge-fc']));
    } else kpis.append(card('3분기 후 전망', '—', '전망 행 없음 (미지원 또는 추정 불가)', '', ['없음', 'iv-badge-gap']));
    const bt = backtestSummary(track.backtest);
    kpis.append(card('모델 품질·최신성', bt.text, `최근 실측 ${lastActual ? periodLabel(lastActual.obs, s) : '없음'} · 기준일 ${projections.as_of} · 모델 ${projections.model_version} · 실측 ${actualRows.length}분기 / 추정 ${rows.filter(r => r.kind === 'estimate').length}분기`, bt.weak ? 'iv-kpi-partial' : ''));
    dashboard.append(kpis);
    const toolbar = el('div', null, 'iv-chart-tools'), modes = el('div', null, 'iv-mode'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '재고 그래프 표현');
    const levelButton = el('button', '재고 주수'), changeButton = el('button', '전분기 대비 %');
    levelButton.type = changeButton.type = 'button'; modes.append(levelButton, changeButton);
    const spanLabel = el('label', '표시 기간'), span = el('select'); span.setAttribute('aria-label', `${s.entity} 재고 표시 기간`);
    [['all', '전체 분기'], ['12', '최근 12분기']].forEach(([value, label]) => { const option = el('option', label); option.value = value; span.append(option); }); spanLabel.append(span);
    const scaleLabel = el('label', '세로축'), scaleSelect = el('select'); scaleSelect.setAttribute('aria-label', `${s.entity} 재고 세로축`);
    [['focus', '변화 강조'], ['zero', '0부터 보기']].forEach(([value, label]) => { const option = el('option', label); option.value = value; scaleSelect.append(option); }); scaleLabel.append(scaleSelect);
    toolbar.append(modes, spanLabel, scaleLabel); dashboard.append(toolbar);
    const plot = el('div'), detail = el('div', null, 'iv-detail'); detail.setAttribute('aria-live', 'polite');
    let mode = 'level';
    const draw = () => {
      levelButton.setAttribute('aria-pressed', String(mode === 'level')); changeButton.setAttribute('aria-pressed', String(mode === 'change')); scaleLabel.hidden = mode !== 'level';
      const visible = span.value === '12' ? rows.slice(-12) : rows;
      plot.replaceChildren(modeledGraph(visible, s, track, detail, mode, scaleSelect.value));
      requestAnimationFrame(() => { const scroll = plot.querySelector('.iv-plot-scroll'); if (scroll) scroll.scrollLeft = scroll.scrollWidth; });
      if (lastActual) actualDetail(detail, lastActual, lastActual.obs, s, unit, '');
      else if (currentRow && currentRow.kind === 'estimate') estimateDetail(detail, currentRow, s, track, unit);
      else { detail.replaceChildren(el('p', '관측점 또는 추정점을 선택하면 값·변화율·근거가 표시됩니다.', 'iv-caption')); }
    };
    levelButton.addEventListener('click', () => { mode = 'level'; draw(); }); changeButton.addEventListener('click', () => { mode = 'change'; draw(); });
    span.addEventListener('change', draw); scaleSelect.addEventListener('change', draw);
    dashboard.append(plot, el('p', '그래프를 좌우로 이동해 전체 분기를 확인하세요. 실측점은 원문 근거를, 추정점은 산식·모수·앵커·가정·최근 실측 경과·백테스트를 표시합니다. 추정은 관측으로 집계하지 않습니다.', 'iv-caption'), detail);
    const tools = el('div', null, 'iv-model-toolbar');
    const modelCsv = el('button', '이 시리즈 모델 레이어 CSV (추정 포함 · 원장 아님)'); modelCsv.type = 'button';
    modelCsv.addEventListener('click', () => download(modelCsvText([s.id]), `inventory-model-layer-${s.id}.csv`));
    tools.append(modelCsv); dashboard.append(tools);
    const notes = el('details', null, 'iv-chart-notes'); notes.append(el('summary', '분기 비교·추정 표시 방법'));
    notes.append(el('p', '실측 간 비교 규칙은 실측 전용 화면과 같습니다: 인접한 두 분기에 각각 한 관측이 있고 계열·출처·측정 기준이 같을 때만 연결하고 변화율을 계산합니다. 추정점은 직전 실측 구간의 측정 기준·출처를 승계하며, 기준이 바뀌면 연결하지 않습니다. 실측과 추정 또는 추정끼리의 비교는 “추정 포함”으로 표시하고 실측 변화율로 간주하지 않습니다. 출처 추정·전망과 자체 모델 사이의 변화율은 계산하지 않습니다.'));
    notes.append(el('p', '실선은 실측, 점선은 추정에 닿는 구간입니다. 황색은 과거 공백의 사후 추정(미래 앵커 사용 가능), 청색은 현재 분기 추정, 보라색은 전망입니다. ◆는 발행사 추정 (e)/전망 (f)이며 자체 모델 수치와 섞지 않습니다. 민감도 범위는 가정 기반 포락선이며 검증된 신뢰구간이 아닙니다. 미만·이상 경계는 경계를 유지하는 조건부 시나리오로만 표시합니다. FY 회계분기 표기와 기업 전체·제품별 구분은 그대로 유지합니다.'));
    const method = el('details', null, 'iv-chart-notes'); method.append(el('summary', '이 계열의 모델 방법론·백테스트'));
    if (pickStr(track, ['methodology_ko'])) method.append(el('p', track.methodology_ko));
    if (projections.methodology_ko) method.append(el('p', projections.methodology_ko));
    method.append(el('p', `백테스트: ${bt.text}`));
    if (isObject(track.backtest)) {
      const scalars = Object.fromEntries(Object.entries(track.backtest).filter(([, v]) => v === null || ['number', 'string', 'boolean'].includes(typeof v)));
      if (Object.keys(scalars).length) method.append(scalarList(scalars));
      const limits = Array.isArray(track.backtest.limitations_ko) ? track.backtest.limitations_ko.filter(t => typeof t === 'string') : [];
      if (limits.length) { const ul = el('ul'); limits.forEach(t => ul.append(el('li', t))); method.append(ul); }
    }
    if (isObject(track.stats)) method.append(el('p', `모델 파일 집계: ${Object.entries(track.stats).map(([k, v]) => `${k} ${Number.isFinite(v) ? fmt(v) : String(v)}`).join(' · ')} (화면 집계는 원장 연결 기준)`, 'iv-caption'));
    method.append(el('p', `모델 ${projections.model_version} · 기준일 ${projections.as_of} · 달력 현재 분기 ${projections.current_quarter} · 이 계열 현재 분기 ${s.calendar === 'fiscal' ? 'FY ' : ''}${track.current_quarter} · 전망 지평 +${projections.horizon_quarters}분기`, 'iv-caption'));
    dashboard.append(notes, method);
    const rawTable = el('details', null, 'iv-raw-table'); rawTable.append(el('summary', `관측 원장 (실측만) · ${obs.length}건`), table(obs, s)); dashboard.append(rawTable); draw();
    return dashboard;
  }
  function rolePanel(product, role) {
    const panel = el('section', null, 'iv-panel');
    panel.append(el('h3', role === 'manufacturer' ? '제조사 재고' : '고객 재고 · 유통 채널'));
    const series = data.series.filter(s => s.product_id === product.id && (role === 'manufacturer' ? s.role === role : ['customer', 'channel'].includes(s.role))).sort((a,b)=>(a.metric==='reported_wos'?0:1)-(b.metric==='reported_wos'?0:1) || data.observations.filter(o=>o.series_id===b.id).length-data.observations.filter(o=>o.series_id===a.id).length);
    const coverage = data.coverage.find(c => c.product_id === product.id);
    const count = data.observations.filter(o => series.some(s => s.id === o.series_id)).length;
    if (!count) panel.append(el('p', '이 역할에서 확인된 수치 출처가 없습니다. 재고가 0이라는 의미는 아닙니다.', 'iv-empty'));
    if (coverage) panel.append(el('p', `${role === 'manufacturer' ? coverage.manufacturer_status : coverage.customer_status} · ${coverage.note || ''}`, 'iv-caption'));
    if (!series.length) return panel;
    const label = el('label', '회사·출처 시리즈 선택'), select = el('select');
    series.forEach(s => {
      const sourceNames = [...new Set(data.observations.filter(o => o.series_id === s.id).map(o => data.sources.find(src => src.id === o.source_id).publisher))].join(', ');
      const option = el('option', `${s.entity} · ${s.name} · ${s.role === 'channel' ? '유통 채널 (channel)' : s.role === 'customer' ? '고객 (customer)' : '제조사 (manufacturer)'} · ${metricLabel(s)} · ${sourceNames || '수치 출처 없음'}`);
      option.value = s.id; select.append(option);
    });
    const choiceKey = `${product.id}:${role}`;
    if (seriesChoice.has(choiceKey) && series.some(s => s.id === seriesChoice.get(choiceKey))) select.value = seriesChoice.get(choiceKey);
    label.append(select); panel.append(label);
    const content = el('div'); panel.append(content);
    function renderSeries() {
      const s = series.find(v => v.id === select.value);
      content.replaceChildren();
      content.append(el('p', metricLabel(s), 'iv-badge'));
      if(s.evidence_tier === 'secondary') content.append(el('p','LS증권 재인용 · TrendForce 원자료 별도 미확인','iv-secondary'));
      if (companywide(s)) content.append(el('p', '기업 전체 참고 · 제품별 재고 아님', 'iv-warning'));
      const method = el('details', null, 'iv-series-method'); method.append(el('summary', `${s.entity} · 범위와 측정 방법`), el('p', `역할: ${s.role === 'channel' ? '유통 채널' : s.role === 'customer' ? '고객' : '제조사'} · 범위: ${s.scope || '미상'}`), el('p', s.method_ko), el('p', s.note, 'iv-caption')); content.append(method);
      const obs = data.observations.filter(o => o.series_id === s.id).sort((a, b) => quarterPosition(a) - quarterPosition(b));
      if (!obs.length) { content.append(el('p', '이 시리즈에는 수치 관측치가 없습니다.', 'iv-empty')); return; }
      if (overlay === 'estimate' && projectionStatus.state === 'ready') {
        let note = '';
        try {
          const bound_ = bindTrack(s, obs);
          if (bound_.rows) { content.append(modeledDashboard(obs, s, bound_.track, bound_.rows)); return; }
          note = bound_.error;
        } catch (error) { note = `추정 표시 오류 · ${error && error.message ? error.message : String(error)}`; }
        content.append(el('p', `실측 전용으로 표시 · ${note}`, 'iv-estimate-status iv-status-note'));
      }
      content.append(seriesDashboard(obs, s));
    }
    select.addEventListener('change', () => { seriesChoice.set(choiceKey, select.value); renderSeries(); }); renderSeries(); return panel;
  }
  const csvCell = value => {
    let text = value == null ? '' : String(value);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  function csvText() {
    const headers = ['id', 'series_id', 'product_id', 'product_name', 'entity', 'series_name', 'role', 'scope', 'scope_level', 'calendar', 'evidence_tier', 'metric', 'method_ko', 'series_note', 'quarter', 'period_label', 'period_start', 'period_end', 'as_of', 'observation_timing', 'observation_timing_display', 'measure_type', 'value_min', 'value_max', 'qualifier', 'upper_open', 'raw_value_min', 'raw_value_max', 'raw_unit', 'conversion', 'narrative_ko', 'inputs', 'source_id', 'source_ids', 'source_urls', 'period_end_source_url', 'publisher', 'title', 'url', 'published_at', 'locator'];
    const rows = data.observations.map(o => {
      const s = data.series.find(v => v.id === o.series_id), source = data.sources.find(v => v.id === o.source_id), p = data.products.find(v => v.id === s.product_id);
      const row = { ...source, ...s, ...o, series_name: s.name, series_note: s.note, product_name: p.name, observation_timing_display:timingLabel(o,s), inputs: o.inputs ? JSON.stringify(o.inputs) : '', evidence_tier:o.evidence_tier || s.evidence_tier || 'primary', source_ids:JSON.stringify(o.source_ids || [o.source_id]), source_urls:JSON.stringify((o.source_ids || [o.source_id]).map(id=>safeURL(data.sources.find(v=>v.id===id).url))), upper_open: o.upper_open === true, url: safeURL(source.url) || '' };
      return headers.map(k => csvCell(row[k])).join(',');
    });
    return '﻿' + [headers.map(csvCell).join(','), ...rows].join('\r\n');
  }
  // Model-layer CSV: every point carries status/basis/method/anchor/as_of provenance. Never the raw ledger.
  function modelCsvText(seriesIds = null) {
    const headers = ['layer', 'model_version', 'as_of', 'current_quarter_calendar', 'horizon_quarters', 'series_id', 'track_current_quarter', 'product_id', 'product_name', 'entity', 'series_name', 'role', 'scope', 'scope_level', 'calendar', 'metric', 'unit', 'quarter', 'period_label', 'status', 'status_label', 'is_estimate', 'basis', 'basis_label', 'publisher_flag', 'publisher', 'vintage', 'value_lower', 'value_upper', 'qualifier', 'upper_open', 'level_label', 'selection_status', 'selection_note', 'observation_count', 'observation_ids', 'connect_previous', 'source_change', 'scope_break', 'comparison_key', 'method', 'method_label_ko', 'explanation_ko', 'anchor_ids', 'anchor_quarters', 'anchor_source_urls', 'parameters', 'last_actual_quarter', 'quarters_since_actual', 'confidence_label_ko', 'sensitivity_lower', 'sensitivity_upper', 'sensitivity_label_ko', 'limitations_ko', 'narrative_ko', 'source_url', 'ui_ledger_binding'];
    const lines = [];
    Object.values(projections.inventory).forEach(track => {
      if (seriesIds && !seriesIds.includes(track.id)) return;
      const s = data.series.find(v => v.id === track.id) || null, p = s ? data.products.find(v => v.id === s.product_id) : null;
      let binding = 'ok';
      if (s) { try { const b = bindTrack(s, data.observations.filter(o => o.series_id === s.id)); if (!b.rows) binding = `error: ${b.error}`; } catch (error) { binding = `error: ${error && error.message ? error.message : String(error)}`; } }
      else binding = 'error: 원장에 없는 시리즈';
      track.points.forEach(pt => {
        const m = isObject(pt.model) ? pt.model : null, basis = pt.is_estimate ? basisOf(pt) : null, L = isObject(pt.level) ? pt.level : {};
        const row = {
          layer: 'model (estimates included; not raw ledger)', model_version: projections.model_version, as_of: projections.as_of, current_quarter_calendar: projections.current_quarter, horizon_quarters: projections.horizon_quarters,
          series_id: track.id, track_current_quarter: track.current_quarter, product_id: s ? s.product_id : '', product_name: p ? p.name : '', entity: s ? s.entity : '', series_name: s ? s.name : (track.label || ''), role: s ? s.role : '', scope: s ? s.scope : (pt.scope || ''), scope_level: s ? s.scope_level : '', calendar: s ? s.calendar : (track.calendar || ''), metric: s ? s.metric : '', unit: track.unit,
          quarter: pt.quarter, period_label: `${(s ? s.calendar : track.calendar) === 'fiscal' ? 'FY ' : ''}${pt.quarter}`, status: pt.status, status_label: statusLabels[pt.status] || pt.status, is_estimate: pt.is_estimate,
          basis: basis ? (basis.kind === 'publisher' ? 'publisher_source' : 'own_model') : 'actual', basis_label: basis ? basisLabel(basis, pt.status) : '실측', publisher_flag: basis ? (basis.flag || '') : '', publisher: basis ? basis.publisher : (pt.publisher || ''), vintage: basis ? basis.vintage : '',
          value_lower: L.lower ?? '', value_upper: L.upper ?? '', qualifier: L.qualifier ?? '', upper_open: L.upper_open === true, level_label: L.label ?? '',
          selection_status: pt.selection_status ?? '', selection_note: pt.selection_note ?? '', observation_count: Number.isFinite(pt.observation_count) ? pt.observation_count : pt.observation_ids.length, observation_ids: JSON.stringify(pt.observation_ids), connect_previous: pt.connect_previous ?? '', source_change: pt.source_change ?? '', scope_break: pt.scope_break ?? '', comparison_key: pt.comparison_key ?? '',
          method: m ? m.method : '', method_label_ko: m ? (m.method_label_ko ?? '') : '', explanation_ko: m ? (m.explanation_ko ?? '') : '', anchor_ids: m && Array.isArray(m.anchor_ids) ? JSON.stringify(m.anchor_ids) : '', anchor_quarters: m && Array.isArray(m.anchor_quarters) ? JSON.stringify(m.anchor_quarters) : '', anchor_source_urls: m && Array.isArray(m.anchor_sources) ? JSON.stringify(m.anchor_sources.map(a => isObject(a) ? safeURL(a.url) : null)) : '', parameters: m && isObject(m.parameters) ? JSON.stringify(m.parameters) : '',
          last_actual_quarter: m ? (m.last_actual_quarter ?? '') : '', quarters_since_actual: m ? (m.quarters_since_actual ?? '') : '', confidence_label_ko: m ? (m.confidence_label_ko ?? '') : '',
          sensitivity_lower: m && isObject(m.sensitivity) ? (m.sensitivity.lower ?? '') : '', sensitivity_upper: m && isObject(m.sensitivity) ? (m.sensitivity.upper ?? '') : '', sensitivity_label_ko: m && isObject(m.sensitivity) ? (m.sensitivity.label_ko ?? '') : '', limitations_ko: m && Array.isArray(m.limitations_ko) ? JSON.stringify(m.limitations_ko) : '',
          narrative_ko: pt.narrative_ko ?? '', source_url: safeURL(pt.source_url) || '', ui_ledger_binding: binding
        };
        lines.push(headers.map(k => csvCell(row[k])).join(','));
      });
    });
    return '﻿' + [headers.map(csvCell).join(','), ...lines].join('\r\n');
  }
  function download(text, filename) {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = el('a'); a.href = url; a.download = filename; mount.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function estimateBar() {
    const bar = el('section', null, 'iv-estimate-bar'); bar.setAttribute('aria-label', '실측·추정 표시 설정');
    const modes = el('div', null, 'iv-mode'); modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '실측만 또는 실측+추정 표시');
    const actualButton = el('button', '실측만'), estimateButton = el('button', '실측+추정', 'iv-mode-estimate');
    actualButton.type = estimateButton.type = 'button'; modes.append(actualButton, estimateButton);
    const meta = el('p', null, 'iv-estimate-meta'), status = el('p', null, 'iv-estimate-status'); status.setAttribute('role', 'status');
    const method = el('details'); method.append(el('summary', '추정 레이어 방법론·설정'));
    const methodBody = el('div'); method.append(methodBody);
    bar.append(modes, meta, status, method);
    updateEstimateBar = () => {
      const ready = projectionStatus.state === 'ready';
      const showing = ready && overlay === 'estimate';
      actualButton.setAttribute('aria-pressed', String(!showing)); estimateButton.setAttribute('aria-pressed', String(showing));
      estimateButton.disabled = !ready; estimateButton.title = ready ? '' : '추정 레이어를 불러온 뒤 사용할 수 있습니다';
      status.replaceChildren(); status.className = `iv-estimate-status iv-status-${projectionStatus.state === 'ready' ? 'ok' : projectionStatus.state === 'loading' ? 'loading' : 'error'}`;
      methodBody.replaceChildren(); method.hidden = !ready;
      if (ready) {
        const n = Object.keys(projections.inventory).length, failed = projections.trackErrors.size, unsupported = projections.unsupported.length;
        meta.replaceChildren();
        meta.append(el('strong', `현재 분기 ${projections.current_quarter}`), ` · 기준일 ${projections.as_of} · 전망 +${projections.horizon_quarters}분기 (현재+1 ~ +${projections.horizon_quarters}) · 모델 ${projections.model_version}`);
        status.append(`추정 레이어 로드 완료 · 재고 시리즈 ${n}개${failed ? ` · 검증 실패 ${failed}개 (실측 전용으로 표시)` : ''}${unsupported ? ` · 모델 미지원 ${unsupported}개` : ''} · 추정은 관측으로 집계하지 않으며 원장·원문 CSV는 그대로입니다.`);
        if (!showing) status.append(' 현재 실측만 표시 중입니다.');
        const csv = el('button', '전체 모델 레이어 CSV (추정 포함 · 원장 아님)'); csv.type = 'button'; csv.addEventListener('click', () => download(modelCsvText(), 'inventory-model-layer.csv')); status.append(csv);
        const retry = el('button', '추정 레이어 다시 불러오기'); retry.type = 'button'; retry.addEventListener('click', loadProjections); status.append(retry);
        if (projections.methodology_ko) methodBody.append(el('p', projections.methodology_ko));
        methodBody.append(el('p', '실측(관측 원장)은 변경되지 않습니다. 추정점은 status(과거 공백 추정 / 현재 분기 추정 / 전망), 기준(자체 모델 / 출처 추정 (e) / 출처 전망 (f)), 산식·모수·앵커·가정·백테스트를 함께 표시합니다. 미만·이상 경계는 경계 조건부 시나리오로만, FY 회계분기와 기업 전체·제품별 구분은 그대로 유지합니다. 민감도 범위는 가정 기반이며 신뢰구간이 아닙니다.'));
        if (failed) { const ul = el('ul'); projections.trackErrors.forEach((message, id) => ul.append(el('li', `${id}: ${message}`))); methodBody.append(el('p', '검증 실패 시리즈 (실측 전용으로 표시)', 'iv-timing'), ul); }
        if (unsupported) { const ul = el('ul'); projections.unsupported.forEach(e => ul.append(el('li', typeof e === 'string' ? `${e}: 사유 미제공` : `${pickStr(e, ['id', 'series_id', 'track_id']) || '?'}: ${pickStr(e, ['reason_ko', 'reason', 'note_ko', 'note']) || '사유 미제공'}`))); methodBody.append(el('p', '모델 미지원 (사유)', 'iv-timing'), ul); }
        if (projections.config) { methodBody.append(el('p', '설정 (config)', 'iv-timing'), el('pre', JSON.stringify(projections.config, null, 1), 'iv-pre')); }
        if (projections.stats) { methodBody.append(el('p', '모델 파일 집계 (stats)', 'iv-timing'), el('pre', JSON.stringify(projections.stats, null, 1), 'iv-pre')); }
      } else {
        meta.replaceChildren(el('strong', '실측만 표시'), ' · 추정 레이어(projections.json)는 별도 파일이며 실측 원장과 분리되어 있습니다.');
        if (projectionStatus.state === 'loading') status.append('추정 레이어를 불러오는 중입니다… 실측은 이미 표시되어 있습니다.');
        else if (projectionStatus.state === 'error') {
          status.append(`추정 레이어를 불러오지 못해 실측만 표시합니다 · ${projectionStatus.message}`);
          const retry = el('button', '추정 레이어 다시 불러오기'); retry.type = 'button'; retry.addEventListener('click', loadProjections); status.append(retry);
        } else status.append('추정 레이어 미로드 · 실측만 표시합니다.');
      }
    };
    actualButton.addEventListener('click', () => { if (overlay === 'actual') return; overlay = 'actual'; updateEstimateBar(); refreshSelected(); });
    estimateButton.addEventListener('click', () => { if (overlay === 'estimate' || projectionStatus.state !== 'ready') return; overlay = 'estimate'; updateEstimateBar(); refreshSelected(); });
    updateEstimateBar();
    return bar;
  }
  function render() {
    mount.replaceChildren();
    const header = el('header', null, 'iv-header');
    header.append(el('p', 'ENSEMBLE / INVENTORY EVIDENCE', 'iv-eyebrow'), el('h2', '재고, 분기마다 얼마나 변했나'), el('p', data.intro_ko), el('p', `자료 갱신: ${data.updated_at}`, 'iv-caption'));
    const summary = el('div', null, 'iv-summary');
    summary.append(el('strong', `출처 연결 관측치 ${data.observations.length}건`), el('span', `비교 계열 ${data.series.length}개`), el('span', '기업 전체 재무 참고 포함 · 제품 전체 커버리지 아님'));
    const updatesLink=el('a','발간별 한국어 재고 업데이트');updatesLink.href=new URL('inventory-updates.md',scriptURL).href;updatesLink.target='_blank';updatesLink.rel='noopener noreferrer';header.append(summary,updatesLink);mount.append(header);
    mount.append(estimateBar());
    const method = el('details', null, 'iv-method'); method.append(el('summary', '방법론과 지표 구분'));
    method.append(el('p', '납기는 주문~인도, 재고 주수는 보유재고의 소진기간으로 서로 다른 지표입니다. DIO 주수는 재무 회전기간이며 제품 물량 기반 재고 주수와 구분합니다.'), el('p', '직접 보고 제품 재고 주수, 제품별·전사 보고 재고일수 환산, 계산된 전사 재무 참고를 구분합니다. 기업 전체 지표의 제조사·고객 역할은 발행사의 공급 관계 문맥이며 제품별 재고 근거가 아닙니다. 미상 범위와 집계 고객은 원문대로 유지합니다.'), el('p', '각 계열의 달력분기 또는 FY 회계분기를 보존합니다. 동일 계열·출처·측정 기준의 인접 분기만 비교합니다. 분기 초·중·말과 측정시점 미확인을 구분합니다. 원문 범위의 하단과 상단은 각각 계산하며 누락 분기·측정 기준 변경은 그래프의 공백으로 남깁니다. 환산값은 제공 데이터를 사용하고 화면은 최대 소수 둘째 자리로 표시합니다.'), el('p', '추정 레이어(실측+추정)는 별도 모델 파일에서 읽으며 실측 원장과 원문 CSV에는 영향을 주지 않습니다. 추정값은 점선·상태 배지·기준(자체 모델 / 출처 추정·전망)으로 구분하고 소수 첫째 자리까지만 표시합니다.'));
    mount.append(method);
    const controls = el('div', null, 'iv-controls'), searchLabel = el('label', '제품 검색'), search = el('input');
    search.type = 'search'; search.placeholder = '제품명 또는 메모'; search.value = query;
    searchLabel.append(search);
    const pickerLabel = el('label', '제품 선택'), picker = el('select'); pickerLabel.append(picker);
    const exportButton = el('button', '전체 관측치 CSV'); exportButton.type = 'button';
    exportButton.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([csvText()], { type: 'text/csv;charset=utf-8' }));
      const a = el('a'); a.href = url; a.download = 'inventory-observations.csv'; mount.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    controls.append(searchLabel, pickerLabel, exportButton); mount.append(controls);
    const selected = el('section', null, 'iv-selected'); mount.append(selected);
    function selectProduct() {
      chosen = picker.value; selected.replaceChildren();
      const p = data.products.find(v => v.id === chosen);
      if (!p) { selected.append(el('p', '검색에 맞는 제품이 없습니다.', 'iv-empty')); return; }
      selected.append(el('h3', p.name), el('p', p.note));
      const grid = el('div', null, 'iv-roles'); grid.append(rolePanel(p, 'manufacturer'), rolePanel(p, 'customer')); selected.append(grid);
    }
    refreshSelected = selectProduct;
    function filterProducts() {
      query = search.value; picker.replaceChildren();
      data.products.filter(p => `${p.name} ${p.note || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).forEach(p => { const o = el('option', p.name); o.value = p.id; picker.append(o); });
      if ([...picker.options].some(o => o.value === chosen)) picker.value = chosen;
      picker.disabled = !picker.options.length; selectProduct();
    }
    search.addEventListener('input', filterProducts); picker.addEventListener('change', selectProduct); filterProducts();
    const coverage = el('section', null, 'iv-coverage'); coverage.append(el('h3', '전체 제품 근거 현황'), el('p', '상태는 제공된 조사 현황입니다. 자료 없음은 재고 0 또는 조사 완료를 뜻하지 않습니다. 기업 전체 재무 참고는 제품별 재고 커버리지로 집계하지 않습니다. 추정 레이어는 커버리지에 포함하지 않습니다.', 'iv-caption'));
    const ct = el('table'); ct.append(el('caption', '모든 제품의 제조사·고객 근거 상태'));
    const ch = el('thead'), cr = el('tr'); ['제품', '제조사 상태', '고객·유통 상태', '조사 메모 / 출처'].forEach(v => { const th = el('th', v); th.scope = 'col'; cr.append(th); }); ch.append(cr); ct.append(ch);
    const cb = el('tbody');
    data.products.forEach(p => {
      const c = data.coverage.find(v => v.product_id === p.id), row = el('tr');
      row.append(el('td', p.name), el('td', c ? c.manufacturer_status : '현황 미제공'), el('td', c ? c.customer_status : '현황 미제공'));
      const note = el('td', c ? c.note : '수치 근거 여부를 확인할 조사 메모가 없습니다.');
      (c && Array.isArray(c.source_urls) ? c.source_urls : []).forEach((url, i) => { const p = el('p'); p.append(link({ url, publisher: '조사 출처', title: String(i + 1) })); note.append(p); });
      row.append(note); cb.append(row);
    });
    ct.append(cb); const cw = el('div', null, 'iv-table-wrap'); cw.append(ct); coverage.append(cw); mount.append(coverage);
    const archive = el('details', null, 'iv-archive'); archive.append(el('summary', `전체 출처 아카이브 (${data.sources.length}건)`));
    const list = el('ul'); data.sources.forEach(s => { const li = el('li'); li.append(link(s), el('p', `${s.published_at || '발행일 미제공'} · ${s.locator || '위치 미제공'} · ${s.id}`, 'iv-caption')); list.append(li); }); archive.append(list); mount.append(archive);
    if (!data.observations.length) header.append(el('p', '현재 공개된 수치 관측치가 없습니다. 제품별 조사 상태와 출처를 확인하세요.', 'iv-empty'));
  }
  // Loads projections.json separately. Any failure keeps the actual-only UI and shows status + retry.
  async function loadProjections() {
    projections = null; projectionStatus = { state: 'loading', message: '' };
    updateEstimateBar(); refreshSelected();
    try {
      if (!scriptURL) throw new Error('스크립트 주소를 확인할 수 없습니다.');
      const response = await fetch(new URL('projections.json', scriptURL), { credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error(`요청 실패 (${response.status})`);
      const layer = validateProjections(await response.json());
      projections = layer; projectionStatus = { state: 'ready', message: '' };
    } catch (error) {
      projections = null; projectionStatus = { state: 'error', message: error && error.message ? error.message : String(error) };
    }
    updateEstimateBar(); refreshSelected();
  }
  async function start() {
    mount.replaceChildren(el('p', '재고 근거 자료를 불러오는 중입니다…', 'iv-state'));
    mount.setAttribute('aria-busy', 'true');
    try {
      if (!scriptURL) throw new Error('스크립트 주소를 확인할 수 없습니다.');
      const response = await fetch(new URL('inventory.json', scriptURL), { credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error(`자료 요청 실패 (${response.status})`);
      data = validate(await response.json()); render();
      loadProjections();
    } catch (error) {
      const box = el('div', null, 'iv-state'); box.setAttribute('role', 'alert');
      box.append(el('h2', '재고 자료를 표시할 수 없습니다'), el('p', '자료 파일과 형식을 확인한 뒤 다시 시도해 주세요.'), el('p', error.message, 'iv-caption'));
      const retry = el('button', '다시 불러오기'); retry.type = 'button'; retry.addEventListener('click', start); box.append(retry); mount.replaceChildren(box);
    } finally { mount.setAttribute('aria-busy', 'false'); }
  }
  start();
})();
