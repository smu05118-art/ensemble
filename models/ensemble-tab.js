/* 앙상블 '커버리지 모델 12사' — 홈 탭(#pane-models)과 단독 페이지(#models-standalone) 공용 렌더러. 데이터 계약 ensemble-analyst-models/2.
   HTML 문자열을 만드는 순수 함수와 DOM 연결(mount)을 나눴다. Node에서 require하면 순수 함수만 module.exports로 내보내고 DOM은 건드리지 않는다.
   이번 라운드 계약의 새 필드(range.sensitivity·cross_checks·op_vs_consensus·headline_text, flags, break_even, mapping_check, bps_basis,
   house_tp_in_consensus_snapshot, 현금흐름·세전이익 이력, sources.aliases·doc_type 등)는 없을 수 있다 — 없으면 그 조각을 그리지 않는다. */
(function () {
  'use strict';
  const SCHEMA = 'ensemble-analyst-models/2';
  const SCEN = ['bear', 'base', 'bull'];
  const DART = 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=';
  const CHART_W = 640;

  // ── 형식 ──
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  const isNum = x => typeof x === 'number' && Number.isFinite(x);
  const obj = x => (x && typeof x === 'object' && !Array.isArray(x)) ? x : {};
  const arr = x => Array.isArray(x) ? x : [];
  const str = x => typeof x === 'string' ? x : '';
  const nfs = {};
  const nf = (min, max) => nfs[min + ':' + max] || (nfs[min + ':' + max] = new Intl.NumberFormat('ko-KR', {minimumFractionDigits: min, maximumFractionDigits: max}));
  const z = (x, d) => (Math.abs(x) < 0.5 * Math.pow(10, -d) ? 0 : x);
  const fmt = (x, d) => { d = d == null ? 1 : d; return isNum(x) ? nf(0, d).format(z(x, d)) : '—'; };
  const fx = (x, d) => { d = d == null ? 1 : d; return isNum(x) ? nf(d, d).format(z(x, d)) : '—'; };
  const sgn = (x, d) => { d = d == null ? 1 : d; if (!isNum(x)) return '—'; const v = z(x, d); return (v > 0 ? '+' : '') + nf(d, d).format(v); };
  const pct = (x, d) => isNum(x) ? sgn(x, d) + '%' : '—';
  const pctR = (r, d) => isNum(r) ? pct(r * 100, d) : '—';
  const lvlR = (r, d) => isNum(r) ? fx(r * 100, d == null ? 1 : d) + '%' : '—';
  const won = x => isNum(x) ? nf(0, 0).format(z(Math.round(x), 0)) + '원' : '—';
  const wonE = x => isNum(x) ? nf(0, 2).format(z(x, 2)) + '원' : '—'; // 12MF EPS처럼 소수 둘째 자리까지 오는 값(4,336.5원)은 반올림하지 않는다
  const mult = (x, d) => isNum(x) ? fmt(x, d == null ? 3 : d) + '배' : '—';
  const bnTxt = x => isNum(x) ? fx(x, 1) + '십억원' : '—';
  const ratio = (a, b) => (isNum(a) && isNum(b) && b > 0) ? a / b : null;
  const r1 = v => Math.round(v * 10) / 10;
  const ymd = s => /^\d{8}$/.test(str(s)) ? s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6) : str(s);
  const host = u => { try { return new URL(u).hostname; } catch (e) { return ''; } };
  const safeUrl = u => /^https?:\/\//.test(str(u)) ? u : '';
  const hasHangul = s => /[가-힣]/.test(str(s));
  // 엔진 설명문에 섞인 내부 파일명·필드명(rollfwd.py, (da_verified) 등)은 화면에 쓰지 않는다
  const plain = s => str(s).replace(/\s*\([A-Za-z0-9_.-]+\.(?:py|json|tsv|csv|xlsx?|xlsm)\)/g, '').replace(/\b[A-Za-z0-9_-]+\.(?:py|json|tsv|csv|xlsx?|xlsm)\b\s*/g, '').replace(/\s*\([a-z]+_[a-z0-9_]+\)/g, '');
  // 커버리지 레인 문구의 키 이름: as_of → 기준일, 점으로 이은 내부 경로(official_evidence.calibration) → 일반 명칭
  const plainNote = s => plain(s).replace(/\bas_of\b/g, '기준일').replace(/\b[a-z]+(?:_[a-z0-9]+)+\.[a-z_][a-z0-9_]*\b/g, '커버리지 레인 근거 자료');
  // 근거·출처 문구의 접수번호 키 이름(rcept_no·rcpNo)은 'DART'로 바꾸고 번호는 공시 링크로 단다.
  // Open DART API 이름(fnlttSinglAcntAll)과 XBRL 계정 id(ifrs-full_…)도 화면 이름으로 바꾼다
  const rcptHtml = s => esc(str(s).replace(/\s*\((?:fnltt\w+|ifrs-full_[^)]*)\)/g, '').replace(/\bfnltt\w+\s+CFS\s+CF\b/g, '연결 현금흐름표').replace(/\bfnltt\w+\b/g, '전체 재무제표')
    .replace(/\b(?:DART\s+)?(?:rcept_no|rcpNo)\s*/g, 'DART ')).replace(/\b20\d{12}\b/g, no => dartLink(no, no));

  // ── 이름표 ──
  const sectorNames = {ent: '엔터테인먼트', media: '미디어', leisure: '레저'};
  const scenName = s => ({bear: 'BEAR', base: 'BASE', bull: 'BULL'}[s] || '');
  const statusLabels = {updated: '규칙 환산가', range: 'SOTP 범위', reference_band: '밴드 참고가', not_valued_rehabilitation: '회생절차 · 환산가 미산정', not_computable: '환산가 산출 불가'};
  const methodNames = {per: 'PER', pbr: 'PBR', ev_ebitda: 'EV/EBITDA', sotp: 'SOTP(부문합산)', none: '산정 안 함', unknown: '원본 산식 없음(템플릿)'};
  const bindingNames = {band_p80_cap: '자기 밴드 80백분위 상한', street_ceiling: '스트리트 상한', pbr_cap: 'PBR 정합 상한', eps_clamp: 'EPS 입력 ±30% 제한'};
  const bandSourceNames = {workbook: '워크북 밴드 × k', dart_fy: 'DART 연간', ttm: '최근 4개 분기'};
  const bucketNames = {borrowings: '차입금·사채', leases: '리스부채', cash: '현금및현금성자산', short_term_financial: '단기금융상품', other_current_financial: '기타유동금융자산'};
  const unitNames = {ratio: '비율(%)', KRWbn: '십억원', KRWmn: '백만원', persons: '명', visits: '회', visiting_days: '일'};
  const confNames = {low: '낮음', medium: '중간', high: '높음'};
  const metricKo = {revenue: '매출액', operating_profit: '영업이익', net_income: '순이익', controlling_net_income: '지배순이익', eps_basic: 'EPS'};
  const srcStatusNames = {official_original_acquired: '공식 원본', primary_company_file_retrieved: '회사 원본 파일', agent_model_not_official: '에이전트 모델(공식 자료 아님)', agent_model_design: '에이전트 설계 문서', agent_model_not_company_guidance: '에이전트 모델(회사 가이던스 아님)', coverage_lane_source: '커버리지 레인 수집 자료'};
  const pubStatusNames = {unknown_observed_by_cutoff: '수집 시점까지 확인 안 됨'};
  // 레저 드라이버·커버리지 가정 지표의 화면 이름(목록에 없는 지표는 원문 명칭 그대로). 근거: 커버리지 레인 가정 원문(name_table)
  const driverNames = {
    table_participant_estimate: '실방문객 수(테이블 게임 참여 기준 추정)', table_drop: '테이블 드롭액', machine_drop: '머신 드롭액', total_drop: '총 드롭액',
    table_drop_per_participant: '참가자당 테이블 드롭액', total_hold: '전체 홀드율', table_hold: '테이블 홀드율', machine_hold: '머신 홀드율',
    table_net_revenue: '테이블 순매출', slot_net_revenue: '슬롯머신 순매출', casino_net_revenue: '카지노 순매출', casino_visits: '카지노 방문객 수',
    drop_per_visit: '방문당 드롭액', casino_gross_operating_revenue: '카지노 총매출(포인트 차감 전)', gross_operating_hold: '총매출 기준 홀드율', high1_points: '하이원 포인트(카지노 총매출 차감액)',
    casino_food_beverage_revenue: '카지노 식음료 매출', casino_segment_revenue: '카지노 부문 매출', noncasino_revenue: '비카지노 매출',
    hotel_segment_revenue: '호텔 부문 매출', travel_revenue: '여행 부문 매출', vip_visiting_days: 'VIP 방문일수', japan_vip_drop: '일본 VIP 드롭액',
    china_vip_drop: '중국 VIP 드롭액', other_vip_drop: '기타 VIP 드롭액', mass_drop: '일반(매스) 드롭액',
    fixed_cost_inflation_yoy: '고정비 잔차 상승률(전년 동기 대비)', drop_growth_yoy: '드롭액 증가율(전년 대비)', september_drop_growth_yoy: '9월 드롭액 증가율(전년 동월 대비 · 7~8월 실적 증가율 ±10pp)',
    recent_machine_drop_growth_yoy: '머신 드롭액 증가율(7~8월 실적 기준, 9월·4분기에 적용)', variable_cost_ratio: '카지노 변동비율(카지노 관련 변동 영업비용 ÷ 카지노 매출, 강원랜드는 총매출 기준)',
    noncasino_net_revenue_growth_yoy: '비카지노 순매출 증가율(전년 대비)',
    hotel_net_revenue_growth_yoy: '호텔 순매출 증가율(카지노 콤프 내부거래 제거 후, 전년 동기 대비)', travel_other_revenue_growth_yoy: '여행(크루즈 포함)·기타 매출 증가율(전년 동기 대비)',
    organic_noncasino_growth_yoy: '비카지노 매출 유기적 증가율(하얏트 인수분 제외, 전년 동기 대비)', hyatt_incremental_noncasino_revenue: '인수 하얏트 호텔 매출(비카지노 추가분, 분기)',
    high1_points_to_gross_revenue: '하이원 포인트 ÷ 카지노 총매출', accounting_bridge: '월간 카지노 순매출→연결 매출 차이(분기 가산액)',
    nonrecurring_bonus_normalization: '2026Q2 일회성 상여비 감소분 원복(2027Q2 고정비에 다시 가산)', reinforcement_depreciation_release: '보강공사 감가상각비 종료분(2028Q2부터 분기 고정비에서 차감)'
  };
  const metricLabel = k => driverNames[k] ? esc(driverNames[k]) : '<code>' + esc(k) + '</code>';
  const howTxt = s => str(s).replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, k => driverNames[k] || k);
  // 세그먼트·부문 항목의 화면 이름. 근거가 원문 계정명(레저 source_locator)·이 데이터의 부문 라벨(CJ ENM range.segments)·콘텐트리중앙 TP 블록인 것만 확정 이름으로 쓴다
  const segmentNames = {
    casino_gross_win: '카지노매출액', casino_losses: '카지노손실금', sales_allowance: '매출에누리', foreign_exchange_revenue: '환전수입', comps: '콤프비용', sales_promotion: '판매촉진비',
    wages_cogs: '급여', retirement_cogs: '퇴직급여', benefits_cogs: '복리후생비', rent_cogs: '임차료', depreciation_cogs: '감가상각비', rou_depreciation: '사용권자산상각비',
    tourism_fund: '관광진흥개발기금', excise_tax: '개별소비세', commissions: '지급수수료',
    casino_segment_revenue: '카지노 부문 매출', hotel_segment_revenue: '호텔 부문 매출', travel_revenue: '여행 부문 매출', other_revenue: '기타 매출', operating_costs: '영업비용', net_financial_income: '금융손익',
    noncasino_revenue: '비카지노 매출', other_operating_costs: '기타 영업비용',
    media_revenue: '미디어플랫폼 매출', scripted_revenue: '영화드라마 매출', music_revenue: '음악 매출', commerce_revenue: '커머스 매출',
    media_operating_profit: '미디어플랫폼 영업이익', scripted_operating_profit: '영화드라마 영업이익', music_operating_profit: '음악 영업이익', commerce_operating_profit: '커머스 영업이익', consolidation_op_adjustment: '연결조정(영업이익)',
    sll_revenue: 'SLL중앙 매출', megabox_revenue: '메가박스 매출', playtime_revenue: '플레이타임 매출'
  };
  // 원문 계정명이 입력에 없어 키 이름을 옮긴 해석(name_table의 '키 해석'·'확인 필요') — 화면에 원문 명칭을 함께 둔다
  const segmentGuess = {
    wages_total: '인건비(합계)', depreciation_total: '감가상각비(합계)', casino_levies: '카지노 제세·부담금',
    integrated_resort_revenue: '복합리조트 부문 매출', integrated_resort_cost_of_sales: '복합리조트 부문 매출원가', casino_segment_cost_of_sales: '카지노 부문 매출원가',
    hotel_segment_cost_of_sales: '호텔 부문 매출원가', other_cost_of_sales: '기타 부문 매출원가', financial_income: '금융수익', financial_expense: '금융비용',
    tv_ad_revenue: 'TV 광고 매출', tving_revenue: '티빙 매출', plusm_revenue: '플러스엠 매출',
    album_digital_revenue: '앨범·음원 매출', concert_revenue: '공연 매출', advertising_appearance_revenue: '광고·출연 매출', merchandise_revenue: 'MD 매출', content_revenue: '콘텐츠 매출', fanclub_revenue: '팬클럽 매출',
    payroll_sga: '판관비: 급여', shipping_sga: '판관비: 운반비', amortization_sga: '판관비: 무형자산상각비', rental_sga: '판관비: 임차료', outsourcing_sga: '판관비: 외주용역비', other_sga: '판관비: 기타',
    nonoperating_income: '영업외수익', nonoperating_expense: '영업외비용', noncontrolling_net_income: '비지배지분 순이익', adjusted_operating_profit: '조정 영업이익(회사 기준)', adjusted_ebitda: '조정 EBITDA(회사 기준)',
    subsidiaries_eliminations_rounding_revenue: '자회사·연결조정(내부거래 제거·반올림) 매출',
    physical_album_revenue: '음반(실물) 매출', streaming_revenue: '음원(스트리밍) 매출', advertising_revenue: '광고 매출', appearance_revenue: '출연 매출',
    other_operating_income: '기타영업수익', other_operating_expense: '기타영업비용', nonoperating_income_before_associates: '영업외수익(지분법 제외)', associates_income: '지분법손익',
    product_revenue: '제품 매출', music_service_revenue: '음악서비스 매출', advertising_business_revenue: '광고사업 매출', service_revenue: '용역 매출',
    product_cogs: '제품 매출원가', music_service_cogs: '음악서비스 매출원가', concert_cogs: '공연 매출원가', service_cogs: '용역 매출원가',
    broadcast_revenue: '편성 매출', sales_revenue: '판매 매출', domestic_revenue: '국내 매출', overseas_revenue: '해외 매출',
    business_revenue: '사업 매출', operating_expenses: '영업비용', production_cost: '제작원가', business_cost: '사업원가'
  };
  function segLabel(k) {
    if (segmentNames[k]) return esc(segmentNames[k]);
    if (segmentGuess[k]) return esc(segmentGuess[k]) + ' <span class="dim">(키 해석 · 원문 명칭 <code>' + esc(k) + '</code>)</span>';
    return '<code>' + esc(k) + '</code> <span class="dim">(원문 명칭 · 뜻 확인 필요)</span>';
  }
  // 세그먼트 표의 묶음: 매출 / 비용 / 이익 / 영업외 / 조정·잔차(비용 항목·조정 영업이익이 '세그먼트'로 읽히지 않게)
  const SEG_GROUPS = [['rev', '매출(부문·유형별)'], ['cost', '비용 항목'], ['profit', '이익(부문·회사 기준)'], ['other', '영업외·금융·지분 손익'], ['adj', '조정·잔차']];
  function segGroup(k) {
    if (/eliminations|consolidation|rounding|_adjustment$/.test(k)) return 'adj';
    if (/operating_profit$|ebitda$/.test(k)) return 'profit';
    if (/nonoperating|^financial_|net_financial|associates|noncontrolling|^other_operating_(?:income|expense)$/.test(k)) return 'other';
    if (/(?:_cogs|_sga|_cost|_costs|_cost_of_sales|_expenses?|_depreciation|_total|_levies|_tax|_fund)$|^(?:comps|commissions|sales_promotion)$/.test(k)) return 'cost';
    return 'rev';
  }
  // 커버리지 레인 분기 추정(roll_forward.quarterly)의 지표 이름
  const rfqLabel = k => metricKo[k] ? esc(metricKo[k]) : driverNames[k] ? esc(driverNames[k]) : segmentNames[k] ? esc(segmentNames[k]) : '<code>' + esc(k) + '</code>';
  const flagNames = {going_concern: '계속기업 전제', sll_cb_mark: 'SLL 전환사채 전환가'};
  const variantNames = {tax_22: 'NOPLAT 세율 22%', tax_27_5: 'NOPLAT 세율 27.5%', media_workbook_18_1: '미디어 배수 18.1배(워크북)', media_workbook_22: '미디어 배수 22배(워크북)', music_no_discount: '음악 할인 없음', no_minority_deduction: '비지배지분 차감 안 함'};
  const docTypeNames = {ir_factsheet: 'IR 팩트시트', factsheet: 'IR 팩트시트', earnings: '실적 자료', earnings_release: '실적 자료', dart: 'DART 공시', dart_filing: 'DART 공시', monthly: '월간 자료'};
  const priceSourceName = s => /naver/i.test(str(s)) ? '네이버 금융 시세' : /aikstockdata/i.test(str(s)) ? '한국주식데이터 시세' : '시세 제공처 표기 없음';
  function histSourceName(s) {
    s = str(s);
    if (s === 'model_report_vendor_actual') return '워크북 내 벤더 실적';
    if (s === 'dart_cfs') return 'Open DART 연결 정기보고서';
    if (s === 'dart_note_da_verified') return 'DART 연결주석 실측';
    if (s === 'operating_profit + dart_note_da_verified') return '영업이익 + DART 연결주석 D&A';
    if (s.indexOf('coverage:') === 0) return '커버리지 레인(회사 공식 자료)';
    return s ? '출처 표기 확인 필요' : '';
  }

  // ── 데이터 접근 (모두 undefined 안전) ──
  const hist = c => obj(obj(c).history);
  const model = c => obj(obj(c).model);
  const rf = c => obj(obj(c).roll_forward);
  const val = c => obj(obj(c).valuation);
  const isTemplate = c => model(c).status === 'template';
  const isCovDriver = c => rf(c).method === 'coverage_driver';
  const vintageYM = d => str(obj(d).model_vintage).slice(0, 7) || '워크북 작성 시점';
  const disclaimer = d => str(obj(obj(d).method).disclaimer) || '투자 권유가 아닙니다.';
  function hrec(c, freq, metric, key) { const r = obj(obj(hist(c)[freq])[metric])[key]; return (r && typeof r === 'object') ? r : null; }
  function hv(c, metric, key, freq) { const r = hrec(c, freq || 'annual', metric, key); return r && isNum(r.value) ? r.value : null; }
  function fv(c, year, key, sc) { const v = obj(obj(obj(rf(c).scenarios)[sc])[String(year)])[key]; return isNum(v) ? v : null; }
  function mrec(c, freq, metric, key) { const r = obj(obj(model(c)[freq])[metric])[key]; return (r && isNum(r.value)) ? r : null; }
  function yearsA(c) { const ks = Object.keys(obj(obj(hist(c).annual).revenue)).filter(k => /^\d{4}$/.test(k)).sort(); return ks.length ? ks : ['2020', '2021', '2022', '2023', '2024', '2025']; }
  function yearsE(c) { const ks = Object.keys(obj(obj(rf(c).scenarios).base)).filter(k => /^\d{4}$/.test(k)).sort(); return ks.length ? ks : ['2026', '2027', '2028']; }
  function yoyA(c, metric, y) { const a = hv(c, metric, y), b = hv(c, metric, String(+y - 1)); return (isNum(a) && isNum(b) && b > 0) ? (a / b - 1) * 100 : null; }
  function fyoy(c, y, key, sc) { const a = fv(c, y, key, sc), b = y === yearsE(c)[0] ? hv(c, key, String(+y - 1)) : fv(c, +y - 1, key, sc); return (isNum(a) && isNum(b) && b > 0) ? (a / b - 1) * 100 : null; }
  function quarterKeys(c) { return Object.keys(obj(obj(hist(c).quarterly).revenue)).filter(k => /^\d{4}Q[1-4]$/.test(k) && k >= '2023Q1').sort(); }
  function modelQ(c, metric, k) {
    if (isTemplate(c)) return null;
    const thru = obj(model(c).horizon).quarterly_through, r = mrec(c, 'quarterly', metric, k);
    return (r && r.flag === 'F' && typeof thru === 'string' && k <= thru) ? r.value : null;
  }
  function pickCompany(d, company) {
    if (company && typeof company === 'object') return company;
    return arr(obj(d).companies).find(x => obj(x).id === company) || {};
  }
  // 출처 목록 조회. 같은 URL 항목을 합친 공개본은 남긴 항목의 aliases에 옛 id를 둔다 — 옛 id로도 찾고, 같은 출처는 한 번만 센다
  function srcIndex(d) {
    const src = obj(obj(d).sources), alias = {};
    Object.keys(src).forEach(k => arr(obj(src[k]).aliases).forEach(a => { if (typeof a === 'string' && a && !src[a]) alias[a] = k; }));
    const key = id => (typeof id === 'string' && id) ? (src[id] ? id : (alias[id] || null)) : null;
    return {key, get: id => { const k = key(id); return k ? obj(src[k]) : null; }};
  }

  // ── 밸류에이션 상태 ──
  const statusLabel = v => statusLabels[obj(v).status] || '상태 미확인';
  function valTone(v) {
    v = obj(v);
    // 초록은 '중간 신뢰도이면서 엔진 경고가 없는 규칙 환산가'에만 준다. 경고가 붙으면(예: JYP 현재가 대비 +95%) 주의색
    const warned = arr(v.warnings).some(x => typeof x === 'string' && x);
    if (v.status === 'updated') return v.confidence === 'medium' && !warned ? 'ok' : 'warn';
    if (v.status === 'range' || v.status === 'reference_band') return 'warn';
    return 'bad';
  }
  const hasValue = v => ['updated', 'range', 'reference_band'].indexOf(v.status) >= 0 && isNum(v.updated_target_price);
  // 신종자본증권을 뺀 보통주 BPS가 0 이하라 엔진이 보고 기준 PBR을 내지 않은 경우(콘텐트리중앙)
  const pbrOff = v => !isNum(v.pbr_now) && isNum(v.bps_ex_hybrid) && v.bps_ex_hybrid <= 0;
  const pbrOffWhy = v => '보통주 BPS ' + won(v.bps_ex_hybrid) + '(자본 내 신종자본증권 제외) ≤ 0 — 보고 BPS ' + won(v.bps) + ' 기준 PBR은 보통주 가치를 나타내지 않아 표시하지 않음';
  // SOTP 범위의 헤드라인: 엔진의 range.headline_text가 있으면 그 조각들, 없으면 범위 요약 필드로 같은 순서를 만든다(단일 값만 보이지 않게)
  function rangeParts(v) {
    v = obj(v);
    const g = obj(v.range), sm = obj(g.summary), bear = obj(obj(g.scenarios).bear), noDed = obj(obj(obj(g.minority).variants).no_deduction);
    const ht = str(g.headline_text).trim();
    if (ht) return ht.split(/\s*·\s*/).filter(Boolean);
    const base = isNum(sm.base) ? sm.base : v.updated_target_price;
    const bearLe0 = bear.equity_le_zero === true || (isNum(bear.equity_value_bn) && bear.equity_value_bn <= 0);
    return [isNum(base) ? 'base ' + won(base) : '',
      isNum(sm.base_low) && isNum(sm.base_high) ? '순차입금 정의별 ' + fmt(sm.base_low, 0) + '~' + won(sm.base_high) : '',
      isNum(noDed.per_share) ? '비지배지분 차감 전 ' + won(noDed.per_share) : '',
      isNum(sm.bull) ? 'bull ' + won(sm.bull) : '',
      isNum(sm.bear) ? 'bear ' + won(sm.bear) : (bearLe0 ? 'bear 주주가치 ≤ 0' : '')].filter(Boolean);
  }

  // ── 작은 조각 ──
  const badge = (text, tone) => '<span class="badge' + (tone ? ' ' + tone : '') + '">' + esc(text) + '</span>';
  const dartLink = (no, text) => no ? '<a href="' + DART + encodeURIComponent(no) + '" target="_blank" rel="noopener noreferrer">' + esc(text || 'DART ' + no) + '</a>' : esc(text || '');
  const negCls = (cls, neg) => [cls || '', neg ? 'neg' : ''].filter(Boolean).join(' ');
  const tdTxt = (html, cls) => '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + html + '</td>';
  function td(v, d, cls, mark) { d = d == null ? 1 : d; return tdTxt(fx(v, d) + (mark || ''), negCls(cls, isNum(v) && z(v, d) < 0)); }
  const tdPct = (v, cls, mark) => tdTxt(pct(v) + (mark || ''), negCls(cls, isNum(v) && z(v, 1) < 0));
  const tdR = (r, cls) => tdTxt(lvlR(r), negCls(cls, isNum(r) && z(r * 100, 1) < 0));
  const tw = (label, table) => '<div class="tablewrap" role="region" tabindex="0" aria-label="' + esc(label) + '">' + table + '</div>';
  const card = (title, body, extra) => '<div class="card' + (extra ? ' ' + extra : '') + '"><h2>' + esc(title) + '</h2>' + body + '</div>';
  const notice = (html, cls) => '<div class="notice' + (cls ? ' ' + cls : '') + '" role="note">' + html + '</div>';
  // 값도 근거도 없는 행은 그리지 않는다(삭제된 필드가 라벨만 남기지 않도록)
  function kv(rows) {
    const body = rows.filter(r => r && ((r[1] != null && r[1] !== '') || r[2])).map(r => '<tr><td class="l k">' + esc(r[0]) + '</td><td class="l">' + (r[1] || '') + (r[2] ? '<div class="basis">' + esc(r[2]) + '</div>' : '') + '</td></tr>').join('');
    return body ? '<div class="tablewrap"><table class="kv"><tbody>' + body + '</tbody></table></div>' : '';
  }
  function det(st, key, defOpen, summary, body) {
    const open = Object.prototype.hasOwnProperty.call(st.open, key) ? !!st.open[key] : defOpen;
    return '<details data-dkey="' + esc(key) + '"' + (open ? ' open' : '') + '><summary>' + summary + '</summary><div class="details-body">' + body + '</div></details>';
  }
  const yearMap = (m, f) => { const o = obj(m), ks = Object.keys(o).sort(); return ks.length ? ks.map(k => k + ' ' + f(o[k])).join(' · ') : ''; };
  function unitVal(v, unit) {
    if (unit === 'ratio') return isNum(v) ? fmt(v * 100, 2) + '%' : '—';
    if (unit === 'persons' || unit === 'visits' || unit === 'visiting_days') return fmt(v, 0);
    if (unit === 'KRWbn') return fx(v, 1);
    if (unit === 'KRWmn') return fx(v, 2);
    return fmt(v, 3);
  }
  // 수집기가 붙인 제목의 군더더기(앞 번호·끝 날짜·'PDF'·'EXCEL')를 걷고, 영문 DART 캐시 제목은 한국어로 바꾼다.
  // id·파일명을 그대로 옮긴 제목(legacy:official-hybe_2q26_factsheet-xlsx → 'official-hybe_2q26_factsheet-xlsx', 'dragon_2q26.xlsx')은 버린다 — sourceLabel이 회사·문서 종류·호스트로 라벨을 만든다
  const bareId = id => str(id).replace(/^[a-z][a-z-]*:/, '').replace(/@[0-9a-f]{6,}$/, '');
  function idLikeTitle(t, s) {
    s = obj(s);
    if (/^[a-z0-9_.:-]+$/.test(t) || /-(?:pdf|xlsx?)$/i.test(t)) return true;
    return [s.id].concat(arr(s.aliases)).some(id => typeof id === 'string' && id && (t === id || t === bareId(id)));
  }
  function cleanTitle(t, s) {
    t = str(t).trim();
    const m = t.match(/^[A-Z][A-Z0-9_]* (?:FY(\d{4})|(\d{4})(H1|Q[1-4])) consolidated DART statement$/);
    if (m) return 'DART 연결 재무제표(' + (m[1] ? m[1] + ' 사업보고서' : m[2] + (m[3] === 'H1' ? ' 반기' : ' ' + m[3].slice(1) + '분기')) + ')';
    // 'Previously verified official company IR: lotte_1q26.pdf'처럼 파일명만 붙은 수집기 표기는 앞말을 떼고 파일명 검사로 넘긴다
    t = t.replace(/^Previously verified official company IR:\s*/i, '');
    t = t.replace(/\s+(?:PDF|EXCEL)$/i, '').replace(/\s+\d{4}-\d{2}-\d{2}(?:\s+\d+)?$/, '').replace(/^\d{1,3}\s+(?=\d{4}년|[가-힣])/, '').trim();
    return t && !idLikeTitle(t, s) ? t : '';
  }
  // 제목이 없거나 id 모양일 때의 문서 종류: 엔진 doc_type이 한국어면 그대로, 아니면 id·제목의 분기 표기(2q26)·종류 단서(factsheet·monthly)와 호스트로 정한다
  function srcDocType(s, h) {
    const dt = str(s.doc_type).trim(), k = [s.id, s.title].concat(arr(s.aliases)).map(str).join(' ').toLowerCase();
    const q = k.match(/(?:^|[^a-z0-9])([1-4])q(\d{2})(?![0-9])/), hy = k.match(/(20\d{2})h1(?![0-9])/);
    const per = q ? '20' + q[2] + '년 ' + q[1] + '분기' : hy ? hy[1] + ' 반기' : '';
    const kind = hasHangul(dt) ? dt : docTypeNames[dt] ? docTypeNames[dt] : /dart\.fss\.or\.kr$/.test(h) ? 'DART 공시 원문' : /factsheet/.test(k) ? 'IR 팩트시트' : /monthly/.test(k) ? '월간 자료' : 'IR 자료';
    return kind + (per && !/\d/.test(kind) ? '(' + per + ')' : '');
  }
  function sourceLabel(s, c, d) {
    s = obj(s);
    const h = host(s.url), t = cleanTitle(s.title, s);
    if (t) return t + (h ? ' · ' + h : '');
    const cid = str(s.company_id), co = obj(cid ? arr(obj(d).companies).find(x => obj(x).id === cid) : null).name || obj(c).name || '회사';
    return co + ' ' + srcDocType(s, h) + (h ? ' · ' + h : '');
  }
  function sourceItem(s, c, d) {
    s = obj(s);
    const pub = s.published_at ? '공표 ' + s.published_at + (s.publication_date_status === 'verified' ? '(확인)' : '') : '공표일 미상' + (pubStatusNames[s.publication_date_status] ? '(' + pubStatusNames[s.publication_date_status] + ')' : '');
    const meta = [pub, !s.published_at && s.retrieved_at ? '수집 ' + str(s.retrieved_at).slice(0, 10) : '', srcStatusNames[s.status]].filter(Boolean).join(' · ');
    const u = safeUrl(s.url), label = sourceLabel(s, c, d);
    return (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + esc(label) + ' ↗</a>' : esc(label)) + ' <span class="dim">· ' + esc(meta) + '</span>';
  }

  // ── 상태 정리·딥링크 ──
  function normState(data, state) {
    const st = Object.assign({}, state || {}), cs = arr(obj(data).companies);
    const c = cs.find(x => obj(x).id === st.company) || cs.find(x => obj(x).sector === st.sector) || cs[0] || {};
    st.company = c.id; st.sector = c.sector;
    if (SCEN.indexOf(st.scenario) < 0) st.scenario = 'base';
    if (st.mode !== 'home') st.mode = 'standalone';
    if (typeof st.coverageHref !== 'string' || !st.coverageHref) st.coverageHref = '../coverage/index.html';
    if (!st.open || typeof st.open !== 'object') st.open = {};
    return st;
  }
  function parseHash(hash) {
    const h = String(hash || '').replace(/^#/, ''), m = h.match(/(?:^|&)models=([A-Za-z0-9_]+)(?:&|$)/);
    if (!m) return null;
    const s = h.match(/(?:^|&)scenario=(bear|base|bull)(?:&|$)/);
    return {company: m[1], scenario: s ? s[1] : null};
  }
  const buildHash = st => '#models=' + encodeURIComponent(st.company) + (st.scenario && st.scenario !== 'base' ? '&scenario=' + st.scenario : '');
  // 현재 해시와 상태로 새 해시를 정한다. 다른 탭이 쓰는 해시면 null(건드리지 않음) — DOM 없이 검사할 수 있게 mount 밖에 둔다
  const nextHash = (cur, st) => (cur && cur !== '#' && !parseHash(cur)) ? null : buildHash(st);

  // ── 머리 카드 · KPI ──
  function scenButtons(st) {
    return '<div class="seg" role="group" aria-label="연장 시나리오"><span>시나리오</span>' + SCEN.map(s => '<button type="button" data-scenario="' + s + '" aria-pressed="' + (st.scenario === s) + '">' + scenName(s) + '</button>').join('') + '</div>';
  }
  function coverageLink(st) {
    if (st.mode === 'home') return '<a class="covlink" data-cov="1" href="' + esc(st.coverageHref) + '">커버리지 레인(드라이버 모델) 탭 열기</a>';
    return '<a class="covlink" href="' + esc(st.coverageHref) + '" target="_blank" rel="noopener">커버리지 레인(드라이버 모델) ↗</a>';
  }
  function kpi(label, value, sub, cls) { return '<div class="kpi' + (cls ? ' ' + cls : '') + '"><small>' + label + '</small><b>' + value + '</b><span class="sub">' + (sub || '') + '</span></div>'; }
  const kU = (x, u) => isNum(x) ? fx(x, 1) + '<span class="u">' + u + '</span>' : '—';
  function valKpi(c, st) {
    const v = val(c), base = esc(v.scenario || 'base');
    const title = esc(v.label || '앙상블 규칙 환산가') + (v.status === 'reference_band' ? ' · 밴드 참고가' : '');
    const basis = '환산가는 ' + base + ' 기준' + (st.scenario !== base ? '(선택한 ' + scenName(st.scenario) + '와 무관)' : '');
    const note = v.label_note ? '<br>' + esc(v.label_note) : '';
    if (!hasValue(v)) return '<div class="kpi kpi-val"><small>' + title + '</small><div class="kb">' + badge(statusLabel(v), valTone(v)) + '</div><span class="sub">' + esc(v.label_note) + '</span></div>';
    // SOTP 범위는 base 한 값을 크게 쓰지 않고 범위 조각을 나란히 보인다
    if (v.status === 'range') return '<div class="kpi kpi-val kpi-range"><small>' + title + '</small><div class="kb">' + badge(statusLabel(v), valTone(v)) + '</div><ul class="rngv">' + rangeParts(v).map(p => '<li>' + esc(p) + '</li>').join('') + '</ul><span class="sub">' + basis + ' · 현재가 대비 base ' + pct(v.upside_pct) + note + '</span></div>';
    const sub = basis + ' · 현재가 대비 ' + pct(v.upside_pct) + note;
    return kpi(title, '<span class="tpv">' + won(v.updated_target_price) + '</span>', sub, 'kpi-val');
  }
  function kpis(c, st) {
    const sc = st.scenario, v = val(c), S = scenName(sc);
    const r25 = hv(c, 'revenue', '2025'), o25 = hv(c, 'operating_profit', '2025');
    const e27 = fv(c, '2027', 'eps', sc), per27 = (isNum(e27) && e27 > 0 && isNum(v.price_now)) ? v.price_now / e27 : null;
    const perTxt = per27 != null ? fmt(per27, 1) + '배' : (isNum(e27) ? '— (EPS ≤ 0)' : '—');
    return '<div class="kpis">' +
      kpi('2025A 매출', kU(r25, '십억원'), 'YoY ' + pct(yoyA(c, 'revenue', '2025'))) +
      kpi('2025A 영업이익', kU(o25, '십억원'), 'OPM ' + lvlR(ratio(o25, r25))) +
      kpi('2026E 매출 · ' + S, kU(fv(c, '2026', 'revenue', sc), '십억원'), 'YoY ' + pct(fyoy(c, '2026', 'revenue', sc))) +
      kpi('2026E 영업이익 · ' + S, kU(fv(c, '2026', 'operating_profit', sc), '십억원'), 'OPM ' + lvlR(fv(c, '2026', 'opm', sc))) +
      kpi('2027E EPS · ' + S, won(e27), '현재가 기준 PER ' + perTxt) +
      valKpi(c, st) + '</div>';
  }
  function titleCard(d, c, st) {
    const m = model(c), v = val(c), r = obj(v.rule), fl = arr(v.flags).map(obj).filter(f => typeof f.text === 'string' && f.text);
    const who = m.status === 'template' ? badge('템플릿(애널리스트 추정 미입력)', 'warn') : badge('애널리스트 추정 포함 워크북') + (m.analyst ? badge('워크북 담당자 ' + m.analyst) : '');
    const badges = who + badge('워크북 ' + (m.vintage || obj(d).model_vintage || '—')) + badge('최신 분기 ' + (hist(c).latest_quarter || '—')) +
      badge(statusLabel(v), valTone(v)) + (r.method_applied ? badge('환산 방식 ' + (methodNames[r.method_applied] || r.method_applied)) : '') + fl.map(f => badge(flagNames[f.key] || '표지', 'warn')).join('');
    return '<div class="card"><div class="title"><div><h2 class="cname">' + esc(c.name) + ' <span class="dim">' + esc(c.ticker) + ' · ' + esc(sectorNames[c.sector] || c.sector_name || '') + '</span></h2><div class="badges">' + badges + '</div></div>' +
      '<div class="controls">' + scenButtons(st) + coverageLink(st) + '</div></div>' + kpis(c, st) + '</div>';
  }

  // ── 연간 표 ──
  const yearSpan = ys => ys.length ? (ys[0] === ys[ys.length - 1] ? ys[0] : ys[0] + '–' + ys[ys.length - 1]) + 'A' : '';
  function sourceYearsText(c, ya) {
    const runs = [];
    ya.forEach(y => { const lab = histSourceName(obj(hrec(c, 'annual', 'revenue', y)).source) || '출처 없음', last = runs[runs.length - 1]; if (last && last.lab === lab) last.to = y; else runs.push({lab, from: y, to: y}); });
    return runs.map(r => (r.from === r.to ? r.from : r.from + '–' + r.to) + 'A ' + r.lab).join(' · ');
  }
  function annualTable(d, c, st) {
    const sc = st.scenario, ya = yearsA(c), ye = yearsE(c), tpl = isTemplate(c), showCov = !isCovDriver(c), restated = [];
    const act = (metric, y, dd) => {
      const r = hrec(c, 'annual', metric, y);
      if (!r || !isNum(r.value)) return '<td>—</td>';
      if (r.restated) restated.push({metric, y, r});
      return td(r.value, dd, '', r.restated ? '<sup title="재작성">*</sup>' : '');
    };
    const dashes = n => new Array(n).fill('<td>—</td>').join('');
    const row = (label, metric, key, dd) => '<tr><td class="l">' + label + '</td>' + ya.map(y => act(metric, y, dd)).join('') + ye.map(y => td(fv(c, y, key, sc), dd, 'est')).join('') + '</tr>';
    const yoyRow = (label, metric) => '<tr class="sub"><td class="l">' + label + '</td>' + ya.map(y => tdPct(yoyA(c, metric, y))).join('') + ye.map(y => tdPct(fyoy(c, y, metric, sc), 'est')).join('') + '</tr>';
    const opmRow = () => '<tr class="sub"><td class="l">영업이익률</td>' + ya.map(y => tdR(ratio(hv(c, 'operating_profit', y), hv(c, 'revenue', y)))).join('') + ye.map(y => tdR(fv(c, y, 'opm', sc), 'est')).join('') + '</tr>';
    const modelRow = metric => tpl ? '' : '<tr class="sub"><td class="l">· 워크북 원본 추정</td>' + ya.map(y => { const r = mrec(c, 'annual', metric, y); return r && r.flag === 'E' ? td(r.value, 1, 'model') : '<td>—</td>'; }).join('') + dashes(ye.length) + '</tr>';
    // 커버리지 레인 추정 행(매출·영업이익·지배순이익): 데이터에 그 지표 시리즈가 있을 때만
    const covRow = metric => {
      if (!showCov) return '';
      const s = obj(obj(obj(obj(c.coverage_lane).series)[metric])[sc]), pick = y => isNum(s[y]) ? s[y] : (isNum(s[y + 'FY']) ? s[y + 'FY'] : null);
      if (!ye.some(y => isNum(pick(y)))) return '';
      return '<tr class="sub cov-row"><td class="l">· 커버리지 레인 추정(' + scenName(sc) + ')</td>' + dashes(ya.length) + ye.map(y => td(pick(y), 1, 'est')).join('') + '</tr>';
    };
    const head = '<tr><th>십억원</th>' + ya.map(y => '<th>' + y + 'A</th>').join('') + ye.map(y => '<th class="est">' + y + 'E</th>').join('') + '</tr>';
    const body = row('매출액', 'revenue', 'revenue', 1) + modelRow('revenue') + covRow('revenue') + yoyRow('매출 YoY', 'revenue') +
      row('영업이익', 'operating_profit', 'operating_profit', 1) + modelRow('operating_profit') + covRow('operating_profit') + opmRow() +
      row('지배순이익', 'controlling_net_income', 'controlling_net_income', 1) + modelRow('controlling_net_income') + covRow('controlling_net_income') +
      row('EPS(원, 기본)', 'eps_basic', 'eps', 0);
    const a = obj(rf(c).assumptions), cov = obj(c.coverage_lane);
    let foot = '<p class="dim small">' + esc(sourceYearsText(c, ya)) + ' · ' + esc(ye[0] + '–' + ye[ye.length - 1]) + 'E 앙상블 연장(' + scenName(sc) + ', ' + (isCovDriver(c) ? '커버리지 레인 드라이버 추정 채택' : '일반 규칙') + ')' +
      (showCov && cov.as_of ? ' · 커버리지 레인 추정 기준일 ' + esc(cov.as_of) : '') + (a.eps_basis ? ' · EPS(E): ' + esc(a.eps_basis) : '') + '</p>';
    // EPS 실적은 출처마다 주식수 기준이 다르다: 워크북 내 벤더 EPS는 발행주식, DART 기본 EPS는 가중평균 유통주식
    const epsSrc = y => str(obj(hrec(c, 'annual', 'eps_basic', y)).source), vY = ya.filter(y => epsSrc(y) === 'model_report_vendor_actual'), dY = ya.filter(y => epsSrc(y) === 'dart_cfs');
    if (vY.length && dY.length) foot += '<p class="dim small">EPS 주식수 기준: ' + esc(yearSpan(vY)) + ' 워크북 내 벤더 EPS는 발행주식 기준, ' + esc(yearSpan(dY)) + ' DART 기본 EPS는 가중평균 유통주식 기준, 연장(E) EPS는 현재 유통주식수(자기주식 제외) 기준이라 연도 사이 비교에 주식수 차이가 섞입니다.</p>';
    foot += '<div class="legend"><span><i class="sw est"></i>추정(앙상블 연장·커버리지 레인)</span>' + (tpl ? '<span>템플릿 워크북: 원본 추정 행 없음</span>' : '<span><i class="sw model"></i>워크북 원본 추정(' + esc(vintageYM(d)) + ')</span>') + '</div>';
    if (restated.length) {
      const r0 = restated[0].r;
      foot += '<p class="dim small">* 재작성 반영: ' + restated.map(x => esc(x.y + 'A ' + (metricKo[x.metric] || x.metric) + ' ' + fx(x.r.value, x.metric === 'eps_basic' ? 0 : 1) + '(원공시 ' + fx(x.r.as_filed, x.metric === 'eps_basic' ? 0 : 1) + ')')).join(' · ') +
        ' — 다음 해 사업보고서의 전기 열 값' + (r0.restated_rcept_no ? ' (' + dartLink(r0.restated_rcept_no, 'DART 공시') + ')' : '') + '</p>';
    }
    return tw('연간 실적과 연장', '<table class="wide"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>') + foot;
  }
  function oneOffNotice(c, st) {
    const a = obj(rf(c).assumptions), oo = a.h1_2026_one_off_op, y0 = yearsE(c)[0];
    if (!isNum(oo) || Math.abs(oo) < 0.05) return '';
    const op = obj(a.h1_2026_actual).operating_profit, e = fv(c, y0, 'eps', st.scenario), eb = fv(c, y0, 'eps', 'base');
    return notice('<b>' + esc(y0) + 'E EPS ' + won(e) + ' (' + scenName(st.scenario) + ')' + (st.scenario !== 'base' ? ' · base ' + won(eb) : '') + '</b> — 2026 상반기 IFRS 영업이익 ' + fx(op, 1) + '십억원은 회사 공시 조정 영업이익보다 ' + fx(Math.abs(oo), 1) + '십억원 ' + (oo > 0 ? '낮습니다' : '높습니다') +
      '(일회성 항목). ' + esc(y0) + 'E 합계 영업이익·지배순이익·EPS는 IFRS 상반기 실적을 그대로 더한 값이라 이 항목이 포함되어 있고, 하반기·2027E 이익률은 조정 영업이익률(2026 상반기 ' + lvlR(a.opm_h1_2026_normalised) + ') 기준입니다.', 'oneoff');
  }

  // ── 분기 ──
  // viewBox 폭 = 실제 표시 폭(px)이라 축 글자 11px가 그대로 11px로 보인다
  function chartW(w) { return Math.max(240, Math.round(isNum(w) && w > 0 ? w : CHART_W)); }
  function quarterlyChart(c, w) {
    const keys = quarterKeys(c);
    if (!keys.length) return '<div class="empty">분기 실적 없음</div>';
    const rev = keys.map(k => hv(c, 'revenue', k, 'quarterly')), op = keys.map(k => hv(c, 'operating_profit', k, 'quarterly')), mq = keys.map(k => modelQ(c, 'revenue', k));
    const W = chartW(w), H = 240, narrow = W < 480, L = narrow ? 44 : 60, R = narrow ? 40 : 52, T = 14, B = 30, n = keys.length, pw = W - L - R;
    const rv = rev.concat(mq).filter(isNum), ov = op.filter(isNum);
    const hi = Math.max(1, ...rv) * 1.08, lo = Math.min(0, ...rv), ohi = Math.max(1, ...ov) * 1.15, olo = Math.min(0, ...ov) * 1.15;
    const x = i => L + pw * (i + 0.5) / n, bw = pw / n * 0.6, y = v => T + (H - T - B) * (hi - v) / (hi - lo), yo = v => T + (H - T - B) * (ohi - v) / (ohi - olo);
    const step = Math.max(1, Math.ceil(n * 52 / pw));
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="분기 매출(막대, 왼쪽 축)과 영업이익(선, 오른쪽 축), 십억원. 수치는 아래 표에 있음">';
    for (let j = 0; j <= 4; j++) { const v = lo + (hi - lo) * j / 4, yy = r1(y(v)); s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (L - 6) + '" y="' + r1(yy + 4) + '" text-anchor="end">' + fmt(v, 0) + '</text>'; }
    for (let j = 0; j <= 4; j++) { const v = olo + (ohi - olo) * j / 4; if (olo < 0 && Math.abs(yo(v) - yo(0)) < 12) continue; s += '<text x="' + (W - R + 6) + '" y="' + r1(yo(v) + 4) + '">' + fmt(v, 0) + '</text>'; }
    if (olo < 0) s += '<line class="zero" x1="' + L + '" x2="' + (W - R) + '" y1="' + r1(yo(0)) + '" y2="' + r1(yo(0)) + '"/><text class="zero-t" x="' + (W - R + 6) + '" y="' + r1(yo(0) + 4) + '">0</text>';
    keys.forEach((k, i) => {
      if (isNum(rev[i])) s += '<rect class="bar" x="' + r1(x(i) - bw / 2) + '" y="' + r1(Math.min(y(rev[i]), y(0))) + '" width="' + r1(bw) + '" height="' + r1(Math.abs(y(0) - y(rev[i]))) + '"><title>' + esc(k + ' 매출 ' + fx(rev[i], 1)) + '</title></rect>';
      if (i % step === 0) s += '<text x="' + r1(x(i)) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc(narrow ? k.slice(2) : k) + '</text>';
    });
    let run = [];
    const flush = () => { if (run.length > 1) s += '<polyline class="opl" points="' + run.join(' ') + '"/>'; run = []; };
    keys.forEach((k, i) => { if (isNum(op[i])) run.push(r1(x(i)) + ',' + r1(yo(op[i]))); else flush(); });
    flush();
    keys.forEach((k, i) => { if (isNum(op[i])) s += '<circle class="opd" cx="' + r1(x(i)) + '" cy="' + r1(yo(op[i])) + '" r="3.5"><title>' + esc(k + ' 영업이익 ' + fx(op[i], 1)) + '</title></circle>'; });
    keys.forEach((k, i) => { if (isNum(mq[i])) s += '<circle class="mdl" cx="' + r1(x(i)) + '" cy="' + r1(y(mq[i])) + '" r="4.5"><title>' + esc(k + ' 워크북 원본 매출 추정 ' + fx(mq[i], 1)) + '</title></circle>'; });
    s += '</svg><div class="legend"><span><i class="sw bar"></i>분기 매출(왼쪽 축)</span><span><i class="sw op"></i>분기 영업이익(오른쪽 축)</span>' +
      (olo < 0 ? '<span><i class="sw zero"></i>영업이익 0선</span>' : '') + (mq.some(isNum) ? '<span><i class="sw ring"></i>워크북 원본 분기 매출 추정(~' + esc(obj(model(c).horizon).quarterly_through) + ')</span>' : '') + '</div>';
    return s;
  }
  function qSourceName(r) {
    const s = str(obj(r).source);
    if (s === 'dart_cfs') return 'DART' + (/9M/.test(str(r.how)) ? '(사업보고서 − 3분기 누적)' : '');
    if (s.indexOf('coverage:') === 0) return '커버리지 레인(회사 자료)';
    return '—';
  }
  function gapRows(c) {
    const q = obj(hist(c).quarterly), out = [];
    ['revenue', 'operating_profit', 'net_income', 'controlling_net_income'].forEach(m => Object.keys(obj(q[m])).sort().forEach(k => { const r = obj(obj(q[m])[k]); if (r.coverage_gap_flag === true) out.push({m, k, r}); }));
    return out;
  }
  // 커버리지 비교값의 공표일: 날짜가 있으면 그 날짜, 없고 상태 필드가 있으면 '공표일 미상'(+ 출처 목록의 수집일)
  function gapPub(r, s) {
    if (r.coverage_published_at) return ' 공표 ' + r.coverage_published_at;
    if (!r.coverage_published_at_status && !s.publication_date_status) return '';
    return ' 공표일 미상' + (s.retrieved_at ? ' · 수집 ' + str(s.retrieved_at).slice(0, 10) : '');
  }
  function quarterlyTable(d, c, st) {
    const keys = quarterKeys(c);
    if (!keys.length) return '';
    const q = obj(hist(c).quarterly), showM = keys.some(k => isNum(modelQ(c, 'revenue', k)) || isNum(modelQ(c, 'operating_profit', k)));
    const cellQ = (m, k) => { const r = obj(obj(q[m])[k]); return isNum(r.value) ? td(r.value, 1, '', r.coverage_gap_flag === true ? '<sup>†</sup>' : '') : '<td>—</td>'; };
    const head = '<tr><th>분기</th><th>매출액</th><th>영업이익</th><th>영업이익률</th><th>순이익</th><th>지배순이익</th>' + (showM ? '<th>워크북 매출 추정</th><th>워크북 영업이익 추정</th>' : '') + '<th class="l">출처</th></tr>';
    const body = keys.map(k => '<tr><td class="l">' + esc(k) + '</td>' + cellQ('revenue', k) + cellQ('operating_profit', k) + tdR(ratio(hv(c, 'operating_profit', k, 'quarterly'), hv(c, 'revenue', k, 'quarterly'))) +
      cellQ('net_income', k) + cellQ('controlling_net_income', k) + (showM ? td(modelQ(c, 'revenue', k), 1, 'model') + td(modelQ(c, 'operating_profit', k), 1, 'model') : '') + '<td class="l">' + esc(qSourceName(obj(q.revenue)[k])) + '</td></tr>').join('');
    const gaps = gapRows(c), si = srcIndex(d);
    const gapTxt = gaps.length ? '<p class="dim small">† DART 정기보고서 기준 값이 커버리지 레인의 IR 발표값과 다른 분기(십억원): ' + gaps.map(g => {
      const s = si.get(g.r.coverage_source_id) || {};
      return esc(g.k + ' ' + (metricKo[g.m] || g.m) + ' DART ' + fx(g.r.value, 1) + ' vs IR ' + fx(g.r.coverage_value, 1) + ' (차이 ' + sgn(g.r.coverage_gap_abs, 1) + ')') +
        ' <span class="dim">· ' + esc(sourceLabel(s, c, d)) + esc(gapPub(g.r, s)) + '</span>';
    }).join(' · ') + '. 4분기 DART 값은 사업보고서 − 3분기 누적으로 계산합니다.</p>' : '';
    return det(st, 'qtable', true, '분기 수치 표 (십억원)', tw('분기 실적 표', '<table class="wide"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>') + gapTxt +
      (showM ? '<p class="dim small">워크북 원본 분기 추정은 워크북의 분기 추정 범위(~' + esc(obj(model(c).horizon).quarterly_through) + ')까지만 표시합니다.</p>' : ''));
  }
  function annualChart(c, w, state) {
    const sc = SCEN.indexOf(obj(state).scenario) >= 0 ? state.scenario : 'base', ya = yearsA(c), ye = yearsE(c), years = ya.concat(ye), n = years.length, na = ya.length;
    const act = years.map((yr, i) => i < na ? hv(c, 'revenue', yr) : null), sel = years.map((yr, i) => i < na ? null : fv(c, yr, 'revenue', sc));
    const bear = years.map((yr, i) => i < na ? null : fv(c, yr, 'revenue', 'bear')), bull = years.map((yr, i) => i < na ? null : fv(c, yr, 'revenue', 'bull'));
    const mod = years.map(yr => { const r = mrec(c, 'annual', 'revenue', yr); return (!isTemplate(c) && r && r.flag === 'E') ? r.value : null; });
    const vals = act.concat(sel, bear, bull, mod).filter(isNum);
    if (!vals.length) return '<div class="empty">연간 데이터 없음</div>';
    const W = chartW(w), H = 230, narrow = W < 480, L = narrow ? 44 : 60, R = 14, T = 14, B = 30, pw = W - L - R;
    let hi = Math.max(...vals) * 1.08; const lo = Math.min(0, ...vals); if (!(hi > lo)) hi = lo + 1;
    const x = i => L + pw * (i + 0.5) / n, bw = pw / n * 0.55, y = v => T + (H - T - B) * (hi - v) / (hi - lo), step = Math.max(1, Math.ceil(n * 44 / pw));
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="연간 매출 실적과 연장(' + scenName(sc) + '), bear–bull 범위, 십억원. 수치는 연간 표에 있음">';
    for (let j = 0; j <= 4; j++) { const v = lo + (hi - lo) * j / 4, yy = r1(y(v)); s += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '"/><text x="' + (L - 6) + '" y="' + r1(yy + 4) + '" text-anchor="end">' + fmt(v, 0) + '</text>'; }
    years.forEach((yr, i) => {
      if (i % step === 0) s += '<text x="' + r1(x(i)) + '" y="' + (H - 10) + '" text-anchor="middle">' + esc((narrow ? yr.slice(2) : yr) + (i < na ? 'A' : 'E')) + '</text>';
      const bar = (v, cls, label) => isNum(v) ? '<rect class="' + cls + '" x="' + r1(x(i) - bw / 2) + '" y="' + r1(Math.min(y(v), y(0))) + '" width="' + r1(bw) + '" height="' + r1(Math.abs(y(0) - y(v))) + '"><title>' + esc(label + ' ' + fx(v, 1)) + '</title></rect>' : '';
      s += bar(act[i], 'bar', yr + 'A 매출') + bar(sel[i], 'barE', yr + 'E 연장 ' + scenName(sc));
      if (isNum(bear[i]) && isNum(bull[i])) { const a = r1(y(bull[i])), b = r1(y(bear[i])), xi = r1(x(i)); s += '<g class="rng"><title>' + esc(yr + 'E bear ' + fx(bear[i], 1) + ' – bull ' + fx(bull[i], 1)) + '</title><line x1="' + xi + '" x2="' + xi + '" y1="' + a + '" y2="' + b + '"/><line x1="' + r1(xi - 7) + '" x2="' + r1(xi + 7) + '" y1="' + a + '" y2="' + a + '"/><line x1="' + r1(xi - 7) + '" x2="' + r1(xi + 7) + '" y1="' + b + '" y2="' + b + '"/></g>'; }
      if (isNum(mod[i])) s += '<circle class="mdl" cx="' + r1(x(i)) + '" cy="' + r1(y(mod[i])) + '" r="5"><title>' + esc(yr + 'E 워크북 원본 매출 추정 ' + fx(mod[i], 1)) + '</title></circle>';
    });
    s += '</svg><div class="legend"><span><i class="sw bar"></i>실적</span><span><i class="sw barE"></i>앙상블 연장 ' + scenName(sc) + '</span><span><i class="sw rng"></i>bear–bull 범위</span>' + (mod.some(isNum) ? '<span><i class="sw ring"></i>워크북 원본 추정</span>' : '') + '</div>';
    return s;
  }
  const chartBox = (kind, svg) => '<div class="chartbox" data-chart="' + kind + '">' + svg + '</div>';

  // ── 연장 가정 ──
  const triple = o => { o = obj(o); return [o.revenue, o.operating_profit, o.controlling_net_income].some(isNum) ? fx(o.revenue, 1) + ' / ' + fx(o.operating_profit, 1) + ' / ' + fx(o.controlling_net_income, 1) : ''; };
  const hasOneOff = a => [a.h1_2026_one_off_op, a.h2_2025_one_off_op].some(x => isNum(x) && Math.abs(x) >= 0.05);
  // 일회성 키가 null = 조정 영업이익 자료가 없어 재지 않음(0과 다름). 그 반기 이익률은 IFRS 값 그대로다
  const oneOffTxt = x => isNum(x) ? sgn(x, 1) : '자료 없음(조정하지 않음)';
  const oneOffOpm = (r, x) => lvlR(r) + (isNum(x) ? '' : '(조정 자료 없음 — IFRS 그대로)');
  function rowsAdder() {
    const rows = [];
    rows.add = (label, value, basis) => { if ((value == null || value === '' || value === '—') && !basis) return; rows.push([label, value || '', basis ? str(basis) : '']); };
    return rows;
  }
  function notesBlock(c) {
    const ns = arr(rf(c).notes).filter(x => typeof x === 'string' && x);
    return ns.length ? notice('<b>연장 메모</b> (금액은 십억원)<ul>' + ns.map(x => '<li>' + esc(plainNote(x)) + '</li>').join('') + '</ul>') : '';
  }
  function ruleAssumptions(d, c) {
    const a = obj(rf(c).assumptions), rows = rowsAdder(), seas = obj(a.h2_h1_seasonality), sk = Object.keys(seas).sort(), obs = obj(a.ni_ratio_observed), ok = Object.keys(obs).sort();
    rows.add('2026 상반기 매출 YoY(실적)', pctR(a.h1_2026_yoy));
    rows.add('2026 하반기 성장률', pctR(a.g_h2_2026), a.g_h2_basis);
    if (sk.length) rows.add('H2/H1 매출 계절비', esc(sk.map(k => k + ' ' + fx(seas[k], 3)).join(' · ')) + ' → 중앙값 ' + fx(a.h2_h1_seasonality_median, 3) + ' · 계절비 기준 ' + pctR(a.g_h2_seasonal));
    rows.add('2027E 성장률', pctR(a.g_2027) + (isNum(a.g_2027_raw) && isNum(a.g_2027) && Math.abs(a.g_2027_raw - a.g_2027) > 1e-9 ? ' <span class="dim">(제한 전 ' + pctR(a.g_2027_raw) + ')</span>' : ''), a.g_2027_basis);
    rows.add('2028E 성장률', pctR(a.g_2028), a.g_2028_basis);
    rows.add('2026 하반기 영업이익률', lvlR(a.opm_h2_2026), a.opm_h2_2026_basis);
    if (hasOneOff(a)) rows.add('일회성 조정(조정 − IFRS 영업이익, 십억원)', '2026 상반기 ' + oneOffTxt(a.h1_2026_one_off_op) + ' · 2025 하반기 ' + oneOffTxt(a.h2_2025_one_off_op),
      '반기 영업이익률(일회성 제외): 2026 상반기 ' + oneOffOpm(a.opm_h1_2026_normalised, a.h1_2026_one_off_op) + ' · 2025 하반기 ' + oneOffOpm(a.opm_h2_2025_normalised, a.h2_2025_one_off_op));
    rows.add('목표 영업이익률(2028E)', lvlR(a.opm_target) + ((isNum(a.opm_ttm) || isNum(a.opm_hist_median)) ? ' <span class="dim">(최근 4개 분기 ' + lvlR(a.opm_ttm) + ' · 2023-2025A 중앙값 ' + lvlR(a.opm_hist_median) + ')</span>' : ''), a.opm_target_basis);
    rows.add('참고(' + vintageYM(d) + ' 워크북 2025E)', lvlR(a.opm_model_2025e), a.opm_model_2025e_basis);
    rows.add('2027E 영업이익률', '', a.opm_2027_basis);
    rows.add('지배순이익/영업이익 전환비율', fx(a.ni_to_op_ratio, 3) + (ok.length ? ' <span class="dim">(관측 ' + esc(ok.map(k => k + ' ' + fx(obs[k], 3)).join(' · ')) + ')</span>' : ''), a.ni_ratio_basis);
    rows.add('2026E 지배순이익', '', a.ni_2026_basis);
    rows.add('EPS', isNum(a.shares_outstanding) ? '유통주식수 ' + fmt(a.shares_outstanding, 0) + '주' : '', a.eps_basis);
    rows.add('2026 상반기 실적', triple(a.h1_2026_actual), '매출 / 영업이익 / 지배순이익(십억원)');
    rows.add('2025 하반기 실적', triple(a.h2_2025_actual), '매출 / 영업이익 / 지배순이익(십억원)');
    return kv(rows) + notesBlock(c) +
      notice('Bear/Bull: 성장률 ∓10pp(2026 하반기)·∓5pp(2027-28), 영업이익률 ∓2pp. 확률 보정 없음. 회사 가이던스·컨센서스가 아니라 앙상블 에이전트의 규칙 기반 연장입니다.', 'blue scen-rule');
  }
  function assumptionRowsTable(c, st) {
    const rows = arr(rf(c).assumption_rows).map(obj).filter(r => r.metric && (r.scenario === st.scenario || SCEN.indexOf(r.scenario) < 0));
    if (!rows.length) return '';
    // 같은 지표라도 기간별 근거 문장이 다르면 행을 나눈다(강원랜드 비카지노 성장률: 2026 하반기 리노베이션 · 2027 콘도 · 2028 그랜드호텔)
    const groups = new Map(), order = [];
    rows.forEach(r => {
      if (order.indexOf(r.metric) < 0) order.push(r.metric);
      const key = r.metric + '|' + str(r.unit) + '|' + str(r.basis);
      if (!groups.has(key)) groups.set(key, {metric: r.metric, unit: str(r.unit), basis: str(r.basis), vals: []});
      groups.get(key).vals.push(r);
    });
    const list = Array.from(groups.values());
    list.forEach(g => g.vals.sort((p, q) => String(p.period).localeCompare(String(q.period))));
    list.sort((a, b) => (order.indexOf(a.metric) - order.indexOf(b.metric)) || String(a.vals[0].period).localeCompare(String(b.vals[0].period)));
    // 근거는 커버리지 레인 원문 그대로다. 한국어가 없는 문장은 '영문 원문'으로 표시한다(번역·요약하지 않음)
    const basisHtml = b => { const t = plainNote(b); return t ? (hasHangul(t) ? esc(t) : '<span class="lang">영문 원문</span><span lang="en">' + esc(t) + '</span>') : ''; };
    const body = list.map(g => '<tr><td class="l">' + metricLabel(g.metric) + '</td><td class="l">' + esc(unitNames[g.unit] || g.unit) + '</td><td class="l">' + g.vals.map(r => esc(r.period) + ' <b>' + unitVal(r.value, r.unit) + '</b>').join(' · ') + '</td><td class="l basis">' + basisHtml(g.basis) + '</td></tr>').join('');
    return '<h3>커버리지 레인 가정 행 (' + scenName(st.scenario) + ')</h3>' + tw('커버리지 레인 가정 행', '<table class="wide"><thead><tr><th class="l">지표</th><th class="l">단위</th><th class="l">기간별 값</th><th class="l">근거(커버리지 레인 원문)</th></tr></thead><tbody>' + body + '</tbody></table>');
  }
  // 커버리지 레인 시나리오별 분기 추정(roll_forward.quarterly) — 연간 표의 E 값이 어떤 분기 값에서 왔는지 접어 둔다
  const RFQ_ORDER = ['revenue', 'casino_net_revenue', 'noncasino_revenue', 'hotel_segment_revenue', 'travel_revenue', 'other_revenue', 'operating_costs', 'operating_profit'];
  function quarterlyForecastTable(c, st) {
    const q = obj(obj(rf(c).quarterly)[st.scenario]), ms = Object.keys(q).filter(m => Object.keys(obj(q[m])).some(k => isNum(obj(q[m])[k])));
    if (!ms.length) return '';
    const rank = m => { const i = RFQ_ORDER.indexOf(m); return i < 0 ? RFQ_ORDER.length : i; };
    ms.sort((a, b) => (rank(a) - rank(b)) || a.localeCompare(b));
    const ks = Array.from(new Set([].concat(...ms.map(m => Object.keys(obj(q[m])))))).filter(k => /^\d{4}Q[1-4]$/.test(k)).sort();
    if (!ks.length) return '';
    const body = ms.map(m => '<tr' + (m === 'revenue' || m === 'operating_profit' ? ' class="hl"' : '') + '><td class="l">' + rfqLabel(m) + '</td>' + ks.map(k => td(obj(q[m])[k], 1, 'est')).join('') + '</tr>').join('');
    return det(st, 'rfq', false, '커버리지 레인 분기 추정 (' + scenName(st.scenario) + ', 십억원, ' + esc(ks[0]) + '~' + esc(ks[ks.length - 1]) + ')',
      tw('커버리지 레인 분기 추정', '<table class="wide"><thead><tr><th class="l">지표</th>' + ks.map(k => '<th class="est">' + esc(k) + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody></table>') +
      '<p class="dim small">커버리지 레인 드라이버 모델의 분기 추정 그대로입니다(영업비용은 비용 합계를 양수로 표시). 연간 표의 2026E는 DART 상반기 실적에 이 표의 2026 하반기 분기를 더한 값입니다.</p>');
  }
  function coverageAssumptions(d, c, st) {
    const r = rf(c), a = obj(r.assumptions), src = obj(r.source), br = obj(r.bridge), hc = obj(src.h1_check), rows = rowsAdder();
    const mode = a.ni_bridge_mode || br.mode;
    rows.add('방식', '', a.method_basis);
    rows.add('커버리지 레인 기준일', esc(a.source_as_of || src.as_of || ''));
    rows.add('Bear/Bull', '', a.scenario_basis);
    rows.add('지배순이익 브리지', esc(mode === 'ratio' ? '비율 방식' : mode === 'additive' ? '가산 방식' : ''), a.ni_bridge_basis || br.basis);
    if (isNum(a.ni_to_op_ratio)) rows.add('전환비율', fx(a.ni_to_op_ratio, 4));
    if (isNum(a.nonop_annual)) rows.add('영업외손익(연, 십억원)', sgn(a.nonop_annual, 1));
    if (isNum(a.tax_rate)) rows.add('세율', lvlR(a.tax_rate, 2));
    rows.add('연도별 지배순이익/영업이익', esc(yearMap(a.ni_op_ratio_by_year || br.ni_op_ratio_by_year, v => fx(v, 3))));
    rows.add('연도별 영업외손익(십억원)', esc(yearMap(br.nonop_by_year, v => sgn(v, 1))));
    rows.add('연도별 세율', esc(yearMap(br.tax_rate_by_year, v => lvlR(v, 1))));
    if (isNum(br.controlling_share_h1_2026)) rows.add('2026 상반기 지배/연결 순이익 비율', fx(br.controlling_share_h1_2026, 3));
    rows.add('2026E 지배순이익', '', a.ni_2026_basis);
    rows.add('순이익 추정', '', a.net_income_basis);
    rows.add('EPS', isNum(a.shares_outstanding) ? '유통주식수 ' + fmt(a.shares_outstanding, 0) + '주' : '', a.eps_basis);
    rows.add('2026 상반기 DART vs 커버리지(십억원)', esc(['revenue', 'operating_profit'].filter(k => hc[k]).map(k => { const x = obj(hc[k]); return metricKo[k] + ' DART ' + fx(x.dart, 1) + ' · 커버리지 ' + fx(x.coverage, 1) + ' (차이 ' + sgn(x.diff, 3) + ')'; }).join(' / ')));
    if (isNum(src.fy_row_max_abs_diff)) rows.add('커버리지 FY 행 − 분기 합 최대 차이', fx(src.fy_row_max_abs_diff, 3) + '십억원');
    return kv(rows) + assumptionRowsTable(c, st) + quarterlyForecastTable(c, st) + notesBlock(c);
  }
  function assumptionsCard(d, c, st) {
    const r = rf(c);
    if (r.status !== 'ok') return notice(esc(arr(r.notes).join(' · ') || '연장 계산 불가'));
    if (isCovDriver(c)) return coverageAssumptions(d, c, st);
    // 일반 규칙 카드의 성장률·이익률 행은 base 값이다 — bear/bull 화면에서는 그 사실을 먼저 밝힌다
    return (st.scenario !== 'base' ? notice('아래 성장률·이익률은 base 값입니다. 선택한 ' + scenName(st.scenario) + '는 맨 아래 규칙(성장률 ∓10pp·∓5pp, 영업이익률 ∓2pp)을 더한 값입니다.', 'blue') : '') + ruleAssumptions(d, c);
  }

  // ── 점수표 (#14 #37) ──
  const TPL_SCORE = '템플릿 워크북에는 애널리스트 추정이 없어 점수표를 만들지 않습니다.';
  function scorecardTable(d, c) {
    if (isTemplate(c)) return '<p class="dim">' + TPL_SCORE + '</p>';
    const metrics = [['revenue', '매출액'], ['operating_profit', '영업이익'], ['controlling_net_income', '지배순이익']], rows = [], late = [];
    let nonPos = false;
    arr(c.scorecard).map(obj).forEach(r => {
      const lt = r.model_after_year_end === true, before = rows.length;
      metrics.forEach(m => {
        const x = obj(r[m[0]]);
        if (!isNum(x.model)) return;
        const np = isNum(x.actual) && x.actual <= 0;
        if (np) nonPos = true;
        rows.push('<tr><td class="l">' + esc(r.year) + 'E vs A' + (lt ? '<sup>‡</sup>' : '') + '</td><td class="l">' + m[1] + '</td>' + td(x.model, 1, 'model') + td(x.actual, 1) + tdPct(x.error_pct, np ? 'dim' : '', np ? '†' : '') + td(x.error_abs, 1) + '</tr>');
      });
      if (lt && rows.length > before) late.push(r);
    });
    if (!rows.length) return '<p class="dim">비교 가능한 추정 연도가 없습니다.</p>';
    const md = arr(c.scorecard).map(r => str(obj(r).model_date)).find(Boolean) || str(model(c).model_date);
    return tw('워크북 원본 추정 대비 실적 오차', '<table><caption>금액 십억원</caption><thead><tr><th>연도</th><th class="l">지표</th><th>워크북 추정</th><th>실적</th><th>오차율</th><th>차이</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>') +
      '<p class="dim small">오차 = (모델 − 실적) ÷ |실적|. 양수 = 모델이 실적보다 높음. 차이 = 모델 − 실적(십억원).' + (nonPos ? ' † 실적이 0 이하인 칸은 오차율의 크기 해석에 주의하고 차이(십억원)를 함께 볼 것.' : '') + ' 모델은 ' + esc(vintageYM(d)) + ' 워크북 추정' + (md ? '(워크북 작성일 ' + esc(md) + ')' : '') + '입니다.</p>' +
      (late.length ? '<p class="dim small">‡ ' + late.map(r => esc(r.model_after_year_end_note || (r.year + '년 종료 후 작성된 워크북 값 — 잠정 실적이 반영됐을 수 있어 예측 오차로 읽지 않음'))).join(' · ') + '</p>' : '');
  }

  // ── 현재 컨센서스 ──
  function consensusNowCard(d, c) {
    const cn = c.consensus_now;
    if (!cn || typeof cn !== 'object') return '<p class="dim">FnGuide 집계 컨센서스 자료 없음</p>';
    const fw = obj(cn.forward), ys = Object.keys(fw).filter(y => /^\d{4}$/.test(y)).sort(), ntm = obj(cn.ntm), u = obj(cn.unit), v = val(c), rule = obj(v.rule), k = obj(rule.street).k, bind = arr(rule.binding);
    const mets = [['revenue', '매출액', 1], ['operating_profit', '영업이익', 1], ['controlling_net_income', '지배순이익', 1], ['eps', 'EPS(원)', 0]];
    const any = ys.some(y => mets.some(m => isNum(obj(fw[y])[m[0]])));
    // 엔진 method.consensus와 같은 조건: 헤드라인이 배수 규칙인 회사에서 스트리트 상한이 걸렸고 PBR 정합 상한이 없을 때
    const setBy = (v.status === 'updated' || v.status === 'reference_band') && bind.indexOf('street_ceiling') >= 0 && bind.indexOf('pbr_cap') < 0;
    let h = '<p class="dim small">' + esc(cn.source || 'FnGuide 집계') + ' · 기준일 ' + esc(cn.as_of || ntm.date || '—') + '</p>';
    h += kv([['12개월 선행 EPS(E12)', won(ntm.E12)], ['12개월 선행 BPS(B12)', won(ntm.B12)], ['컨센서스 목표주가 평균(TP)', won(ntm.TP)], ['주가(P)', won(ntm.P) + (ntm.date ? ' <span class="dim">(' + esc(ntm.date) + ')</span>' : ''), ntm.P_basis]]);
    if (!any) h += '<p class="dim small">이 종목은 FnGuide 집계 연간 추정치가 없습니다.</p>';
    else {
      const head = '<tr><th>지표</th>' + ys.map(y => '<th>' + esc(y) + 'E 컨센서스</th><th class="est">' + esc(y) + 'E 연장 base</th>').join('') + '</tr>';
      const body = mets.map(m => '<tr><td class="l">' + m[1] + '</td>' + ys.map(y => td(obj(fw[y])[m[0]], m[2]) + td(fv(c, y, m[0], 'base'), m[2], 'est')).join('') + '</tr>').join('');
      h += tw('컨센서스와 연장 base 비교', '<table class="wide"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>');
    }
    // 환산가를 내지 않은 회사(콘텐트리중앙)에는 '규칙 환산가의 입력'과 k 환산 문장을 쓰지 않는다
    h += '<p class="dim small">단위: 매출·영업이익·지배순이익 ' + esc(u.revenue || '십억원') + ', EPS·E12·B12·TP ' + esc(u.ntm || u.eps || '원') + '. ' + esc(cn.note) +
      (any && isNum(k) ? ' 주식수 기준 차이 k(유통/발행) = ' + fx(k, 4) + ' — 발행주식 기준 EPS = 유통주식 기준 EPS × k.' : '') +
      ' 컨센서스는 실적·연장 값과 섞지 않습니다.' + (hasValue(v) ? ' 다만 규칙 환산가의 입력으로 쓰입니다: 스트리트 상한(컨센서스 목표주가 ÷ 12MF EPS × k, PBR 회사는 ÷ BPS)과 PER 회사의 연장 12MF EPS ±30% 제한.' : ' 이 종목은 환산가를 산정하지 않아 규칙 입력으로도 쓰지 않습니다.') +
      (setBy ? ' 이 종목은 스트리트 상한이 환산가를 정했습니다.' : '') + (bind.indexOf('eps_clamp') >= 0 ? ' 이 종목은 연장 EPS가 컨센서스 ±30% 범위로 제한됐습니다.' : '') + '</p>';
    return h;
  }

  // ── 밸류에이션 (#26 #27 #28 #34 #35) ──
  function confidenceBlock(v) {
    const rs = arr(v.confidence_reasons).filter(x => typeof x === 'string' && x);
    // 값이 없는 회사(회생 등)에는 신뢰도 배지를 달지 않고 사유 문장만 둔다
    return v.confidence ? (hasValue(v) ? '<p class="small">' + badge('신뢰도 ' + (confNames[v.confidence] || v.confidence)) + '</p>' : '') + (rs.length ? '<ul class="plain">' + rs.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '') : '';
  }
  function warningsBlock(v) {
    const ws = arr(v.warnings).filter(x => typeof x === 'string' && x);
    return ws.length ? notice('<b>경고</b><ul>' + ws.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>', 'bad') : '';
  }
  // 엔진 표지(flags: 계속기업 전제, SLL 전환사채 등). 출처가 출처 목록의 id면 라벨로 바꾸고, 목록에 없는 id 모양 문자열은 쓰지 않는다
  function flagsBlock(d, c) {
    const fs = arr(val(c).flags).map(obj).filter(f => typeof f.text === 'string' && f.text), si = srcIndex(d);
    if (!fs.length) return '';
    const srcHtml = x => { if (!x || typeof x !== 'string') return ''; const s = si.get(x); return s ? esc(sourceLabel(s, c, d)) : idLikeTitle(x, {}) ? '' : rcptHtml(x); };
    return notice('<b>표지</b><ul>' + fs.map(f => { const sh = srcHtml(f.source); return '<li>' + (flagNames[f.key] ? '<b>' + esc(flagNames[f.key]) + '</b> — ' : '') + esc(f.text) + (sh ? ' <span class="dim">· 출처 ' + sh + '</span>' : '') + '</li>'; }).join('') + '</ul>', 'bad');
  }
  function commonKv(c) {
    const v = val(c), sc = v.scenario || 'base', inp = obj(v.inputs), mk = obj(hist(c).market), ei = obj(obj(v.rule).earnings_input);
    const perTxt = isNum(v.per_now_2027e) ? mult(v.per_now_2027e, 1) : (isNum(v.eps_2027e) && v.eps_2027e <= 0 ? '— (EPS ≤ 0)' : '—');
    const eps12 = ei.kind === 'eps_12mf' && isNum(ei.raw) ? ei.raw : v.eps_12mf, off = pbrOff(v);
    return '<h3>입력과 현재 배수 (연장 ' + esc(sc) + ')</h3>' + kv([
      ['현재가', won(v.price_now) + (v.price_as_of ? ' <span class="dim">(' + esc(v.price_as_of) + ')</span>' : ''), isNum(mk.price_krw) && mk.price_krw === v.price_now ? mk.price_basis : ''],
      ['유통주식수', isNum(v.shares_outstanding) ? fmt(v.shares_outstanding, 0) + '주' : '—'],
      ['BPS', won(v.bps), off ? '보고 기준(자본 내 신종자본증권 포함)' : ''],
      ['12MF EPS(연장 ' + sc + ')', wonE(eps12) + (inp.eps_weights ? ' <span class="dim">' + esc(inp.eps_weights) + '</span>' : '')],
      ['2026E · 2027E EPS(연장 ' + sc + ')', won(v.eps_2026e) + ' · ' + won(v.eps_2027e)],
      ['현재가 기준 2027E PER', perTxt],
      ['현재가 기준 PBR', isNum(v.pbr_now) ? mult(v.pbr_now, 3) : '—', off ? pbrOffWhy(v) : ''],
      ['순차입금', bnTxt(v.net_debt_bn) + (v.net_debt_basis ? ' <span class="dim">(' + esc(v.net_debt_basis) + (isNum(v.gross_debt_bn) ? ' · 차입금·사채 ' + bnTxt(v.gross_debt_bn) : '') + ')</span>' : '')]
    ]);
  }
  // CJ ENM 민감도(range.sensitivity): 행 = 배수 변화율, 열 = NOPLAT 변화율, 주주가치 ≤ 0인 칸은 엔진이 null로 둔다
  function sensitivityBlock(g) {
    const se = g.sensitivity;
    if (!se || typeof se !== 'object') return '';
    const s = obj(se), ax = obj(s.axes), rp = arr(ax.multiple_pct), cp = arr(ax.noplat_pct), m = arr(s.per_share), vars = arr(s.variants).map(obj).filter(x => x.label || x.key);
    const axTxt = x => isNum(x) ? (x > 0 ? '+' : '') + fmt(x, 1) + '%' : '—';
    const cell = x => isNum(x) ? won(x) : x === null ? '주주가치 ≤ 0' : '—';
    let h = '';
    if (rp.length && cp.length && m.length) h += '<h3>민감도: 부문 배수 × NOPLAT (base, 주당 값 원)</h3>' + tw('SOTP 민감도 표', '<table class="wide sens"><thead><tr><th class="l">배수 변화 ↓ · NOPLAT 변화 →</th>' + cp.map(x => '<th>' + axTxt(x) + '</th>').join('') + '</tr></thead><tbody>' +
      rp.map((r, i) => '<tr><td class="l">' + axTxt(r) + '</td>' + cp.map((cc, j) => '<td' + (r === 0 && cc === 0 ? ' class="hl0"' : '') + '>' + cell(arr(m[i])[j]) + '</td>').join('') + '</tr>').join('') + '</tbody></table>') +
      '<p class="dim small">엔진 민감도 표 그대로(백 원 단위 반올림). 굵은 칸이 base(변화 없음)입니다.</p>';
    if (vars.length) h += '<h3>민감도: 대안 가정 (base, 주당 값 원)</h3>' + tw('SOTP 대안 가정 표', '<table class="wide"><thead><tr><th class="l">가정</th><th>주당 값</th><th class="l">비고</th></tr></thead><tbody>' +
      vars.map(x => '<tr><td class="l">' + esc(x.label || variantNames[x.key] || '대안 가정') + '</td><td>' + (isNum(x.per_share) ? won(x.per_share) : '산출 안 됨') + '</td><td class="l basis">' + esc(x.note) + '</td></tr>').join('') + '</tbody></table>');
    return h;
  }
  function rangeExtras(g) {
    let h = sensitivityBlock(g);
    const cc = arr(g.cross_checks).map(obj).filter(x => x.label || x.note);
    if (cc.length) h += '<h3>교차값</h3><ul class="plain">' + cc.map(x => '<li>' + esc(x.label || '교차값') + ': ' + (isNum(x.value_bn) ? bnTxt(x.value_bn) : '갱신 불가') + (x.note ? ' — ' + esc(x.note) : '') + '</li>').join('') + '</ul>';
    const oc = obj(g.op_vs_consensus), nums = isNum(oc.lane_12mf_op_bn) && isNum(oc.consensus_12mf_op_bn);
    const numTxt = nums ? '연장 base 부문 12MF 영업이익 합계 ' + bnTxt(oc.lane_12mf_op_bn) + ' vs 컨센서스 12MF 영업이익 ' + bnTxt(oc.consensus_12mf_op_bn) + (isNum(oc.gap_pct) ? '(차이 ' + pct(oc.gap_pct) + ')' : '') : '';
    if (oc.text || numTxt) h += notice('<b>컨센서스 대비</b> ' + (oc.text ? esc(oc.text) + (numTxt ? ' <span class="dim">— ' + esc(numTxt) + '</span>' : '') : esc(numTxt)), 'blue');
    return h;
  }
  function rangeBlock(c, st) {
    const v = val(c), g = obj(v.range), scs = obj(g.scenarios), sm = obj(g.summary), w = obj(obj(v.rule).weights);
    const mi = obj(g.minority), mItems = arr(mi.items).map(obj), mv = obj(mi.variants), noDed = obj(mv.no_deduction), book = obj(mv.book_nci);
    const hasMin = !!(g.minority && typeof g.minority === 'object') || SCEN.some(s => isNum(obj(scs[s]).minority_bn));
    const ndv = arr(g.net_debt_variants).map(obj), leaseNote = str(obj(obj(v.inputs).net_debt).lease_note), nCols = hasMin ? 6 : 5;
    const ps = x => isNum(x.per_share) ? won(x.per_share) : ((x.equity_le_zero || (isNum(x.equity_value_bn) && x.equity_value_bn <= 0)) ? '주주가치 ≤ 0' : '—');
    const dash = '<td>—</td>', minDash = hasMin ? dash : '';
    const subRow = (label, cells) => '<tr class="sub"><td class="l">' + label + '</td>' + cells + '</tr>';
    const scRows = SCEN.map(s => { const x = obj(scs[s]); return '<tr' + (s === 'base' ? ' class="hl"' : '') + '><td class="l">' + scenName(s) + (s === 'base' ? ' (헤드라인)' : '') + '</td>' + td(x.operating_value_bn, 1) + td(x.stake_value_bn, 1) + td(x.net_debt_bn, 1) + (hasMin ? td(x.minority_bn, 1) : '') + td(x.equity_value_bn, 1) + '<td>' + ps(x) + '</td></tr>'; }).join('');
    // 리스부채 행이 없는 회사는 엔진이 리스 포함 변형을 내지 않는다 — 값 대신 그 사유를 같은 자리에 둔다
    const ndRows = ndv.map(x => subRow('base · 순차입금 정의: ' + esc(x.label), dash + dash + td(x.net_debt_bn, 1) + minDash + td(x.equity_value_bn, 1) + '<td>' + ps(x) + '</td>')).join('') +
      (leaseNote && !ndv.some(x => x.key === 'incl_lease') ? subRow('base · 순차입금 정의: 리스부채 포함', '<td class="l dim" colspan="' + nCols + '">' + esc(leaseNote) + '</td>') : '');
    const minRows = hasMin ? ((isNum(noDed.per_share) || isNum(noDed.equity_value_bn)) ? subRow('base · 상장 자회사 비지배지분 차감 전(참고)', dash + dash + dash + '<td>미차감</td>' + td(noDed.equity_value_bn, 1) + '<td>' + ps(noDed) + '</td>') : '') +
      ((isNum(book.per_share) || isNum(book.equity_value_bn)) ? subRow('base · 연결 비지배지분 장부가 전액 차감(참고, 시가 차감 대신)', dash + dash + dash + td(book.nci_book_bn, 1) + td(book.equity_value_bn, 1) + '<td>' + ps(book) + '</td>') : '') : '';
    // 연도별 이익 북엔드: 숫자(주당 값) · 객체({per_share, equity_le_zero, equity_value_bn}) · null(엔진이 값을 내지 않음 — '—'는 미확인으로 읽히므로 쓰지 않는다)
    const be = obj(g.bookends), beKeys = Object.keys(be).sort();
    const beObj = x => (x && typeof x === 'object') ? x : null;
    const beTxt = x => isNum(x) ? won(x) : beObj(x) ? ps(x) : '산출 안 됨';
    const beRows = beKeys.map(k => subRow('base · ' + esc(k) + ' 이익 기준', dash + dash + dash + minDash + (beObj(be[k]) ? td(be[k].equity_value_bn, 1) : dash) + '<td>' + beTxt(be[k]) + '</td>')).join('');
    let h = '<h3>SOTP 범위</h3>' + tw('SOTP 범위 표', '<table class="wide range-summary"><caption>' + esc((g.basis || '') + (g.weights ? ' · ' + g.weights : '')) + ' — 금액 십억원, 주당 값 원</caption><thead><tr><th class="l">구분</th><th>영업가치</th><th>지분가치</th><th>순차입금</th>' + (hasMin ? '<th>비지배지분 차감</th>' : '') + '<th>주주가치</th><th>주당 값</th></tr></thead><tbody>' + scRows + ndRows + minRows + beRows + '</tbody></table>');
    h += '<p class="small">base ' + won(sm.base) + ' · bear ' + (isNum(sm.bear) ? won(sm.bear) : '주주가치 ≤ 0') + ' · bull ' + won(sm.bull) + ' · 순차입금 정의별 base ' + won(sm.base_low) + '~' + won(sm.base_high) +
      (isNum(noDed.per_share) ? ' · 비지배지분 차감 전 ' + won(noDed.per_share) : '') + (isNum(book.per_share) ? ' · 연결 비지배지분 장부가 전액 차감 ' + won(book.per_share) : '') +
      (beKeys.length ? ' · ' + beKeys.map(k => esc(k) + ' 이익 기준 ' + beTxt(be[k])).join(' · ') : '') + '. 단일 값이 아니라 범위로 읽을 것.' +
      (beKeys.some(k => be[k] == null) ? ' <span class="dim">"산출 안 됨"은 엔진이 그 연도 이익 기준 값을 내지 않은 경우입니다(사유 필드 없음).</span>' : '') + '</p>';
    h += rangeExtras(g);
    if (hasMin) {
      if (mItems.length) h += '<h3>상장 자회사 비지배지분 시가 차감 (bear·base·bull 공통)</h3>' + tw('비지배지분 차감 표', '<table class="wide minority"><caption>금액 십억원</caption><thead><tr><th class="l">자회사</th><th>보유 지분율</th><th>시가총액</th><th>차감액</th><th class="l">근거</th></tr></thead><tbody>' +
        mItems.map(x => '<tr><td class="l">' + esc(x.name) + (x.unverified === true ? ' ' + badge('미검증', 'warn') : '') + '</td><td>' + lvlR(x.pct_owned, 2) + '</td>' + td(x.market_cap_bn, 1) + td(x.minority_value_bn, 1) + '<td class="l basis">' + rcptHtml(x.basis || x.stake_basis) + '</td></tr>').join('') +
        '<tr class="tot"><td class="l">차감 합계</td><td></td><td></td>' + td(mi.deduction_bn, 1) + '<td></td></tr></tbody></table>');
      else h += '<p class="dim small">상장 자회사 비지배지분 차감 항목 없음 — 위 값은 비지배지분을 빼지 않은 값입니다.</p>';
      if (mi.note) h += '<p class="dim small">' + esc(mi.note) + '</p>';
    }
    const near = isNum(w.near_fy) ? 'FY' + w.near_fy + 'E' : '근접 연도', far = isNum(w.far_fy) ? 'FY' + w.far_fy + 'E' : '다음 연도';
    const segs = arr(g.segments).map(obj);
    if (segs.length) {
      const segRows = segs.map(x => '<tr><td class="l">' + esc(x.label) + '</td>' + td(x.op_fy_near, 1) + td(x.op_fy_far, 1) + td(x.op_used, 1) + td(x.noplat, 1) + '<td>' + mult(x.multiple, 2) + '</td>' + td(x.value_bn, 1, '', x.floored_at_zero ? '<sup>0</sup>' : '') +
        '<td class="l basis">' + esc(x.multiple_basis) + (x.substitute_note ? '<br>' + esc(x.substitute_note) : '') + ((isNum(x.workbook_multiple) || isNum(x.workbook_value_bn)) ? '<br>워크북: 배수 ' + esc(mult(x.workbook_multiple, 2)) + ' · 가치 ' + bnTxt(x.workbook_value_bn) : '') + '</td></tr>').join('');
      const base = obj(scs.base);
      h += '<h3>부문별 SOTP (base, 십억원)</h3>' + tw('부문별 SOTP 표', '<table class="wide"><thead><tr><th class="l">부문</th><th>' + near + ' 영업이익</th><th>' + far + ' 영업이익</th><th>12MF 영업이익</th><th>NOPLAT</th><th>배수</th><th>가치</th><th class="l">배수 근거</th></tr></thead><tbody>' + segRows +
        '<tr class="tot"><td class="l">영업가치 합계</td><td></td><td></td><td></td><td></td><td></td>' + td(base.operating_value_bn, 1) + '<td></td></tr></tbody></table>') +
        '<p class="dim small">NOPLAT = 12MF 영업이익 × (1 − ' + lvlR(g.noplat_tax_rate, 0) + '). ' + esc(g.excluded) + (segs.some(x => x.floored_at_zero) ? ' · <sup>0</sup> 음수 가치는 0으로 둠' : '') + '</p>';
      const peers = [];
      let hasK = false;
      segs.forEach(x => arr(x.peers).map(obj).forEach(p => {
        if (Object.prototype.hasOwnProperty.call(p, 'k')) hasK = true;
        peers.push('<tr><td class="l">' + esc(x.label) + '</td><td class="l">' + esc(p.name) + '</td>' + td(p.price, 0) + td(p.eps_near, 0) + td(p.eps_far, 0) + tdTxt(fmt(p.eps_12mf, 2)) + '<td>' + (isNum(p.k) ? fx(p.k, 4) : '—') + '</td><td>' + mult(p.per_12mf, 2) + '</td><td class="l">' + esc(p.price_basis) + '</td><td class="l basis">' + esc(p.k_basis) + '</td></tr>');
      }));
      if (peers.length) h += det(st, 'sotp-peers', false, '피어 12MF PER (' + peers.length + '종목)', tw('피어 표', '<table class="wide"><caption>종가·EPS 원' + (hasK ? ' · 12MF PER = 종가 × k ÷ 12MF EPS (k = 유통/발행 주식수, 자료가 없으면 1)' : '') + '</caption><thead><tr><th class="l">부문</th><th class="l">종목</th><th>종가</th><th>' + near + ' EPS</th><th>' + far + ' EPS</th><th>12MF EPS</th><th>k(유통/발행)</th><th>12MF PER</th><th class="l">가격 기준</th><th class="l">k 근거</th></tr></thead><tbody>' + peers.join('') + '</tbody></table>'));
    }
    const stakes = arr(g.stakes).map(obj);
    if (stakes.length) {
      const asOf = stakes.map(x => x.price_as_of).filter(Boolean)[0];
      h += '<h3>상장 지분가치 (할인 ' + lvlR(g.stake_discount, 0) + (asOf ? ' · 시가총액 기준일 ' + esc(asOf) : '') + ')</h3>' + tw('지분 표', '<table class="wide stakes"><caption>시가총액·가치 십억원</caption><thead><tr><th class="l">종목</th><th>지분율</th><th class="l">검증</th><th>할인</th><th>시가총액</th><th>가치</th><th class="l">근거</th></tr></thead><tbody>' +
        stakes.map(x => '<tr><td class="l">' + esc(x.name) + '</td><td>' + lvlR(x.stake_pct, 2) + '</td><td class="l">' + (x.unverified === true ? badge('미검증', 'warn') : x.unverified === false ? badge('확인') : '—') + '</td><td>' + lvlR(x.discount, 0) + '</td>' + td(x.market_cap_bn, 1) + td(x.value_bn, 1) +
          '<td class="l basis">' + rcptHtml(x.stake_basis) + (x.market_cap_basis ? '<br>시가총액 산식: ' + esc(x.market_cap_basis) : '') + '</td></tr>').join('') +
        '<tr class="tot"><td class="l">지분가치 합계</td><td></td><td></td><td></td><td></td>' + td(g.stake_value_bn, 1) + '<td></td></tr></tbody></table>');
    }
    if (g.source) h += '<p class="dim small">출처: ' + esc(g.source) + '</p>';
    return h;
  }
  // 콘텐트리중앙 차입금 매핑 점검(claims_waterfall.mapping_check): 경보면 빨간 상자, 아니면 비율만
  function mappingCheckBlock(cw) {
    const m = obj(obj(cw).mapping_check);
    if (!isNum(m.gross_debt_to_total_liabilities) && !isNum(m.finance_costs_to_gross_debt) && typeof m.incomplete_mapping !== 'boolean') return '';
    const body = '차입금 ÷ 부채총계 ' + lvlR(m.gross_debt_to_total_liabilities) + ' · 금융비용 ÷ 차입금 ' + lvlR(m.finance_costs_to_gross_debt) + (m.note ? ' — ' + esc(m.note) : '');
    return m.incomplete_mapping === true ? notice('<b>매핑 경보</b> 차입금 매핑이 불완전할 수 있습니다(차입금이 일부 빠졌을 수 있음): ' + body, 'bad') : '<p class="dim small">차입금 매핑 점검: ' + body + (m.incomplete_mapping === false ? ' · 경보 없음' : '') + '</p>';
  }
  // 콘텐트리중앙 손익분기(break_even): EBITDA × 배수 = EV가 청구권 B·C·D를 넘는지
  function breakEvenBlock(v) {
    const b = obj(obj(v).break_even), rows = arr(b.rows).map(obj), cl = obj(b.claims), L = ['B', 'C', 'D'], ek = {ltm: 'LTM', ex_sports: '스포츠 중계권 손실 제외'};
    if (!rows.length && !isNum(b.ltm_ebitda_bn)) return '';
    const psBE = (r, k) => { const p = obj(r.per_share_vs)[k], e = obj(r.equity_bn_vs)[k]; return isNum(p) ? won(p) : (isNum(e) && e <= 0 ? '주주가치 ≤ 0' : '—'); };
    let h = '<h3>손익분기 EV/EBITDA (청구권 대비)</h3>' + kv([
      ['LTM EBITDA', bnTxt(b.ltm_ebitda_bn), b.ltm_ebitda_basis],
      ['스포츠 중계권 손실 제외 EBITDA', isNum(b.ex_sports_ebitda_bn) ? bnTxt(b.ex_sports_ebitda_bn) : (b.ex_sports_basis ? '산출 안 됨' : ''), b.ex_sports_basis],
      L.some(k => isNum(cl[k])) ? ['청구권', L.map(k => k + ' ' + bnTxt(cl[k])).join(' · ')] : null
    ]);
    if (rows.length) h += tw('손익분기 표', '<table class="wide"><caption>금액 십억원, 주당 값 원</caption><thead><tr><th>배수</th><th class="l">EBITDA 기준</th><th>EV</th>' + L.map(k => '<th>주주가치 vs ' + k + '</th>').join('') + L.map(k => '<th>주당 vs ' + k + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map(r => '<tr><td>' + mult(r.multiple, 2) + '</td><td class="l">' + esc(ek[r.ebitda_key] || '기타') + '</td>' + td(r.ev_bn, 1) + L.map(k => td(obj(r.equity_bn_vs)[k], 1)).join('') + L.map(k => '<td>' + psBE(r, k) + '</td>').join('') + '</tr>').join('') + '</tbody></table>');
    if (b.note) h += '<p class="dim small">' + esc(b.note) + '</p>';
    return h;
  }
  function rehabBlock(d, c) {
    const v = val(c), ds = obj(v.distress), cw = obj(v.claims_waterfall), ctm = obj(cw.claims_to_market_cap), reason = str(obj(v.rule).reason);
    let h = '<p>' + badge('회생절차 · 환산가 미산정', 'bad') + '</p>' + ((ds.note || v.note) ? '<p class="small">' + esc(ds.note || v.note) + '</p>' : '');
    // 환산 규칙 카드는 그리지 않는다(입력·배수가 모두 적용 안 됨) — 판단 근거 한 줄만 여기 둔다
    if (reason) h += '<p class="dim small">환산 규칙 판단 근거: ' + esc(reason) + '</p>';
    const fl = arr(ds.filings).map(obj);
    if (fl.length) h += '<h3>회생 관련 공시 (DART)</h3><ul class="plain">' + fl.map(f => '<li>' + esc(f.date) + ' · ' + dartLink(f.rcept_no, f.title || '공시') + '</li>').join('') + '</ul>';
    const steps = arr(cw.steps).map(obj);
    if (steps.length) {
      const rows = steps.map(s => '<tr' + (s.subtotal ? ' class="tot"' : '') + '><td class="l">' + esc(s.label) + (s.contested ? ' ' + badge('다툼 있음', 'warn') : '') + (s.subtotal && s.no_items === true ? ' <span class="dim">(이 단계에 더한 수기 항목 없음 — 직전 단계와 같음)</span>' : '') + '</td>' + td(s.value_bn, 1) + '<td>' + (s.subtotal && isNum(ctm[s.key]) ? fx(ctm[s.key], 1) + '배' : '') + '</td><td class="l basis">' +
        [esc(s.source), esc(s.locator)].filter(Boolean).join(' · ') + (s.rcept_no ? ' · ' + dartLink(s.rcept_no, '공시') : '') + '</td></tr>').join('');
      h += '<h3>청구권 순위표 (' + esc(cw.basis || '') + ' · ' + esc(cw.unit || '십억원') + ')</h3>' + tw('청구권 순위표', '<table class="wide claims"><thead><tr><th class="l">단계</th><th>금액</th><th>시가총액 대비</th><th class="l">출처</th></tr></thead><tbody>' + rows + '</tbody></table>') +
        '<p class="small">시가총액 ' + bnTxt(cw.market_cap_bn) + (cw.market_cap_basis ? ' (' + esc(cw.market_cap_basis) + ')' : '') + ' · 기본 정의 순차입금 ' + bnTxt(cw.net_debt_dart_map_bn) + ' · 기타유동금융자산 ' + bnTxt(cw.other_current_financial_bn) + (cw.rcept_no ? ' · ' + dartLink(cw.rcept_no, '기준 공시') : '') + '</p>';
    }
    h += mappingCheckBlock(cw);
    const memo = arr(cw.memo).map(obj);
    if (memo.length) h += '<ul class="plain">' + memo.map(m => '<li>메모: ' + esc(m.label) + ' · ' + esc(m.unit) + ' ' + fmt(m.value, 0) + (m.locator ? ' · ' + esc(m.locator) : '') + (m.note ? ' — ' + esc(m.note) : '') + '</li>').join('') + '</ul>';
    if (cw.note) h += '<p class="dim small">' + esc(cw.note) + (cw.overlay_as_of ? ' 수기 입력 기준일 ' + esc(cw.overlay_as_of) + '.' : '') + '</p>';
    h += breakEvenBlock(v);
    const pbrEx = isNum(v.pbr_ex_hybrid) ? mult(v.pbr_ex_hybrid, 3) : (isNum(v.bps_ex_hybrid) && v.bps_ex_hybrid <= 0 ? '산출 불가(BPS ≤ 0)' : '—');
    h += '<h3>BPS</h3>' + kv([['BPS(보고 기준)', won(v.bps), pbrOff(v) ? '자본 내 신종자본증권 포함 — 보통주 가치를 나타내지 않음' : ''], ['신종자본증권 제외 BPS', won(v.bps_ex_hybrid), v.bps_ex_hybrid_basis], ['PBR(신종자본증권 제외)', pbrEx]]);
    return h;
  }
  // 레저 템플릿: 자기 밴드 저·평균·고 배수 × 입력값(엔진 대안 값 band_low·band_avg·band_high)과 컨센서스 목표주가를 나란히 — 대안 값이 있을 때만
  function bandAltLine(c) {
    const by = {};
    arr(val(c).alternatives).map(obj).forEach(a => { if (a.key) by[a.key] = a; });
    const parts = [['band_low', '저'], ['band_avg', '평균'], ['band_high', '고']].filter(p => by[p[0]] && isNum(by[p[0]].value)).map(p => p[1] + ' ' + won(by[p[0]].value) + (isNum(by[p[0]].multiple) ? '(' + mult(by[p[0]].multiple, 2) + ')' : ''));
    if (!parts.length) return '';
    const tp = obj(obj(c.consensus_now).ntm).TP;
    return '<p class="small">자기 밴드 배수 × 입력값: ' + parts.join(' · ') + (isNum(tp) ? ' · 컨센서스 목표주가 평균 ' + won(tp) : '') + ' <span class="dim">(배수와 근거는 대안 값 표)</span></p>';
  }
  function statusBlock(d, c, st) {
    const v = val(c), inp = obj(v.inputs);
    let h = '';
    if (v.status === 'not_valued_rehabilitation') h += rehabBlock(d, c);
    else if (hasValue(v)) {
      const vs = '현재가 ' + won(v.price_now) + (v.price_as_of ? '(' + esc(v.price_as_of) + ')' : '') + ' 대비 ';
      if (v.status === 'range') h += '<div class="valhead"><span class="dim">SOTP 범위(단일 값이 아님)</span><span class="rngline">' + rangeParts(v).map(esc).join(' · ') + '</span><span class="dim">' + esc(v.scenario || 'base') + ' 기준 · ' + vs + 'base ' + pct(v.upside_pct) + '</span></div>';
      else {
        const lab = v.status === 'reference_band' ? '밴드 참고가' : (v.label || '앙상블 규칙 환산가');
        h += '<div class="valhead"><span class="dim">' + esc(lab) + '</span><span class="tpv">' + won(v.updated_target_price) + '</span><span class="dim">' + esc(v.scenario || 'base') + ' 기준 · ' + vs + pct(v.upside_pct) + '</span></div>';
      }
      if (v.status === 'reference_band') h += bandAltLine(c);
    } else h += '<p>' + badge(statusLabel(v), valTone(v)) + '</p>';
    if (v.status !== 'not_valued_rehabilitation') {
      if (inp.formula) h += '<p class="formula">' + esc(inp.formula) + '</p>';
      if (v.note) h += '<p class="dim small">' + esc(v.note) + '</p>';
      if (v.status === 'range') h += rangeBlock(c, st);
      // 매핑 점검·손익분기는 계약상 콘텐트리중앙(회생 블록 안에서 그림) 몫이지만, 회생이 아닌 회사에 실려도 빠뜨리지 않는다
      h += mappingCheckBlock(v.claims_waterfall) + breakEvenBlock(v);
    }
    return h + confidenceBlock(v) + warningsBlock(v) + flagsBlock(d, c) + commonKv(c);
  }
  function valuationCard(d, c, st) {
    const v = val(c), base = v.scenario || 'base';
    let h = '<div class="card val-card"><div class="title"><div><h2>' + esc(v.label || '앙상블 규칙 환산가') + '</h2><p class="dim small">' + esc(v.label_note) + '</p></div><div class="badges">' + badge(statusLabel(v), valTone(v)) + (v.confidence && hasValue(v) ? badge('신뢰도 ' + (confNames[v.confidence] || v.confidence)) : '') + '</div></div>';
    if (st.scenario !== base) h += notice('환산가는 ' + esc(base) + ' 시나리오 기준입니다. 선택한 ' + scenName(st.scenario) + ' 시나리오는 실적 연장 표·차트에만 반영되며, 이 카드와 아래 규칙 카드의 EPS·배수·값은 모두 ' + esc(base) + ' 값입니다.', 'blue');
    return h + statusBlock(d, c, st) + notice(esc(disclaimer(d)), 'disclaimer') + '</div>';
  }
  function earningsInputHtml(ei, v) {
    ei = obj(ei);
    if (ei.kind === 'eps_12mf') {
      const band = arr(ei.band);
      return '12MF EPS(연장 ' + esc(ei.scenario || v.scenario || 'base') + ') ' + wonE(ei.raw) + ' → 입력 ' + wonE(ei.value) + ' <span class="dim">(' + (ei.clamped === true ? '±30% 윈저라이즈 적용' : ei.clamped === false ? '윈저라이즈 미적용' : '윈저라이즈 여부 미기재') +
        (band.length === 2 ? ' · 허용 범위 ' + won(band[0]) + '~' + won(band[1]) : '') + (isNum(ei.consensus_12mf_lane) ? ' · 컨센서스 12MF(유통주식 기준) ' + wonE(ei.consensus_12mf_lane) + ' 대비 ' + pct(ei.gap_vs_consensus_pct) : '') + ')</span>';
    }
    if (ei.kind === 'bps') {
      const parts = [esc(ei.basis), isNum(ei.lane_eps_12mf) ? '참고: 연장 12MF EPS ' + wonE(ei.lane_eps_12mf) : '', isNum(ei.lane_roe_12mf) ? '12MF ROE ' + lvlR(ei.lane_roe_12mf) : ''].filter(Boolean);
      return 'BPS ' + won(ei.value) + (parts.length ? ' <span class="dim">(' + parts.join(' · ') + ')</span>' : '');
    }
    return [isNum(ei.bps) ? 'BPS ' + won(ei.bps) : '', isNum(ei.lane_eps_12mf) ? '연장 12MF EPS ' + wonE(ei.lane_eps_12mf) : ''].filter(Boolean).join(' · ') || '—';
  }
  function ruleCard(d, c, st) {
    const v = val(c), r = obj(v.rule);
    // 회생절차로 환산가를 내지 않은 회사는 규칙 입력(보고 BPS·밴드 배수·스트리트 배수)을 늘어놓지 않는다(renderCompany는 이 카드를 아예 그리지 않음)
    if (v.status === 'not_valued_rehabilitation') return '<p class="dim">' + esc(r.reason || '환산가를 산정하지 않아 환산 규칙을 적용하지 않았습니다.') + '</p>';
    const band = obj(r.own_band), sr = obj(r.street), inp = obj(v.inputs), ns = obj(r.n_sensitivity);
    const vy = arr(band.valid_years).map(String), bk = band.kind === 'per' ? 'PER' : band.kind === 'pbr' ? 'PBR' : '';
    const nsTxt = Object.keys(ns).sort((a, b) => +a - +b).map(k => 'N=' + esc(k) + ' ' + won(ns[k])).join(' · ') || '—';
    const binding = arr(r.binding).map(b => bindingNames[b] || b).join(' · ') || '없음';
    // PBR 회사(TP ÷ 최신 BPS)는 분모가 BPS다 — 쓰지 않은 12MF EPS·k 대신 BPS를 보여 화면 숫자로 S를 다시 계산할 수 있게 한다
    const pbrS = /BPS/.test(str(sr.basis)), sBps = isNum(sr.bps) ? sr.bps : v.bps;
    const streetParts = [isNum(sr.tp) ? '컨센서스 목표주가 평균 ' + won(sr.tp) : '', pbrS ? (isNum(sBps) ? '÷ 최신 BPS ' + won(sBps) : '') : (isNum(sr.eps_12mf) ? '÷ 12MF EPS ' + wonE(sr.eps_12mf) + (isNum(sr.eps_12mf_lane) ? '(유통주식 기준 ' + wonE(sr.eps_12mf_lane) + ')' : '') : ''), !pbrS && isNum(sr.k) ? '× k ' + fx(sr.k, 4) : ''].filter(Boolean);
    let h = kv([
      ['판단 근거', '', r.reason],
      ['방식', esc(methodNames[r.method_original] || r.method_original || '—') + ' → ' + esc(methodNames[r.method_applied] || r.method_applied || '—') + (r.s_rule_method ? ' <span class="dim">(규칙 환산가 교차 확인: ' + esc(methodNames[r.s_rule_method] || r.s_rule_method) + ')</span>' : '')],
      ['자기 밴드 기준 H', mult(band.H) + ' <span class="dim">' + esc(bk) + (isNum(band.median) ? ' · 중앙값 ' + mult(band.median) : '') + (isNum(band.p80) ? ' · 80백분위 ' + mult(band.p80) : '') + (vy.length ? ' · 기준 연도 ' + esc(vy.join('·')) : '') + (band.consecutive === false ? ' · 기준 연도 비연속' : '') + '</span>'],
      isNum(band.pbr_p80) ? ['PBR 정합 상한(P80 PBR)', mult(band.pbr_p80)] : null,
      ['스트리트 상한 배수', mult(sr.S) + (streetParts.length ? ' <span class="dim">' + streetParts.join(' ') + '</span>' : ''), [sr.basis, pbrS ? '' : sr.e12_source, sr.date].filter(Boolean).join(' · ')],
      ['적용 배수 · 실효 배수', mult(r.target_multiple) + ' · ' + mult(r.effective_multiple) + (inp.multiple_kind ? ' <span class="dim">(' + esc(inp.multiple_kind) + ')</span>' : '')],
      ['걸린 상한', esc(binding)],
      ['이익 입력', earningsInputHtml(r.earnings_input, v)],
      ['12MF 가중', esc(obj(r.weights).text || '—')],
      ['N 민감도(최근 N개 유효 연도)', nsTxt]
    ]);
    const years = obj(band.years), yk = Object.keys(years).sort(), off = pbrOff(v);
    if (yk.length) {
      const yn = b => b === true ? '유효' : b === false ? '제외' : '—';
      // 보통주 BPS ≤ 0이면 기준연도(최신 분기 BPS = 보고 BPS) PBR도 내지 않는다
      const hideRef = x => off && x.source === 'ttm';
      const rows = yk.map(y => { const x = obj(years[y]), on = vy.indexOf(y) >= 0; return '<tr' + (on ? ' class="hl"' : '') + '><td class="l">' + esc(y) + (on ? ' ●' : '') + '</td><td class="l">' + esc(bandSourceNames[x.source] || '') + '</td>' + td(x.eps, 0) + td(x.bps, 0) + tdR(x.roe) + td(x.per, 2) + (hideRef(x) ? '<td>—</td>' : td(x.pbr, 3)) + td(x.months, 0) + '<td>' + yn(x.valid_per) + '</td><td>' + yn(x.valid_pbr) + '</td></tr>'; }).join('');
      h += '<h3>자기 밴드 (연평균 배수' + (bk ? ', 기준 ' + bk : '') + ')</h3>' + tw('자기 밴드 표', '<table class="wide band"><caption>EPS·BPS 원</caption><thead><tr><th>연도</th><th class="l">출처</th><th>EPS</th><th>BPS</th><th>ROE</th><th>PER</th><th>PBR</th><th>개월</th><th>PER 유효</th><th>PBR 유효</th></tr></thead><tbody>' + rows + '</tbody></table>') +
        '<p class="dim small">● 중앙값 H를 낸 기준 연도. ' + esc(band.p80_method) + (band.bps_basis ? ' 과거 연도 BPS 기준: ' + esc(band.bps_basis) + '.' : '') + (off && yk.some(y => hideRef(obj(years[y]))) ? ' 기준연도(최근 4개 분기) PBR은 비움: ' + esc(pbrOffWhy(v)) + '.' : '') + '</p>';
    }
    return h;
  }
  // 대안 값 칸: 값이 없는 SOTP 연도 북엔드는 '—'(미확인) 대신 '주주가치 ≤ 0'(엔진 표지가 있을 때) 또는 '산출 안 됨'
  function altValue(a, v) {
    if (isNum(a.value)) return won(a.value);
    const m = str(a.key).match(/^sotp_(FY\d{4}E)$/), be = m ? obj(obj(v.range).bookends)[m[1]] : null;
    if (a.equity_le_zero === true || (be && typeof be === 'object' && be.equity_le_zero === true)) return '주주가치 ≤ 0';
    return /^sotp_/.test(str(a.key)) ? '산출 안 됨' : '—';
  }
  function alternativesCard(c) {
    const v = val(c), alts = arr(v.alternatives).map(obj);
    if (!alts.length) return '';
    return tw('대안 값 표', '<table class="wide"><thead><tr><th class="l">대안</th><th>값</th><th>배수</th><th class="l">근거</th></tr></thead><tbody>' + alts.map(a => {
      const extra = [a.da_basis ? 'D&A ' + a.da_basis : '', a.da_source, a.workbook_note ? '워크북 비고: ' + a.workbook_note : ''].filter(Boolean);
      return '<tr><td class="l">' + esc(a.label) + '</td><td>' + altValue(a, v) + '</td><td>' + mult(a.multiple) + '</td><td class="l basis">' + esc(a.basis) + extra.map(x => '<br>' + rcptHtml(x)).join('') + '</td></tr>';
    }).join('') + '</tbody></table>') + '<p class="dim small">값은 원 단위입니다. 연장 이익을 쓰는 값은 ' + esc(v.scenario || 'base') + ' 시나리오 기준입니다.</p>';
  }
  const multipleUnit = {per: '배', pbr: '배', ev_ebitda: '배', sotp: '십억원'};
  function workbookCard(d, c, st) {
    const v = val(c), o = obj(v.original), tpa = obj(model(c).target_price_active), mu = obj(o.multiple), vt = vintageYM(d);
    if (!v.original && !model(c).target_price_active) return '<p class="dim">템플릿 워크북: TP 시트에 산식·목표주가 입력이 없습니다.</p>';
    const tp = isNum(o.target_price) ? o.target_price : tpa.target_price, px = isNum(o.price) ? o.price : tpa.current_price;
    const pxl = [o.price_label || tpa.current_price_label, o.price_date || tpa.current_price_date].filter(Boolean).join(' · ');
    const muTxt = [str(mu.label), isNum(mu.value) ? fmt(mu.value, 2) + (multipleUnit[mu.kind] || '') : ''].filter(Boolean).join(' ');
    // 워크북 컨센 시트의 교보증권 공표 목표주가(house_tp_in_consensus_snapshot) — TP 시트 값과 나란히 둔다
    const hs = model(c).house_tp_in_consensus_snapshot, hx = obj(hs);
    const houseRow = (hs && isNum(hx.target_price)) ? [(hx.house || obj(d).model_house || '교보증권') + ' 공표 목표주가(워크북 컨센 시트)', won(hx.target_price) + (hx.date ? ' <span class="dim">(' + esc(hx.date) + ')</span>' : '') +
      (hx.differs_from_block === true ? ' ' + badge('TP 시트 값과 다름', 'warn') : hx.differs_from_block === false ? ' <span class="dim">· TP 시트 값과 같음</span>' : ''), '워크북 컨센 시트의 해당 증권사 행만 싣는다 — 다른 증권사 행은 공개하지 않음'] : null;
    let h = kv([
      ['블록', esc('블록 ' + (o.block || tpa.block || '—') + ' · ' + (o.header_basis || tpa.header_basis || '')), tpa.active_block_basis],
      ['워크북 일자', esc(o.model_date || tpa.model_date || '—')],
      ['원본 산식 핵심 항목', esc(muTxt), mu.note],
      ['목표주가(워크북 TP 시트 값)', won(tp) + ' <span class="dim">— ' + esc(vt) + ' 워크북 TP 시트 값(공표 목표주가와 다를 수 있음)' + (v.status === 'not_valued_rehabilitation' ? ' · 회생절차 개시 전 작성 값 — 현재 가치 추정이 아니며 이 페이지는 환산가를 내지 않음' : '') + '</span>'],
      houseRow,
      ['시트 주가', won(px) + (pxl ? ' <span class="dim">(' + esc(pxl) + ')</span>' : ''), '워크북 작성 당시 시트 값 — 현재가가 아님'],
      ['출처', esc(o.source || '')]
    ]);
    const items = arr(tpa.items).map(obj);
    if (items.length) h += det(st, 'tpitems', false, '활성 블록 항목 ' + items.length + '개', tw('TP 시트 활성 블록 항목', '<table><caption>' + esc(vt) + ' 워크북 작성 당시 시트 값 그대로 — 주가·상승여력 항목도 그 시점 기준이며 현재 시세나 현재 의견이 아님</caption><thead><tr><th class="l">항목</th><th class="l">단위</th><th>값</th><th class="l">비고</th></tr></thead><tbody>' +
      items.map(it => '<tr><td class="l">' + esc(it.label) + '</td><td class="l">' + esc(it.unit) + '</td>' + (isNum(it.value) ? td(it.value, Math.abs(it.value) >= 1000 ? 0 : 2) : '<td class="l">' + esc(typeof it.value === 'string' ? it.value : '') + '</td>') + '<td class="l">' + esc(it.note) + '</td></tr>').join('') + '</tbody></table>'));
    return h;
  }

  // ── 드라이버 · 세그먼트 · 워크북 컨센 ──
  function driversCard(d, c) {
    const rows = arr(hist(c).drivers_actual).map(obj).filter(r => r.metric), si = srcIndex(d);
    if (!rows.length) return '';
    const keys = Array.from(new Set([].concat(...rows.map(r => Object.keys(obj(r.values)))))).filter(k => /^\d{4}Q[1-4]$/.test(k)).sort().slice(-8);
    const showSrc = rows.some(r => Array.isArray(r.source_ids) || r.as_of != null);
    // 출처 id는 출처 목록(data.sources, aliases 포함)에 있는 것만 번호를 붙여 아래 목록에 연결하고, 목록에 없는 id는 건너뛴다
    const refs = [], usedBy = {}, missing = new Set();
    const ref = (k, metric) => { let i = refs.indexOf(k); if (i < 0) { refs.push(k); usedBy[k] = []; i = refs.length - 1; } if (usedBy[k].indexOf(metric) < 0) usedBy[k].push(metric); return '[' + (i + 1) + ']'; };
    const body = rows.map(r => {
      const ids = arr(r.source_ids).filter(id => typeof id === 'string' && id);
      ids.filter(id => !si.key(id)).forEach(id => missing.add(id));
      const refTxt = Array.from(new Set(ids.map(si.key).filter(Boolean))).map(k => ref(k, r.metric)).join(' ');
      return '<tr><td class="l">' + metricLabel(r.metric) + '<div class="basis">' + esc(howTxt(r.how)) + '</div></td><td class="l">' + esc(unitNames[r.unit] || r.unit) + '</td>' + keys.map(k => { const x = obj(r.values)[k]; return tdTxt(unitVal(x, r.unit), isNum(x) && x < 0 ? 'neg' : ''); }).join('') +
        (showSrc ? '<td class="l">' + (refTxt || '—') + '</td><td>' + esc(r.as_of || '—') + '</td>' : '') + '</tr>';
    }).join('');
    return tw('드라이버 실적 표', '<table class="wide"><thead><tr><th class="l">지표</th><th class="l">단위</th>' + keys.map(k => '<th>' + esc(k) + '</th>').join('') + (showSrc ? '<th class="l">출처</th><th>기준일</th>' : '') + '</tr></thead><tbody>' + body + '</tbody></table>') +
      '<p class="dim small">커버리지 레인이 회사 월간·분기 IR 자료에서 집계한 실적입니다. 각 행 아래에 계산 방식(월 3개월 합, 분기 합끼리의 비율 등)을 적었습니다.' +
      (showSrc ? ' 기준일은 그 행 값에 쓴 원자료의 가장 늦은 기간 말일이고, 출처 번호는 아래 목록의 번호입니다.' + (missing.size ? ' 출처 목록에 없는 자료 ' + missing.size + '건은 표시하지 않았습니다.' : '') : '') + '</p>' +
      (refs.length ? '<ol class="plain refs">' + refs.map(k => '<li>' + sourceItem(si.get(k), c, d) + ' <span class="dim">— ' + usedBy[k].map(metricLabel).join(' · ') + '</span></li>').join('') + '</ol>' : '');
  }
  // 부문·항목별 실적. 보이는 분기에 값이 없는 행은 빼고, 조정·잔차 행만 남으면(에스엠) 카드를 그리지 않는다('' 반환)
  function segmentsCard(d, c) {
    const seg = obj(hist(c).segments), si = srcIndex(d);
    const keys = Array.from(new Set([].concat(...Object.keys(seg).map(n => Object.keys(obj(seg[n])))))).filter(k => /^\d{4}Q[1-4]$/.test(k) && k >= '2025Q1').sort();
    if (!keys.length) return '';
    const names = Object.keys(seg).filter(n => keys.some(k => isNum(obj(obj(seg[n])[k]).value)));
    if (!names.some(n => segGroup(n) !== 'adj')) return '';
    const ids = Array.from(new Set([].concat(...names.map(n => Object.values(obj(seg[n])).map(r => si.key(obj(r).source_id)))).filter(Boolean)));
    const body = SEG_GROUPS.map(g => {
      const ns = names.filter(n => segGroup(n) === g[0]);
      return ns.length ? '<tr class="grp"><td class="l" colspan="' + (keys.length + 1) + '">' + esc(g[1]) + '</td></tr>' + ns.map(n => '<tr><td class="l">' + segLabel(n) + '</td>' + keys.map(k => td(obj(obj(seg[n])[k]).value, 1)).join('') + '</tr>').join('') : '';
    }).join('');
    const weak = names.some(n => !segmentNames[n]);
    return tw('부문·항목별 실적 표', '<table class="wide"><thead><tr><th class="l">항목</th>' + keys.map(k => '<th>' + esc(k) + '</th>').join('') + '</tr></thead><tbody>' + body + '</tbody></table>') +
      '<p class="dim small">단위 십억원. 커버리지 레인이 회사 IR 자료·DART 공시에서 수집한 보고 실적이며 잠정치와 기간 차감 계산값을 포함할 수 있습니다.' +
      (weak ? ' "키 해석"은 원문 계정명이 입력 자료에 없어 커버리지 레인의 키 이름을 옮긴 것이라 원문 명칭을 함께 둡니다.' : '') + (ids.length ? ' 출처: ' + ids.map(id => sourceItem(si.get(id), c, d)).join(' / ') : '') + '</p>';
  }
  function vintageConsensusCard(d, c, st) {
    const cs = obj(model(c).consensus_at_vintage), cols = arr(cs.columns).map(obj), stats = obj(cs.stats), u = obj(cs.unit);
    if (!cols.length) return '<p class="dim">워크북 컨센 시트 없음</p>';
    const thousand = u.monetary === 'KRW thousand', perShare = x => /목표주가|EPS/.test(str(x.item));
    const conv = (x, v) => !isNum(v) ? null : (perShare(x) || !thousand) ? v : v / 1e6;
    const unitOf = x => perShare(x) ? '원' : thousand ? '십억원' : '원자료 단위';
    const period = p => isNum(p) && /^\d{6}$/.test(String(p)) ? String(p).slice(0, 4) + '.' + String(p).slice(4) : (p == null ? '—' : String(p));
    const ks = ['mean', 'high', 'median', 'low'], has = x => ks.some(k => isNum(obj(stats[k])[String(x.col)]));
    const rows = cols.filter(has), annual = rows.filter(x => x.period == null || /AS$/.test(String(x.period))), quarterly = rows.filter(x => annual.indexOf(x) < 0);
    const table = (list, label) => tw(label, '<table class="wide"><thead><tr><th class="l">항목</th><th class="l">기간</th><th class="l">단위</th><th>평균</th><th>최고</th><th>중앙</th><th>최저</th></tr></thead><tbody>' +
      list.map(x => '<tr><td class="l">' + esc(x.item) + '</td><td class="l">' + esc(period(x.period)) + '</td><td class="l">' + unitOf(x) + '</td>' + ks.map(k => td(conv(x, obj(stats[k])[String(x.col)]), perShare(x) ? 0 : 1)).join('') + '</tr>').join('') + '</tbody></table>');
    const unitTxt = thousand ? '금액 항목은 원자료 단위가 천원(KRW thousand)이라 ÷1,000,000 해서 십억원으로 표시' : '금액 항목은 원자료 단위 그대로';
    let h = (cs.source ? '<p class="small">' + esc(cs.source) + '</p>' : '') + '<p class="dim small">' + esc([cs.as_of_note, cs.consensus_date].filter(Boolean).join(' · ')) + (isNum(cs.house_count) ? ' · 증권사 ' + cs.house_count + '곳' : '') + ' · ' + unitTxt + ', 목표주가·EPS는 ' + esc(u.per_share === 'KRW' ? '원' : (u.per_share || '원')) + '. 증권사별 값은 공개하지 않습니다.</p>';
    if (annual.length) h += table(annual, '워크북 컨센 연간·목표주가');
    if (quarterly.length) h += det(st, 'vintage-q', false, '분기 항목 ' + quarterly.length + '개', table(quarterly, '워크북 컨센 분기'));
    return h;
  }

  // ── 재무 세부 ──
  function netDebtDetails(c, st) {
    const nd = hist(c).net_debt;
    if (!nd || typeof nd !== 'object') return '<p class="dim small">재무상태표 순차입금 자료 없음</p>';
    const items = arr(nd.items).map(obj), vnd = obj(obj(val(c).inputs).net_debt);
    // 리스부채 행이 없으면 리스 0·리스 포함 순차입금 대신 엔진의 사유(lease_note)를 보인다
    const noLeaseRow = items.length > 0 && !items.some(x => x.bucket === 'leases') && !(isNum(nd.lease_liabilities_bn) && nd.lease_liabilities_bn !== 0);
    const leaseNote = str(nd.lease_note) || str(vnd.lease_note) || (noLeaseRow ? '재무상태표에 리스부채 별도 행 없음 — 리스 포함 순차입금을 표시하지 않음' : '');
    const it = items.length ? tw('순차입금 구성 행', '<table><thead><tr><th class="l">계정(DART 원문)</th><th class="l">구분</th><th>십억원</th></tr></thead><tbody>' + items.map(x => '<tr><td class="l">' + esc(x.account_nm) + '</td><td class="l">' + esc(bucketNames[x.bucket] || '기타') + '</td>' + td(x.value, 1) + '</tr>').join('') + '</tbody></table>') : '';
    const sum = kv([['차입금·사채(리스 제외)', fx(nd.borrowings_bn, 1)], leaseNote ? ['리스부채 · 리스 포함 순차입금', '', leaseNote] : ['리스부채', fx(nd.lease_liabilities_bn, 1)], ['현금및현금성자산', fx(nd.cash_bn, 1)], ['단기금융상품', fx(nd.short_term_financial_bn, 1)], ['기타유동금융자산', fx(nd.other_current_financial_bn, 1)],
      ['순차입금(기본 정의)', '<b>' + fx(nd.net_debt_bn, 1) + '</b>'], ['기타유동금융자산 미차감', fx(nd.net_debt_ex_other_financial_bn, 1)], leaseNote ? null : ['리스부채 포함', fx(nd.net_debt_incl_lease_bn, 1)]]);
    return det(st, 'netdebt', false, '순차입금 내역 (' + esc(nd.label || '') + ' · 십억원)', sum + it + '<p class="small">' + esc(nd.basis) + (nd.rcept_no ? ' · ' + dartLink(nd.rcept_no, 'DART 공시') : '') + '</p>');
  }
  function ebitdaDetails(c, st) {
    const a = obj(hist(c).annual), eb = obj(a.ebitda), dep = obj(a.depreciation), am = obj(a.amortisation);
    const ir = obj(obj(hist(c).quarterly).ebitda_company_ir), irk = Object.keys(ir).filter(k => isNum(obj(ir[k]).value)).sort();
    const ks = Array.from(new Set(Object.keys(eb).concat(Object.keys(dep), Object.keys(am)))).sort();
    if (!ks.length && !irk.length) return '<p class="dim small">EBITDA·D&amp;A 이력 없음</p>';
    const label = k => /^\d{4}$/.test(k) ? k + 'A' : /^\d{4}H1$/.test(k) ? k.slice(0, 4) + ' 상반기' : /^TTM_/.test(k) ? '최근 4개 분기(~' + k.slice(4) + ')' : k;
    const rows = ks.map(k => {
      const e = obj(eb[k]), dp = obj(dep[k]), mm = obj(am[k]), op = isNum(e.operating_profit) ? e.operating_profit : hv(c, 'operating_profit', k);
      const srcName = histSourceName(e.source || dp.source || mm.source), docs = Array.from(new Set([e.source_doc, dp.source_doc, mm.source_doc].filter(Boolean)));
      const extra = [dp.incl_rou ? '감가상각비는 사용권자산 상각 포함' : '', isNum(dp.dart_cf_value) ? 'DART 현금흐름표 감가상각비 ' + fx(dp.dart_cf_value, 1) : '', isNum(e.da_verified_ebitda) ? '주석 집계 EBITDA ' + fx(e.da_verified_ebitda, 1) : ''].filter(Boolean);
      return '<tr><td class="l">' + esc(label(k)) + '</td>' + td(op, 1) + td(dp.value, 1) + td(mm.value, 1) + td(e.value, 1) + '<td class="l basis">' + esc(srcName) + docs.map(x => '<br>' + rcptHtml(x)).join('') + (extra.length ? '<br>' + esc(extra.join(' · ')) : '') + '</td></tr>';
    }).join('');
    let body = '';
    // 같은 'EBITDA'라도 정의가 둘이다: 영업이익 + DART 주석 D&A(연간 표)와 회사 IR 자료의 EBITDA(분기). 이름과 정의를 나눠 보이고 섞지 않는다
    if (ks.length) body += tw('EBITDA와 감가상각 이력', '<table class="wide"><thead><tr><th class="l">기간</th><th>영업이익</th><th>감가상각비</th><th>무형자산상각비</th><th>EBITDA(영업이익 + D&amp;A)</th><th class="l">출처</th></tr></thead><tbody>' + rows + '</tbody></table>') +
      '<p class="dim small">EBITDA(영업이익 + D&amp;A) = 영업이익 + 감가상각비(사용권자산 포함) + 무형자산상각비. D&amp;A는 DART 연결주석 실측이고, 출처가 워크북 내 벤더 실적인 연도는 벤더 값 그대로(정의 확인 안 됨). 회사 IR 자료가 발표하는 EBITDA와는 정의가 다릅니다.</p>';
    if (irk.length) {
      const defs = Array.from(new Set(irk.map(k => str(obj(ir[k]).definition)).filter(Boolean)));
      body += '<h3>회사 IR 기준 EBITDA (분기, 십억원)</h3>' + tw('회사 IR 기준 EBITDA', '<table><thead><tr><th class="l">분기</th><th>회사 IR EBITDA</th><th class="l">출처</th></tr></thead><tbody>' +
        irk.map(k => { const r = obj(ir[k]); return '<tr><td class="l">' + esc(k) + '</td>' + td(r.value, 1) + '<td class="l">' + esc(qSourceName(r)) + '</td></tr>'; }).join('') + '</tbody></table>') +
        '<p class="dim small">정의(회사 IR): ' + (defs.length ? defs.map(esc).join(' / ') : '회사 IR 자료 표기 그대로') + ' — 위 EBITDA(영업이익 + D&amp;A)와 더하거나 비교하지 않습니다.</p>';
    }
    return det(st, 'ebitda', false, 'EBITDA·D&amp;A 이력 (출처 포함, 십억원)', body);
  }
  // 공개본이 싣는 연간 현금흐름·손익 세부와 분기 세전이익·법인세·EPS·지배지분. 데이터에 있는 행만 그린다.
  // 총차입금은 2020-2022 워크북 벤더 정의와 DART(리스 제외) 정의가 달라, 엔진이 둘로 나눠 실었을 때만 두 행으로 보인다
  const FIN_A = [['gross_profit', '매출총이익'], ['sga', '판매비와관리비'], ['pretax_income', '법인세비용차감전순이익'], ['income_tax', '법인세비용'], ['cfo', '영업활동 현금흐름'], ['cfi', '투자활동 현금흐름'], ['cff', '재무활동 현금흐름'], ['capex', '유형자산 취득(CAPEX)'], ['dividends_paid', '배당금 지급']];
  const FIN_Q = [['pretax_income', '법인세비용차감전순이익', 1], ['income_tax', '법인세비용', 1], ['eps_basic', 'EPS(원, 기본)', 0], ['controlling_equity', '지배주주지분', 1]];
  function finDetails(c, st) {
    const A = obj(hist(c).annual), Q = obj(hist(c).quarterly);
    const rowsA = FIN_A.concat(A.total_borrowings_vendor ? [['total_borrowings_vendor', '총차입금(워크북 벤더 정의)'], ['total_borrowings', '차입금·사채(DART, 리스 제외)']] : []);
    const has = (m, re) => Object.keys(obj(m)).some(k => re.test(k) && isNum(obj(obj(m)[k]).value));
    const la = rowsA.filter(r => has(A[r[0]], /^\d{4}$/)), lq = FIN_Q.filter(r => has(Q[r[0]], /^\d{4}Q[1-4]$/));
    if (!la.length && !lq.length) return '';
    const yrs = Array.from(new Set([].concat(...la.map(r => Object.keys(obj(A[r[0]])))))).filter(k => /^\d{4}$/.test(k)).sort();
    const qs = Array.from(new Set([].concat(...lq.map(r => Object.keys(obj(Q[r[0]])))))).filter(k => /^\d{4}Q[1-4]$/.test(k)).sort().slice(-8);
    const cell = (m, k, dd) => { const r = obj(obj(m)[k]); return isNum(r.value) ? td(r.value, dd) : '<td>—</td>'; };
    const srcs = Array.from(new Set([].concat(...la.map(r => yrs.map(y => histSourceName(obj(obj(A[r[0]])[y]).source))), ...lq.map(r => qs.map(k => histSourceName(obj(obj(Q[r[0]])[k]).source)))).filter(Boolean)));
    let h = '';
    if (la.length) h += tw('연간 현금흐름·손익 세부', '<table class="wide"><thead><tr><th class="l">십억원</th>' + yrs.map(y => '<th>' + esc(y) + 'A</th>').join('') + '</tr></thead><tbody>' + la.map(r => '<tr><td class="l">' + esc(r[1]) + '</td>' + yrs.map(y => cell(A[r[0]], y, 1)).join('') + '</tr>').join('') + '</tbody></table>');
    if (lq.length) h += '<h3>분기 세부</h3>' + tw('분기 세전이익·법인세·EPS', '<table class="wide"><thead><tr><th class="l">분기</th>' + lq.map(r => '<th>' + esc(r[1]) + '</th>').join('') + '</tr></thead><tbody>' + qs.map(k => '<tr><td class="l">' + esc(k) + '</td>' + lq.map(r => cell(Q[r[0]], k, r[2])).join('') + '</tr>').join('') + '</tbody></table>');
    h += '<p class="dim small">금액 십억원(EPS는 원).' + (la.some(r => r[0] === 'capex' || r[0] === 'dividends_paid') ? ' CAPEX·배당금 지급은 현금 유출이라 음수로 둡니다.' : '') + (srcs.length ? ' 출처: ' + esc(srcs.join(' · ')) : '') + '</p>';
    return det(st, 'fin', false, '현금흐름·세전이익·법인세 (십억원)', h);
  }

  // ── 출처 · 방법 ──
  function sourceIds(c, si) {
    const q = obj(hist(c).quarterly), seg = obj(hist(c).segments), ids = arr(c.coverage_source_ids).slice();
    Object.keys(q).forEach(m => Object.values(obj(q[m])).forEach(r => ids.push(obj(r).coverage_source_id)));
    Object.keys(seg).forEach(m => Object.values(obj(seg[m])).forEach(r => ids.push(obj(r).source_id)));
    arr(hist(c).drivers_actual).forEach(r => arr(obj(r).source_ids).forEach(id => ids.push(id)));
    arr(obj(rf(c).source).driver_source_ids).forEach(id => ids.push(id));
    return Array.from(new Set(ids.map(si.key).filter(Boolean)));
  }
  function lineageCard(d, c) {
    const h = hist(c), dp = obj(h.dart_periods), mk = obj(h.market), sh = obj(h.shares), m = model(c), si = srcIndex(d), cn = c.consensus_now ? obj(c.consensus_now) : null, lic = obj(mk.license), hz = obj(m.horizon), op = obj(m.op_row), ex = obj(op.excluded_years), exk = Object.keys(ex).sort();
    const tplM = m.status === 'template', pageUrl = safeUrl(mk.page_url);
    let s = '<h3>Open DART 정기보고서(연결)</h3><p class="small">' + (Object.keys(dp).map(k => { const r = obj(dp[k]); return r.rcept_no ? dartLink(r.rcept_no, k) : esc(k) + '(없음)'; }).join(' · ') || '—') + '</p>';
    s += '<h3>시세 · 주식수</h3><ul class="plain"><li>현재가: ' + esc(priceSourceName(mk.price_source)) + ' ' + won(mk.price_krw) + (mk.price_as_of ? ' (' + esc(mk.price_as_of) + ')' : '') + (obj(d).market_retrieved_at ? ' · 수집 ' + esc(str(d.market_retrieved_at).slice(0, 10)) : '') + (mk.price_basis ? '<div class="basis">' + esc(mk.price_basis) + '</div>' : '') + '</li>';
    if (isNum(sh.outstanding)) s += '<li>유통주식수(EPS·밸류에이션 기준): DART 주식총수 현황 — 발행 ' + fmt(sh.issued, 0) + '주' + (isNum(sh.treasury) ? ' − 자기주식 ' + fmt(sh.treasury, 0) + '주' : '(자기주식 미기재)') + ' = ' + fmt(sh.outstanding, 0) + '주' + (sh.rcept_no ? ' · ' + dartLink(sh.rcept_no, '공시') : '') + '</li>';
    // 인용문은 원문 페이지(history.market.page_url)가 있으면 링크로 단다
    const cite = mk.citation ? (pageUrl ? '<a href="' + esc(pageUrl) + '" target="_blank" rel="noopener noreferrer">' + esc(mk.citation) + ' ↗</a>' : esc(mk.citation)) : '';
    if (isNum(mk.shares_outstanding)) s += '<li>KRX 발행주식수(자기주식 미차감, 참고): ' + fmt(mk.shares_outstanding, 0) + '주' + (mk.shares_as_of ? ' (' + esc(ymd(mk.shares_as_of)) + ')' : '') + (cite ? ' · ' + cite : '') + (safeUrl(lic.url) ? ' · 라이선스 <a href="' + esc(lic.url) + '" target="_blank" rel="noopener noreferrer">' + esc(lic.name || lic.id || '보기') + '</a>' : '') + '</li>';
    s += '</ul><h3>컨센서스</h3><p class="small">' + (cn ? esc(cn.source || 'FnGuide 집계') + ' · 기준일 ' + esc(cn.as_of || obj(d).consensus_as_of || '—') + (obj(d).consensus_retrieved_at ? ' · 수집 ' + esc(str(d.consensus_retrieved_at).slice(0, 10)) : '') : '컨센서스 자료 없음') + '</p>';
    const ids = sourceIds(c, si);
    if (ids.length) s += '<h3>커버리지 레인 공식 자료</h3><ul class="plain">' + ids.map(id => '<li>' + sourceItem(si.get(id), c, d) + '</li>').join('') + '</ul>';
    // 템플릿 워크북에는 애널리스트 추정이 없으므로 추정 범위·분기 영업이익 대사 문구를 쓰지 않는다
    s += '<h3>워크북</h3><p class="small">' + esc(m.house || obj(d).model_house || '') + (m.analyst ? ' · 워크북 담당자 ' + esc(m.analyst) : (tplM ? ' · 템플릿(애널리스트 추정 미입력)' : '')) + ' · 워크북 기준 ' + esc(m.vintage || obj(d).model_vintage || '—') + (m.model_date ? ' · 워크북 일자 ' + esc(m.model_date) : '') +
      (!tplM && hz.quarterly_through ? ' · 분기 추정 범위 ~' + esc(hz.quarterly_through) : '') + (!tplM && hz.annual_through ? ' · 연간 추정 범위 ~' + esc(hz.annual_through) : '') +
      (!tplM && typeof op.reconciled === 'boolean' ? ' · 분기 영업이익 행 대사 ' + (op.reconciled ? '일치' : '불일치') + (isNum(op.max_abs_diff) ? '(최대 차이 ' + fx(op.max_abs_diff, 3) + '십억원)' : '') : '') +
      (!tplM && exk.length ? ' · 대사에서 뺀 연도: ' + esc(exk.map(k => k + ' ' + str(ex[k])).join('; ')) : '') + '</p>';
    return s;
  }
  function methodCard(d) {
    const m = obj(obj(d).method), names = {history: '실적', roll_forward: '연장', valuation: '밸류에이션', consensus: '컨센서스'};
    return Object.keys(names).filter(k => m[k]).map(k => '<h3>' + names[k] + '</h3><p class="dim small">' + esc(plain(m[k])) + '</p>').join('') || '<p class="dim">방법 설명 없음</p>';
  }

  // ── 페이지 ──
  function renderCompany(data, company, state) {
    const d = obj(data), c = pickCompany(d, company), st = normState(d, Object.assign({}, state, {company: c.id}));
    const qk = quarterKeys(c), v = val(c), tpl = isTemplate(c);
    const asmTitle = isCovDriver(c) ? '연장 가정 · 커버리지 레인 드라이버 추정' : '연장 가정 · 일반 규칙';
    // 빈 카드는 그리지 않는다: 애널리스트 8사의 '모델 드라이버'(행 없음), 환산가 미산정 회사의 규칙·대안 카드, 조정 행뿐인 세그먼트 카드.
    // 템플릿의 점수표는 별도 카드 대신 연장 가정 카드 아래 한 줄
    const altHtml = alternativesCard(c), wbCard = card('워크북 TP 시트(' + vintageYM(d) + ') 활성 블록', workbookCard(d, c, st));
    const drvHtml = driversCard(d, c), segHtml = segmentsCard(d, c), finHtml = finDetails(c, st);
    return titleCard(d, c, st) +
      card('연간 실적 · 워크북 원본 · 앙상블 연장 (' + scenName(st.scenario) + ')', annualTable(d, c, st) + oneOffNotice(c, st)) +
      '<div class="two">' + card('분기 실적' + (qk.length ? ' (' + qk[0] + '~' + qk[qk.length - 1] + ')' : ''), chartBox('q', quarterlyChart(c, CHART_W)) + quarterlyTable(d, c, st)) +
      card('연간 매출: 실적 · 워크북 원본 · 연장 범위', chartBox('a', annualChart(c, CHART_W, st))) + '</div>' +
      (tpl ? card(asmTitle, assumptionsCard(d, c, st) + '<p class="dim small">점수표: ' + TPL_SCORE + '</p>')
        : '<div class="two">' + card(asmTitle, assumptionsCard(d, c, st)) + card('워크북 원본 추정 vs 실적 (예측 오차)', scorecardTable(d, c)) + '</div>') +
      card('현재 컨센서스 vs 앙상블 연장(base)', consensusNowCard(d, c)) +
      valuationCard(d, c, st) +
      (v.status === 'not_valued_rehabilitation' ? '' : card('환산 규칙 (' + (v.scenario || 'base') + ' 기준)', ruleCard(d, c, st))) +
      (altHtml ? '<div class="two">' + card('대안 값', altHtml) + wbCard + '</div>' : wbCard) +
      (drvHtml ? card('드라이버 실적 (최근 8개 분기)', drvHtml) : '') +
      (segHtml ? card('부문·항목별 실적 (회사 공식 자료·DART 공시, 커버리지 레인 수집)', segHtml) : '') +
      card('워크북 컨센 시트 (작성 시점 스냅숏)', vintageConsensusCard(d, c, st)) +
      card('재무 세부: 순차입금 · EBITDA' + (finHtml ? ' · 현금흐름·세전이익' : ''), netDebtDetails(c, st) + ebitdaDetails(c, st) + finHtml) +
      card('출처 · 계보', lineageCard(d, c)) +
      card('방법', methodCard(d));
  }
  // 사이드바 태그: 상승률 대신 상태 라벨(색은 valTone). SOTP 범위는 base 한 값이 아니라 범위 문구를 함께
  function listTag(c) {
    const v = val(c);
    return '<span class="tag ' + valTone(v) + '">' + esc(statusLabel(v)) + (v.status === 'range' && hasValue(v) ? '<br>' + esc(rangeParts(v).join(' · ')) : '') + '</span>';
  }
  function renderApp(data, state) {
    const d = obj(data), st = normState(d, state), cs = arr(d.companies).filter(x => obj(x).id), c = cs.find(x => x.id === st.company) || {};
    const nA = cs.filter(x => model(x).status === 'analyst').length, nT = cs.filter(isTemplate).length;
    const sectors = Object.keys(sectorNames).concat(Array.from(new Set(cs.map(x => x.sector))).filter(s => s && !sectorNames[s])).filter(s => cs.some(x => x.sector === s));
    const secName = s => sectorNames[s] || obj(cs.find(x => x.sector === s)).sector_name || s;
    const list = cs.filter(x => x.sector === st.sector).map(x => '<button type="button" class="company" data-company="' + esc(x.id) + '"' + (x.id === st.company ? ' aria-current="true"' : '') + '><span>' + esc(x.name) + ' <small>' + esc(x.ticker) + (isTemplate(x) ? ' · 템플릿' : '') + '</small></span>' + listTag(x) + '</button>').join('');
    return '<div class="am ' + (st.mode === 'home' ? 'am-home' : 'am-solo') + '">' +
      '<header><div><div class="eyebrow">ENSEMBLE / ANALYST MODELS</div><h1>커버리지 모델 ' + cs.length + '사</h1><p class="dim">앙상블 에이전트가 ' + esc(d.model_house) + ' 워크북 ' + cs.length + '사(' + esc(d.model_vintage) + ')를 출발점으로 최신 실적을 반영하고 2026–2028을 규칙 기반으로 연장한 페이지 · 애널리스트 추정 포함 워크북 ' + nA + '사 · 추정 미입력 템플릿 ' + nT + '사</p></div>' +
      '<div class="asof">기준일 ' + esc(d.as_of) + '<br>DART 수집 ' + esc(str(d.dart_retrieved_at).slice(0, 10)) + ' · 시세 ' + esc(str(d.market_retrieved_at).slice(0, 10)) + '<br>컨센서스 기준일 ' + esc(d.consensus_as_of || '—') + '</div></header>' +
      '<nav class="sectors" aria-label="섹터">' + sectors.map(s => '<button type="button" data-sector="' + esc(s) + '" aria-pressed="' + (st.sector === s) + '">' + esc(secName(s)) + ' <small>' + cs.filter(x => x.sector === s).length + '</small></button>').join('') + '</nav>' +
      '<div class="layout"><aside><nav class="companies" aria-label="회사 목록">' + list + '</nav><div class="notice" style="margin-top:12px">워크북은 ' + esc(d.model_vintage) + ' 시점 ' + esc(d.model_house) + ' 리서치 워크북이며, 연장과 환산 값은 앙상블 에이전트의 규칙 계산입니다. ' + esc(disclaimer(d)) + '</div></aside>' +
      '<section aria-label="' + esc(c.name) + '">' + renderCompany(d, c, st) + '</section></div>' +
      '<p class="foot">숫자는 십억원(별도 표기 제외). 실적 · 워크북 원본 · 앙상블 연장 · 커버리지 레인 · 컨센서스 값은 서로 대체하지 않으며, 미확인 값은 —로 둡니다.</p>' + notice(esc(disclaimer(d)), 'disclaimer') + '</div>';
  }

  const css = `
  .am{--bg:#0b1018;--panel:#131b27;--panel2:#192333;--line:#293447;--line2:#223046;--ink:#e8eef6;--dim:#9aa9bd;--accent:#f2b84b;--on-accent:#1b1400;--ok:#65dec2;--warn:#f2b84b;--bad:#ff8a80;--link:#65dec2;--est:#93a9ff;--model:#cfb3f0;--neg:#ff8a80;--focus:#b6ed7e;--notice:#1a1c26;--notice2:#141d30;--bar:#3f6fd8;--base:#819df8;--op:#f2b84b;--range:#e8eef6;background:var(--bg);color:var(--ink);font:14px/1.55 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',sans-serif;padding:24px;max-width:1440px;margin:0 auto;box-sizing:border-box;overflow-wrap:anywhere}
  .am.am-home{--bg:#0d1117;--panel:#151d23;--panel2:#1b252d;--line:#233038;--line2:#1b242c;--ink:#e6edf3;--dim:#8f99a8;padding:8px 0 0}
  .am *{box-sizing:border-box}.am h1,.am h2,.am h3,.am p{margin:0}.am h1{font-size:28px;letter-spacing:-1px}.am h2{font-size:17px;margin-bottom:10px}.am h3{font-size:13px;color:var(--dim);margin:14px 0 6px}.am a{color:var(--link)}.am .dim{color:var(--dim)}.am .small{font-size:12px;margin-top:6px}.am code{font:12px ui-monospace,Menlo,monospace}.am .eyebrow{font-size:11px;letter-spacing:2px;color:var(--accent);font-weight:700}
  .am header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:20px;flex-wrap:wrap}.am header>div{min-width:0}.am .asof{text-align:right;color:var(--dim);font-size:12px}
  .am button{font:inherit;color:var(--ink);border:1px solid var(--line);background:var(--panel2);border-radius:7px;padding:7px 12px;cursor:pointer}.am button:hover{border-color:var(--dim)}
  .am button[aria-pressed="true"],.am button[aria-current="true"]{color:var(--on-accent);background:var(--accent);border-color:var(--accent);font-weight:700}
  .am button:focus-visible,.am a:focus-visible,.am summary:focus-visible,.am .tablewrap:focus-visible{outline:3px solid var(--focus);outline-offset:2px}
  .am .sectors{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.am .layout{display:grid;grid-template-columns:230px minmax(0,1fr);gap:20px}.am .layout>*{min-width:0}
  .am .companies{display:flex;flex-direction:column;gap:7px}.am .company{padding:10px 12px;text-align:left;display:flex;flex-direction:column;align-items:flex-start;gap:4px;min-width:0}.am .company small{font-size:11px;opacity:.85}
  .am .tag{font-size:11px;line-height:1.35;font-weight:600}.am .tag.ok{color:var(--ok)}.am .tag.warn{color:var(--warn)}.am .tag.bad{color:var(--bad)}.am .company[aria-current="true"] .tag{color:inherit}
  .am .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:16px;min-width:0}
  .am .title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px}.am .title>div{min-width:0}.am .cname{font-size:22px;margin-bottom:4px}.am .cname .dim{font-size:13px;font-weight:400}
  .am .badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.am .badge{display:inline-block;font-size:11px;font-weight:700;border:1px solid var(--line);padding:2px 8px;border-radius:20px;color:var(--dim);line-height:1.5}
  .am .badge.ok{color:var(--ok);border-color:var(--ok)}.am .badge.warn{color:var(--warn);border-color:var(--warn)}.am .badge.bad{color:var(--bad);border-color:var(--bad)}
  .am .controls{display:flex;gap:10px 14px;flex-wrap:wrap;align-items:center}.am .seg{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.am .seg>span{font-size:12px;color:var(--dim)}.am .covlink{font-size:13px}
  .am .kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:12px}.am .kpi{background:var(--bg);border:1px solid var(--line);padding:10px 12px;border-radius:8px;min-width:0}
  .am .kpi b{display:block;font-size:19px;font-variant-numeric:tabular-nums}.am .kpi b .u{font-size:11px;font-weight:400;color:var(--dim);margin-left:3px}.am .kpi small,.am .kpi .sub{color:var(--dim);font-size:11px;display:block}.am .kpi .kb{margin:4px 0}.am .kpi .tpv{font-size:19px}
  .am .kpi .rngv{list-style:none;margin:4px 0;padding:0;font-size:12px;font-weight:700;line-height:1.45;font-variant-numeric:tabular-nums}.am .valhead .rngline{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
  .am .tablewrap{overflow-x:auto;max-width:100%;margin-top:6px}.am table{width:100%;border-collapse:collapse;font-size:12px}.am .tablewrap>table.wide{min-width:640px}.am caption{text-align:left;color:var(--dim);font-size:12px;padding:0 0 6px}
  .am th{text-align:right;color:var(--dim);font-weight:500;padding:7px 8px;border-bottom:1px solid var(--line);white-space:nowrap}.am th:first-child,.am td:first-child,.am th.l,.am td.l{text-align:left}
  .am td{padding:6px 8px;border-bottom:1px solid var(--line2);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.am td.l{white-space:normal}.am td.dim{color:var(--dim)}
  .am tr.sub td{font-size:11px}.am tr.sub td.l{color:var(--dim)}.am tr.hl td{background:var(--panel2)}.am tr.tot td{font-weight:700}.am tr.grp td{color:var(--dim);font-size:11px;font-weight:700;padding-top:10px}.am td.hl0{font-weight:800;background:var(--panel2)}
  .am td.est,.am th.est{color:var(--est)}.am td.model{color:var(--model)}.am td.neg{color:var(--neg)}
  .am table.kv td.k{color:var(--dim);width:34%}.am .basis{font-size:11px;color:var(--dim);margin-top:2px}.am td.basis{min-width:200px}
  .am .lang{display:inline-block;font-size:10px;line-height:1.4;border:1px solid var(--line);border-radius:4px;padding:0 4px;margin-right:4px;color:var(--dim)}
  .am .chartbox{width:100%;min-width:0}.am .chart{display:block;width:100%;height:auto}.am .chart text{font-size:11px;fill:var(--dim);font-family:inherit}
  .am .chart .grid{stroke:var(--line)}.am .chart .bar{fill:var(--bar)}.am .chart .barE{fill:var(--base);opacity:.6}.am .chart .opl{fill:none;stroke:var(--op);stroke-width:2.5}.am .chart .opd{fill:var(--op)}
  .am .chart .zero{stroke:var(--op);stroke-dasharray:4 3}.am .chart .zero-t{fill:var(--op)}.am .chart .mdl{fill:none;stroke:var(--model);stroke-width:2}.am .chart .rng line{stroke:var(--range);stroke-width:2}
  .am .legend{display:flex;gap:6px 12px;flex-wrap:wrap;font-size:11px;color:var(--dim);margin-top:6px}.am .sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px}
  .am .sw.bar{background:var(--bar)}.am .sw.barE{background:var(--base)}.am .sw.op{background:var(--op)}.am .sw.est{background:var(--est)}.am .sw.model{background:var(--model)}
  .am .sw.ring{background:none;border:2px solid var(--model);border-radius:50%}.am .sw.rng{width:2px;background:var(--range)}.am .sw.zero{height:0;border-top:2px dashed var(--op);border-radius:0;vertical-align:middle}
  .am .two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.am .two>*{min-width:0}
  .am .notice{border-left:3px solid var(--warn);padding:8px 12px;color:var(--dim);font-size:12px;margin-top:10px;background:var(--notice)}.am .notice.blue{border-color:var(--est);background:var(--notice2)}.am .notice.bad{border-color:var(--bad)}.am .notice ul{margin:4px 0 0;padding-left:18px}.am .notice b{color:var(--ink)}
  .am details{border-top:1px solid var(--line);padding:8px 0;margin-top:8px}.am summary{cursor:pointer}.am .details-body{padding:8px 0 0;font-size:12px;color:var(--dim)}.am .details-body table{color:var(--ink)}
  .am .valhead{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;margin:4px 0 6px}.am .tpv{font-size:26px;font-weight:800;color:var(--ink);font-variant-numeric:tabular-nums}.am .formula{font-size:13px;margin:4px 0}
  .am ul.plain,.am ol.plain{margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--dim)}.am .foot{font-size:12px;color:var(--dim);margin:18px 0 0}.am .empty{text-align:center;padding:40px 10px;color:var(--dim);border:1px dashed var(--line);border-radius:8px}
  @media(max-width:900px){.am{padding:16px}.am .layout{grid-template-columns:minmax(0,1fr)}.am .companies{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.am .two{grid-template-columns:minmax(0,1fr)}.am .kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
  @media(max-width:480px){.am{padding:12px 10px}.am h1{font-size:22px}.am .kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.am .card{padding:14px 12px}.am header{display:block}.am .asof{text-align:left;margin-top:8px}.am .tpv{font-size:22px}.am td.basis{min-width:160px}}
  @media(prefers-color-scheme:light){.am.am-solo{--bg:#f3f6fa;--panel:#ffffff;--panel2:#eef2f7;--line:#d3dbe7;--line2:#e4eaf1;--ink:#152235;--dim:#56677c;--accent:#9a5d0b;--on-accent:#ffffff;--ok:#08745f;--warn:#985c0a;--bad:#b3261e;--link:#08745f;--est:#3550b8;--model:#6a3db8;--neg:#b3261e;--focus:#3550b8;--notice:#fff6e5;--notice2:#ebf0ff;--bar:#3b6fd8;--base:#8ea4ee;--op:#a8650c;--range:#152235}}
  `;

  // ── DOM 연결 ──
  function mount() {
    const standalone = document.getElementById('models-standalone');
    const ownScript = document.currentScript;
    const assetRoot = ownScript && ownScript.src ? new URL('.', ownScript.src) : new URL('.', location.href);
    let data = null, root = null, tabButton = null, state = {open: {}};
    const cssEsc = s => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
    // 홈 탭 버튼의 선택 상태를 보조기기에도 알린다(클래스 'on'과 같은 값)
    const syncPressed = () => document.querySelectorAll('.tabbtn').forEach(b => b.setAttribute('aria-pressed', String(b.classList.contains('on'))));
    function activate() {
      if (!tabButton) return;
      document.querySelectorAll('.tabbtn,.pane').forEach(e => e.classList.remove('on'));
      tabButton.classList.add('on'); root.classList.add('on');
      syncPressed();
      drawCharts(false);
    }
    function drawCharts(force) {
      if (!data || !root) return;
      const c = arr(data.companies).find(x => obj(x).id === state.company);
      if (!c) return;
      root.querySelectorAll('[data-chart]').forEach(el => {
        const w = el.clientWidth;
        if (!w || (!force && el.dataset.w === String(w))) return;
        el.dataset.w = String(w);
        el.innerHTML = el.dataset.chart === 'q' ? quarterlyChart(c, w) : annualChart(c, w, state);
      });
    }
    function focusKey(el) {
      const ds = el.dataset || {};
      for (const k of ['company', 'sector', 'scenario']) if (ds[k] != null) return '[data-' + k + '="' + cssEsc(ds[k]) + '"]';
      const dt = el.tagName === 'SUMMARY' && el.parentElement && el.parentElement.dataset ? el.parentElement.dataset.dkey : null;
      return dt ? 'details[data-dkey="' + cssEsc(dt) + '"] > summary' : null;
    }
    function render() {
      const a = document.activeElement, fk = (a && a !== document.body && root.contains(a)) ? focusKey(a) : null;
      root.innerHTML = renderApp(data, state);
      drawCharts(true);
      const el = fk ? root.querySelector(fk) : null;
      if (el && el.focus) el.focus({preventScroll: true});
    }
    function syncHash() {
      const h = nextHash(location.hash, state);
      if (h == null || h === location.hash) return; // 다른 탭이 쓰는 해시는 그대로 둔다
      try { history.replaceState(history.state, '', h); } catch (err) { /* file:// 등에서 막히면 해시 갱신만 건너뛴다 */ }
    }
    function fromHash() {
      const h = parseHash(location.hash);
      if (!h || !arr(data.companies).some(x => obj(x).id === h.company)) return false;
      state.company = h.company; state.scenario = h.scenario || 'base';
      return true;
    }
    function wire() {
      root.addEventListener('click', e => {
        if (!data) return;
        const el = e.target && e.target.closest ? e.target.closest('[data-company],[data-sector],[data-scenario],[data-cov]') : null;
        if (!el || !root.contains(el)) return;
        const ds = el.dataset;
        if (ds.cov != null) {
          const b = document.querySelector('.tabbtn[data-tab="coverage"]');
          if (b) { e.preventDefault(); b.click(); b.focus(); }
          return;
        }
        if (ds.sector != null) {
          const first = arr(data.companies).find(x => obj(x).sector === ds.sector);
          if (ds.sector === state.sector || !first) return;
          state.sector = ds.sector; state.company = first.id;
        } else if (ds.company != null) {
          if (ds.company === state.company) return;
          state.company = ds.company;
        } else {
          if (ds.scenario === state.scenario || SCEN.indexOf(ds.scenario) < 0) return;
          state.scenario = ds.scenario;
        }
        state = normState(data, state);
        syncHash(); render();
      });
      root.addEventListener('toggle', e => { const t = e.target; if (t && t.dataset && t.dataset.dkey) state.open[t.dataset.dkey] = t.open; }, true);
      window.addEventListener('hashchange', () => { if (!data || !fromHash()) return; state = normState(data, state); render(); activate(); });
      if (window.ResizeObserver) new ResizeObserver(() => drawCharts(false)).observe(root);
      else window.addEventListener('resize', () => drawCharts(false));
      if (tabButton && tabButton.parentElement) {
        // 홈 탭 줄의 클릭(버블 단계 — 각 버튼의 핸들러가 'on'을 바꾼 뒤): 선택 상태를 aria로 맞추고,
        // 다른 홈 탭으로 옮기면 모델 해시를 지운다(새로고침·주소 공유 때 모델 탭이 다시 열리지 않도록). 다른 탭이 쓰는 해시는 건드리지 않는다
        tabButton.parentElement.addEventListener('click', e => {
          const b = e.target && e.target.closest ? e.target.closest('.tabbtn') : null;
          if (!b) return;
          syncPressed();
          if (b === tabButton || !parseHash(location.hash)) return;
          try { history.replaceState(history.state, '', location.pathname + location.search); } catch (err) { /* file:// 등에서 막히면 건너뛴다 */ }
        });
      }
    }
    async function init() {
      if (!document.querySelector('style[data-am-style]')) { const style = document.createElement('style'); style.setAttribute('data-am-style', '1'); style.textContent = css; document.head.appendChild(style); }
      let mode = 'standalone';
      if (standalone) root = standalone;
      else {
        const tabs = document.querySelector('.tabs'), firstPane = document.querySelector('.pane');
        if (!tabs || !firstPane || document.getElementById('pane-models')) return;
        // 회사 수는 데이터를 읽은 뒤 붙인다(하드코딩하지 않음)
        tabButton = document.createElement('button'); tabButton.type = 'button'; tabButton.className = 'tabbtn'; tabButton.dataset.tab = 'models'; tabButton.textContent = '📐 커버리지 모델'; tabs.appendChild(tabButton);
        root = document.createElement('div'); root.id = 'pane-models'; root.className = 'pane'; firstPane.parentElement.insertBefore(root, firstPane.nextSibling);
        // 홈 탭과 같은 진입 동작: 패널 전환 후 맨 위로 스크롤, 데이터가 있으면 현재 회사 해시를 쓴다
        tabButton.addEventListener('click', () => { activate(); window.scrollTo(0, 0); if (data) syncHash(); });
        mode = 'home';
      }
      state = {mode, coverageHref: mode === 'home' ? new URL('../coverage/index.html', assetRoot).href : '../coverage/index.html', open: {}, scenario: 'base'};
      root.innerHTML = '<div class="am ' + (mode === 'home' ? 'am-home' : 'am-solo') + '"><p>모델 데이터를 불러오는 중입니다.</p></div>';
      wire();
      if (tabButton) syncPressed();
      try {
        const embedded = document.getElementById('models-data');
        let loaded;
        if (embedded) loaded = JSON.parse(embedded.textContent);
        else { const response = await fetch(new URL('data.json', assetRoot), {cache: 'no-cache'}); if (!response.ok) throw new Error('HTTP ' + response.status); loaded = await response.json(); }
        if (obj(loaded).schema_version !== SCHEMA || !arr(obj(loaded).companies).length) throw new Error('지원하지 않는 데이터 계약: ' + (obj(loaded).schema_version || '버전 표기 없음') + ' (필요: ' + SCHEMA + ')');
        data = loaded;
        if (tabButton) tabButton.textContent = '📐 커버리지 모델 ' + arr(data.companies).length + '사';
        const hit = fromHash();
        state = normState(data, state);
        render();
        if (hit) activate();
      } catch (error) {
        data = null;
        root.innerHTML = '<div class="am ' + (mode === 'home' ? 'am-home' : 'am-solo') + '"><div class="card"><h2>데이터를 표시할 수 없습니다</h2><p>' + esc(error && error.message) + '</p><p class="dim">기존 탭은 그대로 사용할 수 있습니다.</p></div></div>';
      }
    }
    init();
  }

  const api = {SCHEMA, renderApp, renderCompany, quarterlyChart, annualChart, normState, parseHash, buildHash, nextHash, valTone, statusLabel, cleanTitle, sourceLabel, rangeParts};
  if (typeof module !== 'undefined' && module && module.exports) module.exports = api;
  if (typeof document !== 'undefined' && typeof window !== 'undefined') mount();
})();
