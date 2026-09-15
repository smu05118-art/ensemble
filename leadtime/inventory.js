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
  function quarterPosition(o) {
    if (o.period_end) return Date.parse(o.period_end + 'T00:00:00Z');
    const [year, q] = o.quarter.split('-Q').map(Number);
    // Internal placement only; this synthetic timestamp is never printed as a date.
    return Date.UTC(year, (q - 1) * 3 + 1, 15);
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
  function graph(obs, s, detail) {
    const wrap = el('div', null, 'iv-chart');
    const chart = svg('svg', { viewBox: '0 0 620 300', role: 'group', 'aria-label': `${s.name} 분기별 관측치. 연결선 없음. 아래 표에서 동일한 자료와 출처 확인 가능.` });
    chart.append(svg('title', {}, `${s.name}: 보고된 관측점과 범위`));
    const values = obs.flatMap(o => [o.value_min, o.value_max === null ? o.value_min : o.value_max]);
    const min = Math.min(...values), max = Math.max(...values);
    const top = max + Math.max(1, (max - min) * 0.18);
    const times = obs.map(quarterPosition), first = Math.min(...times), last = Math.max(...times);
    const x = t => first === last ? 330 : 70 + (t - first) / (last - first) * 450;
    const y = v => 230 - v / top * 180;
    [0, top / 2, top].forEach(v => {
      chart.append(svg('line', { x1: 65, x2: 570, y1: y(v), y2: y(v), class: 'iv-grid' }), svg('text', { x: 57, y: y(v) + 4, 'text-anchor': 'end', class: 'iv-axis' }, fmt(v)));
    });
    chart.append(svg('text', { x: 65, y: 20, class: 'iv-axis' }, s.metric === 'financial_dio_proxy' ? '계산값 (주)' : '주 단위 값'));
    const quarters = [...new Set(obs.map(o => o.quarter))].sort();
    const stride = Math.max(1, Math.ceil(quarters.length / 5));
    const ticks=quarters.map((q,i)=>i).filter(i=>i%stride===0);if(ticks.at(-1)!==quarters.length-1){if(quarters.length-1-ticks.at(-1)<stride)ticks.pop();ticks.push(quarters.length-1);}
    quarters.forEach((q, i) => {
      if (!ticks.includes(i)) return;
      const o = obs.find(v => v.quarter === q);
      chart.append(svg('text', { x: x(quarterPosition(o)), y: 257, 'text-anchor': 'middle', class: 'iv-axis' }, periodLabel(o,s)));
    });
    chart.append(svg('text', { x: 65, y: 287, class: 'iv-axis' }, `관측 경계 최솟값 ${fmt(min)}주 · 최댓값 ${fmt(max)}주`));
    obs.forEach(o => {
      const px = x(quarterPosition(o)), low = y(o.value_min), high = y(o.value_max === null ? o.value_min : o.value_max);
      const g = svg('g', { tabindex: '0', role: 'button', 'aria-label': `${periodLabel(o,s)}, ${bound(o)}. 상세 및 출처 보기`, class: 'iv-mark' });
      const title = `${periodLabel(o,s)} · ${bound(o)} · 종료 ${o.period_end || '미제공'} · 기준일 ${o.as_of || '미제공'}`;
      g.append(svg('title', {}, title), svg('rect', { x: px - 13, y: Math.min(high, low) - 18, width: 26, height: Math.abs(low - high) + 36, class: 'iv-hit' }));
      if (o.value_max !== null && o.value_max !== o.value_min) {
        g.append(svg('line', { x1: px, x2: px, y1: low, y2: high, class: 'iv-whisker' }), svg('line', { x1: px - 6, x2: px + 6, y1: low, y2: low, class: 'iv-whisker' }));
        g.append(svg('circle', { cx: px, cy: high, r: 4, class: o.upper_open ? 'iv-open' : 'iv-dot' }));
      } else {
        g.append(svg('circle', { cx: px, cy: low, r: 5, class: (['more_than', 'less_than', 'about'].includes(o.qualifier) || o.upper_open) ? 'iv-open' : 'iv-dot' }));
      }
      const symbol = { at_least: '≥', more_than: '>', less_than: '<', at_most: '≤', about: '≈' }[o.qualifier];
      if (symbol) g.append(svg('text', { x: px + 9, y: low - 7, class: 'iv-bound' }, symbol));
      const show = () => detail.replaceChildren(evidence(o, s));
      g.addEventListener('mouseenter', show); g.addEventListener('focus', show); g.addEventListener('click', show);
      g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(); } });
      chart.append(g);
    });
    const scroll=el('div',null,'iv-plot-scroll');scroll.setAttribute('tabindex','0');scroll.setAttribute('role','region');scroll.setAttribute('aria-label','분기 그래프 · 좌우로 이동 가능');scroll.append(chart);
    wrap.append(scroll, el('p', obs.length === 1 ? '단일 관측치 1건입니다. 추세를 뜻하지 않습니다.' : `${obs.length}개 분기 자료 · 연결선·보간 없음 · 누락 분기 채우지 않음`, 'iv-caption'));
    wrap.append(el('p', '범위는 경계와 수직선으로 표시하며 중간값은 생성하지 않습니다. ≥ / > / ≤ / < / ≈는 원문의 한계·근삿값입니다. 경계 최댓값은 미만·이상 자료의 확정 재고 최댓값이 아닙니다. 분기 위치는 종료일 우선이며, 종료일이 없으면 분기만 사용합니다. 표에서 정확한 날짜를 확인하세요. 작은 화면의 그래프는 좌우로 움직일 수 있습니다.', 'iv-caption'));
    return wrap;
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
      content.append(el('p', `역할: ${s.role === 'channel' ? '유통 채널 (channel)' : s.role === 'customer' ? '고객 (customer)' : '제조사 (manufacturer)'} · ${s.entity} · 범위: ${s.scope || '미상'}`), el('p', s.method_ko), el('p', s.note, 'iv-caption'));
      const obs = data.observations.filter(o => o.series_id === s.id).sort((a, b) => quarterPosition(a) - quarterPosition(b));
      if (!obs.length) { content.append(el('p', '이 시리즈에는 수치 관측치가 없습니다.', 'iv-empty')); return; }
      const detail = el('div', null, 'iv-detail');
      detail.append(evidence(obs[obs.length-1], s));
      content.append(graph(obs, s, detail), el('p', '점을 가리키거나 키보드로 선택하면 아래 근거가 바뀝니다.', 'iv-caption'), detail, table(obs, s));
    }
    select.addEventListener('change', renderSeries); renderSeries(); return panel;
  }
  const csvCell = value => {
    let text = value == null ? '' : String(value);
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  function csvText() {
    const headers = ['id', 'series_id', 'product_id', 'product_name', 'entity', 'series_name', 'role', 'scope', 'scope_level', 'calendar', 'evidence_tier', 'metric', 'method_ko', 'series_note', 'quarter', 'period_label', 'period_start', 'period_end', 'as_of', 'value_min', 'value_max', 'qualifier', 'upper_open', 'raw_value_min', 'raw_value_max', 'raw_unit', 'conversion', 'narrative_ko', 'inputs', 'source_id', 'source_ids', 'source_urls', 'period_end_source_url', 'publisher', 'title', 'url', 'published_at', 'locator'];
    const rows = data.observations.map(o => {
      const s = data.series.find(v => v.id === o.series_id), source = data.sources.find(v => v.id === o.source_id), p = data.products.find(v => v.id === s.product_id);
      const row = { ...source, ...s, ...o, series_name: s.name, series_note: s.note, product_name: p.name, inputs: o.inputs ? JSON.stringify(o.inputs) : '', evidence_tier:o.evidence_tier || s.evidence_tier || 'primary', source_ids:JSON.stringify(o.source_ids || [o.source_id]), source_urls:JSON.stringify((o.source_ids || [o.source_id]).map(id=>safeURL(data.sources.find(v=>v.id===id).url))), upper_open: o.upper_open === true, url: safeURL(source.url) || '' };
      return headers.map(k => csvCell(row[k])).join(',');
    });
    return '\uFEFF' + [headers.map(csvCell).join(','), ...rows].join('\r\n');
  }
  function render() {
    mount.replaceChildren();
    const header = el('header', null, 'iv-header');
    header.append(el('p', 'ENSEMBLE / INVENTORY EVIDENCE', 'iv-eyebrow'), el('h2', '분기별 재고 주수'), el('p', data.intro_ko), el('p', `자료 갱신: ${data.updated_at}`, 'iv-caption'));
    const summary = el('div', null, 'iv-summary');
    summary.append(el('strong', `출처 연결 관측치 ${data.observations.length}건`), el('span', `비교 계열 ${data.series.length}개`), el('span', '기업 전체 재무 참고 포함 · 제품 전체 커버리지 아님'));
    const updatesLink=el('a','발간별 한국어 재고 업데이트');updatesLink.href=new URL('inventory-updates.md',scriptURL).href;updatesLink.target='_blank';updatesLink.rel='noopener noreferrer';header.append(summary,updatesLink);mount.append(header);
    const method = el('details', null, 'iv-method'); method.append(el('summary', '방법론과 지표 구분'));
    method.append(el('p', '납기는 주문~인도, 재고 주수는 보유재고의 소진기간으로 서로 다른 지표입니다. DIO 주수는 재무 회전기간이며 제품 물량 기반 재고 주수와 구분합니다.'), el('p', '직접 보고 제품 재고 주수, 제품별·전사 보고 재고일수 환산, 계산된 전사 재무 참고를 구분합니다. 기업 전체 지표의 제조사·고객 역할은 발행사의 공급 관계 문맥이며 제품별 재고 근거가 아닙니다. 미상 범위와 집계 고객은 원문대로 유지합니다.'), el('p', '각 계열의 달력분기 또는 FY 회계분기를 보존합니다. 분기 중 관측일(as_of)이 분기 말과 다를 수 있습니다. 같은 series_id 안에서만 확인하며 시리즈 간 연결·평균·보간·추정·전망을 생성하지 않습니다. 환산값은 제공 데이터를 사용하고 화면은 최대 소수 둘째 자리로 표시합니다.'));
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
