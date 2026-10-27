/* Dated, source-supported earnings previews; no modification of other models. */
(() => {
  const tabs = document.querySelector('.tabs');
  if (!tabs || document.querySelector('[data-tab="earnings"]')) return;
  const b = document.createElement('button');
  b.className = 'tabbtn'; b.dataset.tab = 'earnings'; b.textContent = '실적 프리뷰';
  tabs.append(b);
  const pane = document.createElement('div'); pane.id = 'pane-earnings'; pane.className = 'pane';
  const h = document.createElement('h2'); h.textContent = 'FORM · VRT · SCREEN — 10월 실적과 다음 가이던스';
  const p = document.createElement('p');
  p.textContent = '2026-10-27 발표 전 스냅샷. 공식 수치, 시장 컨센서스, 조건부 추정을 구분했습니다. 발표 후 실제값으로 이 예측을 소급 수정하지 않습니다.';
  pane.append(h,p);
  const grid = document.createElement('div'); grid.className='cgrid'; pane.append(grid);
  [['FORM','FormFactor','HBM · 첨단 로직 프로브카드 · CPO 테스트'],['VRT','Vertiv','전력 · 냉각 · 서비스와 수주 전환'],['SCREEN','SCREEN Holdings','세정 장비 · 반도체 설비투자 · 검수 시점']].forEach(([id,name,desc])=>{
    const card=document.createElement('div');card.className='ccard';
    const title=document.createElement('h3');title.textContent=name;
    const detail=document.createElement('p');detail.textContent=desc;
    const link=document.createElement('a');link.href='earnings/'+id+'.html';link.textContent='프리뷰·추정·원문 보기 →';link.style.color='#49d2dd';
    card.append(title,detail,link);grid.append(card);
  });
  const all=document.createElement('a');all.href='earnings/';all.textContent='세 종목 비교·발표 일정 →';all.style.color='#49d2dd';
  pane.append(all);tabs.insertAdjacentElement('afterend',pane);
  function activate(){
    document.querySelectorAll('.tabbtn,.pane').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');pane.classList.add('on');window.scrollTo(0,0);
  }
  b.addEventListener('click',activate);
  if(location.hash==='#earnings') activate();
})();
