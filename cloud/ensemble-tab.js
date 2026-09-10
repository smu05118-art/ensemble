/* Idempotent host integration. Existing Ensemble tabs and data stay independent. */
(function(){
 'use strict';
 const tabs=document.querySelector('.shell > .tabs')||document.querySelector('.tabs');
 if(!tabs||document.getElementById('pane-cloud'))return;
 const button=document.createElement('button');button.className='tabbtn';button.dataset.tab='cloud';button.textContent='☁ AI·클라우드';button.setAttribute('aria-controls','pane-cloud');tabs.append(button);
 const pane=document.createElement('div');pane.className='pane';pane.id='pane-cloud';pane.innerHTML='<iframe title="앙상블 AI·클라우드 관측실" style="display:block;width:100%;height:1500px;border:0" loading="lazy"></iframe>';tabs.after(pane);
 const frame=pane.querySelector('iframe');
 function state(){const h=new URLSearchParams(location.hash.slice(1)),q=new URLSearchParams(location.search);return {company:h.get('company')||q.get('cloud')||'NBIS',view:h.get('view')||'overview'};}
 function open(update=true){
  document.querySelectorAll('.tabbtn').forEach(b=>b.classList.toggle('on',b===button));document.querySelectorAll('.pane').forEach(p=>p.classList.toggle('on',p===pane));
  const s=state(),url=new URL('cloud/',location.href);url.searchParams.set('embed','1');url.searchParams.set('company',s.company);url.searchParams.set('view',s.view);
  if(!frame.src)frame.src=url.href;
  if(update)history.replaceState(null,'','#tab=cloud&company='+encodeURIComponent(s.company)+'&view='+encodeURIComponent(s.view));
  frame.contentWindow?.postMessage({type:'ensemble-cloud-resize'},location.origin);
 }
 button.addEventListener('click',()=>open());
 tabs.querySelectorAll('[data-tab]:not([data-tab="cloud"])').forEach(b=>b.addEventListener('click',()=>{if(new URLSearchParams(location.hash.slice(1)).get('tab')==='cloud')history.replaceState(null,'',location.pathname+location.search);}));
 window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==frame.contentWindow)return;
  if(event.data?.type==='ensemble-cloud-height'&&Number.isFinite(event.data.height))frame.style.height=Math.max(500,Math.min(50000,event.data.height+8))+'px';
  if(event.data?.type==='ensemble-cloud-state'&&pane.classList.contains('on')&&typeof event.data.company==='string'&&typeof event.data.view==='string')history.replaceState(null,'','#tab=cloud&company='+encodeURIComponent(event.data.company)+'&view='+encodeURIComponent(event.data.view));
 });
 window.addEventListener('hashchange',()=>{if(new URLSearchParams(location.hash.slice(1)).get('tab')==='cloud'){const s=state();if(frame.src){const url=new URL(frame.src);if(url.searchParams.get('company')!==s.company||url.searchParams.get('view')!==s.view){url.searchParams.set('company',s.company);url.searchParams.set('view',s.view);frame.src=url.href;}}open(false);}});
 if(new URLSearchParams(location.hash.slice(1)).get('tab')==='cloud'||new URLSearchParams(location.search).has('cloud'))open(false);
})();
