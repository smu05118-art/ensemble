# U02_CALENDAR 완료 노트

## 결과

- `u02_calendar_build.py`가 지정 실데이터를 다시 읽어 `u02_calendar.html` 조각, `u02_preview.html` 단독 미리보기, `u02_calendar_data.json` 감사 스냅샷을 생성한다. 생성 HTML 직접 수정은 금지한다.
- 커버 기업 31사, 커버 일정 76건/27일, 비커버 일정 7,554건, 전체 일정일 82일을 수록했다.
- 월 범위는 2026-05~2027-02(10개월)이며, 실행일이 범위에 있으면 해당 월을 기본 표시한다.
- 기업실적·IR 일정만 사용했다. 경제지표 입력은 없고 감사 JSON의 `provenance.economic_indicators_included=false` 및 입력 6종 SHA-256으로 고정했다.
- 앙상블 커버 일정은 굵은 섹터색 칩, 비커버 일정은 국가/시장 배지와 건수로 접었다. 날짜 선택 시 시장·장전/장후(없으면 `시각 모른다`)·컨센서스 유무·확정/추정을 표시한다.
- 오늘 하이라이트, 월 이동, 날짜 클릭/Enter/Space 선택, T-3 동적 핀 로직을 포함한다.
- 2026-09-03 기준 T-3(9/3~9/6)에 커버 일정이 없어 표시되는 핀은 0개다. 이는 누락이 아니며, 브라우저 실행일 기준 T-3에 커버 일정이 들어오면 자동 표시된다.

## 실데이터 원천

- `~/phalanx/jem_data/earnings_cal.json`
- `~/phalanx/jem_data/ecal_us_eu.json`
- `~/phalanx/jem_data/ecal_kr.json`
- `~/phalanx/jem_data/ecal_tw.json`
- `~/phalanx/jem_data/ecal/ecal_jp.json`
- `~/Downloads/integ_wave/bundle/ensemble/registry/_merged.json`

원천 기준일은 실적 2026-09-02, US/EU IR 2026-08-31, KR/TW 2026-08-21, JP 2026-08-12~09-09, 레지스트리 2026-09-02다. 세부 경로와 해시는 `u02_calendar_data.json`에 있다.

## 추정·모른다 처리

- 원천의 `est=true` 또는 레지스트리 문구의 `추정/잠정`만 추정으로 표시했다. 확정은 원천 `confirmed=true` 또는 레지스트리의 `확정/공시` 표기만 사용했다.
- 한국 일정에는 DART 접수패턴 예측과 법정기한 대리치가 포함된다. `excluded=true` 412행도 실제 기업 일정 원천이므로 삭제하지 않고 비커버 접힘 집계에 보존했다.
- 대만 분기 일정은 법정기한, 월매출은 공고 기한이다. 개별 회사의 실제 발표시각으로 해석하면 안 된다.
- SCREEN은 `2026-10월 하순`이라 정확한 날짜를 모른다. JEM은 TDnet·회사 IR 미공시로 날짜를 모른다. 날짜 없는 커버 항목은 달력에서 만들지 않고 하단 `일정 미확정 커버`에 그대로 남겼다.
- 시장/원천에 발표시각 또는 컨센서스가 없으면 값을 만들지 않고 각각 `시각 모른다`, `컨센 없음`으로 표시했다.

## 재생성·검증

```bash
cd ~/Downloads/ui_wave/out/U02_CALENDAR
python3 u02_calendar_build.py
python3 verify_u02.py
```

2026-09-03 실검증 결과:

```text
PASS U02_CALENDAR
cover_companies=31 cover_events=76 cover_days=27
other_rows=7554 calendar_days=82 months=10
inputs=earnings_cal,ecal_jp,ecal_kr,ecal_tw,ecal_us_eu,registry external_scripts=0 dom_ids=7 js_syntax=PASS
```

검증 범위는 원천 재로드와 감사 JSON 일치, 날짜/월 연속성, 커버 중복, 허용 소스, 비커버 합계, 필수 DOM ID 유일성, 외부 스크립트 0건, 한글/모바일 메타, 인라인 JavaScript 구문 및 상호작용 계약이다.

로컬 `file://` 미리보기의 실제 브라우저 오픈은 브라우저 보안 정책에서 차단되어 클릭·시각 렌더는 확인하지 못했다. 우회하지 않았으며, 이 부분은 모른다. Python DOM 검증과 Node JavaScript 구문 검증은 통과했다.

## 통합 계약

`ensemble_page_build.py`에서는 다음처럼 조각을 받아 U01과 U03 사이에 삽입한다.

```python
from u02_calendar_build import build_calendar_section

u02_html, u02_stats = build_calendar_section()
```

섹션 루트 ID는 `u02-calendar`다. 모든 CSS는 이 ID 아래로 한정했고 데이터와 동작 스크립트는 인라인이므로 서버와 외부 네트워크가 필요 없다.

I08 통합 시 레지스트리 경로는 `ENSEMBLE_REGISTRY_PATH`가 있으면 그 값을 사용하고,
그렇지 않으면 Studio 번들 경로가 존재할 때 Studio 경로를, 없을 때 미니
`~/ensemble/registry/_merged.json`을 사용하도록 보강했다. 데이터 값과 렌더 산출은
바꾸지 않았으며 I08에서 원천 재로드 검증을 다시 통과했다.

일정 정보는 투자판단 참고용이다. 추정일·법정기한 대리치를 포함하므로 실제 발표 전 회사 IR·공시를 다시 확인해야 한다.
