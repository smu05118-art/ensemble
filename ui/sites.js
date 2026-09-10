/* Native details handles keyboard activation; close on Escape or outside click. */
(function(){
 'use strict';
 document.addEventListener('click',function(event){
  document.querySelectorAll('.en-sites[open]').forEach(function(menu){if(!menu.contains(event.target))menu.open=false;});
 });
 document.addEventListener('keydown',function(event){
  if(event.key!=='Escape')return;
  document.querySelectorAll('.en-sites[open]').forEach(function(menu){
   const focused=menu.contains(document.activeElement);menu.open=false;
   if(focused)menu.querySelector('summary').focus();
  });
 });
})();
