#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
U02_CALENDAR — Ensemble 홈 '발표 캘린더' 섹션 빌더 (기업실적 + IR 일정만, 경제지표 제외)

원칙(팔랑크스 불변규칙 2 계승): HTML 조각은 이 빌더가 재생성한다. u02_calendar.html 직접 수정 금지.

데이터 소스(전부 실물, 창작 금지):
  ~/phalanx/jem_data/earnings_cal.json            — US/JP/GLOBAL 발표일 (nasdaq·ir 스크랩, 장전/장마감·EPS 컨센)
  ~/phalanx/jem_data/ecal_us_eu.json              — US/EU/HK 16사 IR 페이지 기반 next_date (confirmed/est)
  ~/phalanx/jem_data/ecal_kr.json                 — KR 803사 DART 접수패턴 예측 + 법정기한 대리치
  ~/phalanx/jem_data/ecal_tw.json                 — TW 전 상장사 證交法 §36 법정기한 + 월매출 공고 기한
  ~/phalanx/jem_data/ecal/ecal_jp.json            — JP kabuyoho 캘린더 (2026-08-12~09-09 창)
  ~/Downloads/integ_wave/bundle/ensemble/registry/_merged.json — 앙상블 커버 31사

사용:
  python3 u02_calendar_build.py            → HTML 조각·단독 미리보기·감사 JSON
  from u02_calendar_build import build_calendar_section
  html_fragment = build_calendar_section()  # ensemble_page_build.py 에서 호출
