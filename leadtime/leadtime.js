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
    add(header, add(el('div', 'lt-stats'), el('span', '', `리드타임 최근 발행일 ${latest ? date(latest.published_at) : '미확인'}`), el('span', '', `리드타임 관측 ${data.observations.length}건`), el('span', '', `리드타임 갱신 ${date(data.updated_at)}`)), el('p', 'lt-notice', '분기별 납기·재고와 변화율을 비교합니다. 분기 내 마지막 확인값을 사용하며 원문 날짜와 출처를 함께 제공합니다.'));
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
    const quarterlyDownload=el('a','lt-update-link','전체 계열 분기 데이터 CSV');quarterlyDownload.href=new URL('quarterly.csv',dataURL);quarterlyDownload.download='ensemble-leadtime-quarterly.csv';leadView.append(quarterlyDownload);
    const trendCss=el('link');trendCss.rel='stylesheet';trendCss.href=new URL('trends.css',dataURL);document.head.append(trendCss);
    const trendJs=el('script');trendJs.src=new URL('trends.js',dataURL);trendJs.onerror=()=>{trendRoot.textContent='장기 시계열을 불러오지 못했습니다. 새로고침해 주세요.';};document.body.append(trendJs);
    const overview = el('details', 'lt-section lt-supporting'); overview.append(el('summary', '', '발간호별 원문·한국어 업데이트'));
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
    const coverage = el('details', 'lt-section lt-supporting'); coverage.append(el('summary', '', '제품별 자료 범위와 미확인 항목')); coverage.append(heading('관측 범위와 공백', '미확인 항목의 수급 상태나 전망을 추정하지 않습니다.'));
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
})();
