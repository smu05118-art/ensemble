#!/usr/bin/env python3
"""U02_CALENDAR 산출물의 데이터·DOM 계약을 표준 라이브러리로 검증한다."""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
import sys
from collections import Counter
from html.parser import HTMLParser
from pathlib import Path


HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
BUILDER = HERE / "u02_calendar_build.py"
FRAGMENT = HERE / "u02_calendar.html"
PREVIEW = HERE / "u02_preview.html"
DATA_FILE = HERE / "u02_calendar_data.json"
DATE_RE = re.compile(r"^20\d{2}-\d{2}-\d{2}$")
ALLOWED_SOURCES = {
    "earnings_cal", "ecal_us_eu", "ecal_jp", "ecal_kr", "ecal_tw",
    "tw_monthly", "registry",
}
EXPECTED_INPUTS = {
    "earnings_cal", "ecal_us_eu", "ecal_kr", "ecal_tw", "ecal_jp", "registry",
}
EXPECTED_IDS = {
    "u02-calendar", "u02-prev", "u02-title", "u02-next", "u02-today",
    "u02-grid", "u02-detail",
}


class AuditParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids: list[str] = []
        self.external_scripts: list[str] = []
        self.lang = None
        self.has_viewport = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag == "script" and attrs.get("src"):
            self.external_scripts.append(attrs["src"])
        if tag == "html":
            self.lang = attrs.get("lang")
        if tag == "meta" and attrs.get("name") == "viewport":
            self.has_viewport = True


def fail(message: str) -> None:
    raise AssertionError(message)


def load_builder():
    spec = importlib.util.spec_from_file_location("u02_calendar_build", BUILDER)
    if spec is None or spec.loader is None:
        fail("빌더 import spec 생성 실패")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def continuous_months(months: list[str]) -> bool:
    if not months:
        return False
    cursor_y, cursor_m = map(int, months[0].split("-"))
    expected = []
    end = months[-1]
    while True:
        current = f"{cursor_y:04d}-{cursor_m:02d}"
        expected.append(current)
        if current == end:
            break
        cursor_m += 1
        if cursor_m == 13:
            cursor_y, cursor_m = cursor_y + 1, 1
    return expected == months