"""
import json
import re
import html as _html
import pathlib
import collections
import hashlib
import os

HOME = pathlib.Path.home()
JEM = HOME / "phalanx" / "jem_data"
STUDIO_REG_PATH = HOME / "Downloads" / "integ_wave" / "bundle" / "ensemble" / "registry" / "_merged.json"
MINI_REG_PATH = HOME / "ensemble" / "registry" / "_merged.json"
REG_PATH = pathlib.Path(os.environ["ENSEMBLE_REGISTRY_PATH"]) if os.environ.get("ENSEMBLE_REGISTRY_PATH") else (
    STUDIO_REG_PATH if STUDIO_REG_PATH.is_file() else MINI_REG_PATH
)
OUT = pathlib.Path(__file__).resolve().parent

CAP = 30  # 비커버(그외) 일별 상세 목록 상한 — 초과분은 '외 N건'

SEC_COLOR = {"rack": "#5aa9ff", "optics": "#c9a24a", "jpeq": "#e2574f", "power": "#2fae66"}
SEC_LABEL = {"rack": "랙·서버", "optics": "광·부품", "jpeq": "JP 장비·소재", "power": "전력·신재생"}

# 칩 표시명 (id 그대로 쓰기 애매한 것만 오버라이드)
CHIP_NAME = {
    "MITSUIKZ2": "미쓰이Kz", "FURUKAWA2": "후루카와", "CANADIAN": "CSIQ", "JINKO": "JKS",
    "ADTEST": "ADVANTEST",
}


# ---------------------------------------------------------------- 데이터 로드
def _load(p):
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def _sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_registry(path=REG_PATH):
    reg = _load(path)
    companies = {}
    by_us, by_jp, by_tw = {}, {}, {}
    for c in reg["companies"]:
        cid = c["id"]
        tk = c.get("ticker", "")
        sym, _, mkt_sfx = tk.partition(" ")
        mkt = {"US": "US", "JP": "JP", "TT": "TW", "CH": "CN"}.get(mkt_sfx.strip(), "US")
        market = c.get("market") or {}
        companies[cid] = {
            "id": cid, "nm": c.get("name", cid), "sym": sym, "mkt": mkt,
            "sec": c.get("sector", ""), "report": market.get("report", ""),
            "fq": market.get("fq", ""), "consensus": market.get("consensus"),
        }
        if mkt == "US":
            by_us[sym] = cid
        elif mkt == "JP":
            by_jp[sym] = cid
        elif mkt == "TW":
            by_tw[sym] = cid
    return reg, companies, by_us, by_jp, by_tw


# ------------------------------------------------------- registry report 파싱
_DATE_RE = re.compile(r"(20\d{2}-\d{2}-\d{2})")


def parse_report(s):
    """market.report 문자열 → (date, st, tm) 또는 None. st: 'c'확정 / 'e'추정 / ''미표기"""
    if not s:
        return None
    m = _DATE_RE.search(s)
    if not m:
        return None
    est = bool(re.search(r"추정|잠정", s))
    conf = (not est) and bool(re.search(r"확정|공시", s))
    tm = ""
    if "장전" in s or "개장전" in s or "개장 전" in s:
        tm = "장전"
    elif "장후" in s or "장마감" in s:
        tm = "장후"
    return m.group(1), ("c" if conf else "e" if est else ""), tm


# ---------------------------------------------------------------- 이벤트 수집
def collect(jem=JEM, reg_path=REG_PATH):
    reg, companies, by_us, by_jp, by_tw = load_registry(reg_path)

    input_paths = {
        "earnings_cal": jem / "earnings_cal.json",
        "ecal_us_eu": jem / "ecal_us_eu.json",
        "ecal_kr": jem / "ecal_kr.json",
        "ecal_tw": jem / "ecal_tw.json",
        "ecal_jp": jem / "ecal" / "ecal_jp.json",
        "registry": pathlib.Path(reg_path),
    }
    ec = _load(input_paths["earnings_cal"])
    us_eu = _load(input_paths["ecal_us_eu"])
    kr = _load(input_paths["ecal_kr"])
    tw = _load(input_paths["ecal_tw"])
    jp = _load(input_paths["ecal_jp"])

    cov = {}  # (id, date) -> ev dict
    oth = collections.defaultdict(lambda: collections.defaultdict(lambda: {"n": 0, "i": []}))

    def add_cov(cid, date, kind="E", tm="", fq="", st="", cons="", src=""):
        key = (cid, date)
        c = companies[cid]
        ev = cov.get(key)
        if ev is None:
            ev = cov[key] = {
                "d": date, "id": cid, "tk": CHIP_NAME.get(cid, cid), "nm": c["nm"],
                "sec": c["sec"], "mkt": c["mkt"], "kind": kind, "tm": "", "fq": "",
                "st": "", "cons": "", "src": [],
            }
        if tm and not ev["tm"]:
            ev["tm"] = tm
        if fq and not ev["fq"]:
            ev["fq"] = fq
        if cons and not ev["cons"]:
            ev["cons"] = cons
        if st == "c":
            ev["st"] = "c"
        elif st == "e" and ev["st"] != "c":
            ev["st"] = "e"
        if src and src not in ev["src"]:
            ev["src"].append(src)

    def add_oth(date, mkt, tk, nm, tm="", cons=0, st=""):
        cell = oth[date][mkt]
        cell["n"] += 1
        cell["i"].append([tk, nm, tm, 1 if cons else 0, st])

    # 1) earnings_cal.json — US/JP/GLOBAL 실측 스크랩
    ec_jp_seen = set()
    for e in ec.get("entries", []):
        mkt = e.get("market", "")
        date, tkr = e.get("date", ""), e.get("ticker", "")
        if not date:
            continue
        tm = {"장마감": "장후"}.get(e.get("time", ""), e.get("time", ""))
        cons = (e.get("eps_est") or "").strip()
        if mkt == "US" and tkr in by_us:
            add_cov(by_us[tkr], date, tm=tm, fq=e.get("fq", ""), cons=cons, src="earnings_cal")
        elif mkt == "JP" and tkr in by_jp:
            ec_jp_seen.add((tkr, date))
            add_cov(by_jp[tkr], date, tm=tm, fq=e.get("fq", ""), cons=cons, src="earnings_cal")
        else:
            if mkt == "JP":
                ec_jp_seen.add((tkr, date))
            add_oth(date, "GL" if mkt == "GLOBAL" else mkt, tkr, e.get("name", ""), tm, bool(cons), "")

    # 2) ecal_us_eu.json — IR 페이지 기반 (confirmed/est 명시)
    for tkr, v in us_eu.items():
        if tkr.startswith("_") or not isinstance(v, dict):
            continue
        date = v.get("next_date", "")
        if not date:
            continue
        st = "c" if v.get("confirmed") else ("e" if v.get("est") else "")
        if tkr in by_us:
            add_cov(by_us[tkr], date, fq=v.get("quarter", ""), st=st, src="ecal_us_eu")
        else:
            mkt = "EU" if tkr.endswith(".MI") else "HK" if tkr.endswith(".HK") else "US"
            add_oth(date, mkt, tkr, "", "", 0, st)

    # 3) ecal_jp.json (kabuyoho) — earnings_cal 과 (code,date) 중복 제거
    for e in jp.get("entries", []):
        code, date = e.get("code", ""), e.get("date", "")
        if not date or (code, date) in ec_jp_seen:
            continue
        if code in by_jp:
            add_cov(by_jp[code], date, fq=e.get("quarter", ""), src="ecal_jp")
        else:
            add_oth(date, "JP", code, e.get("name", ""), "", 0, "")

    # 4) ecal_kr.json — 전부 비커버 (레지스트리에 KR 종목 없음)
    for e in kr.get("entries", []):
        date = e.get("date", "")
        if not date:
            continue
        st = "c" if e.get("confirmed") else ("e" if e.get("est") else "")
        add_oth(date, "KR", e.get("code", ""), e.get("name", ""), "", 0, st)

    # 5) ecal_tw.json — 분기 법정기한 (커버 5사 + 그외)
    for e in tw.get("entries", []):
        date, code = e.get("date", ""), e.get("code", "")
        if not date:
            continue
        st = "c" if e.get("confirmed") else ("e" if e.get("est") else "")
        if code in by_tw:
            add_cov(by_tw[code], date, fq=e.get("quarter", ""), st=st, src="ecal_tw")
        else:
            add_oth(date, "TW", code, e.get("name", ""), "", 0, st)

    # 6) TW 월매출 공고 기한 — 커버 TW 5사의 핵심 IR 일정 (證交法 §36 매월 10일)
    for m in tw.get("monthly_revenue_deadlines", []):
        date = m.get("date", "")
        if not date:
            continue
        st = "e" if m.get("est") else "c"
        for code, cid in by_tw.items():
            add_cov(cid, date, kind="M", fq=(m.get("month", "") + " 월매출"), st=st, src="tw_monthly")

    # 7) registry market.report — 커버 종목 IR 예정일 (문자열 파싱)
    for cid, c in companies.items():
        p = parse_report(c["report"])
        if p:
            date, st, tm = p
            cons = "있음" if c["consensus"] is not None else ""
            add_cov(cid, date, tm=tm, fq=c["fq"], st=st, cons=cons, src="registry")
        # DISCO식 '10/6 속보 선행' — 월/일 속보 표기를 IR 이벤트로 추가
        mm = re.search(r"(\d{1,2})/(\d{1,2})\s*속보", c["report"])
        if mm and p:
            yy = p[0][:4]
            d2 = f"{yy}-{int(mm.group(1)):02d}-{int(mm.group(2)):02d}"
            add_cov(cid, d2, kind="IR", fq="속보(선행)", src="registry")

    # ---- 후처리: 커버 이벤트 날짜별 정리
    cov_by_date = collections.defaultdict(list)
    for ev in cov.values():
        ev["src"] = "+".join(ev["src"])
        cov_by_date[ev["d"]].append(ev)
    for d in cov_by_date:
        cov_by_date[d].sort(key=lambda e: (e["kind"] != "E", e["sec"], e["id"]))

    # ---- 그외: 확정 우선 정렬 후 CAP 컷
    oth_out = {}
    for d, mkts in oth.items():
        oth_out[d] = {}
        for mkt, cell in mkts.items():
            cell["i"].sort(key=lambda it: (it[4] != "c", it[0]))
            oth_out[d][mkt] = {"n": cell["n"], "i": cell["i"][:CAP]}

    # ---- 월 범위
    all_dates = sorted(set(list(cov_by_date) + list(oth_out)))
    months = []
    if all_dates:
        y0, m0 = int(all_dates[0][:4]), int(all_dates[0][5:7])
        y1, m1 = int(all_dates[-1][:4]), int(all_dates[-1][5:7])
        y, m = y0, m0
        while (y, m) <= (y1, m1):
            months.append(f"{y}-{m:02d}")
            m += 1
            if m == 13:
                y, m = y + 1, 1

    # ---- 일정 미확정 커버 종목 (이벤트가 하나도 없는 커버 31사 잔여)
    dated_ids = {ev["id"] for ev in cov.values()}
    undated = collections.defaultdict(list)
    for cid, c in companies.items():
        if cid not in dated_ids:
            reason = re.sub(r"\s+", " ", c["report"] or "모른다").strip()
            undated[reason].append(CHIP_NAME.get(cid, cid))
    undated_out = [{"who": "·".join(sorted(v)), "why": k} for k, v in sorted(undated.items())]

    asof = {
        "earnings_cal": ec.get("generated", "?"),
        "us_eu": (us_eu.get("_meta") or {}).get("last_refresh", us_eu.get("_meta", {}).get("generated", "?")),
        "kr": kr.get("generated", "?"),
        "tw": tw.get("generated", "?"),
        "jp": jp.get("fetched_for", "?"),
        "registry": reg.get("asof", "?"),
    }
    stats = {
        "cov_events": len(cov), "cov_days": len(cov_by_date),
        "oth_rows": sum(c["n"] for mk in oth_out.values() for c in mk.values()),
        "days": len(all_dates), "months": months, "companies": len(companies),
        "kr_excluded_rows_retained": sum(1 for e in kr.get("entries", [])
                                          if e.get("excluded") and e.get("date")),
    }
    return {
        "cov": dict(cov_by_date), "oth": oth_out, "months": months,
        "undated": undated_out, "asof": asof,
        "secColor": SEC_COLOR, "secLabel": SEC_LABEL, "cap": CAP,
        "provenance": {
            "economic_indicators_included": False,
            "inputs": [
                {"id": key, "path": str(path), "sha256": _sha256(path)}
                for key, path in input_paths.items()
            ],
        },
    }, stats


# ---------------------------------------------------------------- HTML 렌더
def _hex_rgba(hx, a):
    hx = hx.lstrip("#")
    r, g, b = int(hx[0:2], 16), int(hx[2:4], 16), int(hx[4:6], 16)
    return f"rgba({r},{g},{b},{a})"


CSS = """
#u02-calendar{margin:28px 0}
#u02-calendar .u02-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px;margin-bottom:2px}
#u02-calendar h2{font-size:17px;margin:0}
#u02-calendar .u02-sub{color:var(--sub,#8a93a6);font-size:11.5px}
#u02-calendar .u02-caution{background:#2a1f14;border:1px solid #6b4d1f;border-radius:8px;
  color:#e8d5a8;font-size:11.5px;padding:7px 10px;margin:8px 0}
