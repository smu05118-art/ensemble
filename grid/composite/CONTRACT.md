# 전력기기 컴포짓 — 데이터 계약 (grid-composite/1)

산일전기(062040) 피어의 **공식 실적(타깃)** 과 **외부 프록시(월별 관측)** 를 모아
선행성·동행성을 검정하고, 검증을 통과한 프록시만 앙상블 컴포짓으로 묶는다.
이 문서는 수집 에이전트·빌더·화면이 공유하는 파일 계약이다. 계약에 맞지 않는 파일은
빌더가 **읽지 않고 실패 사유를 남긴다**(fail-closed).

## 0. 원칙

1. **원문만 싣는다.** 모든 숫자에 `source_url` 과 `locator`(페이지·표·행)를 붙인다.
   검색 스니펫·애그리게이터(야후·인베스팅·스크리너)·언론 기사 숫자는 싣지 않는다.
   예외: 원문 접근이 막혀 다른 공식 경로(거래소 공시 사본, 규제기관 XBRL)로 확인한 경우
   그 경로를 `source_url` 로 적는다.
2. **추정하지 않는다.** 누계에서 분기를 만드는 차분(`ytd_difference`, `annual_minus_9m`)은
   허용하되 `method` 에 적는다. 환율 환산·비율 역산·보간은 금지.
3. **모르면 비운다.** 빈 분기는 빼고 `gaps` 에 이유를 적는다. 0 은 원문이 0 일 때만.
4. **범위를 섞지 않는다.** 연결·세그먼트·별도는 서로 다른 타깃이다. 세그먼트 재편·인수·
   매각은 `structural_breaks` 에 날짜와 함께 남긴다.
5. **통화 환산 금지.** 타깃은 보고 통화 그대로, 모델은 로그 YoY 로만 비교한다.

## 1. 실적 파일 `data/actuals/<ID>.json`

```json
{
  "schema": "grid-composite-actuals/1",
  "id": "ABB",
  "grid_node": "GRID_ABB",
  "name": "ABB Ltd",
  "ticker": "ABBN SW",
  "listed": true,
  "currency": "USD",
  "unit": "million",
  "accounting_basis": "IFRS",
  "fiscal_year_end_month": 12,
  "quarter_calendar": "calendar | 4-4-5 | 13-week(Saturday) | ...",
  "collected_at": "2026-09-25",
  "targets": {
    "revenue_total": {
      "label_ko": "연결 매출",
      "scope": "consolidated",
      "freq": "Q",
      "primary": false,
      "points": [
        {
          "fiscal_key": "FY2024Q1",
          "period_start": "2024-01-01",
          "period_end": "2024-03-31",
          "value": 7859.0,
          "prior_year_comparative": 8130.0,
          "method": "direct_reported_quarter | ytd_difference | annual_minus_9m | sum_of_monthly",
          "source_url": "https://…",
          "locator": "Q1 2024 press release p.9 'Revenues' table",
          "published_date": "2024-04-18"
        }
      ]
    },
    "revenue_segment": { "...": "관련 세그먼트(예: Electrification). scope=segment, segment_name 필수" },
    "orders_segment":  { "...": "선택. 수주·orders 공시가 있으면. metric 이 다르므로 매출과 합치지 않는다" },
    "revenue_monthly": { "...": "freq=M (대만 MOPS 월매출 등). points 에 month='YYYY-MM'" }
  },
  "primary_target": "revenue_segment",
  "structural_breaks": [
    {"date": "2024-10-07", "type": "acquisition|divestiture|segment_reorg|restatement|listing",
     "note": "…", "source_url": "…"}
  ],
  "profile": {
    "products": "변압기 종류·전압·용량 범위 등 원문 근거 요약",
    "plants": [{"country": "MX", "city": "Monterrey", "products": "distribution transformers", "source_url": "…"}],
    "end_markets": "…",
    "export_routes": ["MX->US", "CA->US"],
    "hs_candidates": ["850421", "850422", "850433", "850434"],
    "proxy_routes": [
      {"proxy_hint": "us_imp_850434_p484", "why": "멕시코 공장 → 미국 건식 대형 변압기", "expected_sign": "+",
       "role": "primary|diagnostic"}
    ]
  },
  "gaps": ["FY2019Q2: 보고서 PDF 접근 불가(403) — 비움"],
  "collection_notes": ["…"]
}
```

