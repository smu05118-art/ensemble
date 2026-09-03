#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""U01 — 밸류체인 강도 맵(트리맵) 섹션 빌더.

ensemble_page_build.py 통합용 트리맵 섹션 함수 모음(팔랑크스 불변규칙 2 계승:
데이터 → 빌더 → html 재생성, 직접 html 수정 금지).

통합 방법:
    from u01_treemap_section import build_treemap_section
    fragment = build_treemap_section()          # <section id="u01-treemap">…</section>
    # ensemble_home.html 본문에서 [U01] 자리에 그대로 삽입

단독 실행:
    python3 u01_treemap_section.py              # 섹션 조각 + 데이터 json + 검증용 preview 생성

데이터 계약(실데이터만, 창작 금지):
  · 크기  = 레지스트리 route 실측 집계 — 각 route 의 최신 3개월(월 3개 전부 관측된 창)
            무역금액 합 × 귀속가중 중앙값(w[1]) 을 USD 로 환산해 종목별 합산.
            estat_long.csv=천엔, thai_long.csv=천바트 → USD 환산(빌드시 open.er-api.com
            실측 환율, 실패 시 캐시, 캐시도 없으면 해당 종목 '환율 대기' 처리).
            그 외 CSV 는 천USD 단위(rack_long 미러 교차검증 완료).
  · 색    = 컴포짓 YoY(통합 번들 out/out.json 의 est.corr_yoy, state=ready 한정)
            → 없으면 프록시 최신 3M YoY(route metric 축, 전년 동일 3개월 대비). ±30% 클리핑.
  · 카드  = 현 국면(R03 cycle_clock — 미존재 시 placeholder 명시) · 품질등급(레지스트리 E16)
            · 최신 나우캐스트(엔진 corr_yoy·target) · 다음 발표일(레지스트리 market.report).
  · mem 샤드(KIOXIA)는 연구전용(research_only) — 박스에 '연구전용' 태그로 구분 표시.
