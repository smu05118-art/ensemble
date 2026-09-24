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
  let data, chosen = '', query = '';
  const fmt = n => new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 }).format(n);
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
      content.append(seriesDashboard(obs, s));
    }
    select.addEventListener('change', renderSeries); renderSeries(); return panel;
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
    return '\uFEFF' + [headers.map(csvCell).join(','), ...rows].join('\r\n');
  }
  function render() {
    mount.replaceChildren();
    const header = el('header', null, 'iv-header');
    header.append(el('p', 'ENSEMBLE / INVENTORY EVIDENCE', 'iv-eyebrow'), el('h2', '재고, 분기마다 얼마나 변했나'), el('p', data.intro_ko), el('p', `자료 갱신: ${data.updated_at}`, 'iv-caption'));
    const summary = el('div', null, 'iv-summary');
    summary.append(el('strong', `출처 연결 관측치 ${data.observations.length}건`), el('span', `비교 계열 ${data.series.length}개`), el('span', '기업 전체 재무 참고 포함 · 제품 전체 커버리지 아님'));
    const updatesLink=el('a','발간별 한국어 재고 업데이트');updatesLink.href=new URL('inventory-updates.md',scriptURL).href;updatesLink.target='_blank';updatesLink.rel='noopener noreferrer';header.append(summary,updatesLink);mount.append(header);
    const method = el('details', null, 'iv-method'); method.append(el('summary', '방법론과 지표 구분'));
    method.append(el('p', '납기는 주문~인도, 재고 주수는 보유재고의 소진기간으로 서로 다른 지표입니다. DIO 주수는 재무 회전기간이며 제품 물량 기반 재고 주수와 구분합니다.'), el('p', '직접 보고 제품 재고 주수, 제품별·전사 보고 재고일수 환산, 계산된 전사 재무 참고를 구분합니다. 기업 전체 지표의 제조사·고객 역할은 발행사의 공급 관계 문맥이며 제품별 재고 근거가 아닙니다. 미상 범위와 집계 고객은 원문대로 유지합니다.'), el('p', '각 계열의 달력분기 또는 FY 회계분기를 보존합니다. 동일 계열·출처·측정 기준의 인접 분기만 비교합니다. 분기 초·중·말과 측정시점 미확인을 구분합니다. 원문 범위의 하단과 상단은 각각 계산하며 누락 분기·측정 기준 변경은 그래프의 공백으로 남깁니다. 환산값은 제공 데이터를 사용하고 화면은 최대 소수 둘째 자리로 표시합니다.'));
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
    function filterProducts() {
      query = search.value; picker.replaceChildren();
      data.products.filter(p => `${p.name} ${p.note || ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).forEach(p => { const o = el('option', p.name); o.value = p.id; picker.append(o); });
      if ([...picker.options].some(o => o.value === chosen)) picker.value = chosen;
      picker.disabled = !picker.options.length; selectProduct();
    }
    search.addEventListener('input', filterProducts); picker.addEventListener('change', selectProduct); filterProducts();
    const coverage = el('section', null, 'iv-coverage'); coverage.append(el('h3', '전체 제품 근거 현황'), el('p', '상태는 제공된 조사 현황입니다. 자료 없음은 재고 0 또는 조사 완료를 뜻하지 않습니다. 기업 전체 재무 참고는 제품별 재고 커버리지로 집계하지 않습니다.', 'iv-caption'));
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
  async function start() {
    mount.replaceChildren(el('p', '재고 근거 자료를 불러오는 중입니다…', 'iv-state'));
    mount.setAttribute('aria-busy', 'true');
    try {
      if (!scriptURL) throw new Error('스크립트 주소를 확인할 수 없습니다.');
      const response = await fetch(new URL('inventory.json', scriptURL), { credentials: 'omit', redirect: 'error' });
      if (!response.ok) throw new Error(`자료 요청 실패 (${response.status})`);
      data = validate(await response.json()); render();
    } catch (error) {
      const box = el('div', null, 'iv-state'); box.setAttribute('role', 'alert');
      box.append(el('h2', '재고 자료를 표시할 수 없습니다'), el('p', '자료 파일과 형식을 확인한 뒤 다시 시도해 주세요.'), el('p', error.message, 'iv-caption'));
      const retry = el('button', '다시 불러오기'); retry.type = 'button'; retry.addEventListener('click', start); box.append(retry); mount.replaceChildren(box);
    } finally { mount.setAttribute('aria-busy', 'false'); }
  }
  start();
})();