def main() -> None:
    for path in (BUILDER, FRAGMENT, PREVIEW, DATA_FILE):
        if not path.is_file() or path.stat().st_size == 0:
            fail(f"필수 산출물 없음/빈 파일: {path.name}")

    module = load_builder()
    rebuilt_data, stats = module.collect()
    saved_data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    if saved_data != rebuilt_data:
        fail("감사 JSON이 현재 원천을 다시 읽은 결과와 다름")

    dates = set(saved_data["cov"]) | set(saved_data["oth"])
    if not dates or not all(DATE_RE.fullmatch(date) for date in dates):
        fail("일정 날짜 형식 오류")
    if not continuous_months(saved_data["months"]):
        fail("월 목록이 비어 있거나 연속 범위가 아님")
    if min(dates)[:7] != saved_data["months"][0] or max(dates)[:7] != saved_data["months"][-1]:
        fail("월 범위가 실제 일정 날짜 범위와 불일치")
    provenance = saved_data.get("provenance") or {}
    input_rows = provenance.get("inputs") or []
    if provenance.get("economic_indicators_included") is not False:
        fail("경제지표 제외 계보 플래그 오류")
    if {row.get("id") for row in input_rows} != EXPECTED_INPUTS:
        fail("입력 원천 계보 누락/추가")
    if any(not re.fullmatch(r"[0-9a-f]{64}", row.get("sha256", "")) for row in input_rows):
        fail("입력 원천 해시 오류")

    cover_keys = []
    sources = set()
    for date, events in saved_data["cov"].items():
        for event in events:
            if event["d"] != date or not event["id"] or not event["sec"]:
                fail("커버 일정 필수 필드 오류")
            cover_keys.append((event["id"], date))
            sources.update(filter(None, event["src"].split("+")))
    dupes = [key for key, count in Counter(cover_keys).items() if count > 1]
    if dupes:
        fail(f"커버 종목·날짜 중복: {dupes[:3]}")
    if not sources or not sources <= ALLOWED_SOURCES:
        fail(f"허용되지 않은 데이터 소스: {sorted(sources - ALLOWED_SOURCES)}")

    other_count = 0
    for date, markets in saved_data["oth"].items():
        for market, cell in markets.items():
            if not market or cell["n"] < len(cell["i"]):
                fail(f"비커버 집계 오류: {date}/{market}")
            if any(len(item) != 5 for item in cell["i"]):
                fail(f"비커버 상세 스키마 오류: {date}/{market}")
            other_count += cell["n"]
    if other_count != stats["oth_rows"]:
        fail("비커버 행 합계 불일치")

    fragment = FRAGMENT.read_text(encoding="utf-8")
    preview = PREVIEW.read_text(encoding="utf-8")
    builder_text = BUILDER.read_text(encoding="utf-8")
    if "/Users/kioxia/ensemble/" in builder_text or 'jem / "preview"' in builder_text:
        fail("미니 전용 경로가 빌더에 남아 있음")
    for required in ("경제지표 제외", "투자판단 참고용", "추정", "모른다", "window.U02_DATA"):
        if required not in fragment:
            fail(f"필수 고지/기능 문자열 누락: {required}")
    for behavior in ("isPin(ds)", "move(-1)", "move(1)", "addEventListener('keydown'",
                     "aria-pressed", "u02-market-count", "selDate=TODAY"):
        if behavior not in fragment:
            fail(f"상호작용 계약 누락: {behavior}")

    match = re.search(r"window\.U02_DATA=(.*?);</script>", fragment, re.S)
    if not match or json.loads(match.group(1).replace("<\\/", "</")) != saved_data:
        fail("HTML 인라인 데이터와 감사 JSON 불일치")

    frag_parser = AuditParser()
    frag_parser.feed(fragment)
    counts = Counter(frag_parser.ids)
    if set(counts) != EXPECTED_IDS or any(counts[item] != 1 for item in EXPECTED_IDS):
        fail(f"DOM id 계약 오류: {dict(counts)}")
    if frag_parser.external_scripts:
        fail(f"외부 스크립트 의존 발견: {frag_parser.external_scripts}")

    node = shutil.which("node")
    if node is None:
        fail("JavaScript 구문 검사용 node 실행파일 없음")
    scripts = re.findall(r"<script(?:\s[^>]*)?>(.*?)</script>", fragment, re.S | re.I)
    if len(scripts) != 2:
        fail(f"인라인 스크립트 수 오류: {len(scripts)}")
    for index, script in enumerate(scripts, 1):
        checked = subprocess.run(
            [node, "--check"], input=script, text=True, capture_output=True, check=False)
        if checked.returncode:
            fail(f"인라인 JavaScript {index} 구문 오류: {checked.stderr.strip()}")

    preview_parser = AuditParser()
    preview_parser.feed(preview)
    if preview_parser.lang != "ko" or not preview_parser.has_viewport:
        fail("단독 미리보기의 한글/모바일 메타 누락")
    if not preview.lstrip().lower().startswith("<!doctype html>"):
        fail("단독 미리보기가 완전한 HTML 문서가 아님")

    print("PASS U02_CALENDAR")
    print(f"cover_companies={stats['companies']} cover_events={stats['cov_events']} cover_days={stats['cov_days']}")
    print(f"other_rows={stats['oth_rows']} calendar_days={stats['days']} months={len(stats['months'])}")
    print(f"inputs={','.join(sorted(EXPECTED_INPUTS))} external_scripts=0 dom_ids={len(EXPECTED_IDS)} js_syntax=PASS")


if __name__ == "__main__":
    main()