규칙
- `points` 는 기간 오름차순, `fiscal_key` 중복 금지.
- `period_end` 는 원문 결산일(4-4-5·토요일 결산이면 그 날짜). 모르면 `null` + `period_end_note`.
- `prior_year_comparative`: 같은 보고서가 인쇄한 전년 동기 값(재작성 반영). 없으면 생략.
  빌더는 이 값이 있으면 YoY 분모로 우선 쓴다(동일 범위 YoY).
- `primary_target`: 모델 타깃. 세그먼트가 회사의 변압기·배전 노출을 더 잘 대표하면 세그먼트.
- 월매출(`freq=M`) 은 `month` 키를 쓰고 `period_start/end` 는 생략 가능.
- 비상장·실적 미공시 회사는 `listed=false`, `targets={}` 로 두고 `profile` 만 채운다.
- 최소 이력 목표: 2016Q1 이후 가능한 전 분기(최소 2019Q1~최신).

## 2. 프록시 파일 `data/proxies/<family>.json`

```json
{
  "schema": "grid-composite-proxy/1",
  "family": "comtrade_us_imports",
  "fetched_at": "2026-09-25T09:00:00Z",
  "fetch_tool": "grid/composite/tools/fetch_comtrade.py",
  "source": {"name": "UN Comtrade public preview API", "url": "https://comtradeapi.un.org/public/v1/preview/C/M/HS"},
  "series": {
    "us_imp_850422_p410": {
      "label": "US imports HS850422 from Korea",
      "label_ko": "미국 수입 HS850422(유입식 650~10,000kVA) · 한국발",
      "unit": "USD", "freq": "M", "agg": "sum",
      "kind": "trade_route | trade_total | production | shipments | orders | price | construction | company_monthly | investment",
      "geo": "US", "hs": "850422", "reporter": "842", "partner": "410", "flow": "M",
      "release_lag_days": 60,
      "notes": "",
      "obs": {"2015-01": 12345.0, "2015-02": 23456.0}
    }
  },
  "errors": []
}
```

규칙
- `obs` 는 `YYYY-MM` → 숫자. 결측 월은 **키를 빼고**(0 으로 채우지 않는다) 원문이 0 이면 0.
- `agg`: 분기 합산 방식. 유량(수출입·출하·매출)=`sum`, 지수·가격=`mean`, 잔량(재고·수주잔)=`last`.
- `release_lag_days`: 해당 월 말일 → 첫 공표까지 대략 일수(나우캐스트 가용성 판단용).
- 수집기는 **파이썬 stdlib 만** 사용(urllib·json·csv·zipfile·xml). 원자적 쓰기(tmp→os.replace),
  키 정렬·들여쓰기 1, 실패 시 기존 파일 보존. 원자료 응답은 `data/raw/<family>/` 에 캐시 가능
  (파일당 5MB 이하, 필요 없으면 커밋하지 않는다).

## 3. 시리즈 ID 규칙

| 종류 | 형식 | 예 |
|---|---|---|
| 미국 수입 | `us_imp_<hs6>_p<partner>` | `us_imp_850423_p484` |
| 국가 수출 | `<iso2>_exp_<hs6>_p<partner>` (partner 0=World) | `kr_exp_850422_p842` |
| 매크로 | `<src>_<code>` | `fred_IPG3353S`, `eurostat_ip_C271_DE` |
| 회사 월매출 | `mops_<code>` | `mops_1519` |
| TRASS 회사 수출 | `trass_<name>_<port>` | `trass_sanil_T267` |

## 4. 빌더가 하는 일 (요약 — 상세는 README.md)

1. 회계 분기 ↔ 달력 월 정렬(명목 분기 월, 3/3 개월 완결만).
2. 로그 YoY 변환(타깃은 `prior_year_comparative` 우선).
3. 선후행: 시차 k=−2…+4 분기(월 타깃은 −6…+12 개월) 교차상관 — 원계열·사전백색화 두 가지,
   자기상관 보정 유효표본(n_eff), BH-FDR. 전환점(국면) 선행 개월/분기 중앙값·일치율.
4. rolling-origin(확장창, 최소 학습 8분기) 단일 프록시 OOS — 시차는 각 원점의 학습 구간에서만 선택.
5. 앙상블: 학습 구간 선별 → 동일가중·역MSE 결합 → OOS, 기준모형(0YoY·직전YoY·학습평균·AR1) 대비.
6. 게이트 통과 회사만 현재 분기 나우캐스트(적합 오차 기반 conformal 80% 구간) 공개.
