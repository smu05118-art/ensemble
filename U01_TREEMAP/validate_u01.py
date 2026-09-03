#!/usr/bin/env python3
"""U01 산출 데이터·정적 HTML 계약을 독립 검증한다."""
from __future__ import annotations

import csv
import json
import math
from pathlib import Path

import u01_treemap_section as u01


HERE = Path(__file__).resolve().parent
DATA_PATH = HERE / "treemap_data.json"
FRAGMENT_PATH = HERE / "section_U01_treemap.html"
PREVIEW_PATH = HERE / "preview_U01.html"
REPORT_PATH = HERE / "validation_report.json"
SPOT_ROUTES = (("DELL", "usimp"), ("LONGI", None), ("KIOXIA", "jp_flash_ic"))


def shift_month(ym: str, delta: int) -> str:
    year, month = map(int, ym.split("-"))
    index = year * 12 + month - 1 + delta
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def latest_window(monthly: dict[str, float]) -> list[str] | None:
    if not monthly:
        return None
    last = max(monthly)
    for back in range(6):
        end = shift_month(last, -back)
        window = [shift_month(end, offset) for offset in (-2, -1, 0)]
        if all(month in monthly for month in window):
            return window
    return None


def independent_route(route: dict, fx: dict) -> dict:
    """UI 빌더 함수를 호출하지 않고 CSV 행에서 route 1개를 다시 집계한다."""
    values: dict[str, float] = {}
    weights: dict[str, float] = {}
    exact_hs = set(route.get("hs") or [])
    prefixes = tuple(route.get("hs_prefix") or [])
    ports = set(route.get("ports") or [])
    countries = set(route.get("countries") or [])
    path = u01.JEM_DATA / route["csv"]

    with path.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            month = row["date"][:7]
            if month < u01.DATE_CUTOFF or row["flow"] != route["flow"]:
                continue
            hs = row["hs"]
            if not ((exact_hs and hs in exact_hs) or (prefixes and hs.startswith(prefixes))):
                continue
            if ports and row["custom"] not in ports:
                continue
            if countries and row["country"] not in countries:
                continue
            if route.get("min_date") and month < route["min_date"]:
                continue
            try:
                values[month] = values.get(month, 0.0) + float(row["value"])
            except ValueError:
                continue
            try:
                weights[month] = weights.get(month, 0.0) + float(row["weight"])
            except ValueError:
                pass

    window = latest_window(values)
    assert window, f"{route['csv']}:{route['id']} 연속 3개월 관측 없음"
    native = sum(values[month] for month in window) * 1000.0
    currency = u01.CSV_CURRENCY.get(route["csv"], "USD")
    current_usd = native if currency == "USD" else native / fx[currency]
    axis = weights if route.get("metric", "value") == "weight" else values
    previous = [shift_month(month, -12) for month in window]
    yoy = None
    if all(month in axis for month in window + previous):
        base = sum(axis[month] for month in previous)
        if base > 0:
            yoy = round((sum(axis[month] for month in window) / base - 1) * 100, 1)
    return {
        "window": f"{window[0]}~{window[-1][5:7]}",
        "cur_usd": current_usd,
        "yoy": yoy,
    }


def load_registries() -> tuple[dict, dict, dict, dict]:
    merged = json.loads(u01.REG_MERGED.read_text(encoding="utf-8"))
    memory = json.loads(u01.REG_MEM.read_text(encoding="utf-8"))
    quality = json.loads(u01.QUALITY_VERDICTS.read_text(encoding="utf-8"))
    engine = json.loads(u01.ENGINE_OUT.read_text(encoding="utf-8"))
    companies = {c["id"]: c for c in merged["companies"]}
    companies.update({c["id"]: c for c in memory.get("companies", [])})
    return companies, quality, engine, merged


def main() -> None:
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    fragment = FRAGMENT_PATH.read_text(encoding="utf-8")
    preview = PREVIEW_PATH.read_text(encoding="utf-8")
    source_companies, quality, engine, merged = load_registries()
    actual = {c["id"]: c for c in data["companies"]}
    quality_by = {c["id"]: c for c in quality["companies"]}
    engine_by = {c["id"]: c for c in engine["companies"]}

    assert set(actual) == set(source_companies), "레지스트리+메모리 종목 합집 불일치"
    assert set(data["sector_order"]) == {"rack", "mem", "optics", "power", "jpeq"}
    assert {c["sector"] for c in data["companies"]} == set(data["sector_order"])
    assert all(c["size_usd"] is not None and c["size_usd"] > 0 for c in data["companies"])
    assert actual["KIOXIA"]["research_only"] is True
    assert actual["KIOXIA"]["grade"] is None

    for cid, verdict in quality_by.items():
        assert actual[cid]["grade"] == verdict["model_quality_e16"], f"{cid} E16 등급 불일치"
    for cid, result in engine_by.items():
        est = result.get("est") or {}
        expected = est.get("corr_yoy") if est.get("state") == "ready" else None
        assert actual[cid]["engine_yoy"] == expected, f"{cid} 엔진 YoY 불일치"

    assert data["asof"]["registry"] == merged["asof"]
    assert data["asof"]["quality"] == quality["asof"]
    assert data["asof"]["engine"] == engine["asof"]
    assert "Math.max(-30,Math.min(30,y))" in fragment, "색상 ±30% 클리핑 계약 누락"
    assert "document.createElement(\"button\")" in fragment, "종목 박스 버튼 계약 누락"
    assert 'data-company' in fragment and 'aria-controls' in fragment
    assert "투자판단 참고용" in preview
    assert "d3" not in fragment.lower()
    assert "<script src=" not in fragment.lower()

    spot_checks = []
    for company_id, route_id in SPOT_ROUTES:
        company = source_companies[company_id]
        route = next(
            r for r in company["routes"]
            if route_id is None or r["id"] == route_id
        )
        independent = independent_route(route, data["fx"])
        index = company["routes"].index(route)
        rendered = actual[company_id]["routes"][index]
        assert rendered["window"] == independent["window"]
        assert math.isclose(rendered["cur_usd"], independent["cur_usd"], rel_tol=1e-12)
        assert rendered["yoy"] == independent["yoy"]
        spot_checks.append({
            "company": company_id,
            "route": route["id"],
            "csv": route["csv"],
            **independent,
        })

    engine_count = sum(c["engine_yoy"] is not None for c in data["companies"])
    proxy_count = sum(c["engine_yoy"] is None and c["proxy_yoy"] is not None
                      for c in data["companies"])
    report = {
        "status": "PASS",
        "companies": len(actual),
        "sectors": data["sector_order"],
        "sized_companies": sum(c["size_usd"] is not None for c in data["companies"]),
        "color_sources": {"engine": engine_count, "proxy_3m": proxy_count},
        "clock": "placeholder" if data["clock"]["placeholder"] else "R03",
        "spot_checks": spot_checks,
        "contracts": {
            "pure_js_no_d3": True,
            "clip_yoy_pct": [-30, 30],
            "clickable_company_buttons": True,
            "investment_disclaimer": True,
        },
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
