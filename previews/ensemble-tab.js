/* Additive home integration, matching the existing .tabbtn / .pane pattern. */
(() => {
  function install() {
    const tabs = document.querySelector('.tabs');
    if (!tabs || document.querySelector('[data-tab="previews"]')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'tabbtn'; button.dataset.tab = 'previews';
    button.textContent = '기업별 프리뷰'; button.setAttribute('aria-controls', 'pane-previews');
    const pane = document.createElement('div'); pane.id = 'pane-previews'; pane.className = 'pane';
    const iframe = document.createElement('iframe');
    iframe.src = 'previews/index.html'; iframe.title = '기업별 프리뷰: 전망과 원문 보고서';
    iframe.loading = 'lazy'; iframe.style.cssText = 'width:100%;height:85vh;min-height:520px;border:0;display:block;background:#f2f6f6';
    const fallback = document.createElement('a'); fallback.href = 'previews/index.html'; fallback.textContent = '기업별 프리뷰 전체 화면으로 보기 ↗';
    pane.append(fallback, iframe); tabs.prepend(button); tabs.insertAdjacentElement('afterend', pane);
    function activate() {
      document.querySelectorAll('.tabbtn,.pane').forEach(node => node.classList.remove('on'));
      button.classList.add('on'); pane.classList.add('on');
    }
    button.addEventListener('click', () => { activate(); if (location.hash !== '#previews') history.pushState(null, '', '#previews'); });
    window.addEventListener('hashchange', () => { if (location.hash === '#previews') activate(); });
    window.addEventListener('popstate', () => { if (location.hash === '#previews') activate(); });
    if (location.hash === '#previews') activate();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, {once:true});
  else install();
})();