#u02-calendar .u02-legend{display:flex;flex-wrap:wrap;gap:10px;align-items:center;
  color:var(--sub,#8a93a6);font-size:11px;margin:6px 0 10px}
#u02-calendar .u02-dot{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:-1px}
#u02-calendar .u02-nav{display:flex;align-items:center;gap:8px;margin-bottom:8px}
#u02-calendar .u02-nav b{font-size:15px;min-width:110px;text-align:center}
#u02-calendar .u02-nav button{background:var(--card,#12151d);border:1px solid var(--line,#232a3a);
  color:var(--ink,#dce3f0);border-radius:8px;padding:4px 12px;cursor:pointer;font-size:13px}
#u02-calendar .u02-nav button:hover{border-color:var(--blue,#5aa9ff)}
#u02-calendar .u02-nav button:disabled{opacity:.35;cursor:default;border-color:var(--line,#232a3a)}
#u02-calendar .u02-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
#u02-calendar .u02-dow{color:var(--sub,#8a93a6);font-size:11px;text-align:center;padding:2px 0}
#u02-calendar .u02-dow.sun{color:#e2574f99}#u02-calendar .u02-dow.sat{color:#5aa9ff99}
#u02-calendar .u02-cell{background:var(--card,#12151d);border:1px solid var(--line,#232a3a);
  border-radius:8px;min-height:74px;padding:4px 5px;cursor:pointer;overflow:hidden;position:relative}
#u02-calendar .u02-cell.off{opacity:.35;cursor:default}
#u02-calendar .u02-cell.we{background:var(--card,#12151d)cc}
#u02-calendar .u02-cell:not(.off):hover{border-color:var(--blue,#5aa9ff)}
#u02-calendar .u02-cell:focus-visible{outline:2px solid var(--blue,#5aa9ff);outline-offset:1px}
#u02-calendar .u02-cell.today{border-color:var(--gold,#c9a24a);box-shadow:0 0 0 1px var(--gold,#c9a24a) inset}
#u02-calendar .u02-cell.sel{border-color:var(--blue,#5aa9ff);box-shadow:0 0 0 1px var(--blue,#5aa9ff) inset}
#u02-calendar .u02-dnum{font-size:11px;color:var(--sub,#8a93a6);font-weight:700}
#u02-calendar .u02-cell.today .u02-dnum{color:var(--gold,#c9a24a)}
#u02-calendar .u02-chip{display:block;font-size:10px;font-weight:800;line-height:1.5;border-radius:4px;
  padding:0 3px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#u02-calendar .u02-more{font-size:10px;color:var(--sub,#8a93a6);margin-top:1px}
#u02-calendar .u02-markets{display:flex;flex-wrap:wrap;gap:2px;margin-top:2px}
#u02-calendar .u02-market-count{font-size:9px;line-height:1.45;color:var(--sub,#8a93a6);
  background:var(--card2,#171b26);border:1px solid var(--line,#232a3a);border-radius:3px;padding:0 3px}
#u02-calendar .u02-detail{background:var(--card,#12151d);border:1px solid var(--line,#232a3a);
  border-radius:10px;padding:12px 14px;margin-top:10px;font-size:13px}
#u02-calendar .u02-detail h3{margin:0 0 8px;font-size:14px}
#u02-calendar .u02-ev{padding:5px 0;border-bottom:1px solid var(--line,#232a3a)}
#u02-calendar .u02-ev:last-child{border-bottom:0}
#u02-calendar .u02-secb{display:inline-block;font-size:10px;font-weight:800;border-radius:4px;
  padding:1px 6px;margin-right:6px;color:#0b0e14}
#u02-calendar .u02-b{display:inline-block;font-size:10.5px;border:1px solid var(--line,#232a3a);
  border-radius:4px;padding:0 5px;margin-left:5px;color:var(--sub,#8a93a6)}
#u02-calendar .u02-b.c{color:var(--green,#2fae66);border-color:var(--green,#2fae66)}
#u02-calendar .u02-b.e{color:var(--gold,#c9a24a);border-color:var(--gold,#c9a24a)}
#u02-calendar .u02-oth-h{color:var(--sub,#8a93a6);font-size:11.5px;font-weight:700;margin:8px 0 3px}
#u02-calendar .u02-oth-i{color:var(--sub,#8a93a6);font-size:11.5px;line-height:1.7}
#u02-calendar .u02-oth-i .st-c{color:var(--green,#2fae66)}
#u02-calendar .u02-oth-i .st-e{color:var(--gold,#c9a24a)}
#u02-calendar .u02-undated{color:var(--sub,#8a93a6);font-size:11px;margin-top:8px;line-height:1.6}
#u02-calendar .u02-undated b{color:var(--ink,#dce3f0);font-weight:700}
@media(max-width:640px){
  #u02-calendar .u02-cell{min-height:56px;padding:3px}
  #u02-calendar .u02-chip{font-size:9px}
  #u02-calendar .u02-market-count{font-size:8px;padding:0 2px}
  #u02-calendar .u02-nav{gap:5px}
  #u02-calendar .u02-nav button{padding:4px 9px}
}
"""

JS = r"""
(function(){
  var D = window.U02_DATA;
  var GRID = document.getElementById('u02-grid');
  var TITLE = document.getElementById('u02-title');
  var DETAIL = document.getElementById('u02-detail');
  var PREV = document.getElementById('u02-prev');
  var NEXT = document.getElementById('u02-next');
  var DOW = ['일','월','화','수','목','금','토'];
  var MARKET_ORDER = ['US','JP','KR','TW','EU','HK','GL','CN'];
  function pad(n){return (n<10?'0':'')+n;}
  var now = new Date();
  var TODAY = now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
  function diffDays(ds){ // ds - today (일수)
    var a = Date.UTC(+ds.slice(0,4), +ds.slice(5,7)-1, +ds.slice(8,10));
    var b = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.round((a-b)/86400000);
  }
  function isPin(ds){ var d = diffDays(ds); return d>=0 && d<=3; } // T-3 프리뷰 창
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function rgba(hex,a){ var h=hex.replace('#','');
    return 'rgba('+parseInt(h.substr(0,2),16)+','+parseInt(h.substr(2,2),16)+','+parseInt(h.substr(4,2),16)+','+a+')'; }
  function fmtN(n){ return n.toLocaleString('ko-KR'); }
  function marketRank(m){ var i=MARKET_ORDER.indexOf(m); return i<0?99:i; }
  function marketKeys(om){ return Object.keys(om).sort(function(a,b){return marketRank(a)-marketRank(b);}); }

  var months = D.months;
  var curTodayM = TODAY.slice(0,7);
  var mi = months.indexOf(curTodayM); if (mi < 0) mi = 0;
  var selDate = months.indexOf(curTodayM)>=0 ? TODAY : (months[0]?months[0]+'-01':TODAY);

  function render(){
    var ym = months[mi]; var y=+ym.slice(0,4), m=+ym.slice(5,7);
    TITLE.textContent = y+'년 '+m+'월';
    var first = new Date(Date.UTC(y,m-1,1));
    var startDow = first.getUTCDay();
    var dim = new Date(Date.UTC(y,m,0)).getUTCDate();
    var h = '';
    for (var i=0;i<7;i++)
      h += '<div class="u02-dow'+(i===0?' sun':i===6?' sat':'')+'">'+DOW[i]+'</div>';
    for (i=0;i<startDow;i++) h += '<div class="u02-cell off"></div>';
    for (var d=1; d<=dim; d++){
      var ds = ym+'-'+pad(d);
      var dow = (startDow+d-1)%7;
      var cls = 'u02-cell'+(dow===0||dow===6?' we':'')+(ds===TODAY?' today':'')+(ds===selDate?' sel':'');
      h += '<div class="'+cls+'" data-d="'+ds+'" role="button" tabindex="0" aria-label="'+ds+' 일정" aria-pressed="'+(ds===selDate?'true':'false')+'"><span class="u02-dnum">'+d+'</span>';
      var evs = D.cov[ds]||[];
      var shown = 0;
      for (var k=0;k<evs.length && shown<3;k++,shown++){
        var ev=evs[k], col=D.secColor[ev.sec]||'#8a93a6';
        h += '<span class="u02-chip" style="color:'+col+';background:'+rgba(col,0.14)+'">'+
             (isPin(ds)?'📌':'')+esc(ev.tk)+(ev.kind==='M'?'·월':ev.kind==='IR'?'·IR':'')+'</span>';
      }
      if (evs.length>shown) h += '<div class="u02-more">+'+(evs.length-shown)+'</div>';
      var om = D.oth[ds];
      if (om){
        var mks=marketKeys(om), mshown=mks.slice(0,3), hiddenMarkets=mks.length-mshown.length;
        if (mshown.length){
          h += '<div class="u02-markets">';
          for (var q=0;q<mshown.length;q++){
            var mk=mshown[q]; h += '<span class="u02-market-count">'+esc(mk)+' '+fmtN(om[mk].n)+'</span>';
          }
          if (hiddenMarkets>0) h += '<span class="u02-market-count">+'+hiddenMarkets+'국</span>';
          h += '</div>';
        }
      }
      h += '</div>';
    }
    GRID.innerHTML = h;
    PREV.disabled = mi===0; NEXT.disabled = mi===months.length-1;
    var cells = GRID.querySelectorAll('.u02-cell[data-d]');
    function chooseCell(cell){ selDate=cell.getAttribute('data-d'); render(); detail(); }
    for (i=0;i<cells.length;i++){
      cells[i].addEventListener('click', function(){chooseCell(this);});
      cells[i].addEventListener('keydown', function(e){
        if(e.key==='Enter'||e.key===' '){e.preventDefault();chooseCell(this);}
      });
    }
  }

  function badge(txt, cls){ return '<span class="u02-b '+(cls||'')+'">'+esc(txt)+'</span>'; }
  function detail(){
    var ds = selDate;
    var evs = D.cov[ds]||[], om = D.oth[ds]||{};
    var h = '<h3>'+ds+(ds===TODAY?' · 오늘':'')+'</h3>';
    if (!evs.length && !Object.keys(om).length){
      h += '<div class="u02-oth-i">등록된 발표 일정 없음</div>';
      DETAIL.innerHTML = h; return;
    }
    for (var k=0;k<evs.length;k++){
      var ev=evs[k], col=D.secColor[ev.sec]||'#8a93a6';
      h += '<div class="u02-ev">'
        + '<span class="u02-secb" style="background:'+col+'">'+esc(D.secLabel[ev.sec]||ev.sec)+'</span>'
        + (isPin(ds)?'📌 ':'')
        + '<b style="color:'+col+'">'+esc(ev.tk)+'</b> '
        + '<span style="color:var(--sub,#8a93a6)">'+esc(ev.nm)+'</span>'
        + badge(ev.mkt)
        + (ev.kind==='M'?badge('월매출 기한'):ev.kind==='IR'?badge('IR'):'')
        + (ev.fq?badge(ev.fq):'')
        + badge(ev.tm||'시각 모른다')
        + (ev.cons?badge(ev.cons==='있음'?'컨센 있음':'컨센 '+ev.cons):badge('컨센 없음'))
        + (ev.st==='c'?badge('확정','c'):ev.st==='e'?badge('추정','e'):'')
        + '</div>';
    }
    var keys = marketKeys(om);
    for (var q=0;q<keys.length;q++){
      var mk=keys[q], cell=om[mk];
      h += '<div class="u02-oth-h">'+mk+' 그외 '+fmtN(cell.n)+'건</div><div class="u02-oth-i">';
      var parts=[];
      for (var j=0;j<cell.i.length;j++){
        var it=cell.i[j]; // [tk,nm,tm,cons,st]
        var stClass=it[4]==='c'?'st-c':it[4]==='e'?'st-e':'';
        parts.push('<span'+(stClass?' class="'+stClass+'"':'')+'>'+esc(it[1]||it[0])
          +(it[1]&&it[0]?'('+esc(it[0])+')':'')
          +(it[2]?'·'+esc(it[2]):'·시각 모른다')+(it[3]?'·컨센 있음':'·컨센 없음')
          +(it[4]==='c'?'·확정':it[4]==='e'?'·추정':'')+'</span>');
      }
      h += parts.join(' ·  ');
      if (cell.n>cell.i.length) h += ' … 외 '+fmtN(cell.n-cell.i.length)+'건';
      h += '</div>';
    }
    DETAIL.innerHTML = h;
  }

  function move(delta){
    var target=mi+delta; if(target<0||target>=months.length)return;
    mi=target; var ym=months[mi]; selDate=ym===curTodayM?TODAY:ym+'-01'; render(); detail();
  }
  PREV.addEventListener('click', function(){move(-1);});
  NEXT.addEventListener('click', function(){move(1);});
  document.getElementById('u02-today').addEventListener('click', function(){
    var t = months.indexOf(TODAY.slice(0,7)); if (t>=0) mi=t; selDate=TODAY; render(); detail(); });
  render(); detail();
})();
"""


def build_calendar_section(jem=JEM, reg_path=REG_PATH):
    """캘린더 섹션 HTML 조각을 반환한다. ensemble_page_build.py 가 홈에 삽입."""
    data, stats = collect(jem, reg_path)

    legend = []
    for sec, col in SEC_COLOR.items():
        legend.append(
            f'<span><span class="u02-dot" style="background:{col}"></span>{_html.escape(SEC_LABEL[sec])}</span>')
    legend.append('<span><b>굵은 칩</b> = 앙상블 커버</span>')
    legend.append('<span>📌 = T-3 프리뷰 창</span>')
    legend.append('<span style="color:var(--green,#2fae66)">확정</span>')
    legend.append('<span style="color:var(--gold,#c9a24a)">추정</span>')
    legend.append('<span>회색 = 비커버(건수 접힘, 일 클릭 시 상세)</span>')

    undated_html = ""
    if data["undated"]:
        rows = " &nbsp;/&nbsp; ".join(
            f'<b>{_html.escape(u["who"])}</b> — {_html.escape(u["why"])}' for u in data["undated"])
        undated_html = f'<div class="u02-undated">일정 미확정 커버: {rows}</div>'

    a = data["asof"]
    asof_line = (f'실적 {a["earnings_cal"]} · US/EU IR {a["us_eu"]} · KR {a["kr"]} · TW {a["tw"]} · '
                 f'JP캘린더 {a["jp"]} · 레지스트리 {a["registry"]}')

    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    frag = f"""<!-- U02_CALENDAR — 빌더 생성물. 직접 수정 금지 (u02_calendar_build.py) -->
<section id="u02-calendar">
<style>{CSS}</style>
<div class="u02-head"><h2>발표 캘린더</h2>
<span class="u02-sub">기업실적 + IR만 · 경제지표 제외 · {_html.escape(asof_line)}</span></div>
<div class="u02-caution">⚠ 추정일·법정기한 대리치를 포함한 일정 스냅샷입니다. 실제 발표 전 회사 IR·공시를 다시 확인하세요. 투자판단 참고용.</div>
<div class="u02-legend">{''.join(legend)}</div>
<div class="u02-nav">
<button id="u02-prev" type="button" aria-label="이전 달">◀</button><b id="u02-title" aria-live="polite"></b>
<button id="u02-next" type="button" aria-label="다음 달">▶</button>
<button id="u02-today" type="button">오늘</button></div>
<div class="u02-grid" id="u02-grid"></div>
<div class="u02-detail" id="u02-detail" aria-live="polite"></div>
{undated_html}
<script>window.U02_DATA={payload};</script>
<script>{JS}</script>
</section>
"""
    return frag, stats


STANDALONE_SHELL = """<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>U02 캘린더 — 단독 검증용</title>
<style>
:root{{--bg:#0b0e14;--card:#12151d;--card2:#171b26;--line:#232a3a;--ink:#dce3f0;--sub:#8a93a6;
--blue:#5aa9ff;--blue2:#3d6fd8;--green:#2fae66;--red:#e2574f;--gold:#c9a24a;}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);
font-family:"Apple SD Gothic Neo",Pretendard,system-ui,sans-serif;font-size:14px;line-height:1.55}}
.wrap{{max-width:1080px;margin:0 auto;padding:20px 14px 60px}}
</style></head><body><div class="wrap">
{frag}
</div></body></html>
"""


def main():
    frag, stats = build_calendar_section()
    data, _ = collect()
    (OUT / "u02_calendar.html").write_text(frag, encoding="utf-8")
    (OUT / "u02_preview.html").write_text(STANDALONE_SHELL.format(frag=frag), encoding="utf-8")
    (OUT / "u02_calendar_data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("[U02] 커버 이벤트:", stats["cov_events"], "건 /", stats["cov_days"], "일")
    print("[U02] 그외(비커버) 행:", stats["oth_rows"], "건, 전체", stats["days"], "일")
    print("[U02] 커버 기업:", stats["companies"], "사 / KR excluded 보존:",
          stats["kr_excluded_rows_retained"], "행")
    print("[U02] 월 범위:", stats["months"][0], "→", stats["months"][-1], f"({len(stats['months'])}개월)")
    print("[U02] 조각:", OUT / "u02_calendar.html")
    print("[U02] 미리보기:", OUT / "u02_preview.html")
    print("[U02] 감사 JSON:", OUT / "u02_calendar_data.json")


if __name__ == "__main__":
    main()
