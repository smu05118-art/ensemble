(() => {
  'use strict';
  const root = document.getElementById('leadtime-trends-root');
  if (!root) return;
  const url = new URL('trends.json', document.currentScript?.src || document.baseURI);
  const token = {}; root.__leadtimeTrends = token;
  const active = () => root.__leadtimeTrends === token;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; };
  const add = (n, ...children) => { n.append(...children); return n; };
  const svg = (tag, attrs, text) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.entries(attrs).forEach(([k,v]) => n.setAttribute(k,v)); if (text != null) n.textContent = text; return n; };
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const ordinal = q => { const m = /^(\d{4})-Q([1-4])$/.exec(q); return m ? Number(m[1])*4 + Number(m[2])-1 : NaN; };
  const button = (label, fn) => { const b = el('button', label); b.type = 'button'; b.onclick = fn; return b; };
  const num = n => n.toLocaleString('ko-KR', {maximumFractionDigits:1});
  const signed = n => `${n > 0 ? '+' : ''}${num(n)}%`;
  const flags = p => [p.source_change && '출처 변경', p.scope_break && '제품 범위 변경', p.evidence_tier === 'secondary' && '재인용'].filter(Boolean).join(' · ');
  function source(p) {
    let href; try { const u = new URL(p.source_url); if (/^https?:$/.test(u.protocol)) href = u.href; } catch {}
    const a = el(href ? 'a' : 'span', href ? p.source_title || '원문 출처' : '출처 없음');
    if (href) { a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  }
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
  function values(p, mode) {
    if (p.selection_status !== 'latest' || !p.has_observation) return {};
    if (mode === 'level') {
      const l = p.level;
      if (['exact','about'].includes(l.qualifier)) return {exact:l.lower};
      if (['less_than','at_most'].includes(l.qualifier)) return {upper:l.lower};
      return {lower:l.lower, upper:l.upper};
    }
    const m = p[mode]; if (p.scope_break || !m?.available) return {};
    const s = mode === 'index' ? '' : '_pct';
    return m.kind === 'exact' ? {exact:m['exact'+s]} : {lower:m['lower'+s], upper:m.kind === 'endpoints' ? m['upper'+s] : null};
  }
  function metric(p, mode) {
    if (mode === 'level') return p.level.label;
    const m = p[mode];
    if (p.scope_break) return '제품 범위 변경';
    if (!m?.available) return m?.reason || '산출 불가';
    const v = values(p,mode);
    if (mode === 'change' || mode === 'yoy') return finite(v.exact) ? signed(v.exact) : Object.entries(v).filter(([,n]) => finite(n)).map(([k,n]) => `${k === 'lower' ? '하단' : '상단'} ${signed(n)}`).join(' · ');
    return m.label;
  }
  async function load() {
    root.setAttribute('aria-busy','true'); root.replaceChildren(el('p','분기별 자료를 불러오는 중입니다…','tr-empty'));
    try { const r = await fetch(url.href,{credentials:'omit'}); if (!r.ok) throw Error('fetch'); const d = validate(await r.json()); if (active()) render(d); }
    catch (e) { if (!active()) return; root.replaceChildren(add(el('section',null,'tr-empty'),el('h2',e.message === 'refresh' ? '분기별 데이터 갱신이 필요합니다' : '분기별 자료를 불러올 수 없습니다'),el('p',e.message === 'refresh' ? '현재 파일에는 분기 대표값이 없습니다. 데이터 갱신 후 다시 불러와 주세요.' : '연결 또는 분기별 데이터 형식을 확인해 주세요.'),button('다시 불러오기',load))); }
    finally { if (active()) root.removeAttribute('aria-busy'); }
  }
  function render(data) {
    let mode = 'level', period = '12', selected = null;
    const groupSelect = el('select'), trackSelect = el('select'), periodSelect = el('select');
    const control = (label,s) => { s.setAttribute('aria-label',label); return add(el('label',label),s); };
    for (const g of data.groups) { const o = el('option',g.label); o.value = g.id; groupSelect.append(o); }
    for (const [v,l] of [['12','최근 12분기'],['20','최근 20분기'],['all','전체 분기']]) { const o = el('option',l); o.value = v; periodSelect.append(o); }
    const tabs = el('div',null,'tr-tabs'); tabs.setAttribute('role','group'); tabs.setAttribute('aria-label','차트 지표');
    for (const [key,label] of [['level','납기'],['change','전분기 대비 %'],['index','기준 분기 = 100']]) { const b = button(label,() => {mode = key; show();}); b.dataset.mode = key; tabs.append(b); }
    const body = el('div');
    root.replaceChildren(add(el('header'),el('p','QUARTERLY TRENDS','tr-eyebrow'),el('h2','분기별 리드타임'),el('p',`분기 대표값과 양 끝점으로 읽는 납기 흐름 · 갱신 ${data.updated_at || '미제공'}`,'tr-muted')),add(el('div',null,'tr-controls'),control('제품',groupSelect),control('비교 시리즈',trackSelect),control('표시 기간',periodSelect)),tabs,body);
    groupSelect.onchange = populate;
    trackSelect.onchange = () => { selected = null; show(); };
    periodSelect.onchange = () => { period = periodSelect.value; show(); };
    function populate() {
      const g = data.groups.find(x => x.id === groupSelect.value); trackSelect.replaceChildren();
      for (const t of g?.tracks || []) { const o = el('option',t.label); o.value = t.id; trackSelect.append(o); }
      trackSelect.value = g?.default_track_id || g?.tracks[0]?.id || '';
      if (!trackSelect.value && g?.tracks.length) trackSelect.value = g.tracks[0].id;
      selected = null; show();
    }
    function show() {
      if (!active()) return;
      [...tabs.children].forEach(b => b.setAttribute('aria-pressed',String(b.dataset.mode === mode)));
      body.replaceChildren();
      const g = data.groups.find(x => x.id === groupSelect.value), t = g?.tracks.find(x => x.id === trackSelect.value);
      if (!t?.quarterly_points.length) { body.append(el('p','표시할 분기 자료가 없습니다.','tr-empty')); return; }
      const all = t.quarterly_points, points = period === 'all' ? all : all.slice(-Number(period)), latest = all.at(-1), stats = t.quarterly_stats;
      if (!points.some(p => p.quarter === selected)) selected = points.at(-1).quarter;
      const cards = el('div',null,'tr-kpis');
      for (const [label,value,sub] of [['최근 분기 납기',metric(latest,'level'),latest.quarter],['최근 전분기 대비',metric(latest,'change'),`${latest.quarter} · 직전 분기 기준`],['관측 분기',`${stats.observed_quarters} / ${stats.total_quarters}`,`공백 ${stats.missing_quarters} · 대표값 미확인 ${stats.ambiguous_quarters}`]]) cards.append(add(el('article',null,'tr-kpi'),el('p',label,'tr-muted'),el('strong',value),el('p',sub,'tr-muted')));
      body.append(cards);
      if (t.quality === 'reference') body.append(el('p','참고 비교 · 발행사·제품 범위 차이를 선택 분기의 출처에서 확인하세요.','tr-banner'));
      const detail = el('section',null,'tr-detail'); detail.setAttribute('aria-live','polite'); detail.setAttribute('aria-label','선택 분기');
      const evidence = add(el('details'),el('summary',`원문 관측·후보 ${t.points.length}건`));
      const tableWrap = el('div',null,'tr-table-wrap'); tableWrap.tabIndex = 0; tableWrap.setAttribute('role','region'); tableWrap.setAttribute('aria-label','전체 원문 관측 표 · 가로 스크롤');
      const rowMap = new Map(); tableWrap.append(rawTable(t.points,rowMap)); evidence.append(tableWrap);
      const reveal = p => {
        const scroll=body.querySelector('.tr-chart'), hit=scroll?.querySelector(`[data-quarter="${p.quarter}"]`);
        if (scroll && hit) { const target=hit.getBoundingClientRect(), box=scroll.getBoundingClientRect(); scroll.scrollLeft += target.left-box.left+target.width/2-scroll.clientWidth/2; }
      };
      const select = (p,revealChart=false) => {
        selected = p.quarter;
        body.querySelectorAll('[data-quarter]').forEach(n => n.setAttribute('aria-pressed',String(n.dataset.quarter === selected)));
        detail.replaceChildren(add(el('div',null,'tr-detail-title'),el('h3',`${p.quarter} · ${p.level.label}`),el('span',flags(p),'tr-badges')),el('p',`전분기 ${metric(p,'change')} · 전년동분기 ${metric(p,'yoy')}`),add(el('p',null,'tr-provenance'),el('span',`원 자료 축 ${p.original_date || '없음'} · ${p.date_basis || '날짜 기준 없음'} · ${p.publisher || '발행사 없음'} · `),source(p)),el('p',p.selection_note,'tr-muted'));
        const more = add(el('details'),el('summary','선택 근거·분기 후보'));
        add(more,el('p',p.narrative_ko || p.selection_note),el('p',`발행 ${p.published_at || '미제공'} · 기준 ${p.as_of || '미제공'} · 날짜 기준 ${p.date_basis || '미제공'}`,'tr-muted'),el('p',`제품 범위 ${p.scope || '미제공'} · ${p.locator || ''}`,'tr-muted'),el('p',`지수 ${metric(p,'index')} · 기준 ${p.index.base_date || '없음'} · ${p.index.reason || ''}`,'tr-muted'));
        const candidates = el('div',null,'tr-candidates');
        for (const id of p.observation_ids) {
          const raw = t.points.find(x => x.id === id);
          const a = el('a',`${raw.date} · ${raw.level.label}${id === p.id ? ' · 대표값' : ''}`); a.href = `#${rowMap.get(id).id}`;
          a.onclick = e => {e.preventDefault(); evidence.open = true; const row = rowMap.get(id); row.scrollIntoView({block:'nearest'}); row.focus({preventScroll:true});}; candidates.append(a);
        }
        if (!p.observation_ids.length) candidates.append(el('p','이 분기에 원문 관측이 없습니다.','tr-muted'));
        more.append(candidates); detail.append(more);
        if (revealChart) reveal(p);
      };
      body.append(chart(points,mode,t.unit,select));
      const strip = el('div',null,'tr-strip'); strip.setAttribute('role','group'); strip.setAttribute('aria-label','분기별 전분기 변화 탐색');
      points.forEach(p => {
        const v = Object.entries(values(p,'change')).filter(([,n]) => finite(n));
        const b = button('',() => select(p,true)); b.dataset.quarter = p.quarter;
        b.setAttribute('aria-label',`${p.quarter} · 전분기 ${metric(p,'change')} · 상세 보기`);
        b.append(el('span',p.quarter));
        if (!v.length) b.append(el('strong','—','tr-unavailable'));
        else for (const [key,n] of v) b.append(el('span',`${key === 'exact' ? '' : key === 'lower' ? '하 ' : '상 '}${signed(n)}`,n > 0 ? 'tr-positive' : n < 0 ? 'tr-negative' : 'tr-neutral'));
        b.onfocus = () => select(p,true); strip.append(b);
      });
      body.append(el('p','분기 탐색 · 전분기 대비 (하: 하단 / 상: 상단)','tr-muted'),strip,detail);
      const actions = add(el('div',null,'tr-actions'),button('분기 CSV 저장',() => exportCSV(t,all,false)),button('원문 CSV 저장',() => exportCSV(t,t.points,true)),el('span','선택 시리즈 전체 기간 · 공백 포함','tr-muted'));
      const methodology = add(el('details'),el('summary','계산 방법·비교 범위'),el('p',t.quarterly_methodology_ko),el('p',t.note_ko || g.note_ko || '','tr-muted'));
      body.append(actions,evidence,methodology); select(points.find(p => p.quarter === selected));
      requestAnimationFrame(() => { if (!active()) return; const point=points.find(p => p.quarter === selected); if (point) reveal(point); const cell=strip.querySelector('[aria-pressed="true"]'); if (cell) strip.scrollLeft=cell.offsetLeft-strip.offsetLeft+cell.offsetWidth/2-strip.clientWidth/2; });
    }
    if (data.groups.some(g => g.id === 'dram')) groupSelect.value = 'dram';
    populate();
    if ([...trackSelect.options].some(o => o.value === 'rebound-alliance-pc-dram')) { trackSelect.value = 'rebound-alliance-pc-dram'; show(); }
  }
  function chart(points,mode,unit,onSelect) {
    const width = Math.max(640,points.length*76+96), height = 352, left = 64, bottom = 278;
    const x = p => left+38+(ordinal(p.quarter)-ordinal(points[0].quarter))*((width-left-64)/points.length);
    const all = points.flatMap(p => Object.values(values(p,mode))).filter(finite);
    const anchor = mode === 'index' ? 100 : 0;
    const min = Math.min(anchor,...all), max = Math.max(anchor,...all), pad = (max-min || Math.abs(max)*.1 || 1)*.14;
    const lo = mode === 'level' ? Math.max(0,min-pad) : min-pad, hi = max+pad;
    const y = n => bottom-(n-lo)/(hi-lo)*228;
    const canvas = svg('svg',{viewBox:`0 0 ${width} ${height}`,width,height,role:'group','aria-label':`${mode === 'level' ? '분기별 납기' : mode === 'change' ? '분기별 전분기 변화율' : '분기별 기준 지수'} · 빈 분기는 연결하지 않습니다`});
    canvas.style.width = `max(100%, ${width}px)`;
    for (let i=0;i<5;i++) { const n=lo+(hi-lo)*i/4; canvas.append(svg('line',{x1:left,x2:width-22,y1:y(n),y2:y(n),class:'tr-grid'}),svg('text',{x:left-10,y:y(n)+4,'text-anchor':'end'},num(n))); }
    if (mode !== 'level') canvas.append(svg('line',{x1:left,x2:width-22,y1:y(anchor),y2:y(anchor),class:'tr-baseline'}));
    canvas.append(svg('text',{x:left,y:24},mode === 'level' ? {weeks:'주',months:'개월',days:'일'}[unit] : mode === 'change' ? '전분기 대비 %' : '기준 분기 = 100'));
    const color = k => k === 'upper' ? 'var(--tr-violet)' : 'var(--lt-teal, #087c72)';
    const normalized = p => { const v=values(p,mode); return finite(v.exact) ? {lower:v.exact,upper:v.exact} : v; };
    const closed = p => mode !== 'level' || (['exact','about','range'].includes(p.level.qualifier) && !p.level.upper_open && (p.level.qualifier !== 'range' || finite(p.level.upper)));
    if (mode !== 'change') points.forEach((p,i) => {
      const prev=points[i-1];
      if (!prev || !p.connect_previous || p.scope_break || !closed(p) || !closed(prev)) return;
      const a=normalized(prev),b=normalized(p), dash=p.source_change ? '5 5' : '';
      if (mode === 'level' && [a.lower,a.upper,b.lower,b.upper].every(finite)) canvas.append(svg('polygon',{points:`${x(prev)},${y(a.lower)} ${x(prev)},${y(a.upper)} ${x(p)},${y(b.upper)} ${x(p)},${y(b.lower)}`,class:'tr-band'}));
      for (const k of ['lower','upper']) if (finite(a[k]) && finite(b[k]) && !(k === 'upper' && a.lower === a.upper && b.lower === b.upper)) canvas.append(svg('line',{x1:x(prev),x2:x(p),y1:y(a[k]),y2:y(b[k]),stroke:color(k),'stroke-width':2,'stroke-dasharray':dash,'data-link':`${prev.quarter}/${p.quarter}`}));
    });
    points.forEach(p => {
      const entries=Object.entries(values(p,mode)).filter(([,n]) => finite(n)), px=x(p);
      if (mode === 'level' && entries.length === 2) canvas.append(svg('line',{x1:px,x2:px,y1:y(entries[0][1]),y2:y(entries[1][1]),class:'tr-range'}));
      for (const [key,n] of entries) {
        const py=y(n);
        if (mode === 'change') {
          const offset=key === 'lower' ? -18 : key === 'upper' ? 3 : -8, barColor=n === 0 ? 'var(--lt-muted, #52686c)' : n > 0 ? 'var(--tr-rose)' : 'var(--lt-teal, #087c72)';
          canvas.append(svg('rect',{x:px+offset,y:n === 0 ? y(0)-1 : Math.min(py,y(0)),width:15,height:Math.max(2,Math.abs(y(0)-py)),fill:barColor,opacity:key === 'upper' ? '.6' : '1','data-bar':key,'data-quarter-value':p.quarter,'data-value':n}));
          canvas.append(svg('text',{x:px+offset+7.5,y:n >= 0 ? py-8 : py+16,'text-anchor':'middle',class:'tr-bar-sign'},n > 0 ? '+' : n < 0 ? '−' : '0'));
        } else {
          const open=mode === 'level' && (p.level.upper_open && key === 'upper' || ['less_than','more_than'].includes(p.level.qualifier) || key === 'lower' && p.level.qualifier === 'range' && p.level.upper === null);
          canvas.append(svg(key === 'upper' ? 'rect' : 'circle',key === 'upper' ? {x:px-4,y:py-4,width:8,height:8,fill:open ? 'var(--lt-panel,white)' : color(key),stroke:color(key),'stroke-width':2} : {cx:px,cy:py,r:4,fill:open ? 'var(--lt-panel,white)' : color(key),stroke:color(key),'stroke-width':2}));
          if (mode === 'level' && (open || ['at_least','at_most'].includes(p.level.qualifier))) canvas.append(svg('text',{x:px+10,y:py-10},['less_than','at_most'].includes(p.level.qualifier) ? '↓' : '↑'));
        }
      }
      if (!entries.length) canvas.append(svg('text',{x:px,y:bottom-6,'text-anchor':'middle',class:'tr-gap'},'—'));
      canvas.append(svg('text',{x:px,y:305,'text-anchor':'middle'},p.quarter),svg('text',{x:px,y:327,'text-anchor':'middle'},p.selection_status === 'ambiguous' ? '미확인' : p.selection_status === 'missing' ? '자료 없음' : p.scope_break ? '범위 변경' : p.source_change ? '출처 변경' : ''));
      const hit=svg('rect',{x:px-24,y:36,width:48,height:298,fill:'transparent',tabindex:0,role:'button','aria-label':`${p.quarter} · ${metric(p,mode)} · 상세 보기`,'data-quarter':p.quarter,class:'tr-hit'});
      for (const event of ['pointerenter','focus','click']) hit.addEventListener(event,() => onSelect(p));
      hit.addEventListener('keydown',e => {if (e.key === 'Enter' || e.key === ' ') {e.preventDefault(); onSelect(p);}}); canvas.append(hit);
    });
    const wrap=add(el('div',null,'tr-chart'),canvas); wrap.tabIndex=0; wrap.setAttribute('role','region'); wrap.setAttribute('aria-label','분기 차트 · 가로 스크롤 가능');
    const legend=mode === 'change' ? '＋ 증가: 장미색 · − 감소: 청록 · 왼쪽 진한 막대: 하단 / 오른쪽 옅은 막대: 상단 · 단일값: 중앙 막대' : '● 청록: 단일값·하단 · ■ 보라: 상단 · 빈 표식·화살표: 열린 경계 · 점선: 출처 변경';
    return add(el('div',null,'tr-plot'),el('p',legend,'tr-legend'),wrap,el('p','— 자료·계산 없음 · 범위는 보고된 양 끝점이며 중간값을 사용하지 않습니다.','tr-muted'));
  }
  function rawTable(points,rowMap) {
    const table=el('table'); table.append(el('caption','전체 원문 관측 · 아래 변화율은 직전 원문 관측 대비이며 전분기 대비와 다릅니다.'));
    const head=el('tr'); ['자료 축·발간일','제품 범위·발행사','보고 납기·원문 변화','출처·근거'].forEach(s => {const th=el('th',s); th.scope='col'; head.append(th);}); table.append(add(el('thead'),head));
    const tbody=el('tbody');
    points.forEach((p,i) => {
      const row=el('tr'); row.id=`tr-raw-${i}`; row.tabIndex=-1; rowMap.set(p.id,row);
      row.append(el('td',`${p.date} / ${p.published_at || '미제공'} · 기준 ${p.as_of || '미제공'} · ${p.date_basis || ''}`),el('td',`${p.scope || '미제공'} / ${p.publisher || '미제공'}`),el('td',`${p.level.label} / ${p.change?.label || '미제공'}`),add(el('td'),source(p),el('p',p.locator || ''),el('p',p.narrative_ko || ''),el('p',flags(p)))); tbody.append(row);
    }); table.append(tbody); return table;
  }
  function exportCSV(track,points,raw) {
    const fields=['id','date','quarter','original_date','has_observation','selection_status','selection_note','observation_count','observation_ids','connect_previous','published_at','as_of','date_basis','publisher','source_title','source_url','locator','scope','comparison_key','evidence_tier','narrative_ko','approximate','source_change','scope_break',...['lower','upper','qualifier','upper_open','label'].map(k=>'level.'+k),...['change','yoy'].flatMap(m=>['available','kind','exact_pct','lower_pct','upper_pct','label','reason','previous_id','previous_date'].map(k=>m+'.'+k)),...['available','kind','exact','lower','upper','label','reason','base_id','base_date'].map(k=>'index.'+k)];
    const cell=v => { let s=v == null ? '' : Array.isArray(v) ? JSON.stringify(v) : String(v); if (typeof v !== 'number' && /^[\s\uFEFF]*[=+@-]/.test(s)) s="'"+s; return '"'+s.replace(/"/g,'""')+'"'; };
    const rows=[['track_id','track_label','unit',...fields],...points.map(p=>[track.id,track.label,track.unit,...fields.map(f=>f.split('.').reduce((v,k)=>v?.[k],p))])];
    const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const href=URL.createObjectURL(blob),a=el('a'); a.href=href; a.download=`leadtime-${raw ? 'raw' : 'quarterly'}-${track.id.replace(/[^a-zA-Z0-9_-]/g,'_')}.csv`; root.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  load();
})();
