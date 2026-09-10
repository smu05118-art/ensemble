#!/usr/bin/env python3
"""Curated financial additions, preserving existing observations and revisions."""
import hashlib
import json
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
path = ROOT / 'cloud/data/ledger.json'
ledger = json.loads(path.read_text())
research = json.loads((ROOT / 'cloud/data/research.json').read_text())
NOW = research['updated']

def add(provider, metric, title, value, unit, axis, source, period, effective, note, direction=None, rule='', evidence='confirmed'):
    src = research['sources'][source]
    key = f'reviewed:{provider}:{metric}:{period}'
    previous = [s for s in ledger['signals'] if s['key'] == key]
    row = dict(key=key, provider=provider, metric=metric, title=title, value=round(value, 6), unit=unit, axis=axis,
               source_url=src['url'], source_path='공식 실적발표 원문 대조', period=period, effective_at=effective,
               note=note, scope=title, direction=direction, rule=rule, evidence=evidence, verified=True,
               verified_at=NOW, published_at=src['published_at'], observed_at=NOW,
               first_seen_at=previous[0]['first_seen_at'] if previous else NOW,
               origin='reviewed', correlation_group=src['url'])
    digest = hashlib.sha256(json.dumps(row, sort_keys=True).encode()).hexdigest()
    if previous and previous[-1].get('fingerprint') == digest:
        return
    row.update(fingerprint=digest, revision=max((s['revision'] for s in previous), default=0)+1)
    row['id'] = hashlib.sha256((key+':'+str(row['revision'])).encode()).hexdigest()[:20]
    ledger['signals'].append(row)

add('NBIS','fcf','전사 분기 FCF',2246.1-5657.4,'USD M','funding','nbis_fin','2026-Q2','2026-06-30','동일 분기 영업현금흐름 − PP&E·무형자산 현금지출. 선수금 영향 포함.',-1,'동일 분기 전사 FCF가 음수.')
add('NBIS','group_revenue','전사 분기 매출',582.3,'USD M','demand','nbis_fin','2026-Q2','2026-06-30','Q1 399M = H1 981.3 − Q2 582.3. AI cloud 575M와 범위 구분.',1,'같은 연결 범위의 직전 분기 매출 399M 대비 증가.')
add('NBIS','cash_capex','PP&E·무형자산 현금 CAPEX',5657.4,'USD M','funding','nbis_fin','2026-Q2','2026-06-30','투자 지출 자체는 방향을 판정하지 않음. FCF와 함께 판단.')
add('NBIS','deferred_revenue','선수수익 잔액',5975.2,'USD M','contracts','nbis_fin','2026-Q2','2026-06-30','유동 979.4 + 비유동 4995.8. 현금 선수금 유입액·RPO와 다름.')
add('IREN','group_revenue','전사 분기 매출',144.8,'USD M','demand','iren_q3','FY26-Q3','2026-03-31','직전 184.7M. 채굴 포함 매출 감소이며 AI 서비스 수요 감소로 해석하지 않음.')
add('IREN','adjusted_ebitda','전사 조정 EBITDA',59.5,'USD M','pricing','iren_q3','FY26-Q3','2026-03-31','채굴 포함 전사 비GAAP. 직전 75.3M; 클라우드 수익성으로 단정하지 않음.')
add('IREN','nvidia_contract','NVIDIA 신규 계약 용량',60,'critical IT MW','contracts','iren_q3','2026-05','2026-05-07','3.4B / 5년. 2027년 초 서비스 시작. 60MW 가동 공시가 아니라 서명 계약.',1,'공식 발표에서 신규 서명 계약을 확인.')
add('IREN','nvidia_delivery_target','NVIDIA 공급 개시 목표',60,'critical IT MW','delivery','iren_q3','2027','2026-05-07','기존 air-cooled 시설 활용. 2027년 초 목표.',None,'',evidence='target')
add('APLD','active_pf1','Polaris Forge 1 가동 용량',175,'critical IT MW','delivery','apld_q4','2026-06-30','2026-06-30','6/30 두 번째 시설 75MW 인도. 5/31 종료 FY26 Q4 이후.',1,'기존 100MW 대비 75MW 실제 인도 증가.')
add('APLD','group_revenue','전사 분기 매출',258.7,'USD M','demand','apld_q4','FY26-Q4','2026-05-31','전년 51.1M. ChronoScale 연결·tenant fit-out 매출 포함. 반복 임대료 신호로 사용하지 않음.')
add('APLD','hpc_base_rent','HPC 분기 기본 임대료',44.1,'USD M','demand','apld_q4','FY26-Q4','2026-05-31','HPC 203M 중 기본 임대료. fit-out 152.4M·회수금 6.5M와 분리.')
add('APLD','hpc_fitout','HPC tenant fit-out 매출',152.4,'USD M','demand','apld_q4','FY26-Q4','2026-05-31','시설 구축 지원 매출. 반복 임대료로 연율화하지 않음.')
add('WULF','hpc_revenue','HPC 분기 매출',31.9,'USD M','demand','wulf_q2','2026-Q2','2026-06-30','전체 44.8M의 약 71%. 비교기간 미대조로 방향은 보류.')
add('WULF','active_lake_mariner','Lake Mariner 매출 발생 용량',102,'critical IT MW','delivery','wulf_q2','2026-07','2026-07-31','6월말 81MW에서 7월초 21MW 인도. 향후 336MW는 별도 목표.',1,'81MW 대비 실제 인도 21MW 증가.')
add('WULF','anthropic_contract','Anthropic 신규 계약 용량',401,'critical IT MW','contracts','wulf_q2','2026-08','2026-08-05','Justified 별도 계약. 20년 기본 19B; 옵션 포함 33B를 기본 계약에 추가하지 않음.',1,'공식 발표의 신규 서명 계약 확인.')
add('CIFR','black_pearl_delivery','Black Pearl 첫 인도 조기화',2,'개월','delivery','cifr_q2','2026-08','2026-08-04','기존 10월 대비 8월 임대 시작. 실제 인도 MW 미공개.',1,'공식 계획 대비 2개월 조기 첫 인도.')
add('CIFR','group_revenue','전사 분기 매출',25,'USD M','demand','cifr_q2','2026-Q2','2026-06-30','HPC 임대 개시 이전 분기. AI 클라우드 매출과 구분.')
# Keep the original key for revision continuity while correcting the mislabeled interval.
for old in list(ledger['signals']):
    if old.get('metric')=='older_gpu_price_yoy' and old['revision']==1:
        if not any(s['key']==old['key'] and s['revision']>1 for s in ledger['signals']):
            row=dict(old, metric='older_gpu_price_qoq', title='기존 GPU 가격 QoQ 하한', revision=2,
                     note='Q2 회사 발표: 기존 GPU 가격이 QoQ 30% 초과 상승. YoY가 아님.', observed_at=NOW)
            row['id']=hashlib.sha256((row['key']+':2').encode()).hexdigest()[:20]
            row['fingerprint']=hashlib.sha256(json.dumps(row,sort_keys=True).encode()).hexdigest()
            ledger['signals'].append(row)
ledger['updated']=NOW
path.write_text(json.dumps(ledger,ensure_ascii=False,indent=2)+'\n')
print(f"Preserved ledger with {len(ledger['signals'])} observations/revisions")
