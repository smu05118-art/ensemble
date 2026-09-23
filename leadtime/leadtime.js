(() => {
  'use strict';
  const script = document.currentScript;
  const dataURL = new URL('data.json', script && script.src ? script.src : document.baseURI);
  const root = document.getElementById('leadtime-root');
  if (!root) return;
  const unitLabel = { weeks: '주', days: '일', months: '개월' };
  const statusLabel = { 'Very Tight': '심각한 부족', Tight: '공급 제약', Balanced: '수급 균형', Tightening: '수급 긴축', Easing: '수급 완화', unknown: '상태 미확인' };
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = String(text); return n; };
  const add = (parent, ...children) => { children.forEach(c => { if (c) parent.append(c); }); return parent; };
  const clean = value => value == null ? '' : String(value);
  const validURL = value => { try { const u = new URL(value); return /^https?:$/.test(u.protocol) ? u.href : null; } catch { return null; } };
  const link = (label, url) => { const href = validURL(url); const a = el(href ? 'a' : 'span', '', label); if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; } return a; };
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const date = value => clean(value) || '날짜 미확인';
  const bounds = (o, unit) => { if (!o || !finite(o.value_min)) return '수치 미확인'; const suffix = unitLabel[unit] || unit || ''; const v = o.value_min; if (o.qualifier === 'less_than') return `< ${v} ${suffix}`; if (o.qualifier === 'at_most') return `≤ ${v} ${suffix}`; if (o.qualifier === 'at_least') return `≥ ${v} ${suffix}`; if (o.qualifier === 'more_than') return `> ${v} ${suffix}`; if (o.qualifier === 'range') return finite(o.value_max) ? `${v}–${o.value_max}${o.upper_open ? "+" : ""} ${suffix}` : `${v}–상한 미확인 ${suffix}`; return `${o.qualifier === 'about' ? '약 ' : ''}${v} ${suffix}`; };
  const balanced = (o, unit) => { const suffix = unitLabel[unit] || unit; if (!finite(o.balanced_min)) return finite(o.balanced_max) ? `≤ ${o.balanced_max} ${suffix}` : '미제공'; return `${o.balanced_min}${finite(o.balanced_max) && o.balanced_max !== o.balanced_min ? `–${o.balanced_max}` : !finite(o.balanced_max) ? '–상한 미확인' : ''} ${suffix}`; };
  const csvCell = value => { let s = clean(value); if (/^[\s\uFEFF]*[=+@-]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const svgEl = (tag, attrs, text) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs || {}).forEach(([k, v]) => n.setAttribute(k, v)); if (text !== undefined) n.textContent = text; return n; };
  const heading = (title, note) => add(el('div', 'lt-section-heading'), el('h2', '', title), note ? el('p', 'lt-muted', note) : null);
  root.replaceChildren(el('p', 'lt-loading', '발행 자료를 불러오는 중입니다…'));
  fetch(dataURL.href, { credentials: 'omit' }).then(r => { if (!r.ok) throw new Error('load'); return r.json(); }).then(render).catch(() => {
    root.replaceChildren(add(el('section', 'lt-empty'), el('h2', '', '자료를 불러올 수 없습니다'), el('p', '', '잠시 후 다시 시도해 주세요. 자료가 준비되면 발행 이력과 출처를 확인할 수 있습니다.')));
    const retry = el('button', '', '다시 불러오기'); retry.type = 'button'; retry.onclick = () => location.reload(); root.firstChild.append(retry);
  });
  function render(data) {
    if (!data || data.schema_version !== 1 || !['sources', 'series', 'observations', 'releases', 'coverage'].every(k => Array.isArray(data[k]))) throw new Error('schema');
    const sourceMap = new Map(data.sources.map(s => [s.id, s]));
    const seriesMap = new Map(data.series.map(s => [s.id, s]));
    const obsMap = new Map(data.observations.map(o => [o.id, o]));
    const sourceOf = o => sourceMap.get(o.source_id) || {};
    const seriesOf = o => seriesMap.get(o.series_id) || {};
    const isTF = p => /trendforce/i.test(clean(p));
    const periodStamp = value => { const v=clean(value), q=v.match(/^(\d{4})-Q([1-4])$/); return q ? Date.UTC(Number(q[1]),(Number(q[2])-1)*3,1) : Date.parse(v); };
    const ordered = list => [...list].sort((a, b) => periodStamp(a.published_at || a.edition_period) - periodStamp(b.published_at || b.edition_period) || clean(a.id).localeCompare(clean(b.id)));
    const releases = ordered(data.releases).reverse();
    const initial = releases.find(r => isTF(r.publisher));
    const latest = ordered(data.sources.filter(s => s.published_at)).at(-1);
    root.replaceChildren();
    const header = add(el('header', 'lt-header'), el('p', 'lt-eyebrow', 'ENSEMBLE / SUPPLY RESEARCH'), el('h1', '', '공급망 리드타임·재고'), el('p', 'lt-intro', data.intro_ko || '공개된 발행 자료에서 확인한 부품별 리드타임과 수급 상태입니다.'));
    add(header, add(el('div', 'lt-stats'), el('span', '', `리드타임 최근 발행일 ${latest ? date(latest.published_at) : '미확인'}`), el('span', '', `리드타임 관측 ${data.observations.length}건`), el('span', '', `리드타임 갱신 ${date(data.updated_at)}`)), el('p', 'lt-notice', '확인된 과거 납기와 변화율입니다. 동일 계열 비교와 여러 출처의 참고 비교를 구분해 볼 수 있습니다.'));
    root.append(header);
    const views = el('div','lt-view-tabs');
    const leadButton=el('button','','리드타임'), inventoryButton=el('button','','분기 재고 주수');
    leadButton.type=inventoryButton.type='button';leadButton.setAttribute('aria-pressed','true');inventoryButton.setAttribute('aria-pressed','false');
    add(views,leadButton,inventoryButton);root.append(views);
    const leadView=el('div');leadView.id='lt-leadtime-view';root.append(leadView);
    const inventoryView=el('div','iv-app');inventoryView.id='inventory-root';inventoryView.hidden=true;root.append(inventoryView);
    let inventoryLoaded=false;
    function selectView(inventory){leadView.hidden=inventory;inventoryView.hidden=!inventory;leadButton.setAttribute('aria-pressed',String(!inventory));inventoryButton.setAttribute('aria-pressed',String(inventory));
      if(inventory&&!inventoryLoaded){inventoryLoaded=true;const css=el('link');css.rel='stylesheet';css.href=new URL('inventory.css',dataURL);document.head.append(css);const js=el('script');js.src=new URL('inventory.js',dataURL);js.onerror=()=>{inventoryView.textContent='재고 화면을 불러오지 못했습니다.';};document.body.append(js);}}
    leadButton.onclick=()=>selectView(false);inventoryButton.onclick=()=>selectView(true);

    const trendRoot=el('section');trendRoot.id='leadtime-trends-root';leadView.append(trendRoot);
    const trendCss=el('link');trendCss.rel='stylesheet';trendCss.href=new URL('trends.css',dataURL);document.head.append(trendCss);
    const trendJs=el('script');trendJs.src=new URL('trends.js',dataURL);trendJs.onerror=()=>{trendRoot.textContent='장기 시계열을 불러오지 못했습니다. 새로고침해 주세요.';};document.body.append(trendJs);
    const overview = el('section', 'lt-section');
    overview.append(heading('발행 호별 핵심 부품', '기본 선택: 가장 최근 TrendForce 발행 호 · 균형 범위는 원문 제공값만 표시'));
    const picker = el('select'); picker.id = 'lt-release'; picker.setAttribute('aria-label', '발행 호 선택');
    if (!initial) add(picker, el('option', '', 'TrendForce 발행 호 없음'));
    releases.forEach(r => { const option = el('option', '', `${r.published_at ? date(r.published_at) : '발간호 '+date(r.edition_period)+' (발간일 미확인)'} · ${r.publisher} · ${r.label}`); option.value = r.id; picker.append(option); });
    if (initial) picker.value = initial.id;
    const edition = el('div'); add(overview, add(el('div', 'lt-control'), el('label', '', '발행 호'), picker), edition); overview.querySelector('label').htmlFor = picker.id;
    function showEdition() {
      edition.replaceChildren(); const release = releases.find(r => r.id === picker.value);
      if (!release) { edition.append(el('p', 'lt-empty', '확인된 TrendForce 발행 호가 없습니다. 아래에서 다른 시리즈를 확인할 수 있습니다.')); return; }
      add(edition, el('p', 'lt-edition', `${release.publisher} · ${release.label} | 발행 ${date(release.published_at)} · 기준 ${date(release.as_of)}`));
      const cards = el('div', 'lt-cards');
      const observations = (release.observation_ids || []).map(id => obsMap.get(id)).filter(Boolean);
      const tfRows = observations.filter(o => isTF(seriesOf(o).publisher));
      const cardRows = isTF(release.publisher) ? tfRows : observations;
      const primaryRows = []; const seenComponents = new Set();
      [...cardRows].sort((a,b)=>clean(b.as_of).localeCompare(clean(a.as_of))).forEach(o => { const key = seriesOf(o).component || o.series_id; if (!seenComponents.has(key)) { seenComponents.add(key); primaryRows.push(o); } });
      primaryRows.slice(0, 6).forEach(o => {
        const s = seriesOf(o); const src = sourceOf(o);
        const card = el('article', 'lt-card');
        add(card, el('p', 'lt-eyebrow', s.component || '부품 미확인'), el('h3', '', s.name || o.series_id), el('p', 'lt-meta', `${s.publisher || release.publisher} · ${s.scope || '범위 미확인'}`), el('p', 'lt-value', bounds(o, s.unit)), el('span', `lt-status ${({unknown:'lt-unknown','Very Tight':'lt-severe',Tight:'lt-tight',Tightening:'lt-tight',Balanced:'lt-balanced',Easing:'lt-balanced'})[o.status] || 'lt-unknown'}`, statusLabel[o.status] || '상태 미확인'), el('p', 'lt-meta', `균형 ${balanced(o, s.unit)}`));
        card.append(rangeComparison(o, s.unit));
        add(card, el('p', 'lt-narrative', o.narrative_ko || '상세 설명 미제공'), el('p', 'lt-meta', `발행 ${date(src.published_at)} · 기준 ${date(o.as_of)}`), link(src.title || '출처 미확인', src.url)); cards.append(card);
      });
      edition.append(cards);
      if (primaryRows.length < 6) edition.append(el('p', 'lt-muted', `이 발행 호에서 확인된 핵심 부품 ${Math.min(primaryRows.length, 6)}건 · 제공되지 않은 부품의 값은 표시하지 않습니다.`));
      const update = add(el('div', 'lt-update'), el('h3', '', '선택 호 해설'), el('p', '', release.summary_ko || '발행 호 해설 미제공'));
      (release.source_ids || []).forEach(id => { const s = sourceMap.get(id); if (s) add(update, add(el('p'), link(`${s.publisher} · ${s.title}`, s.url))); }); edition.append(update);
    }
    picker.addEventListener('change', showEdition); showEdition(); leadView.append(overview);
    const history = el('section', 'lt-section'); history.append(heading('전체 발행 이력', '한 시리즈의 실제 관측만 표시합니다. 점은 단일값, 세로 막대는 범위이며 누락 기간은 보간하지 않습니다.'));
    const search = el('input'); search.type = 'search'; search.id = 'lt-search'; search.placeholder = '부품, 이름, 공급처, 범위 검색';
    const seriesPicker = el('select'); seriesPicker.id = 'lt-series';
    const controls = el('div', 'lt-controls'); const searchLabel = el('label', '', '시리즈 검색'); searchLabel.htmlFor = search.id; const seriesLabel = el('label', '', '비교할 시리즈'); seriesLabel.htmlFor = seriesPicker.id;
    add(controls, add(el('div', 'lt-control'), searchLabel, search), add(el('div', 'lt-control'), seriesLabel, seriesPicker));
    const chartArea = el('div'); add(history, controls, chartArea); leadView.append(history);
    function filterSeries() {
      const previous = seriesPicker.value; seriesPicker.replaceChildren(); const q = search.value.trim().toLocaleLowerCase();
      data.series.filter(s => [s.component, s.name, s.publisher, s.scope, s.unit].join(' ').toLocaleLowerCase().includes(q)).forEach(s => { const option = el('option', '', `${s.component} · ${s.name} · ${s.publisher} · ${s.scope} · ${unitLabel[s.unit] || s.unit}`); option.value = s.id; seriesPicker.append(option); });
      if ([...seriesPicker.options].some(o => o.value === previous)) seriesPicker.value = previous;
      showHistory();
    }
    function showHistory() {
      chartArea.replaceChildren(); const s = seriesMap.get(seriesPicker.value); if (!s) { chartArea.append(el('p', 'lt-empty', '조건에 맞는 시리즈가 없습니다.')); return; }
      const dateOf = o => s.axis === 'observation' || s.axis === 'edition' ? o.as_of : sourceOf(o).published_at;
      const axisLabel = s.axis === 'edition' ? '발간호 분기' : s.axis === 'observation' ? '자료 기준 분기' : '발간일';
      if(s.axis === 'edition') chartArea.append(el('p','lt-notice','가로축은 표지의 발간호 분기입니다. 정확한 발간일·조사일은 미확인이며 분기말 실측을 뜻하지 않습니다.'));
      const rows = data.observations.filter(o => o.series_id === s.id).sort((a,b)=>clean(dateOf(a)).localeCompare(clean(dateOf(b))) || clean(a.id).localeCompare(clean(b.id)));
      if(s.axis === 'observation') chartArea.append(el('p','lt-notice','단일 보고서의 과거 분기 이력입니다. 가로축은 발간일이 아닌 자료 기준 분기입니다.'));
      add(chartArea, el('h3', '', s.name), el('p', 'lt-meta', `${s.component} · ${s.publisher} · ${s.scope} · 단위 ${unitLabel[s.unit] || s.unit} · 발행 주기 ${s.cadence || '미확인'}`), el('p', 'lt-count', rows.length === 1 ? '첫 관측 · 이력 1건 (제공된 데이터 기준)' : `관측 ${rows.length}건`));
      if (!rows.length) { chartArea.append(el('p', 'lt-empty', '아직 확인된 관측이 없습니다.')); return; }
      const facts = el('div', 'lt-facts'); facts.setAttribute('aria-live', 'polite');
      const showFact = o => { const src = sourceOf(o); facts.replaceChildren(el('strong', '', `발행 ${date(src.published_at)} · ${bounds(o, s.unit)}`), el('p', 'lt-meta', `기준 ${date(o.as_of)} · ${statusLabel[o.status] || '상태 미확인'} · 균형 ${balanced(o, s.unit)}`), el('p', '', o.narrative_ko || '상세 설명 미제공'), link(`${src.publisher || s.publisher} · ${src.title || '출처 미확인'}`, src.url)); };
      const plotRows = rows.filter(o => finite(o.value_min) && Number.isFinite(periodStamp(dateOf(o))));
      if (plotRows.length) chartArea.append(historySVG(plotRows, s.unit, sourceOf, showFact, dateOf, axisLabel, periodStamp));
      if (plotRows.length !== rows.length) chartArea.append(el('p', 'lt-muted', '발행일 또는 수치가 미확인된 관측은 아래 표에만 표시됩니다.'));
      add(chartArea, facts); showFact(rows.at(-1));
      const details = el('details', 'lt-details'); details.open = true; add(details, el('summary', '', '관측 표 · 그래프와 동일한 자료'), observationTable(rows)); chartArea.append(details);
    }
    search.addEventListener('input', filterSeries); seriesPicker.addEventListener('change', showHistory); filterSeries();
    const coverage = el('section', 'lt-section'); coverage.append(heading('관측 범위와 공백', '미확인 항목의 수급 상태나 전망을 추정하지 않습니다.'));
    const coverageGrid = el('div', 'lt-coverage');
    data.coverage.forEach(c => { const card = add(el('article', 'lt-coverage-card'), el('h3', '', c.component), el('p', 'lt-meta', c.status), el('p', '', c.note)); (c.source_urls || []).forEach((url, i) => add(card, link(`관련 출처 ${i + 1}`, url))); coverageGrid.append(card); });
    add(coverage, data.coverage.length ? coverageGrid : el('p', 'lt-empty', '관측 범위 안내가 아직 제공되지 않았습니다.')); leadView.append(coverage);
    const archive = el('section', 'lt-section'); archive.append(heading('출처 아카이브', '전체 관측과 원문을 확인하거나 CSV로 저장할 수 있습니다.'));
    const download = el('button', '', `전체 관측 CSV 저장 (${data.observations.length}건)`); download.type = 'button'; download.onclick = () => {
      const headers = ['observation_id', 'series_id', 'source_id', 'release_id', 'component', 'name', 'scope', 'publisher', 'unit', 'published_at', 'as_of', 'value_min', 'value_max', 'qualifier', 'upper_open', 'balanced_min', 'balanced_max', 'status', 'narrative_ko', 'source_title', 'source_url', 'evidence_type', 'observed_at', 'locator', 'edition_period', 'date_precision', 'axis'];
      const records = data.observations.map(o => { const s = seriesOf(o), src = sourceOf(o); return [o.id, o.series_id, o.source_id, o.release_id, s.component, s.name, s.scope, s.publisher, s.unit, src.published_at, o.as_of, o.value_min, o.value_max, o.qualifier, o.upper_open || false, o.balanced_min, o.balanced_max, o.status, o.narrative_ko, src.title, validURL(src.url) || '', src.evidence_type, src.observed_at, src.locator, src.edition_period, src.date_precision, s.axis]; });
      const blob = new Blob(['\uFEFF' + [headers, ...records].map(row => row.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob); const a = el('a'); a.href = url; a.download = 'ensemble-leadtime-observations.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    add(archive, download);const updates=el('a','','발간별 한국어 업데이트 문서');updates.href=new URL('updates.md',dataURL);updates.className='lt-update-link';archive.append(updates); const all = el('details', 'lt-details'); add(all, el('summary', '', '전체 관측 보기'), observationTable(data.observations)); archive.append(all);
    const sourceDetails = el('details', 'lt-details'); add(sourceDetails, el('summary', '', `전체 원문 목록 (${data.sources.length}건)`)); const list = el('div', 'lt-source-list'); data.sources.forEach(s => add(list, add(el('article'), link(`${s.publisher} · ${s.title}`, s.url), el('p', 'lt-meta', `발행 ${date(s.published_at)} · 확인 ${date(s.observed_at)} · ${s.evidence_type || '증거 유형 미제공'}`), s.locator ? el('p', 'lt-meta', s.locator) : null))); add(sourceDetails, list); archive.append(sourceDetails); leadView.append(archive);
    function observationTable(rows) {
      if (!rows.length) return el('p', 'lt-empty', '확인된 관측이 없습니다.');
      const wrap = el('div', 'lt-table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', '관측 자료 표, 가로 스크롤 가능'); const table = el('table'); const caption = el('caption', '', '공개 발행 자료의 관측값 · 단위와 범위는 각 행 기준'); const head = el('thead'), tr = el('tr'); ['부품 / 시리즈', '발행처 / 범위', '발행일 / 기준일', '관측 / 균형', '상태 / 해설', '출처'].forEach(t => { const th = el('th', '', t); th.scope = 'col'; tr.append(th); }); head.append(tr); const body = el('tbody');
      rows.forEach(o => { const s = seriesOf(o), src = sourceOf(o), row = el('tr'); add(row, add(el('td'), el('strong', '', s.component || '미확인'), el('p', '', s.name || o.series_id)), add(el('td'), el('span', '', s.publisher), el('p', 'lt-meta', s.scope)), add(el('td'), el('span', '', date(src.published_at)), el('p', 'lt-meta', `기준 ${date(o.as_of)}`)), add(el('td'), el('strong', '', bounds(o, s.unit)), el('p', 'lt-meta', `균형 ${balanced(o, s.unit)}`)), add(el('td'), el('span', '', statusLabel[o.status] || '상태 미확인'), el('p', '', o.narrative_ko || '해설 미제공')), add(el('td'), link(src.title || '출처 미확인', src.url))); body.append(row); }); add(table, caption, head, body); add(wrap, table); return wrap;
    }
  }
  function rangeComparison(o, unit) {
    const box = el('div', 'lt-range'); if (!finite(o.value_min)) return box;
    const values = [o.value_min, o.value_max, o.balanced_min, o.balanced_max].filter(finite); const max = Math.max(1, ...values) * 1.15;
    const svg = svgEl('svg', { viewBox: '0 0 300 72', role: 'img', 'aria-label': `관측 ${bounds(o, unit)}, 균형 ${balanced(o, unit)}. 동일 단위 비교.` });
    const x = v => 55 + v / max * 215;
    [['관측', o.value_min, o.value_max, 20, 'lt-current'], ['균형', o.balanced_min, o.balanced_max, 48, 'lt-baseline']].forEach(([label, min, upper, y, cls]) => {
      svg.append(svgEl('text', { x: 0, y: y + 4 }, label)); svg.append(svgEl('line', { x1: 55, x2: 285, y1: y, y2: y, class: 'lt-grid' }));
      if (finite(min)) { const hi = finite(upper) && (label === '균형' || o.qualifier === 'range') ? upper : min; svg.append(svgEl('line', { x1: x(min), x2: x(hi), y1: y, y2: y, class: cls, 'stroke-width': 7 })); svg.append(svgEl('circle', { cx: x(min), cy: y, r: 4, class: cls })); if (label === '관측' && (o.upper_open || ['at_least','more_than','less_than','at_most'].includes(o.qualifier))) svg.append(svgEl('text', { x: x(o.upper_open ? hi : min) + 7, y: y + 4 }, o.upper_open ? '→+' : ({at_least:'≥',more_than:'>',less_than:'<',at_most:'≤'}[o.qualifier]))); }
      else svg.append(svgEl('text', { x: 60, y: y + 4 }, '범위 미제공'));
    }); add(box, svg, el('p', 'lt-scale', `공통 눈금 0–${Number(max.toFixed(1))} ${unitLabel[unit] || unit}`)); return box;
  }
  function historySVG(rows, unit, sourceOf, select, dateOf, axisLabel, periodStamp) {
    const width = Math.max(680, rows.length * 70 + 100), height = 340, left = 62, bottom = 260;
    const stamps = rows.map(o => periodStamp(dateOf(o))); const lo = Math.min(...stamps), hi = Math.max(...stamps);
    const max = Math.max(1, ...rows.flatMap(o => [o.value_min, o.qualifier === 'range' ? o.value_max : null]).filter(finite)) * 1.18;
    const x = t => hi === lo ? width / 2 : left + 20 + (t - lo) / (hi - lo) * (width - left - 60); const y = v => bottom - v / max * 210;
    const wrap = el('div', 'lt-chart-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', '발행일별 그래프. 관측을 탭 또는 클릭하면 상세 정보가 표시됩니다. 많은 관측은 가로 스크롤할 수 있습니다.');
    const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'group', 'aria-label': `${axisLabel}별 리드타임, ${rows.length}건, 단위 ${unitLabel[unit] || unit}` });
    svg.append(svgEl('text', { x: 8, y: 20 }, `리드타임 (${unitLabel[unit] || unit})`));
    for (let i = 0; i <= 4; i++) { const v = max * i / 4; svg.append(svgEl('line', { x1: left, x2: width - 20, y1: y(v), y2: y(v), class: 'lt-grid' })); svg.append(svgEl('text', { x: left - 10, y: y(v) + 4, 'text-anchor': 'end' }, Number(v.toFixed(1)))); }
    const uniqueDates = [...new Set(stamps)];
    rows.forEach((o, i) => {
      const cx = x(stamps[i]); const top = finite(o.value_max) && o.qualifier === 'range' ? o.value_max : o.value_min;
      const description = `발행 ${date(sourceOf(o).published_at)}, 기준 ${date(o.as_of)}, ${bounds(o, unit)}`;
      const g = svgEl('g', { tabindex: 0, role: 'button', 'aria-label': description, class: 'lt-point' });
      g.append(svgEl('title', {}, description)); g.append(svgEl('rect', { x: cx - 13, y: Math.max(28, y(top) - 18), width: 26, height: Math.max(36, y(o.value_min) - y(top) + 36), fill: 'transparent' }));
      if (top !== o.value_min) { g.append(svgEl('line', { x1: cx, x2: cx, y1: y(o.value_min), y2: y(top), class: 'lt-current', 'stroke-width': 5 })); (o.upper_open ? [o.value_min] : [top, o.value_min]).forEach(v => g.append(svgEl('line', { x1: cx - 7, x2: cx + 7, y1: y(v), y2: y(v), class: 'lt-current', 'stroke-width': 2 }))); }
      else g.append(svgEl('circle', { cx, cy: y(o.value_min), r: 5, class: 'lt-current' }));
      if (['about', 'at_least', 'more_than', 'less_than', 'at_most'].includes(o.qualifier) || o.upper_open || (o.qualifier === 'range' && !finite(o.value_max))) g.append(svgEl('text', { x: cx + 8, y: y(top) - 9 }, (o.upper_open ? '↑+' : { about: '약', at_least: '≥', more_than: '>', less_than: '<', at_most: '≤' }[o.qualifier]) || '상한 ?'));
      g.addEventListener('mouseenter', () => select(o)); g.addEventListener('focus', () => select(o)); g.addEventListener('click', () => select(o)); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(o); } }); svg.append(g);
    });
    // Only actual publication dates label the time axis. Close dates stay available in point facts and the table.
    let lastX = -Infinity;
    uniqueDates.forEach((t, i) => { const cx = x(t); if (cx - lastX < 85 && i !== uniqueDates.length - 1) return; if (i === uniqueDates.length - 1 && cx - lastX < 75) return; lastX = cx; svg.append(svgEl('text', { x: cx, y: bottom + 24, 'text-anchor': 'middle' }, dateOf(rows[stamps.indexOf(t)]))); });
    svg.append(svgEl('text', { x: width / 2, y: 320, 'text-anchor': 'middle' }, axisLabel + ' · 보고된 값만 표시')); svg.style.width = `${width}px`; svg.style.minWidth = '100%'; wrap.append(svg); return wrap;
  }
})();
