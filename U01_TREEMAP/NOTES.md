# U01_TREEMAP 결과 노트

완료. 이전 부분산출의 순수 JS 트리맵·다크 시각언어·5섹터 구조를 재사용했고, Studio 실물 경로와 현재 통합 번들로 데이터 연결을 교정했다. HTML은 `u01_treemap_section.py`로 재생성하며 직접 수정하지 않는다.

## 산출물

- `u01_treemap_section.py`: `build_treemap_section()` 통합 진입점 + CSV 집계 + 순수 JS 트맵/미니카드
- `section_U01_treemap.html`: 통합용 `<section id="u01-treemap">` 조각
- `preview_U01.html`: 단독 실렌더 검증용 프리뷰
- `treemap_data.json`: 빌더가 CSV·레지스트리·엔진에서 생성한 인라인 페이로드의 가독형 복사
- `validate_u01.py`, `validation_report.json`: Python 재현·독립 CSV 스팟체크
- `browser_validation.json`: 박스 클릭·닫기·모바일 실렌더 검증 결과
- `fx_cache.json`: JPY·THB←USD 실측 환율 캐시

동일 인계본을 `~/Downloads/integ_wave/bundle/ensemble/site/U01_TREEMAP/`에도 배치했다.

## 실물 입력

- 무역 CSV: `~/phalanx/jem_data/` 의 `us_long.csv`, `rack_long.csv`, `thai_long.csv`, `estat_long.csv`, `cn_mirror_long.csv`
- 31사 레지스트리 + KIOXIA 연구전용 샤드: `~/Downloads/integ_wave/bundle/ensemble/registry/`
- E16 품질등급: `~/Downloads/integ_wave/bundle/ensemble/quality_verdicts.json`의 `model_quality_e16`
- 나우캐스트: `~/Downloads/integ_wave/bundle/ensemble/out/out.json`의 `est.corr_yoy` (`state=ready`만)
- 사이클: `~/Downloads/rot_wave/out/R03_CLOCK/cycle_clock.json`이 아직 없어 명시적 `R03 데이터 대기(placeholder)` 처리

`kr_long.csv`, `memory/`, `ppi/`, `tw_revenue.json`, `ecal/`도 확인했지만 U01 레지스트리 route 집계에는 직접 쓰이지 않았다. 해당 소스는 U02/U03 영역이다.

## 집계 계약

- 박스 크기: 종목별 route의 최신 연속 3개월 무역금액 × 귀속가중 중앙값. USD 외 JPY·THB는 실측 환율로 USD 환산. 시총이 아님.
- 색상: 최신 컴포짓 `corr_yoy` 우선, 없으면 route 최신 3M YoY. 색상 계산은 -30%~+30% 클리핑.
- 미니카드: 현 국면, E16 품질등급, 최신 나우캐스트, 프록시 3M YoY·금액, 다음 발표, route 근거.
- 데이터 없음은 창작값으로 메우지 않고 `데이터 대기`/`미평가`/`모른다`로 노출.

## 검증 결과

- `python3 u01_treemap_section.py`: 32종목, 크기 산출 32, 5섹터, 색=엔진 17/프록시 15, KIOXIA 연구전용.
- `python3 validate_u01.py`: PASS. DELL(`us_long`), LONGI(`cn_mirror_long`), KIOXIA(`estat_long`) route를 원시 CSV에서 독립 재집계해 창·금액·YoY 일치. 31사 E16 등급과 31사 엔진 `corr_yoy` 전수 일치.
- 브라우저 실렌더: DELL 클릭 시 +33.3% 나우캐스트·품질 B·발표일·route 2건 표시, 닫기 후 카드 숨김/선택 해제. KIOXIA 클릭 시 `연구전용`·`미평가`·`나우캐스트 데이터 대기`·`정확한 날짜 모른다` 표시.
- 375px 모바일: 5섹터·32 버튼 유지, 수평 오버플로 없음.

## 재생성

```bash
cd ~/Downloads/ui_wave/out/U01_TREEMAP
python3 u01_treemap_section.py
python3 validate_u01.py
```

통합 빌더에서는 본 디렉터리를 import path에 두고 `from u01_treemap_section import build_treemap_section`한 뒤, 반환 HTML을 U01 슬롯에 삽입하면 된다. 외부 D3·서버 의존은 없다.

I08 통합 시 `U01_BUNDLE_DIR`가 없으면 Studio 번들 경로가 존재할 때 그 경로를,
없을 때 미니 `~/ensemble`을 선택하도록 기본 경로를 보강했다. 기존 환경변수
오버라이드는 유지하며, I08에서 독립 CSV 스팟체크를 다시 통과했다.

## 한계·유의

- R03 국면 파일이 미산출이므로 현 국면은 아직 모른다. placeholder를 스키마 가정과 함께 명시했다.
- KIOXIA는 E16 평가 범위 밖 연구전용이며 품질등급과 엔진 나우캐스트가 없다. 다음 발표의 정확한 날짜도 모른다.
- 무역 route는 회사 전용 매출이 아닌 귀속 프록시다. 박스 크기는 시총·기업가치가 아니다.
- 최신 3M 창은 원천별 공표 지연에 따라 다를 수 있다. 현 산출의 최신월은 US/rack 2026-06, Thai 2026-05, JP/CN mirror 2026-07이다.

**투자판단 참고용이며 투자 권유가 아니다.**
