(function () {
  'use strict';
  const standalone = document.getElementById('models-standalone');
  const ownScript = document.currentScript;
  const assetRoot = ownScript && ownScript.src ? new URL('.', ownScript.src) : new URL('.', location.href);
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = (x, d) => (typeof x === 'number' && Number.isFinite(x)) ? new Intl.NumberFormat('ko-KR', {maximumFractionDigits: d == null ? 1 : d, minimumFractionDigits: 0}).format(x) : '—';
  const pct = (x, d) => (typeof x === 'number' && Number.isFinite(x)) ? (x > 0 ? '+' : '') + fmt(x, d == null ? 1 : d) + '%' : '—';
  const won = x => (typeof x === 'number' && Number.isFinite(x)) ? new Intl.NumberFormat('ko-KR').format(Math.round(x)) + '원' : '—';
  const sectorNames = {ent: '엔터테인먼트', media: '미디어', leisure: '레저'};
  const metricNames = {revenue: '매출액', operating_profit: '영업이익', net_income: '당기순이익', controlling_net_income: '지배순이익', gross_profit: '매출총이익', sga: '판관비', cogs: '매출원가', ebitda: 'EBITDA', pretax_income: '세전이익', income_tax: '법인세', eps_basic: '기본 EPS(원)', total_assets: '자산총계', total_liabilities: '부채총계', equity: '자본총계', controlling_equity: '지배지분', cash: '현금및현금성자산'};
  const methodNames = {per: 'PER (목표 P/E × 12MF EPS)', ev_ebitda: 'EV/EBITDA', sotp: 'SOTP (부문합산)', unknown: '템플릿 · 애널리스트 산식 없음'};
  const statusNames = {analyst: '애널리스트 추정 포함', template: '템플릿(추정 미입력)'};
  let data, root, state = {sector: 'ent', company: 'HYBE', scenario: 'base', driversOpen: {}};
  const css = `
  .am{--bg:#0b1018;--panel:#131b27;--line:#293447;--ink:#e8eef6;--dim:#92a3b9;--accent:#f2b84b;--teal:#65dec2;--blue:#819df8;--red:#ff7b72;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;padding:24px;max-width:1440px;margin:auto;box-sizing:border-box}
  .am *{box-sizing:border-box}.am h1,.am h2,.am h3,.am p{margin:0}.am h1{font-size:28px;letter-spacing:-1px}.am h2{font-size:17px;margin-bottom:10px}.am h3{font-size:13px;color:var(--dim)}.am a{color:var(--teal)}.am .dim{color:var(--dim)}.am .eyebrow{font-size:11px;letter-spacing:2px;color:var(--accent);font-weight:700}
  .am header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap}.am .asof{text-align:right;color:var(--dim);font-size:12px}
  .am button,.am select{font:inherit;color:var(--ink);border:1px solid var(--line);background:#192333;border-radius:7px;padding:7px 12px;cursor:pointer}.am button.active{color:#1b1400;background:var(--accent);border-color:var(--accent);font-weight:700}.am button:focus-visible,.am a:focus-visible,.am summary:focus-visible{outline:3px solid #b6ed7e;outline-offset:3px}
  .am .sectors{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.am .layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:20px}.am .layout>section{min-width:0}
  .am .companies{display:flex;flex-direction:column;gap:7px}.am .company{padding:11px 12px;text-align:left;display:flex;justify-content:space-between;align-items:center;gap:6px}.am .company small{display:block;font-size:11px;opacity:.75}.am .company .tag{font-size:10px;white-space:nowrap;color:var(--dim)}
  .am .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px}
  .am .title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}.am .badges{display:flex;gap:6px;flex-wrap:wrap}.am .badge{font-size:10.5px;font-weight:700;border:1px solid var(--line);padding:2px 8px;border-radius:20px;white-space:nowrap;color:var(--dim)}.am .badge.ok{color:var(--teal)}.am .badge.warn{color:var(--accent)}.am .badge.bad{color:var(--red)}
  .am .kpis{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin:12px 0}.am .kpi{background:var(--bg);border:1px solid var(--line);padding:10px 12px;border-radius:8px}.am .kpi b{display:block;font-size:19px;font-variant-numeric:tabular-nums}.am .kpi small{color:var(--dim);font-size:11px;display:block}.am .kpi .sub{font-size:11px;color:var(--dim)}
  .am .controls{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin:6px 0 10px}.am label{font-size:11px;color:var(--dim);display:flex;gap:6px;align-items:center}
  .am .tablewrap{overflow-x:auto}.am table{width:100%;border-collapse:collapse;font-size:12px;min-width:640px}.am th{text-align:right;color:var(--dim);font-weight:500;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.am th:first-child,.am td:first-child{text-align:left}.am td{padding:6px 8px;border-bottom:1px solid #223046;text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.am td.l{text-align:left;white-space:normal}.am tr.sub td{color:var(--dim);font-size:11px}.am td.est{color:var(--blue)}.am td.model{color:#c8aae9}.am td.neg{color:var(--red)}.am th.est{color:var(--blue)}
  .am .chart{width:100%;height:auto;min-height:200px;display:block}.am .chart text{font:11px -apple-system,sans-serif;fill:var(--dim)}.am .chart .grid{stroke:var(--line)}.am .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11px;color:var(--dim);margin-top:4px}.am .legend i{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px}
  .am .two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.am .notice{border-left:3px solid var(--accent);padding:8px 12px;color:var(--dim);font-size:12px;margin-top:10px;background:#1a1c26}.am .notice.blue{border-color:var(--blue);background:#141d30}
  .am details{border-top:1px solid var(--line);padding:8px 0}.am summary{cursor:pointer}.am .details-body{padding:10px 0 0;font-size:12px;color:var(--dim);overflow-wrap:anywhere}
  .am .foot{font-size:11px;color:var(--dim);margin:18px 0}.am .empty{text-align:center;padding:40px 10px;color:var(--dim);border:1px dashed var(--line);border-radius:8px}
  .am .pill{display:inline-block;font-size:10px;border:1px solid var(--line);border-radius:20px;padding:1px 7px;margin-left:6px;color:var(--dim)}
  @media(max-width:900px){.am{padding:16px}.am .layout{grid-template-columns:1fr}.am .companies{display:grid;grid-template-columns:repeat(2,1fr)}.am .two{grid-template-columns:1fr}.am .kpis{grid-template-columns:repeat(3,1fr)}}
  @media(max-width:480px){.am h1{font-size:22px}.am .kpis{grid-template-columns:repeat(2,1fr)}.am .card{padding:14px}.am header{display:block}.am .asof{text-align:left;margin-top:8px}}
  @media(prefers-color-scheme:light){html:not([data-theme=dark]) .am{--bg:#f3f6fa;--panel:#fff;--line:#d6deea;--ink:#152235;--dim:#64758a;--accent:#b8781b;--teal:#087c66;--blue:#3b57c4;--red:#c43b3b}html:not([data-theme=dark]) .am button,html:not([data-theme=dark]) .am select{background:#f5f7fa;color:var(--ink)}html:not([data-theme=dark]) .am button.active{background:#b8781b;color:#fff}html:not([data-theme=dark]) .am .notice{background:#fff7e8}html:not([data-theme=dark]) .am .notice.blue{background:#edf2ff}html:not([data-theme=dark]) .am td{border-color:#e4eaf1}}
  `;
  const co = () => data.companies.find(c => c.id === state.company);
  const hv = (c, metric, year) => { const r = ((c.history.annual[metric] || {})[String(year)]); return r ? r.value : null; };
  const mv = (c, metric, year) => { const r = ((c.model.annual[metric] || {})[String(year)]); return r ? r : null; };
  const fv = (c, year, key, sc) => { const s = (c.roll_forward.scenarios || {})[sc || state.scenario]; return s && s[String(year)] ? s[String(year)][key] : null; };
  const YEARS_A = [2020, 2021, 2022, 2023, 2024, 2025], YEARS_E = [2026, 2027, 2028];
  function yoy(c, metric, y) { const a = hv(c, metric, y), b = hv(c, metric, y - 1); return (a != null && b) ? (a / b - 1) * 100 : null; }
  function fyoy(c, y, key) { const a = fv(c, y, key), b = y === 2026 ? hv(c, key, 2025) : fv(c, y - 1, key); return (a != null && b) ? (a / b - 1) * 100 : null; }
  function cell(v, cls, d) { const neg = typeof v === 'number' && v < 0; return '<td class="' + (cls || '') + (neg ? ' neg' : '') + '">' + fmt(v, d) + '</td>'; }
  function pcell(v, cls) { const neg = typeof v === 'number' && v < 0; return '<td class="' + (cls || '') + (neg ? ' neg' : '') + '">' + pct(v) + '</td>'; }
  function annualTable(c) {
    const isT = c.model.status === 'template';
    const head = '<tr><th>십억원</th>' + YEARS_A.map(y => '<th>' + y + 'A</th>').join('') + YEARS_E.map(y => '<th class="est">' + y + 'E</th>').join('') + '</tr>';
    const row = (label, metric, key, opts) => {
      opts = opts || {};
      let h = '<tr><td class="l">' + esc(label) + '</td>';
      YEARS_A.forEach(y => { h += cell(opts.pctRow ? yoy(c, metric, y) : hv(c, metric, y), '', opts.pctRow ? 1 : (metric === 'eps_basic' ? 0 : 1)); });
      YEARS_E.forEach(y => { h += cell(opts.pctRow ? fyoy(c, y, key) : fv(c, y, key), 'est', opts.pctRow ? 1 : (key === 'eps' ? 0 : 1)); });
      return h + '</tr>';
    };
    const modelRow = (label, metric) => {
      let h = '<tr class="sub"><td class="l">' + esc(label) + (isT ? '<span class="pill">템플릿</span>' : '') + '</td>';
      YEARS_A.forEach(y => { const m = mv(c, metric, y); h += (m && m.flag === 'E' && !isT) ? cell(m.value, 'model') : '<td class="model">' + (m && !isT ? '·' : '—') + '</td>'; });
      YEARS_E.forEach(() => { h += '<td class="model">—</td>'; });
      return h + '</tr>';
    };
    const opmRow = () => {
      let h = '<tr class="sub"><td class="l">영업이익률</td>';
      YEARS_A.forEach(y => { const r = hv(c, 'revenue', y), o = hv(c, 'operating_profit', y); h += pcell((r && o != null) ? o / r * 100 : null); });
      YEARS_E.forEach(y => { const m = fv(c, y, 'opm'); h += pcell(m == null ? null : m * 100, 'est'); });
      return h + '</tr>';
    };
    const covRow = (metric, label) => {
      const s = ((c.coverage_lane.series || {})[metric] || {})[state.scenario] || {};
      if (!Object.keys(s).length) return '';
      let h = '<tr class="sub"><td class="l">' + esc(label) + ' · 커버리지 레인(드라이버 추정)</td>';
      YEARS_A.forEach(() => { h += '<td>—</td>'; });
      YEARS_E.forEach(y => { h += cell(s[String(y)] ?? s[String(y) + 'FY'] ?? null, 'est'); });
      return h + '</tr>';
    };
    return '<div class="tablewrap"><table><thead>' + head + '</thead><tbody>' +
      row('매출액', 'revenue', 'revenue') + modelRow('· 모델 원본(2024-03) 추정', 'revenue') + covRow('revenue', '· 매출') + row('YoY', 'revenue', 'revenue', {pctRow: true}) +
      row('영업이익', 'operating_profit', 'operating_profit') + modelRow('· 모델 원본 추정', 'operating_profit') + covRow('operating_profit', '· 영업이익') + opmRow() +
      row('지배순이익', 'controlling_net_income', 'controlling_net_income') + modelRow('· 모델 원본 추정', 'controlling_net_income') +
      row('EPS(원, 기본)', 'eps_basic', 'eps') +
      '</tbody></table></div><p class="dim" style="font-size:11px;margin-top:6px">2020-2022A: 모델 내 벤더 실적 · 2023-2025A: Open DART 연결 · 2026-2028E: 앙상블 연장(' + esc(state.scenario.toUpperCase()) + ') · 보라색: 교보 모델 원본 추정 · EPS(E)는 연장 지배순이익 ÷ 유통주식수</p>';
  }
  function quarterKeys(c) { const q = c.history.quarterly.revenue || {}; return Object.keys(q).filter(k => k >= '2023Q1').sort(); }
  function quarterlyChart(c) {
    const keys = quarterKeys(c); if (!keys.length) return '<div class="empty">분기 실적 없음</div>';
    const rev = keys.map(k => (c.history.quarterly.revenue[k] || {}).value), op = keys.map(k => ((c.history.quarterly.operating_profit || {})[k] || {}).value);
    const mrev = keys.map(k => { const m = (c.model.quarterly.revenue || {})[k]; return (m && m.flag === 'F' && c.model.status !== 'template' && k <= '2025Q4') ? m.value : null; });
    const W = 1000, H = 300, L = 64, R = 56, T = 20, B = 40, n = keys.length;
    const vals = rev.concat(mrev).filter(v => typeof v === 'number'); const hi = Math.max(...vals, 1) * 1.1, lo = Math.min(0, ...vals);
    const ops = op.filter(v => typeof v === 'number'); const ohi = Math.max(...ops, 1) * 1.15, olo = Math.min(0, ...ops) * 1.15;
    const x = i => L + (W - L - R) * (i + 0.5) / n, bw = (W - L - R) / n * 0.6, y = v => T + (H - T - B) * (hi - v) / (hi - lo), yo = v => T + (H - T - B) * (ohi - v) / (ohi - olo);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="분기 매출과 영업이익"><title>분기 매출(막대)·영업이익(선)·모델 원본 분기 추정(점)</title>';
    for (let j = 0; j < 5; j++) { const v = lo + (hi - lo) * j / 4; s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmt(v, 0) + '</text>'; }
    for (let j = 0; j < 5; j++) { const v = olo + (ohi - olo) * j / 4; s += '<text x="' + (W - R + 8) + '" y="' + (yo(v) + 4) + '" text-anchor="start">' + fmt(v, 0) + '</text>'; }
    keys.forEach((k, i) => { if (typeof rev[i] === 'number') s += '<rect x="' + (x(i) - bw / 2) + '" y="' + Math.min(y(rev[i]), y(0)) + '" width="' + bw + '" height="' + Math.abs(y(0) - y(rev[i])) + '" fill="#3f6fd8" opacity=".85"><title>' + esc(k + ' 매출 ' + fmt(rev[i]) + ' (' + ((c.history.quarterly.revenue[k] || {}).source || '') + ')') + '</title></rect>'; if (i % 2 === 0 || n < 10) s += '<text x="' + x(i) + '" y="' + (H - 12) + '" text-anchor="middle">' + esc(k.replace('Q', 'Q')) + '</text>'; });
    let run = []; keys.forEach((k, i) => { if (typeof op[i] === 'number') run.push(x(i) + ',' + yo(op[i])); });
    if (run.length > 1) s += '<polyline points="' + run.join(' ') + '" fill="none" stroke="#f2b84b" stroke-width="2.5"/>';
    keys.forEach((k, i) => { if (typeof op[i] === 'number') s += '<circle cx="' + x(i) + '" cy="' + yo(op[i]) + '" r="3.5" fill="#f2b84b"><title>' + esc(k + ' 영업이익 ' + fmt(op[i])) + '</title></circle>'; });
    keys.forEach((k, i) => { if (typeof mrev[i] === 'number') s += '<circle cx="' + x(i) + '" cy="' + y(mrev[i]) + '" r="4" fill="none" stroke="#c8aae9" stroke-width="2"><title>' + esc(k + ' 모델 원본 매출 추정 ' + fmt(mrev[i])) + '</title></circle>'; });
    s += '</svg><div class="legend"><span><i style="background:#3f6fd8"></i>분기 매출(좌, 십억원)</span><span><i style="background:#f2b84b"></i>분기 영업이익(우)</span><span><i style="background:none;border:2px solid #c8aae9"></i>모델 원본 분기 매출 추정</span></div>';
    return s;
  }
  function annualChart(c) {
    const years = YEARS_A.concat(YEARS_E), n = years.length;
    const act = YEARS_A.map(y => hv(c, 'revenue', y)).concat(YEARS_E.map(() => null));
    const mod = years.map(y => { const m = mv(c, 'revenue', y); return (m && m.flag === 'E' && c.model.status !== 'template') ? m.value : null; });
    const sc = {}; ['bear', 'base', 'bull'].forEach(k => { sc[k] = YEARS_A.map(() => null).concat(YEARS_E.map(y => fv(c, y, 'revenue', k))); });
    const vals = act.concat(mod, sc.bear, sc.base, sc.bull).filter(v => typeof v === 'number'); if (!vals.length) return '<div class="empty">연간 데이터 없음</div>';
    const W = 1000, H = 280, L = 64, R = 20, T = 20, B = 36, hi = Math.max(...vals) * 1.1, lo = Math.min(0, ...vals);
    const x = i => L + (W - L - R) * (i + 0.5) / n, bw = (W - L - R) / n * 0.55, y = v => T + (H - T - B) * (hi - v) / (hi - lo);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="연간 매출 실적과 연장 시나리오"><title>연간 매출: 실적·모델 원본·앙상블 연장(bear/base/bull)</title>';
    for (let j = 0; j < 5; j++) { const v = lo + (hi - lo) * j / 4; s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/><text x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + fmt(v, 0) + '</text>'; }
    years.forEach((yr, i) => {
      s += '<text x="' + x(i) + '" y="' + (H - 10) + '" text-anchor="middle">' + yr + (i < 6 ? 'A' : 'E') + '</text>';
      if (typeof act[i] === 'number') s += '<rect x="' + (x(i) - bw / 2) + '" y="' + y(act[i]) + '" width="' + bw + '" height="' + (y(0) - y(act[i])) + '" fill="#3f6fd8" opacity=".85"><title>' + esc(yr + 'A 매출 ' + fmt(act[i])) + '</title></rect>';
      const b = sc.base[i]; if (typeof b === 'number') { s += '<rect x="' + (x(i) - bw / 2) + '" y="' + y(b) + '" width="' + bw + '" height="' + (y(0) - y(b)) + '" fill="#819df8" opacity=".55"><title>' + esc(yr + 'E base ' + fmt(b)) + '</title></rect>'; const lo_ = sc.bear[i], hi_ = sc.bull[i]; if (typeof lo_ === 'number' && typeof hi_ === 'number') s += '<line x1="' + x(i) + '" x2="' + x(i) + '" y1="' + y(hi_) + '" y2="' + y(lo_) + '" stroke="#e8eef6" stroke-width="2"/><line x1="' + (x(i) - 8) + '" x2="' + (x(i) + 8) + '" y1="' + y(hi_) + '" y2="' + y(hi_) + '" stroke="#e8eef6" stroke-width="2"/><line x1="' + (x(i) - 8) + '" x2="' + (x(i) + 8) + '" y1="' + y(lo_) + '" y2="' + y(lo_) + '" stroke="#e8eef6" stroke-width="2"/>'; }
      if (typeof mod[i] === 'number') s += '<circle cx="' + x(i) + '" cy="' + y(mod[i]) + '" r="5" fill="none" stroke="#c8aae9" stroke-width="2.5"><title>' + esc(yr + 'E 모델 원본 매출 ' + fmt(mod[i])) + '</title></circle>';
    });
    s += '</svg><div class="legend"><span><i style="background:#3f6fd8"></i>실적</span><span><i style="background:#819df8"></i>앙상블 연장 base</span><span><i style="background:#e8eef6;width:2px"></i>bear–bull 범위</span><span><i style="background:none;border:2px solid #c8aae9"></i>모델 원본(2024-03) 추정</span></div>';
    return s;
  }
  function scorecardTable(c) {
    if (c.model.status === 'template') return '<p class="dim">템플릿 모델에는 애널리스트 추정치가 없어 예측 오차를 계산하지 않습니다.</p>';
    const rows = c.scorecard.filter(r => ['revenue', 'operating_profit', 'controlling_net_income'].some(m => r[m].model != null && r[m].model_flag === 'E'));
    if (!rows.length) return '<p class="dim">비교 가능한 추정 연도가 없습니다.</p>';
    let h = '<div class="tablewrap"><table><thead><tr><th>연도</th><th>매출 모델</th><th>매출 실적</th><th>오차</th><th>영업이익 모델</th><th>실적</th><th>오차</th><th>지배순이익 모델</th><th>실적</th><th>오차</th></tr></thead><tbody>';
    rows.forEach(r => { h += '<tr><td class="l">' + r.year + 'E vs A</td>'; ['revenue', 'operating_profit', 'controlling_net_income'].forEach(m => { h += cell(r[m].model, 'model') + cell(r[m].actual) + pcell(r[m].error_pct); }); h += '</tr>'; });
    return h + '</tbody></table></div><p class="dim" style="font-size:11px;margin-top:6px">오차 = 모델 ÷ 실적 − 1. 모델은 2024-03-01 시점 추정(2023E는 잠정실적 반영 전후일 수 있음).</p>';
  }
  function valuationCard(c) {
    const v = c.valuation, m = c.model.target_price;
    let h = '<div class="two"><div><h3>모델 원본 산식 · ' + esc(methodNames[v.method] || v.method) + '</h3>';
    const items = (m.items || []).filter(it => it.value != null || it.note);
    h += items.length ? '<div class="tablewrap"><table style="min-width:0"><tbody>' + items.map(it => '<tr><td class="l">' + esc(it.label) + '</td><td class="l dim">' + esc(it.unit || '') + '</td>' + (typeof it.value === 'number' ? cell(it.value, '', Math.abs(it.value) >= 1000 ? 0 : 2) : '<td class="l">' + esc(it.value == null ? '' : it.value) + '</td>') + '<td class="l dim">' + esc(it.note || '') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="dim">TP 시트에 산식 입력 없음 (템플릿).</p>';
    if (m.house_peers && m.house_peers.length) h += '<details><summary>모델 시점 타사 목표주가 ' + m.house_peers.length + '건</summary><div class="details-body"><table style="min-width:0"><tbody>' + m.house_peers.map(p => '<tr><td class="l">' + esc(p.house) + '</td>' + cell(p.target_price, '', 0) + cell(p.target_pe, '', 1) + '<td class="l dim">' + esc(p.note || '') + '</td></tr>').join('') + '</tbody></table></div></details>';
    h += '</div><div><h3>갱신 계산 (' + esc(data.as_of) + ')</h3><div class="tablewrap"><table style="min-width:0"><tbody>';
    const kv = (k, val) => '<tr><td class="l">' + esc(k) + '</td><td class="l">' + val + '</td></tr>';
    h += kv('현재가', won(v.price_now) + ' <span class="dim">(' + esc(v.price_as_of || '') + ')</span>') + kv('유통주식수', fmt(v.shares_outstanding, 0) + '주 <span class="dim">(발행−자기주식, DART)</span>');
    if (v.method === 'per') h += kv('목표 PER(모델)', fmt(v.inputs.target_pe, 1) + '배 <span class="dim">' + esc(v.inputs.target_pe_note || '') + '</span>') + kv('12MF EPS(연장 base)', won(v.eps_12mf) + ' <span class="dim">' + esc(v.inputs.eps_weights || '') + '</span>');
    if (v.method === 'ev_ebitda') h += kv('목표 EV/EBITDA(모델)', fmt(v.inputs.target_ev_ebitda, 2) + '배') + kv('2027E EBITDA(연장)', fmt(v.inputs.ebitda_2027e) + ' <span class="dim">D&A ' + fmt(v.inputs.da_bn) + ' · ' + esc(v.inputs.da_basis || '') + '</span>') + kv('순차입금', fmt(v.inputs.net_debt_bn) + ' <span class="dim">' + esc(v.net_debt_basis || '') + '</span>');
    if (v.method === 'sotp') { const i = v.inputs; h += kv('원본 영업/사업가치', fmt(i.operating_value_original_bn ?? i.business_value_original_bn) + ' <span class="dim">십억원</span>') + kv('비례 갱신 계수', fmt(i.scale_proxy, 3) + ' <span class="dim">= 연장 2027E ' + (i.roll_op_2027e_bn != null ? '영업이익 ' + fmt(i.roll_op_2027e_bn) + ' ÷ 모델 2024E ' + fmt(i.model_op_2024e_bn) : 'EBITDA ' + fmt(i.roll_ebitda_2027e_bn) + ' ÷ 모델 2024E ' + fmt(i.model_ebitda_2024e_bn)) + '</span>') + kv('순차입금(최신)', fmt(i.net_debt_bn) + ' <span class="dim">' + esc(v.net_debt_basis || '') + '</span>'); if (i.stakes) h += kv('지분가치(현재 시총, 40% 할인)', fmt(i.stake_value_bn) + ' <span class="dim">' + i.stakes.map(s => esc(s.name) + ' ' + fmt(s.value_bn)).join(' · ') + '</span>'); }
    if (v.method === 'unknown') h += kv('참고 배수', '2027E PER ' + fmt(v.per_now_2027e, 1) + '배 · PBR ' + fmt(v.pbr_now, 2) + '배 <span class="dim">(현재가 기준, 목표주가 아님)</span>');
    h += kv('목표주가 원본(2024-03)', won(v.original_target_price) + (v.original_tp_vs_price_now_pct != null ? ' <span class="dim">현재가 대비 ' + pct(v.original_tp_vs_price_now_pct) + '</span>' : '') + ' <span class="dim">' + esc(v.original_recommendation || '') + '</span>');
    h += kv('목표주가 갱신', (v.updated_target_price ? '<b>' + won(v.updated_target_price) + '</b> <span class="badge ' + (v.status === 'proxy' ? 'warn' : 'ok') + '">' + esc(v.status) + '</span> 상승여력 ' + pct(v.upside_pct) : '<span class="badge bad">' + esc(v.status || '') + '</span>'));
    h += kv('2027E PER · PBR (현재가)', fmt(v.per_now_2027e, 1) + '배 · ' + fmt(v.pbr_now, 2) + '배 <span class="dim">BPS ' + won(v.bps) + '</span>');
    h += '</tbody></table></div>' + (v.note ? '<div class="notice">' + esc(v.note) + '</div>' : '') + ((v.warnings || []).length ? '<div class="notice" style="border-color:var(--red)">' + v.warnings.map(esc).join('<br>') + '</div>' : '') + '</div></div>';
    return h;
  }
  function assumptionsCard(c) {
    const a = c.roll_forward.assumptions || {}; if (c.roll_forward.status !== 'ok') return '<div class="notice">' + esc((c.roll_forward.notes || []).join(' · ') || '연장 계산 불가') + '</div>';
    const rows = [['2026 상반기 YoY(실적)', pct(a.h1_2026_yoy * 100)], ['2026 하반기 성장률(base)', pct(a.g_h2_2026 * 100) + ' <span class="dim">= 상반기 YoY, −30%~+50% 제한</span>'], ['2027E 성장률', pct(a.g_2027 * 100) + ' <span class="dim">' + esc(a.g_2027_basis) + '</span>'], ['2028E 성장률', pct(a.g_2028 * 100) + ' <span class="dim">(2027E+5%)/2</span>'], ['2026 하반기 영업이익률', pct(a.opm_h2_2026 * 100) + ' <span class="dim">2025 하반기·2026 상반기 평균</span>'], ['목표 영업이익률(2028E)', pct(a.opm_target * 100) + ' <span class="dim">' + esc(a.opm_target_basis) + '</span>'], ['지배순이익/영업이익 전환', fmt(a.ni_to_op_ratio, 3) + ' <span class="dim">' + esc(a.ni_ratio_basis) + '</span>'], ['2026 상반기 실적(매출/영업이익/지배순이익)', fmt(a.h1_2026_actual.revenue) + ' / ' + fmt(a.h1_2026_actual.operating_profit) + ' / ' + fmt(a.h1_2026_actual.controlling_net_income)], ['2025 하반기 실적', fmt(a.h2_2025_actual.revenue) + ' / ' + fmt(a.h2_2025_actual.operating_profit) + ' / ' + fmt(a.h2_2025_actual.controlling_net_income)]];
    return '<div class="tablewrap"><table style="min-width:0"><tbody>' + rows.map(r => '<tr><td class="l">' + r[0] + '</td><td class="l">' + r[1] + '</td></tr>').join('') + '</tbody></table></div>' + ((c.roll_forward.notes || []).length ? '<div class="notice">' + c.roll_forward.notes.map(esc).join('<br>') + '</div>' : '') + '<div class="notice blue">Bear/Bull: 성장률 ∓10pp(2026 하반기) ∓5pp(2027-28), 영업이익률 ∓2pp. 확률 보정 없음. 회사 가이던스·컨센서스가 아니라 앙상블 에이전트의 규칙 기반 연장입니다.</div>';
  }
  function driversCard(c) {
    const ds = c.model.drivers || []; if (!ds.length || c.model.status === 'template') return '<p class="dim">' + (c.model.status === 'template' ? '템플릿 워크북: 드라이버 가정이 입력되지 않았습니다. 세그먼트 실적은 아래 커버리지 레인 자료를 참고.' : '드라이버 시트 없음') + '</p>';
    return ds.map((d, i) => { const years = (d.years || []).filter(y => y >= 2020).map(String); const open = !!state.driversOpen[c.id + ':' + i]; const rows = d.rows.slice(0, open ? 120 : 25); return '<details ' + (i === 0 ? 'open' : '') + '><summary>' + esc(d.sheet) + ' <span class="dim">' + d.rows.length + '행' + (d.total_rows > d.rows.length ? ' (원본 ' + d.total_rows + ')' : '') + '</span></summary><div class="details-body"><div class="tablewrap"><table><thead><tr><th>항목</th><th>단위</th>' + years.map(y => '<th>' + y + (y <= '2022' ? 'A' : 'E') + '</th>').join('') + '</tr></thead><tbody>' + rows.map(r => '<tr><td class="l" style="padding-left:' + (8 + r.indent * 10) + 'px">' + esc(r.label) + '</td><td class="l dim">' + esc(r.unit || '') + '</td>' + years.map(y => cell(r.values[y], y > '2022' ? 'model' : '', 1)).join('') + '</tr>').join('') + '</tbody></table></div>' + (d.rows.length > rows.length ? '<button data-drivers="' + i + '" style="margin-top:8px">더 보기 (' + d.rows.length + '행)</button>' : '') + '</div></details>'; }).join('');
  }
  function segmentsCard(c) {
    const seg = c.history.segments || {}; const names = Object.keys(seg); if (!names.length) return '<p class="dim">세그먼트 공식 자료 없음</p>';
    const keys = [...new Set(names.flatMap(n => Object.keys(seg[n])))].filter(k => k >= '2025Q1' && /Q/.test(k)).sort();
    return '<div class="tablewrap"><table><thead><tr><th>지표(커버리지 레인 원문 명칭)</th>' + keys.map(k => '<th>' + k + '</th>').join('') + '</tr></thead><tbody>' + names.map(n => '<tr><td class="l">' + esc(n) + '</td>' + keys.map(k => cell((seg[n][k] || {}).value)).join('') + '</tr>').join('') + '</tbody></table></div><p class="dim" style="font-size:11px;margin-top:6px">단위 십억원. 앙상블 커버리지 레인이 회사 IR 자료에서 검증한 값이며, 출처는 아래 계보 카드에 나열됩니다.</p>';
  }
  function consensusCard(c) {
    const cs = c.model.consensus_at_vintage; if (!cs || !cs.columns || !cs.columns.length) return '<p class="dim">컨센 시트 없음</p>';
    const cols = cs.columns.filter(x => x.item && (cs.stats.mean[x.col] != null));
    return '<p class="dim" style="font-size:11px">' + esc(cs.as_of_note || '') + ' · ' + esc(cs.consensus_date || '') + ' · 매출 등은 원 단위(백만원 표기)일 수 있음 — 원본 표기 그대로</p><div class="tablewrap"><table><thead><tr><th>항목</th>' + cols.map(x => '<th>' + esc(x.item) + '<br><span class="dim">' + esc(x.period || '') + '</span></th>').join('') + '</tr></thead><tbody>' + ['mean', 'high', 'median', 'low'].map(k => '<tr><td class="l">' + k + '</td>' + cols.map(x => cell(cs.stats[k][x.col], '', 0)).join('') + '</tr>').join('') + '</tbody></table></div>' + (cs.houses && cs.houses.length ? '<details><summary>증권사별 ' + cs.houses.length + '건</summary><div class="details-body"><table><tbody>' + cs.houses.map(hh => '<tr><td class="l">' + esc(hh.date) + '</td><td class="l">' + esc(hh.house) + ' ' + esc(hh.analyst || '') + '</td>' + cols.slice(0, 3).map(x => cell(hh.values[x.col], '', 0)).join('') + '</tr>').join('') + '</tbody></table></div></details>' : '');
  }
  function lineageCard(c) {
    const dp = c.history.dart_periods || {}; const src = data.sources || {};
    let h = '<h3>Open DART 정기보고서(연결)</h3><p class="dim" style="font-size:12px">' + Object.keys(dp).map(k => dp[k].rcept_no ? '<a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + esc(dp[k].rcept_no) + '" target="_blank" rel="noopener noreferrer">' + esc(k) + '</a>' : esc(k) + '(없음)').join(' · ') + '</p>';
    const ids = c.coverage_source_ids || []; if (ids.length) h += '<h3 style="margin-top:10px">커버리지 레인 공식 자료</h3>' + ids.map(id => { const s = src[id] || {}; return '<p class="dim" style="font-size:12px">' + (s.url ? '<a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.title || id) + ' ↗</a>' : esc(s.title || id)) + ' <span>· 공표 ' + esc(s.published_at || '미확인') + ' · ' + esc(s.status || '') + '</span></p>'; }).join('');
    const mk = c.history.market || {}; h += '<h3 style="margin-top:10px">시세·주식수</h3><p class="dim" style="font-size:12px">현재가: ' + esc(mk.price_source || '') + ' (' + esc(mk.price_as_of || '') + ') · 발행주식수: ' + esc(mk.shares_source || '') + (mk.citation ? ' · ' + esc(mk.citation) : '') + (c.history.shares && c.history.shares.rcept_no ? ' · 자기주식: DART <a href="https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + esc(c.history.shares.rcept_no) + '" target="_blank" rel="noopener noreferrer">주식총수 현황</a>' : '') + '</p>';
    h += '<h3 style="margin-top:10px">원본 모델</h3><p class="dim" style="font-size:12px">' + esc(c.model.file) + ' · ' + esc(c.model.house) + ' ' + esc(c.model.analyst) + ' · 모델 vintage ' + esc(c.model.vintage) + ' · sha256 ' + esc((c.model.sha256 || '').slice(0, 16)) + '… · 시트 ' + (c.model.sheets || []).length + '개 · 상태: ' + esc(statusNames[c.model.status] || c.model.status) + '</p>';
    return h;
  }
  function kpis(c) {
    const v = c.valuation, r25 = hv(c, 'revenue', 2025), o25 = hv(c, 'operating_profit', 2025), r26 = fv(c, 2026, 'revenue'), o26 = fv(c, 2026, 'operating_profit');
    const k = (label, val, sub) => '<div class="kpi"><small>' + label + '</small><b>' + val + '</b><span class="sub">' + (sub || '') + '</span></div>';
    return '<div class="kpis">' + k('2025A 매출', fmt(r25), 'YoY ' + pct(yoy(c, 'revenue', 2025))) + k('2025A 영업이익', fmt(o25), 'OPM ' + pct(r25 && o25 != null ? o25 / r25 * 100 : null)) + k('2026E 매출 · ' + state.scenario, fmt(r26), 'YoY ' + pct(fyoy(c, 2026, 'revenue'))) + k('2026E 영업이익', fmt(o26), 'OPM ' + pct(fv(c, 2026, 'opm') == null ? null : fv(c, 2026, 'opm') * 100)) + k('2027E EPS · PER', won(fv(c, 2027, 'eps')), fmt(v.per_now_2027e, 1) + '배 (현재가 ' + won(v.price_now) + ')') + k('목표주가', v.updated_target_price ? won(v.updated_target_price) : '—', (v.original_target_price ? '원본 ' + won(v.original_target_price) + ' → ' : '') + (v.upside_pct != null ? '상승여력 ' + pct(v.upside_pct) : esc(v.status || ''))) + '</div>';
  }
  function render() {
    const c = co();
    const list = data.companies.filter(x => x.sector === state.sector).map(x => '<button class="company ' + (x.id === state.company ? 'active' : '') + '" data-company="' + esc(x.id) + '"><span>' + esc(x.name) + '<small>' + esc(x.ticker) + '</small></span><span class="tag">' + (x.model.status === 'template' ? '템플릿' : (x.valuation.updated_target_price ? won(x.valuation.updated_target_price) : '추정')) + '</span></button>').join('');
    root.innerHTML = '<div class="am"><header><div><div class="eyebrow">ENSEMBLE / ANALYST MODELS</div><h1>커버리지 모델 12사</h1><p class="dim">' + esc(data.model_house) + ' ' + esc(data.model_analyst) + ' 엔터·미디어·레저 모델(' + esc(data.model_vintage) + ')을 최신 실적으로 갱신하고 2026-2028을 연장한 페이지</p></div><div class="asof">기준일 ' + esc(data.as_of) + '<br>DART ' + esc((data.dart_retrieved_at || '').slice(0, 10)) + ' · 시세 ' + esc((data.market_retrieved_at || '').slice(0, 10)) + '<br>실적 · 모델 원본 · 앙상블 연장 분리 표기</div></header>' +
      '<nav class="sectors" aria-label="섹터">' + Object.keys(sectorNames).map(s => '<button data-sector="' + s + '" class="' + (state.sector === s ? 'active' : '') + '">' + sectorNames[s] + ' <small>4</small></button>').join('') + '</nav>' +
      '<div class="layout"><aside><div class="companies">' + list + '</div><div class="notice" style="margin-top:12px">모델 원본은 2024-03-01 시점 교보증권 리서치 워크북이며, 연장·목표주가 갱신은 앙상블 에이전트의 규칙 계산입니다. 애널리스트의 현재 의견이 아닙니다.</div></aside><section>' +
      '<div class="card"><div class="title"><div><h2 style="font-size:22px">' + esc(c.name) + ' <span class="dim" style="font-size:13px">' + esc(c.ticker) + ' · ' + esc(sectorNames[c.sector]) + '</span></h2><div class="badges"><span class="badge ' + (c.model.status === 'template' ? 'warn' : 'ok') + '">' + esc(statusNames[c.model.status]) + '</span><span class="badge">모델 ' + esc(c.model.vintage) + '</span><span class="badge">최신 분기 ' + esc(c.history.latest_quarter || '—') + '</span><span class="badge">' + esc(methodNames[c.valuation.method] || '') + '</span>' + (c.model.profile && c.model.profile.recommendation ? '<span class="badge">원본 의견 ' + esc(c.model.profile.recommendation) + ' · TP ' + won(c.valuation.original_target_price) + ' (당시 주가 ' + won(c.model.profile.price_krw) + ')</span>' : '') + '</div></div><div class="controls"><label>시나리오 <select data-state="scenario">' + ['base', 'bear', 'bull'].map(s => '<option value="' + s + '" ' + (state.scenario === s ? 'selected' : '') + '>' + s.toUpperCase() + '</option>').join('') + '</select></label><a href="../coverage/index.html" target="_blank" rel="noopener">커버리지 레인(드라이버 모델) ↗</a></div></div>' + kpis(c) + '</div>' +
      '<div class="card"><h2>연간 실적 · 모델 원본 · 앙상블 연장</h2>' + annualTable(c) + '</div>' +
      '<div class="two"><div class="card"><h2>분기 실적 (2023Q1~' + esc(c.history.latest_quarter || '') + ')</h2>' + quarterlyChart(c) + '</div><div class="card"><h2>연간 매출: 실적 · 원본 추정 · 연장 범위</h2>' + annualChart(c) + '</div></div>' +
      '<div class="two"><div class="card"><h2>연장 가정 (' + esc(state.scenario.toUpperCase()) + ' 기준 base 파라미터)</h2>' + assumptionsCard(c) + '</div><div class="card"><h2>모델 원본 vs 실적 (예측 오차)</h2>' + scorecardTable(c) + '</div></div>' +
      '<div class="card"><h2>밸류에이션 · 목표주가</h2>' + valuationCard(c) + '</div>' +
      '<div class="card"><h2>모델 드라이버 가정 (원본 시트 발췌, 2024-03 시점)</h2>' + driversCard(c) + '</div>' +
      '<div class="card"><h2>최신 세그먼트 실적 (회사 공식 자료, 커버리지 레인 검증)</h2>' + segmentsCard(c) + '</div>' +
      '<div class="two"><div class="card"><h2>모델 시점 컨센서스</h2>' + consensusCard(c) + '</div><div class="card"><h2>투자포인트 (원문)</h2>' + ((c.model.target_price.investment_points || []).length ? '<ul class="dim" style="padding-left:18px;margin:0">' + c.model.target_price.investment_points.map(p => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '<p class="dim">TP 시트에 투자포인트 기재 없음</p>') + '</div></div>' +
      '<div class="card"><h2>출처 · 계보</h2>' + lineageCard(c) + '</div>' +
      '<div class="card"><h2>방법</h2><p class="dim" style="font-size:12px">' + esc(data.method.history) + '</p><p class="dim" style="font-size:12px;margin-top:6px">' + esc(data.method.roll_forward) + '</p><p class="dim" style="font-size:12px;margin-top:6px">' + esc(data.method.valuation) + '</p><div class="notice">' + esc(data.method.disclaimer) + '</div></div>' +
      '</section></div><p class="foot">숫자는 십억원(별도 표기 제외). 실적·모델 원본·연장·커버리지 레인 값은 서로 대체하지 않으며 미확인 값은 빈칸으로 둡니다.</p></div>';
    root.querySelectorAll('[data-sector]').forEach(b => b.addEventListener('click', () => { state.sector = b.dataset.sector; state.company = data.companies.find(x => x.sector === state.sector).id; render(); window.scrollTo(0, root.offsetTop - 60); }));
    root.querySelectorAll('[data-company]').forEach(b => b.addEventListener('click', () => { state.company = b.dataset.company; render(); }));
    root.querySelectorAll('[data-state]').forEach(s => s.addEventListener('change', () => { state[s.dataset.state] = s.value; render(); }));
    root.querySelectorAll('[data-drivers]').forEach(b => b.addEventListener('click', () => { state.driversOpen[state.company + ':' + b.dataset.drivers] = true; render(); }));
  }
  async function init() {
    const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);
    if (standalone) root = standalone;
    else {
      const tabs = document.querySelector('.tabs'), firstPane = document.querySelector('.pane');
      if (!tabs || !firstPane) return;
      if (document.getElementById('pane-models')) return;
      const button = document.createElement('button'); button.className = 'tabbtn'; button.dataset.tab = 'models'; button.textContent = '📐 커버리지 모델 12사'; tabs.appendChild(button);
      root = document.createElement('div'); root.id = 'pane-models'; root.className = 'pane'; firstPane.parentElement.insertBefore(root, firstPane.nextSibling);
      button.addEventListener('click', () => { document.querySelectorAll('.tabbtn,.pane').forEach(e => e.classList.remove('on')); button.classList.add('on'); root.classList.add('on'); });
    }
    root.innerHTML = '<div class="am"><p>모델 데이터를 불러오는 중입니다.</p></div>';
    try {
      const embedded = document.getElementById('models-data');
      if (embedded) data = JSON.parse(embedded.textContent);
      else { const response = await fetch(new URL('data.json', assetRoot), {cache: 'no-cache'}); if (!response.ok) throw new Error('HTTP ' + response.status); data = await response.json(); }
      if (data.schema_version !== 'ensemble-analyst-models/1' || !Array.isArray(data.companies)) throw new Error('지원하지 않는 데이터 계약');
      const hash = (location.hash.match(/models=([A-Z_]+)/) || [])[1]; if (hash && data.companies.some(x => x.id === hash)) { state.company = hash; state.sector = data.companies.find(x => x.id === hash).sector; }
      render();
    } catch (error) { root.innerHTML = '<div class="am"><div class="card"><h2>데이터를 표시할 수 없습니다</h2><p>' + esc(error.message) + '</p><p class="dim">기존 탭은 그대로 사용할 수 있습니다.</p></div></div>'; }
  }
  init();
})();