"""
from __future__ import annotations

import csv
import json
import os
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

# ── 경로(LOCAL_MAP 기준, 통합 시 인자로 덮어쓰기 가능) ──────────────────────
USER_HOME = Path.home()
DOWNLOADS = USER_HOME / "Downloads"
JEM_DATA = Path(os.environ.get("U01_JEM_DIR", str(USER_HOME / "phalanx/jem_data")))
BUNDLE_STUDIO = DOWNLOADS / "integ_wave/bundle/ensemble"
BUNDLE_MINI = USER_HOME / "ensemble"
BUNDLE = Path(os.environ.get(
    "U01_BUNDLE_DIR", str(BUNDLE_STUDIO if BUNDLE_STUDIO.is_dir() else BUNDLE_MINI)))
REG_MERGED = Path(os.environ.get(
    "U01_REGISTRY", str(BUNDLE / "registry/_merged.json")))
REG_MEM = Path(os.environ.get(
    "U01_MEM_REGISTRY", str(BUNDLE / "registry/mem.json")))
QUALITY_VERDICTS = Path(os.environ.get(
    "U01_QUALITY", str(BUNDLE / "quality_verdicts.json")))
ENGINE_OUT = Path(os.environ.get(
    "U01_ENGINE_OUT", str(BUNDLE / "out/out.json")))
CLOCK = Path(os.environ.get(
    "U01_CLOCK", str(DOWNLOADS / "rot_wave/out/R03_CLOCK/cycle_clock.json")))
OUT_DIR = Path(__file__).resolve().parent
FX_CACHE = OUT_DIR / "fx_cache.json"

# CSV value 열 단위: 전부 '천 <통화>' long 포맷. estat=JPY, thai=THB(미러 교차검증:
# thai→USA 851762 가 us←TH 대비 ~20배 → THB 확정), 나머지는 USD(rack_long 은 미러비 ~1.1 로 USD 확인).
CSV_CURRENCY = {"estat_long.csv": "JPY", "thai_long.csv": "THB"}
DATE_CUTOFF = "2024-01"  # 최신창+전년동창 계산에 필요한 범위만 스캔

SECTOR_LABEL = {
    "rack": "랙/서버",
    "mem": "메모리",
    "optics": "광통신",
    "power": "전력/신재생",
    "jpeq": "일본 장비·소재",
}
SECTOR_ORDER = ["rack", "jpeq", "power", "optics", "mem"]


# ── FX ───────────────────────────────────────────────────────────────────────
def fetch_fx() -> dict | None:
    """USD 기준 환율(JPY·THB). 실측 API → 캐시 → None(환율 대기). 창작 상수 금지."""
    try:
        with urllib.request.urlopen("https://open.er-api.com/v6/latest/USD", timeout=12) as r:
            d = json.load(r)
        rates = d.get("rates", {})
        if d.get("result") == "success" and rates.get("JPY") and rates.get("THB"):
            fx = {
                "JPY": float(rates["JPY"]),
                "THB": float(rates["THB"]),
                "asof": d.get("time_last_update_utc", ""),
                "source": "open.er-api.com (실측)",
            }
            FX_CACHE.write_text(json.dumps(fx, ensure_ascii=False, indent=1), encoding="utf-8")
            return fx
    except Exception:
        pass
    if FX_CACHE.exists():
        try:
            fx = json.loads(FX_CACHE.read_text(encoding="utf-8"))
            fx["source"] = fx.get("source", "") + " [캐시 재사용]"
            return fx
        except Exception:
            pass
    return None


# ── route 월별 집계(같은 CSV 는 1회 스캔) ────────────────────────────────────
def load_monthlies(route_specs: list[dict], data_dir: Path = JEM_DATA) -> dict[str, dict]:
    """route_specs: [{key, csv, flow, hs, hs_prefix, ports, countries, min_date}]
    → {key: {"val": {ym: 천통화}, "wgt": {ym: kg}}} — composite_preview.py 로더와 동일 필터."""
    out = {s["key"]: {"val": {}, "wgt": {}} for s in route_specs}
    by_csv: dict[str, list[dict]] = {}
    for s in route_specs:
        by_csv.setdefault(s["csv"], []).append(s)
    for csv_name, specs in by_csv.items():
        p = data_dir / csv_name
        if not p.exists():
            for s in specs:
                out[s["key"]]["missing_source"] = True
            continue
        for s in specs:  # 매칭용 전처리
            s["_hs"] = set(s.get("hs") or [])
            s["_pre"] = tuple(s.get("hs_prefix") or [])
            s["_ports"] = set(s.get("ports") or [])
            s["_ctry"] = set(s.get("countries") or [])
        with open(p, newline="", encoding="utf-8-sig") as f:
            rd = csv.reader(f)
            head = next(rd)
            ix = {k: head.index(k) for k in ("date", "flow", "hs", "custom", "country", "value", "weight")}
            i_d, i_f, i_h = ix["date"], ix["flow"], ix["hs"]
            i_p, i_c, i_v, i_w = ix["custom"], ix["country"], ix["value"], ix["weight"]
            for row in rd:
                d = row[i_d][:7]
                if d < DATE_CUTOFF:
                    continue
                flow, h, port, ctry = row[i_f], row[i_h], row[i_p], row[i_c]
                for s in specs:
                    if flow != s["flow"]:
                        continue
                    if not ((s["_hs"] and h in s["_hs"]) or (s["_pre"] and h.startswith(s["_pre"]))):
                        continue
                    if s["_ports"] and port not in s["_ports"]:
                        continue
                    if s["_ctry"] and ctry not in s["_ctry"]:
                        continue
                    if s.get("min_date") and d < s["min_date"]:
                        continue
                    o = out[s["key"]]
                    try:
                        o["val"][d] = o["val"].get(d, 0.0) + float(row[i_v])
                    except ValueError:
                        continue
                    try:
                        o["wgt"][d] = o["wgt"].get(d, 0.0) + float(row[i_w])
                    except ValueError:
                        pass
    return out


def _ym_shift(ym: str, k: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    t = y * 12 + (m - 1) + k
    return f"{t // 12:04d}-{t % 12 + 1:02d}"


def latest_window(monthly: dict[str, float], span: int = 3, search: int = 6) -> list[str] | None:
    """관측월 중 가장 최근의 '연속 span개월 전부 관측' 창. 최대 search 개월 후퇴 탐색."""
    if not monthly:
        return None
    months = sorted(monthly)
    for back in range(search):
        end = _ym_shift(months[-1], -back)
        win = [_ym_shift(end, -(span - 1) + i) for i in range(span)]
        if all(m in monthly for m in win):
            return win
    return None


def route_summary(mon: dict, metric: str) -> dict:
    """route 1개의 최신 3M 창 금액(천통화)·YoY(축=metric)·창 라벨."""
    win = latest_window(mon["val"])
    if not win:
        return {"window": None, "cur_kval": None, "yoy": None}
    cur_v = sum(mon["val"][m] for m in win)
    axis = mon["wgt"] if metric == "weight" else mon["val"]
    prev_win = [_ym_shift(m, -12) for m in win]
    yoy = None
    if all(m in axis for m in win) and all(m in axis for m in prev_win):
        cur_a = sum(axis[m] for m in win)
        prv_a = sum(axis[m] for m in prev_win)
        if prv_a > 0:
            yoy = round((cur_a / prv_a - 1.0) * 100.0, 1)
    return {"window": f"{win[0]}~{win[-1][5:7]}", "cur_kval": cur_v, "yoy": yoy}


# ── cycle clock(R03) ─────────────────────────────────────────────────────────
def load_clock(path: Path = CLOCK) -> dict:
    """R03 cycle_clock.json. 미존재 시 COMMON 스키마 가정 placeholder(명시)."""
    if path.exists():
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            entries = raw if isinstance(raw, list) else raw.get("sectors", raw)
            by = {}
            if isinstance(entries, list):
                for e in entries:
                    by[e.get("sector")] = e
            elif isinstance(entries, dict):
                by = entries
            return {"placeholder": False, "by_sector": by, "src": str(path)}
        except Exception:
            pass
    return {
        "placeholder": True,
        "by_sector": {
            s: {"sector": s, "phase": None, "phase_angle": None,
                "confidence": None, "evidence": None, "asof": None}
            for s in SECTOR_ORDER
        },
        "src": "R03_CLOCK 미산출 — 스키마 {sector,phase,phase_angle,confidence,evidence,asof} 가정 placeholder",
    }


# ── 데이터 조립 ──────────────────────────────────────────────────────────────
def build_treemap_data(
    jem_data: Path = JEM_DATA,
    reg_merged: Path = REG_MERGED,
    reg_mem: Path = REG_MEM,
    quality_verdicts: Path = QUALITY_VERDICTS,
    engine_out: Path = ENGINE_OUT,
    clock_path: Path = CLOCK,
) -> dict:
    reg = json.loads(reg_merged.read_text(encoding="utf-8"))
    companies = list(reg["companies"])
    company_ids = {c["id"] for c in companies}
    # mem 샤드(연구전용) — 스펙의 5개 섹터 그룹 유지를 위해 태그와 함께 포함
    research_ids = set()
    if reg_mem.exists():
        mem = json.loads(reg_mem.read_text(encoding="utf-8"))
        for c in mem.get("companies", []):
            research_ids.add(c["id"])
            if c["id"] not in company_ids:
                companies.append(c)
                company_ids.add(c["id"])

    quality_by = {}
    quality_asof = None
    if quality_verdicts.exists():
        qraw = json.loads(quality_verdicts.read_text(encoding="utf-8"))
        quality_asof = qraw.get("asof")
        quality_by = {c["id"]: c for c in qraw.get("companies", [])}

    eng = {}
    eng_asof = None
    if engine_out.exists():
        e = json.loads(engine_out.read_text(encoding="utf-8"))
        eng_asof = e.get("asof")
        eng = {c["id"]: c for c in e.get("companies", [])}

    fx = fetch_fx()
    clock = load_clock(clock_path)

    # route 명세 수집 → CSV 1회 스캔 집계
    specs = []
    for c in companies:
        for r in c.get("routes", []):
            specs.append({
                "key": f"{c['id']}::{r['id']}", "csv": r["csv"], "flow": r["flow"],
                "hs": r.get("hs"), "hs_prefix": r.get("hs_prefix"),
                "ports": r.get("ports"), "countries": r.get("countries"),
                "min_date": r.get("min_date"),
            })
    monthlies = load_monthlies(specs, jem_data)

    out_companies = []
    for c in companies:
        cid = c["id"]
        routes_out = []
        size_usd = 0.0
        size_ok = True
        # 프록시 3M YoY: 귀속가중 중앙값으로 가중 결합(단일 route 면 그 route YoY)
        yoy_num = yoy_den = 0.0
        yoy_ready = False
        for r in c.get("routes", []):
            mon = monthlies[f"{cid}::{r['id']}"]
            rs = route_summary(mon, r.get("metric", "value"))
            w_mid = (r.get("w") or [None, 1.0, None])[1]
            cur = None
            if rs["cur_kval"] is not None:
                cur_native = rs["cur_kval"] * 1000.0  # 천통화 → 통화
                curcy = CSV_CURRENCY.get(r["csv"], "USD")
                if curcy == "USD":
                    cur = cur_native
                elif fx and fx.get(curcy):
                    cur = cur_native / fx[curcy]
                else:
                    size_ok = False  # 환율 대기 — 창작 상수로 메우지 않음
            else:
                size_ok = False
            if cur is not None:
                size_usd += w_mid * cur
            if rs["yoy"] is not None:
                # 가중 YoY 결합: 전년분모 기준 가중 평균과 동치인 근사(단순 w 가중 평균)
                yoy_num += w_mid * rs["yoy"]
                yoy_den += w_mid
                yoy_ready = True
            routes_out.append({
                "label": r.get("label", r["id"]), "window": rs["window"],
                "cur_usd": cur, "yoy": rs["yoy"], "metric": r.get("metric", "value"),
                "w_mid": w_mid,
            })
        proxy_yoy = round(yoy_num / yoy_den, 1) if yoy_ready and yoy_den else None

        ec = eng.get(cid) or {}
        est = ec.get("est") or {}
        engine_yoy = est.get("corr_yoy") if est.get("state") == "ready" else None
        color_yoy, color_src = (engine_yoy, "컴포짓(엔진)") if engine_yoy is not None else \
                               (proxy_yoy, "프록시 3M") if proxy_yoy is not None else (None, "대기")

        qv = quality_by.get(cid)
        q = qv.get("model_quality_e16") if qv else (c.get("quality") or {}).get("grade")
        qsrc = "quality_verdicts E16" if qv else "레지스트리" if q else "미평가"
        sec = c.get("sector", "?")
        out_companies.append({
            "id": cid, "name": c.get("name", cid), "ticker": c.get("ticker", ""),
            "sector": sec, "research_only": cid in research_ids,
            "grade": q, "grade_source": qsrc,
            "report": (c.get("market") or {}).get("report"),
            "size_usd": round(size_usd) if (size_ok and size_usd > 0) else None,
            "proxy_yoy": proxy_yoy, "engine_yoy": engine_yoy,
            "engine_state": est.get("state") or ec.get("status"),
            "nowcast_target": ec.get("target"),
            "color_yoy": color_yoy, "color_src": color_src,
            "routes": routes_out,
        })

    csv_maxes = {}
    for s in specs:
        mon = monthlies[s["key"]]["val"]
        if mon:
            csv_maxes[s["csv"]] = max(csv_maxes.get(s["csv"], ""), max(mon))

    return {
        "asof": {
            "registry": reg.get("asof"), "quality": quality_asof, "engine": eng_asof,
            "built": datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M %Z"),
            "csv_last": csv_maxes,
        },
        "fx": fx,
        "clock": clock,
        "sector_label": SECTOR_LABEL,
        "sector_order": SECTOR_ORDER,
        "companies": out_companies,
    }


# ── 섹션 html(순수 JS 트리맵, D3 없음 — composite_preview.html 시각언어 계승) ──
_TEMPLATE = r"""<section id="u01-treemap">
<style>
#u01-treemap{margin:12px 0}
#u01-treemap .u01-card{background:var(--card,#12151d);border:1px solid var(--line,#232a3a);
border-radius:12px;padding:12px 14px}
#u01-treemap h2{margin:0 0 2px;font-size:16px;color:var(--ink,#dce3f0)}
#u01-treemap .u01-sub{color:var(--sub,#8a93a6);font-size:11.5px;margin-bottom:10px;line-height:1.5}
#u01-treemap .u01-legend{display:flex;align-items:center;gap:8px;font-size:11px;
color:var(--sub,#8a93a6);margin:6px 0 8px;flex-wrap:wrap}
#u01-treemap .u01-grad{width:150px;height:10px;border-radius:5px;
background:linear-gradient(90deg,#e2574f,#3a4152 50%,#2fae66)}
#u01-treemap .u01-map{position:relative;width:100%;height:clamp(360px,52vw,540px);
border-radius:8px;overflow:hidden;background:var(--bg,#0b0e14)}
#u01-treemap .u01-sec{position:absolute;border:1px solid var(--line,#232a3a);border-radius:4px;
overflow:hidden}
#u01-treemap .u01-sechead{position:absolute;left:0;right:0;top:0;height:16px;line-height:16px;
padding:0 6px;font-size:10px;font-weight:800;color:#aeb8cc;background:rgba(23,27,38,.92);
white-space:nowrap;overflow:hidden;text-overflow:ellipsis;z-index:2}
#u01-treemap .u01-box{position:absolute;border-radius:3px;cursor:pointer;overflow:hidden;
border:0;padding:0;text-align:left;font:inherit;color:inherit;appearance:none;
box-shadow:inset 0 0 0 1px rgba(11,14,20,.65);transition:filter .12s}
#u01-treemap .u01-box:hover{filter:brightness(1.25);z-index:3}
#u01-treemap .u01-box:focus-visible{outline:2px solid #eef2fa;outline-offset:-3px;z-index:4}
#u01-treemap .u01-box.sel{box-shadow:inset 0 0 0 2px #dce3f0;z-index:3}
#u01-treemap .u01-bl{padding:3px 4px;font-size:10.5px;font-weight:800;color:#eef2fa;
text-shadow:0 1px 2px rgba(0,0,0,.55);line-height:1.25;pointer-events:none}
#u01-treemap .u01-bl .y{display:block;font-size:9.5px;font-weight:700;opacity:.9}
#u01-treemap .u01-bl .tag{display:inline-block;font-size:8.5px;font-weight:700;
background:rgba(11,14,20,.55);border-radius:3px;padding:0 3px;margin-top:1px}
#u01-treemap .u01-wait{margin-top:8px;font-size:11.5px;color:var(--gold,#c9a24a)}
#u01-treemap .u01-disclaimer{margin-top:8px;padding-top:8px;border-top:1px solid var(--line,#232a3a);
font-size:11px;color:var(--sub,#8a93a6)}
#u01-treemap .u01-detail{display:none;margin-top:10px;background:var(--card2,#171b26);
border:1px solid var(--line,#232a3a);border-radius:10px;padding:10px 12px}
#u01-treemap .u01-detail.on{display:block}
#u01-treemap .u01-dhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px}
#u01-treemap .u01-dhead b{font-size:15px;color:var(--ink,#dce3f0)}
#u01-treemap .u01-dhead .tk{color:var(--sub,#8a93a6);font-size:12px}
#u01-treemap .u01-x{margin-left:auto;cursor:pointer;color:var(--sub,#8a93a6);font-size:13px;
background:none;border:0;padding:2px 6px}
#u01-treemap .u01-chips{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));
gap:6px;margin-top:8px}
#u01-treemap .u01-chip{background:var(--card,#12151d);border:1px solid var(--line,#232a3a);
border-radius:8px;padding:7px 9px}
#u01-treemap .u01-chip .l{color:var(--sub,#8a93a6);font-size:10px;letter-spacing:.04em}
#u01-treemap .u01-chip .v{font-size:13.5px;font-weight:800;margin-top:2px;
font-variant-numeric:tabular-nums;color:var(--ink,#dce3f0)}
#u01-treemap .u01-chip .s{font-size:10px;color:var(--sub,#8a93a6);margin-top:1px}
#u01-treemap .u01-routes{margin-top:8px;font-size:11.5px;color:var(--sub,#8a93a6)}
#u01-treemap .u01-routes li{margin:3px 0}
#u01-treemap .u01-gbadge{border-radius:5px;padding:1px 7px;font-size:11px;font-weight:800;color:#0b0e14}
@media(max-width:640px){#u01-treemap .u01-map{height:72vw;min-height:330px}}
</style>
<div class="u01-card">
  <h2>밸류체인 강도 맵</h2>
  <div class="u01-sub">박스 크기 = 레지스트리 route 실측 최신 3M 무역금액(귀속가중 중앙값 적용, USD 환산 · 시총 아님) ·
  색 = 컴포짓 YoY(엔진) 우선, 없으면 프록시 최신 3M YoY · ±30% 클리핑 ·
  섹터 그룹 → 종목 박스, 박스 클릭 = 미니카드 · __SUBNOTE__</div>
  <div class="u01-legend"><span>YoY</span><span>-30%</span><div class="u01-grad"></div><span>+30%</span>
  <span style="margin-left:8px">■ 회색 = 판정 대기</span><span id="u01-asof"></span></div>
  <div class="u01-map" id="u01-map"></div>
  <div class="u01-wait" id="u01-wait"></div>
  <div class="u01-detail" id="u01-detail" role="region" aria-label="선택 종목 미니카드" aria-live="polite"></div>
  <div class="u01-disclaimer">투자판단 참고용·투자 권유 아님. 무역 프록시는 회사 전용 매출이 아니며, 나우캐스트는 오차·개정 가능성이 있음.</div>
</div>
<script>
(function(){
"use strict";
var DATA=__DATA__;
var GC={A:"#2fae66",B:"#5aa9ff",C:"#c9a24a"};
function gcol(g){return GC[g]||"#6b7280";}
function esc(v){
  var e={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
  return String(v==null?"":v).replace(/[&<>"']/g,function(ch){return e[ch];});
}
function fmtUsd(v){
  if(v==null)return "환율/데이터 대기";
  if(v>=1e9)return (v/1e9).toFixed(2)+"B$";
  if(v>=1e6)return (v/1e6).toFixed(1)+"M$";
  return Math.round(v/1e3)+"K$";
}
function yoyTxt(y){return y==null?"–":(y>0?"+":"")+y.toFixed(1)+"%";}
function mix(a,b,t){return "rgb("+a.map(function(v,i){return Math.round(v+(b[i]-v)*t);}).join(",")+")";}
var NEU=[58,65,82],RED=[226,87,79],GRN=[47,174,102];
function col(y){
  if(y==null)return "#2b3242";
  var t=Math.max(-30,Math.min(30,y))/30;
  return t<0?mix(NEU,RED,-t):mix(NEU,GRN,t);
}
// ── 순수 JS squarified treemap ──
function squarify(items,x,y,w,h){
  var total=0,i;for(i=0;i<items.length;i++)total+=items[i].v;
  if(total<=0||w<=0||h<=0)return [];
  var sc=w*h/total,it=[],out=[];
  for(i=0;i<items.length;i++)if(items[i].v>0)it.push({o:items[i],a:items[i].v*sc});
  it.sort(function(a,b){return b.a-a.a;});
  var rx=x,ry=y,rw=w,rh=h,k=0;
  function worst(row,s,len){
    var mx=0,mn=Infinity,j;
    for(j=0;j<row.length;j++){if(row[j].a>mx)mx=row[j].a;if(row[j].a<mn)mn=row[j].a;}
    var s2=s*s,l2=len*len;
    return Math.max(l2*mx/s2,s2/(l2*mn));
  }
  while(k<it.length){
    var len=Math.min(rw,rh),row=[it[k]],s=it[k].a;k++;
    while(k<it.length){
      var s2=s+it[k].a,r2=row.concat([it[k]]);
      if(worst(row,s,len)>=worst(r2,s2,len)){row=r2;s=s2;k++;}else break;
    }
    var thick=s/len,off=0,j;
    for(j=0;j<row.length;j++){
      var side=row[j].a/thick;
      if(rw>=rh)out.push({o:row[j].o,x:rx,y:ry+off,w:thick,h:side});
      else out.push({o:row[j].o,x:rx+off,y:ry,w:side,h:thick});
      off+=side;
    }
    if(rw>=rh){rx+=thick;rw-=thick;}else{ry+=thick;rh-=thick;}
  }
  return out;
}
var map=document.getElementById("u01-map"),detail=document.getElementById("u01-detail"),sel=null;
function phaseTxt(sec){
  var ck=DATA.clock,e=(ck.by_sector||{})[sec];
  if(ck.placeholder||!e||e.phase==null)return "R03 데이터 대기(placeholder)";
  var t=e.phase;
  if(e.phase_angle!=null)t+=" ("+e.phase_angle+"°)";
  if(e.confidence!=null)t+=" · conf "+e.confidence;
  return t;
}
function showDetail(c){
  sel=c.id;
  var now=(c.engine_yoy!=null)?yoyTxt(c.engine_yoy)+(c.nowcast_target?" → "+c.nowcast_target+" 분기":"")
        :"데이터 대기("+(c.engine_state||"미산출")+")";
  var rts="";
  for(var i=0;i<c.routes.length;i++){
    var r=c.routes[i];
    rts+="<li>"+esc(r.label)+" — 창 "+esc(r.window||"관측 부족")+" · "+fmtUsd(r.cur_usd)
       +" · YoY("+esc(r.metric)+") "+yoyTxt(r.yoy)+" · w "+esc(r.w_mid)+"</li>";
  }
  var grade=c.grade||"미평가";
  detail.innerHTML=
    '<div class="u01-dhead"><b>'+esc(c.name)+'</b><span class="tk">'+esc(c.ticker)+" · "
    +esc(DATA.sector_label[c.sector]||c.sector)+'</span>'
    +'<span class="u01-gbadge" style="background:'+gcol(c.grade)+'">품질 '+esc(grade)+'</span>'
    +(c.research_only?'<span class="u01-gbadge" style="background:#6b7280">연구전용</span>':"")
    +'<button type="button" class="u01-x" id="u01-close" aria-label="미니카드 닫기">✕ 닫기</button></div>'
    +'<div class="u01-chips">'
    +'<div class="u01-chip"><div class="l">현 국면</div><div class="v" style="font-size:12px">'
    +esc(phaseTxt(c.sector))+'</div></div>'
    +'<div class="u01-chip"><div class="l">최신 나우캐스트 YoY</div><div class="v">'+now
    +'</div><div class="s">컴포짓 엔진 corr_yoy</div></div>'
    +'<div class="u01-chip"><div class="l">프록시 최신 3M YoY</div><div class="v">'+yoyTxt(c.proxy_yoy)
    +'</div><div class="s">route 축(metric) 기준</div></div>'
    +'<div class="u01-chip"><div class="l">최신 3M 무역금액</div><div class="v">'+fmtUsd(c.size_usd)
    +'</div><div class="s">귀속가중 중앙값 적용</div></div>'
    +'<div class="u01-chip"><div class="l">다음 발표</div><div class="v" style="font-size:12px">'
    +esc(c.report||"모른다")+'</div></div>'
    +'</div><ul class="u01-routes">'+rts+'</ul>';
  detail.classList.add("on");
  var b=document.getElementById("u01-close");
  if(b)b.onclick=function(){detail.classList.remove("on");sel=null;render();};
  render();
}
function render(){
  var W=map.clientWidth,H=map.clientHeight;
  if(!W||!H)return;
  map.innerHTML="";
  var secs=[],waits=[],i,j;
  for(i=0;i<DATA.sector_order.length;i++){
    var sk=DATA.sector_order[i],mem=[],tot=0;
    for(j=0;j<DATA.companies.length;j++){
      var c=DATA.companies[j];
      if(c.sector!==sk)continue;
      if(c.size_usd&&c.size_usd>0){mem.push(c);tot+=c.size_usd;}
      else waits.push(c);
    }
    if(tot>0)secs.push({k:sk,v:tot,mem:mem});
  }
  var srects=squarify(secs.map(function(s){return {v:s.v,ref:s};}),0,0,W,H);
  for(i=0;i<srects.length;i++){
    var sr=srects[i],s=sr.o.ref;
    var sd=document.createElement("div");
    sd.className="u01-sec";
    sd.style.cssText="left:"+sr.x+"px;top:"+sr.y+"px;width:"+sr.w+"px;height:"+sr.h+"px";
    var head=0;
    if(sr.h>44&&sr.w>60){
      head=16;
      var hd=document.createElement("div");
      hd.className="u01-sechead";
      hd.textContent=(DATA.sector_label[s.k]||s.k)+" · "+fmtUsd(s.v);
      hd.title="국면: "+phaseTxt(s.k);
      sd.appendChild(hd);
    }
    var brects=squarify(s.mem.map(function(c){return {v:c.size_usd,ref:c};}),
                        1,head+1,Math.max(0,sr.w-2),Math.max(0,sr.h-head-2));
    for(j=0;j<brects.length;j++){
      (function(br){
        var c=br.o.ref,bd=document.createElement("button");
        bd.type="button";
        bd.className="u01-box"+(sel===c.id?" sel":"");
        bd.setAttribute("data-company",c.id);
        bd.setAttribute("aria-controls","u01-detail");
        bd.setAttribute("aria-expanded",sel===c.id?"true":"false");
        bd.style.cssText="left:"+br.x+"px;top:"+br.y+"px;width:"+Math.max(0,br.w-1)
          +"px;height:"+Math.max(0,br.h-1)+"px;background:"+col(c.color_yoy);
        bd.title=c.name+" ("+c.ticker+") · "+fmtUsd(c.size_usd)+" · YoY "+yoyTxt(c.color_yoy)
          +" ["+c.color_src+"] · 품질 "+(c.grade||"미평가");
        bd.setAttribute("aria-label",bd.title);
        if(br.w>44&&br.h>26){
          var lb=document.createElement("div");
          lb.className="u01-bl";
          lb.innerHTML=c.id+(br.h>40?'<span class="y">'+yoyTxt(c.color_yoy)+"</span>":"")
            +(c.research_only&&br.h>54?'<span class="tag">연구전용</span>':"");
          bd.appendChild(lb);
        }
        bd.onclick=function(){showDetail(c);};
        sd.appendChild(bd);
      })(brects[j]);
    }
    map.appendChild(sd);
  }
  var wd=document.getElementById("u01-wait");
  if(waits.length){
    var t=[];
    for(i=0;i<waits.length;i++)t.push(waits[i].id);
    wd.textContent="⚠ 크기 미산출(데이터/환율 대기): "+t.join(", ")+" — 박스 제외, 창작값으로 메우지 않음";
  }else wd.textContent="";
}
var asof=document.getElementById("u01-asof");
asof.textContent=" · 레지스트리 "+(DATA.asof.registry||"?")+" · 엔진 "+(DATA.asof.engine||"미산출")
  +" · 품질 "+(DATA.asof.quality||"미산출")+" · 빌드 "+DATA.asof.built;
var rt=null;
window.addEventListener("resize",function(){clearTimeout(rt);rt=setTimeout(render,120);});
render();
})();
</script>
</section>"""


def render_treemap_section(data: dict) -> str:
    fx = data.get("fx")
    notes = []
    if fx:
        notes.append(f"USD 환산 환율 JPY {fx['JPY']:.2f}·THB {fx['THB']:.2f} "
                     f"({fx['asof']}, {fx['source']})")
    else:
        notes.append("환율 미확보 — 엔/바트 route 종목은 '환율 대기' 처리")
    if data["clock"]["placeholder"]:
        notes.append("사이클 국면: R03_CLOCK 미산출 — placeholder 표기")
    html = _TEMPLATE.replace("__SUBNOTE__", " · ".join(notes))
    return html.replace("__DATA__", json.dumps(data, ensure_ascii=False, separators=(",", ":")))


def build_treemap_section(**kwargs) -> str:
    """ensemble_page_build.py 진입점: 데이터 집계 후 섹션 html 조각 반환."""
    return render_treemap_section(build_treemap_data(**kwargs))


# ── 단독 실행: 조각 + 데이터 + 검증용 standalone preview 생성 ────────────────
_PREVIEW_SHELL = """<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>U01 트리맵 — 검증용 preview</title>
<style>
:root{--bg:#0b0e14;--card:#12151d;--card2:#171b26;--line:#232a3a;--ink:#dce3f0;--sub:#8a93a6;
--blue:#5aa9ff;--blue2:#3d6fd8;--green:#2fae66;--red:#e2574f;--gold:#c9a24a;}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font-family:"Apple SD Gothic Neo",Pretendard,system-ui,sans-serif;font-size:14px;line-height:1.55}
.wrap{max-width:1080px;margin:0 auto;padding:20px 14px 60px}
h1{font-size:20px;margin:0 0 10px}
</style></head><body><div class="wrap">
<h1>Ensemble — U01 밸류체인 강도 맵 (검증용 단독 렌더)</h1>
__SECTION__
</div></body></html>"""


def main() -> None:
    data = build_treemap_data()
    frag = render_treemap_section(data)
    (OUT_DIR / "treemap_data.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    (OUT_DIR / "section_U01_treemap.html").write_text(frag, encoding="utf-8")
    (OUT_DIR / "preview_U01.html").write_text(
        _PREVIEW_SHELL.replace("__SECTION__", frag), encoding="utf-8")
    n_sized = sum(1 for c in data["companies"] if c["size_usd"])
    n_eng = sum(1 for c in data["companies"] if c["engine_yoy"] is not None)
    n_proxy = sum(1 for c in data["companies"]
                  if c["engine_yoy"] is None and c["proxy_yoy"] is not None)
    print(f"[U01] 기업 {len(data['companies'])} · 크기산출 {n_sized} · "
          f"색=엔진 {n_eng} · 색=프록시 {n_proxy} · "
          f"FX {'OK ' + format(data['fx']['JPY'], '.2f') if data['fx'] else '대기'} · "
          f"clock {'placeholder' if data['clock']['placeholder'] else 'R03 실물'}")
    for c in data["companies"]:
        print(f"  {c['id']:10s} {c['sector']:7s} size={c['size_usd']} "
              f"color={c['color_yoy']} [{c['color_src']}] grade={c['grade']}")


if __name__ == "__main__":
    main()
