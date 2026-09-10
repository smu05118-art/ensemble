/* Pure scenario engine. USD millions; MW units stay profile-specific. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.CloudModel=api;})(typeof window==='undefined'?globalThis:window,function(){
'use strict';
function number(x,label,min=0,max=1e7){if(typeof x!=='number'||!Number.isFinite(x)||x<min||x>max)throw Error(label+' 입력 범위를 확인하세요.');return x;}
function month(x){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(x||''))throw Error('월은 YYYY-MM 형식이어야 합니다.');const [y,m]=x.split('-').map(Number);return y*12+m-1;}
function label(x){return Math.floor(x/12)+'-'+String(x%12+1).padStart(2,'0');}
function calculate(c){
 number(c.active_mw,'MW');number(c.utilization,'가동률',0,100);number(c.margin,'EBIT 마진',-100,100);
 if(!Array.isArray(c.mix)||!Array.isArray(c.rates)||c.mix.length!==3||c.rates.length!==3)throw Error('계약 유형 3개의 비중·단가가 필요합니다.');
 c.mix.forEach(v=>number(v,'계약 비중',0,100));c.rates.forEach(v=>number(v,'연간 단가',0,1000));
 const mixTotal=c.mix.reduce((a,b)=>a+b,0);if(Math.abs(mixTotal-100)>0.001)throw Error('계약 비중 합계를 100%로 맞추세요. 현재 '+mixTotal+'%');
 const blended=c.mix.reduce((a,b,i)=>a+b*c.rates[i]/100,0),arr=c.active_mw*c.utilization/100*blended;
 return {blended,arr,ebit:arr*c.margin/100,segments:c.mix.map((m,i)=>c.active_mw*c.utilization/100*m/100*c.rates[i])};
}
function ratio(n,d){return typeof n==='number'&&Number.isFinite(n)&&typeof d==='number'&&Number.isFinite(d)&&d>0?n/d:null;}
function derived({numerator,denominator,numeratorScope,denominatorScope,numeratorPeriod,denominatorPeriod}){
 if(!numeratorScope||numeratorScope!==denominatorScope||!numeratorPeriod||numeratorPeriod!==denominatorPeriod)return null;
 return ratio(numerator,denominator);
}
function forecast(p,opts={}){
 const calc=opts.calculator||p.calculator,c=calculate(calc),delay=number(opts.delay??0,'지연',0,24),price=number(opts.price??0,'단가 변화',-90,200),factor=1+price/100;
 if(!Number.isInteger(delay))throw Error('지연은 정수 개월입니다.');
 const first=month(opts.start||'2026-07'),last=month(opts.end||'2027-12'),baseMonth=month(p.baseline_month),lock=month(opts.lock||'2026-08');
 if(first<=baseMonth||last<first||last-first>60)throw Error('기준월 다음부터 최대 61개월을 계산할 수 있습니다.');
 const baseline=number(p.baseline_mw,'기준 MW'),baseRate=number(p.baseline_rate??c.blended,'기준 단가');
 const tranches=(opts.tranches||p.tranches).map(t=>{const start=month(t.start),end=month(t.end);number(t.mw,'고객 MW');if(start<=baseMonth||end<start||end-start>60)throw Error(t.title+': 시작·완료월을 확인하세요.');return {...t,startN:start,endN:end,rateN:number(t.rate??c.blended,'계약 단가')};});
 const progress=(m,t)=>Math.max(0,Math.min(1,(m-t.startN+1)/(t.endN-t.startN+1)));
 const amount=(m,t)=>{
  if(t.fixed||!delay||m<=lock)return t.mw*progress(m,t);
  const locked=progress(lock,t),start=Math.max(lock+1,t.startN)+delay,end=Math.max(lock+1,t.endN)+delay;
  return t.mw*(locked+(1-locked)*Math.max(0,Math.min(1,(m-start+1)/(end-start+1))));
 };
 const rows=[];
 for(let m=first;m<=last;m++){
  const parts=[{id:'baseline',customer:p.baseline_customer,mw:baseline,previous_mw:baseline,rate:baseRate,mw_basis:p.baseline_kind==='reported'?'reported':'assumption',timing_basis:'reported',source:p.source}];
  tranches.forEach(t=>parts.push({id:t.id,customer:t.customer,mw:amount(m,t),previous_mw:amount(m-1,t),rate:t.rateN,mw_basis:t.mw_basis,timing_basis:t.timing_basis,source:t.source}));
  let total=0,average=0,revenue=0,arr=0;const customers={};
  parts.forEach(t=>{total+=t.mw;average+=(t.mw+t.previous_mw)/2;customers[t.customer]=(customers[t.customer]||0)+t.mw;revenue+=(t.mw+t.previous_mw)/2*t.rate/12*calc.utilization/100*factor;arr+=t.mw*t.rate*calc.utilization/100*factor;});
  rows.push({month:label(m),total_mw:total,average_mw:average,customers,parts,revenue_m:revenue,exit_arr_m:arr,ebit_m:revenue*calc.margin/100,unit:p.unit});
 }
 const sums={};for(const r of rows){const y=r.month.slice(0,4);if(!sums[y])sums[y]={months:0,revenue_m:0,ebit_m:0};sums[y].months++;sums[y].revenue_m+=r.revenue_m;sums[y].ebit_m+=r.ebit_m;sums[y].exit_arr_m=r.exit_arr_m;sums[y].end_mw=r.total_mw;}
 return {rows,sums,calculator:c};
}
function sensitivity(p,opts={}){return [0,3,6].map(delay=>({delay,values:[-20,-10,0,10,20].map(price=>({price,revenue_m:forecast(p,{...opts,delay,price}).sums['2027'].revenue_m}))}));}
return {calculate,forecast,sensitivity,ratio,derived,month,label};
});
