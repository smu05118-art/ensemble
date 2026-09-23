(() => {
  'use strict';
  const root = document.getElementById('leadtime-trends-root');
  if (!root) return;
  const script = document.currentScript;
  const url = new URL('trends.json', script && script.src || document.baseURI);
  const token = {}; root.__leadtimeTrends = token;
  const active = () => root.__leadtimeTrends === token;
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text != null) n.textContent = String(text); if (cls) n.className = cls; return n; };
  const add = (n, ...children) => { n.append(...children); return n; };
  const svg = (tag, attrs, text) => { const n = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k,v] of Object.entries(attrs)) n.setAttribute(k,v); if (text != null) n.textContent = text; return n; };
  const finite = n => typeof n === 'number' && Number.isFinite(n);
  const stamp = s => { const q = /^(\d{4})-Q([1-4])$/.exec(s); if(q) return Date.UTC(+q[1],(+q[2]-1)*3,1); if (!/^\d{4}-\d{2}(-\d{2})?$/.test(s)) return NaN; return Date.parse(s.length === 7 ? s+'-01T00:00:00Z' : s+'T00:00:00Z'); };
  const link = p => { let href; try { const u = new URL(p.source_url); if (/^https?:$/.test(u.protocol)) href = u.href; } catch {} const a = el(href ? 'a' : 'span', p.source_title || '출처'); if(href) { a.href=href; a.target='_blank'; a.rel='noopener noreferrer'; } return a; };
  const badges = p => [p.source_change && '출처 변경 · 참고 비교', p.scope_break && '제품 범위 변경', p.evidence_tier === 'secondary' && '재인용', (p.approximate || p.level.qualifier === 'about') && '약'].filter(Boolean).join(' · ');
  const reason = (p,mode) => p.scope_break && mode !== 'level' ? '제품 범위 변경' : mode === 'level' ? p.level.label : p[mode].reason || p[mode].label || '계산 불가';
  function values(p, mode) {
    if(mode === 'level') {
      const l=p.level;
      if(['exact','about'].includes(l.qualifier)) return {exact:l.lower};
      if(['less_than','at_most'].includes(l.qualifier)) return {upper:l.lower};
      return {lower:l.lower, upper:l.upper};
    }
    const v=p[mode]; if(p.scope_break || !v.available) return {};
    const suffix=mode === 'change' ? '_pct' : '';
    if(v.kind === 'exact') return {exact:v['exact'+suffix]};
    return {lower:v['lower'+suffix], upper:v.kind === 'endpoints' ? v['upper'+suffix] : null};
  }
  const metricText = (p, mode) => {
    if(mode==='level') return p.level.label;
    if(p.scope_break) return '제품 범위 변경';
    return p[mode].label+(!p[mode].available&&p[mode].reason?' · '+p[mode].reason:'');
  };
  function validate(d) {
    const fail=()=>{throw Error('schema');};
    if(!d || d.schema_version!==1 || !Array.isArray(d.groups)) fail();
    const kinds=['exact','endpoints','lower_only','unavailable'];
    const unique=a=>new Set(a.map(x=>x.id)).size===a.length;
    if(!unique(d.groups)) fail();
    for(const g of d.groups) {
      if(typeof g.id!=='string'||typeof g.label!=='string'||!Array.isArray(g.tracks)||!unique(g.tracks)) fail();
      for(const t of g.tracks) {
        if(typeof t.id!=='string'||typeof t.label!=='string'||!['weeks','months','days'].includes(t.unit)||!['matched','reference'].includes(t.quality)||!Array.isArray(t.points)||!unique(t.points)) fail();
        for(const p of t.points) {
          if(typeof p.id!=='string'||!Number.isFinite(stamp(p.date))||!p.level||!p.change||!p.index) fail();
          if(![null,undefined].includes(p.level.lower)&&!finite(p.level.lower)) fail();
          if(p.level.upper!==null&&!finite(p.level.upper)) fail();
          if(typeof p.level.label!=='string') fail();
          for(const [key,fields] of [['change',['exact_pct','lower_pct','upper_pct']],['index',['exact','lower','upper']]]) {
            const v=p[key]; if(typeof v.available!=='boolean'||!kinds.includes(v.kind)) fail();
            for(const f of fields) if(v[f]!==null&&!finite(v[f])) fail();
          }
        }
      }
    }
    return d;
  }
  async function load() {
    root.replaceChildren(el('p','시계열 자료를 불러오는 중입니다…','tr-empty'));
    try { const response=await fetch(url.href,{credentials:'omit'}); if(!response.ok) throw Error('fetch'); const d=validate(await response.json()); if(active()) render(d); }
    catch { if(!active()) return; const b=el('button','다시 불러오기'); b.type='button'; b.onclick=load; root.replaceChildren(add(el('section',null,'tr-empty'),el('h2','시계열 자료를 불러올 수 없습니다'),el('p','데이터 형식 또는 연결을 확인한 후 다시 시도해 주세요.'),b)); }
  }
  function render(data) {
    root.replaceChildren();
    const method=add(el('details'),el('summary','비교 기준·계산 방법'),el('p',data.methodology_ko,'tr-muted'));
    const header=add(el('header'),el('h2','리드타임 변화율·장기 시계열'),el('p',`실제 보고 납기 · 범위 하단/상단 변화율 · 자료 갱신 ${data.updated_at || '미제공'}`,'tr-muted'),method);
    const groupSelect=el('select'), trackSelect=el('select');
    const control=(name,select)=>{select.setAttribute('aria-label',name);return add(el('label',name),select);};
    const controls=add(el('div',null,'tr-controls'),control('제품',groupSelect),control('비교 시리즈',trackSelect));
    for(const g of data.groups) { const o=el('option',g.label); o.value=g.id; groupSelect.append(o); }
    groupSelect.value=(data.groups.find(g=>g.id==='mlcc')||data.groups[0]||{}).id || '';
    let mode='level';
    const tabs=el('div',null,'tr-tabs'); tabs.setAttribute('role','group'); tabs.setAttribute('aria-label','시계열 보기');
    const views=[['level','납기'],['change','직전 관측 대비 %'],['index','최초 관측 = 100']];
    const body=el('div');
    for(const [key,label] of views) { const b=el('button',label); b.type='button'; b.dataset.mode=key; b.onclick=()=>{mode=key;show();}; tabs.append(b); }
    add(root,header,controls,tabs,body);
    groupSelect.onchange=populate; trackSelect.onchange=show;
    function populate() {
      const g=data.groups.find(g=>g.id===groupSelect.value); trackSelect.replaceChildren();
      for(const t of g?.tracks || []) { const o=el('option',t.label); o.value=t.id; trackSelect.append(o); }
      trackSelect.value=(g?.tracks.find(t=>t.id===g.default_track_id)||g?.tracks[0]||{}).id || ''; show();
    }
    function show() {
      if(!active()) return;
      [...tabs.children].forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===mode)));
      body.replaceChildren();
      const g=data.groups.find(g=>g.id===groupSelect.value), t=g?.tracks.find(t=>t.id===trackSelect.value);
      if(!t) { body.append(el('p','선택 가능한 시리즈 없음','tr-empty')); return; }
      const points=[...t.points].sort((a,b)=>stamp(a.date)-stamp(b.date));
      add(body,el('p',g.note_ko,'tr-muted'),el('p',t.note_ko,'tr-muted'));
      if(t.quality==='reference') body.append(el('p','서로 다른 발행사·측정 범위의 비교입니다. 값은 보고된 참고 자료이며, 동질적인 시장 지수가 아닙니다.','tr-banner'));
      const latest=points.at(-1), latestChange=[...points].reverse().find(p=>p.change.available&&!p.scope_break);
      const summary=el('div',null,'tr-summary'); summary.setAttribute('aria-live','polite');
      add(summary,el('p',latest ? `최근 납기 ${latest.level.label} · ${latest.date}${badges(latest) ? ' · '+badges(latest) : ''}` : '관측 없음'),el('p',latestChange ? `최근 계산 가능 변화: ${latestChange.change.label} (${latestChange.change.previous_date || '이전 기간 미제공'} → ${latestChange.date})` : '변화율 계산 가능한 이전 관측 없음'),el('p',`${points.length}개 관측 · ${latest ? points[0].date+' → '+latest.date : '기간 없음'} · 변화율 계산 가능 ${points.filter(p=>p.change.available&&!p.scope_break).length}건`,'tr-muted'));
      body.append(summary);
      const exportButton=el('button','선택 시리즈 CSV 저장'); exportButton.type='button'; exportButton.onclick=()=>exportCSV(t,points); body.append(exportButton);
      if(!points.length) { body.append(el('p','이 시리즈에 관측이 없습니다.','tr-empty')); return; }
      const detail=el('section',null,'tr-detail'); detail.setAttribute('aria-live','polite'); detail.setAttribute('aria-label','선택 관측 상세');
      const showDetail=p=>{
        detail.replaceChildren(el('h3',`${p.date} · ${p.level.label}`));
        add(detail,el('p',badges(p),'tr-badges'),el('p',`발행 ${p.published_at || '미제공'} · 기준 ${p.as_of || '미제공'} · ${p.publisher || '발행사 미제공'}`),el('p',`날짜 기준: ${p.date_basis || '발간일'} · 원래 범위: ${p.scope || '미제공'}`),el('p',p.narrative_ko || ''),el('p',`변화율: ${metricText(p,'change')} · ${p.change.previous_date || '이전 관측 없음'} → ${p.date}`),el('p',`변화 사유: ${p.scope_break ? '제품 범위 변경' : p.change.reason || '미제공'}`),el('p',`지수: ${metricText(p,'index')} · 기준 ${p.index.base_date || '미제공'}${p.index.reason ? ' · '+p.index.reason : ''}`),el('p',p.locator || ''),link(p));
      };
      body.append(chart(points,mode,t.unit,showDetail)); body.append(detail); showDetail(latest);
      body.append(sourceTable(points));
    }
    populate();
  }
  function chart(points,mode,unit,onSelect) {
    const wrap=el('div',null,'tr-chart'); wrap.tabIndex=0; wrap.setAttribute('role','region'); wrap.setAttribute('aria-label','관측 시계열 · 가로 스크롤 가능');
    const stamps=points.map(p=>stamp(p.date)), first=stamps[0], last=stamps.at(-1);
    const distinct=[...new Set(stamps)], gaps=distinct.slice(1).map((x,i)=>x-distinct[i]);
    const width=Math.max(720,Math.min(1600,points.length*80));
    const height=390, x=p=>first===last ? width/2 : 78+(stamp(p.date)-first)/(last-first)*(width-156);
    const all=points.flatMap(p=>Object.values(values(p,mode))).filter(finite);
    const anchor=mode==='index'?100:0;
    const min=all.length?Math.min(anchor,...all):0, max=all.length?Math.max(anchor,...all):1, pad=(max-min || Math.abs(max)*.1 || 1)*.15;
    const lo=mode==='level'?Math.max(0,min-pad):min-pad, hi=max+pad, y=v=>285-(v-lo)/(hi-lo)*240;
    const canvas=svg('svg',{viewBox:`0 0 ${width} ${height}`,width,height,role:'group','aria-label':`${mode==='level'?'납기':mode==='change'?'직전 관측 대비 %':'최초 관측 = 100'}: 실제 관측 기간, 단일값과 범위 양 끝점. 계산 불가 관측은 ×.`});
    canvas.style.width=`max(100%, ${width}px)`;
    const colors={exact:'var(--lt-teal, #087c72)',lower:'var(--lt-teal, #087c72)',upper:'var(--tr-upper, #8552aa)'};
    const labels={exact:'단일값',lower:'범위 하단',upper:'범위 상단'};
    for(let i=0;i<5;i++) { const v=lo+(hi-lo)*i/4; canvas.append(svg('line',{x1:70,x2:width-40,y1:y(v),y2:y(v),class:'tr-grid'}),svg('text',{x:62,y:y(v)+4,'text-anchor':'end'},Number(v.toFixed(2)).toLocaleString('ko-KR'))); }
    canvas.append(svg('text',{x:12,y:20},mode==='level'?{weeks:'주',months:'개월',days:'일'}[unit]:mode==='change'?'%':'지수'));
    const legend=el('p','● 단일값 · ● 범위 하단(청록) · ■ 범위 상단(보라) · 점선: 출처 변경 · ×: 계산 불가','tr-muted');
    const tracks={exact:null,lower:null,upper:null};
    const mixedEndpoints=points.some(p=>{const v=values(p,mode);return finite(v.lower)||finite(v.upper);});
    points.forEach((p,i)=>{
      let v=values(p,mode);
      if(mixedEndpoints&&finite(v.exact))v={lower:v.exact,upper:v.exact};
      const px=x(p), prev=points[i-1];
      for(const key of Object.keys(tracks)) {
        const value=v[key], old=tracks[key];
        if(finite(value)) {
          if(old&&!p.scope_break&&stamp(old.p.date)!==stamp(p.date)&&!(mode==='level'&&([p,old.p].some(o=>!['exact','about','range'].includes(o.level.qualifier))||key==='upper'&&(p.level.upper_open||old.p.level.upper_open)))) canvas.append(svg('line',{x1:x(old.p),y1:y(old.value),x2:px,y2:y(value),stroke:colors[key],'stroke-width':2,'stroke-dasharray':p.source_change || prev && prev.publisher!==p.publisher ? '6 5' : '', 'data-series':key}));
          tracks[key]={p,value};
        } else tracks[key]=null;
      }
    });
    let lastLabelX=-Infinity,lastBoundLabelX=-Infinity;
    points.forEach(p=>{
      const v=values(p,mode), px=x(p), entries=Object.entries(v).filter(([,n])=>finite(n));
      for(const [key,value] of entries) {
        const py=y(value); let open=false;
        if(mode==='level') open=p.level.upper_open&&key==='upper'||['less_than','more_than'].includes(p.level.qualifier)||key==='lower'&&p.level.qualifier==='range'&&p.level.upper===null;
        canvas.append(svg(key==='upper'?'rect':'circle',key==='upper'?{x:px-5,y:py-5,width:10,height:10,fill:open?'var(--lt-panel,white)':colors[key],stroke:colors[key],'stroke-width':2}:{cx:px,cy:py,r:5,fill:open?'var(--lt-panel,white)':colors[key],stroke:colors[key],'stroke-width':2}));
        if(mode==='level' && px-lastBoundLabelX>=72 && (open || ['at_most','at_least'].includes(p.level.qualifier))) {
          lastBoundLabelX=px;
          const down=['less_than','at_most'].includes(p.level.qualifier);
          canvas.append(svg('text',{x:px+10,y:py+(down?18:-12)},`${down?'↓':'↑'} ${p.level.label}`));
        }
      }
      if(!entries.length) canvas.append(svg('text',{x:px,y:302,'text-anchor':'middle'},'×'));
      if(px-lastLabelX>=95){canvas.append(svg('text',{x:px,y:326,'text-anchor':'middle'},p.date));lastLabelX=px;}
      if(p.scope_break) canvas.append(svg('text',{x:px,y:348,'text-anchor':'middle'},'제품 범위 변경'));
    });
    // Separate HTML buttons give every observation a 44px touch target, even coincident periods.
    const buttons=el('div',null,'tr-observations');
    points.forEach(p=>{const b=el('button',`${p.date} · ${metricText(p,mode)}`); b.type='button'; b.setAttribute('aria-label',`${p.date} · ${metricText(p,mode)} · ${badges(p)} · 상세 보기`); b.onfocus=()=>onSelect(p); b.onclick=()=>onSelect(p); buttons.append(b);});
    // Transparent SVG hit areas are ordered by observation; the HTML list also exposes overlapping points.
    points.forEach(p=>{const vals=Object.values(values(p,mode)).filter(finite); const py=vals.length?y(vals[0]):290; const hit=svg('rect',{x:x(p)-22,y:py-22,width:44,height:44,fill:'transparent',tabindex:0,role:'button','aria-label':`${p.date} · ${metricText(p,mode)} · 상세 보기`,class:'tr-hit'}); hit.addEventListener('focus',()=>onSelect(p));hit.addEventListener('click',()=>onSelect(p));hit.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(p);}});canvas.append(hit);});
    add(wrap,canvas); return add(el('div',null,'tr-plot'),legend,wrap,el('p','기간은 실제 보고 기간입니다. 같은 기간의 관측은 같은 위치에 표시하며, 아래 버튼에서 각각 선택할 수 있습니다. 범위 양 끝점은 별도 계열이며 통계적 신뢰구간이 아닙니다.','tr-muted'),buttons);
  }
  function sourceTable(points) {
    const details=add(el('details'),el('summary','관측별 날짜·원문 출처 펼치기'));
    const table=el('table'); table.append(el('caption','선택 시리즈의 실제 보고 기간과 출처'));
    const headings=['기간 / 발행일','원래 범위 / 발행사','납기 / 변화율 / 지수','출처 / 근거'];
    const head=el('tr'); headings.forEach(s=>{const th=el('th',s);th.scope='col';head.append(th);}); table.append(add(el('thead'),head));
    const tbody=el('tbody');
    points.forEach(p=>{const row=el('tr');const texts=[`${p.date} (${p.date_basis || '발간일'}) / ${p.published_at || '발간일 미확인'} · 기준 ${p.as_of || '미제공'}`,`${p.scope} / ${p.publisher}`,`${p.level.label} / ${p.scope_break ? '제품 범위 변경' : p.change.label} / ${p.scope_break ? '제품 범위 변경' : p.index.label}`]; texts.forEach((s,i)=>{const td=el('td',s);td.dataset.label=headings[i];row.append(td);}); const td=add(el('td'),link(p),el('p',`${p.locator || ''} · ${badges(p)}`),el('p',p.change.reason || ''));td.dataset.label=headings[3];row.append(td);tbody.append(row);});
    table.append(tbody); details.append(table); return details;
  }
  function exportCSV(track,points) {
    const original=['id','series_id','date','published_at','as_of','date_basis','narrative_ko','publisher','source_title','source_url','locator','evidence_tier','scope','comparison_key','approximate','source_change','scope_break'];
    const fields=[...original,...['lower','upper','qualifier','upper_open','label'].map(k=>'level.'+k),...['available','kind','exact_pct','lower_pct','upper_pct','label','reason','previous_id','previous_date'].map(k=>'change.'+k),...['available','kind','exact','lower','upper','label','reason','base_id','base_date'].map(k=>'index.'+k)];
    const cell=v=>{let s=v==null?'':String(v); if(/^[\s\uFEFF]*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
    const rows=[['track_id','track_label','unit',...fields],...points.map(p=>[track.id,track.label,track.unit,...fields.map(f=>f.split('.').reduce((v,k)=>v?.[k],p))])];
    const blob=new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
    const href=URL.createObjectURL(blob), a=el('a'); a.href=href;a.download='leadtime-trends.csv';root.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);
  }
  load();
})();
