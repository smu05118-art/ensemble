(function () {
  'use strict';
  const base = new URL('./', document.currentScript.src);
  const tabs = document.querySelector('.shell > .tabs') || document.querySelector('.tabs');
  if (!tabs || document.getElementById('pane-leadtime')) return;
  const button = document.createElement('button');
  button.className = 'tabbtn'; button.dataset.tab = 'leadtime';
  button.textContent = '리드타임'; button.setAttribute('aria-controls', 'pane-leadtime');
  tabs.append(button);
  const pane = document.createElement('div'); pane.id = 'pane-leadtime'; pane.className = 'pane';
  const mount = document.createElement('div'); mount.id = 'leadtime-root'; mount.className = 'lt-app';
  mount.textContent = '리드타임 자료를 불러오는 중입니다.'; pane.append(mount); tabs.after(pane);
  let loaded = false;
  function activate(update) {
    document.querySelectorAll('.tabbtn').forEach(b => b.classList.toggle('on', b === button));
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('on', p === pane));
    if (!loaded) {
      loaded = true;
      const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = new URL('leadtime.css', base); document.head.append(css);
      const script = document.createElement('script'); script.src = new URL('leadtime.js', base);
      script.onerror = () => { mount.textContent = '화면을 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.'; };
      document.body.append(script);
    }
    if (update) history.replaceState(null, '', '#leadtime');
    button.scrollIntoView({block:'nearest',inline:'nearest'});
    window.scrollTo(0, 0);
  }
  function isSelected() { return location.hash === '#leadtime' || new URLSearchParams(location.hash.slice(1)).get('tab') === 'leadtime'; }
  button.addEventListener('click', () => activate(true));
  tabs.addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (b && b.dataset.tab !== 'leadtime' && isSelected()) history.replaceState(null, '', location.pathname + location.search);
  });
  window.addEventListener('hashchange', () => { if (isSelected()) activate(false); });
  if (isSelected()) activate(false);
})();
