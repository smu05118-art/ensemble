/* 업체 관측 원장 · 브라우저/Node 공용 앙상블. 생성물은 수정하지 않는다. */
(function(root,factory){
  var api=factory();
  if(typeof module==='object'&&module.exports) module.exports=api;
  else root.PhxCloud=api;
})(typeof window==='undefined'?globalThis:window,function(){
'use strict';
var AXES={demand:'수요·매출',delivery:'가동·공급',contracts:'신규 계약',pricing:'단가·수익성',funding:'자금 부담'};
var WEIGHTS={demand:30,delivery:25,contracts:20,pricing:15,funding:10};
var GROUPS={hyperscaler:'하이퍼스케일러',neocloud:'GPU 클라우드',colo:'임대·호스팅',china:'중화권'};
var EVIDENCE={confirmed:'공식 확인',target:'회사 목표',external:'외부 관측',inference:'추론',unverified:'미검증'};
var DAY=86400000;
function stamp(x){return /^\d{4}-\d{2}-\d{2}$/.test(x||'')?Date.parse(x+'T00:00:00Z'):NaN;}
function finite(x){return typeof x==='number'&&Number.isFinite(x);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function url(s){try{var u=new URL(s);return u.protocol==='https:'&&!u.username&&!u.password?s:null;}catch(e){return null;}}
function current(rows,asof){
  var end=stamp(asof), map=new Map();
  rows.forEach(function(s){
    if(!Number.isFinite(stamp(s.observed_at))||stamp(s.observed_at)>end) return;
    if(s.published_at&&stamp(s.published_at)>end) return;
    var p=map.get(s.key);
    if(!p||s.revision>p.revision)map.set(s.key,s);
  });
  return Array.from(map.values());
}
function excluded(s,asof){
  if(!s.verified)return '원자료 미검증';
  if(s.evidence!=='confirmed')return EVIDENCE[s.evidence]+' · 실적 점수 제외';
  if(!finite(s.direction)||![-1,0,1].includes(s.direction)||!s.rule)return '비교 기준·귀속범위 부족';
  if(!finite(s.value)||!url(s.source_url))return '관측값·출처 부족';
  var now=stamp(asof), pub=stamp(s.published_at), verified=stamp(s.verified_at), seen=stamp(s.observed_at), eff=stamp(s.effective_at);
  if(![now,pub,verified,seen,eff].every(Number.isFinite))return '일자 정보 부족';
  if(Math.max(pub,verified,seen,eff)>now)return '기준일 이후 정보';
  if((now-eff)/DAY>180)return '180일 초과 관측';
  if(!AXES[s.axis])return '미지원 축';
  return null;
}
function ensemble(rows,provider,asof){
  var available=current(rows,asof).filter(function(s){return s.provider===provider;});
  // 최신 판정이 미검증/목표/누락이면 과거 확정값으로 소급 대체하지 않는다.
  var last=new Map();
  available.forEach(function(s){var k=s.origin+':'+s.metric,p=last.get(k);
    if(!p||String(s.effective_at||s.period)>String(p.effective_at||p.period)||
      ((s.effective_at||s.period)===(p.effective_at||p.period)&&s.revision>p.revision))last.set(k,s);});
  var eligible=Array.from(last.values()).filter(function(s){return !excluded(s,asof);});
  var axes={}, numerator=0, denominator=0, coverage=0, sources=new Set(), used=[];
  Object.keys(AXES).forEach(function(axis){
    var a=eligible.filter(function(s){return s.axis===axis;}), groups=new Map();
    a.forEach(function(s){var k=s.correlation_group||s.source_url;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(s);});
    if(!groups.size){axes[axis]=null;return;}
    var n=0,d=0;
    groups.forEach(function(g){var direction=g.reduce(function(v,s){return v+s.direction;},0)/g.length;
      var age=Math.max.apply(null,g.map(function(s){return (stamp(asof)-stamp(s.effective_at))/DAY;}));
      var freshness=Math.pow(0.5,age/90);n+=direction*freshness;d+=freshness;
      g.forEach(function(s){used.push(s.id);sources.add(s.source_url);});
    });
    var value=n/d, freshness=d/groups.size;
    axes[axis]={direction:value,freshness:freshness,groups:groups.size,ids:a.map(function(s){return s.id;})};
    coverage+=WEIGHTS[axis];numerator+=value*WEIGHTS[axis]*freshness;denominator+=WEIGHTS[axis]*freshness;
  });
  var count=Object.values(axes).filter(Boolean).length;
  var score=count>=2&&coverage>=40?Math.round(50+50*numerator/denominator):null;
  return {provider:provider,asof:asof,score:score,coverage:coverage,axis_count:count,axes:axes,
    source_count:sources.size,used_ids:used,
    conflict:eligible.some(function(s){return s.direction>0;})&&eligible.some(function(s){return s.direction<0;}),
    status:score===null?'관측 부족':(coverage<80?'부분 관측':'관측 충족'),
    method:'판정 규칙 기반 관측 방향 · 예측/투자수익 확률 아님 · 백테스트 미실시'};
}
function filtered(rows,state){return rows.filter(function(s){return (!state.provider||s.provider===state.provider)&&
  (!state.axis||s.axis===state.axis)&&(!state.evidence||s.evidence===state.evidence)&&
  (!state.search||[s.title,s.scope,s.note,s.provider,s.period].join(' ').toLowerCase().includes(state.search.toLowerCase()));});}
function csv(rows,columns){return '\uFEFF'+[columns].concat(rows.map(function(r){return columns.map(function(c){return r[c]==null?'':r[c];});})).map(function(row){
  return row.map(function(v){var s=String(v);if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',');}).join('\r\n');}
return {AXES:AXES,WEIGHTS:WEIGHTS,current:current,excluded:excluded,ensemble:ensemble,filtered:filtered,csv:csv};
});
