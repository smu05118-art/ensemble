/* W01 series semantics and shared SVG/Chart.js style, ES5. */
(function(root){
 'use strict';
 function cp(x){var y={},k;for(k in x){if(Object.prototype.hasOwnProperty.call(x,k)){y[k]=x[k];}}return y;}
 function esc(x){return String(x).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 function roleOf(r){if(r==='actual'||r==='reported'){return 'actual';}if(r==='derived'||r==='calculated'){return 'derived';}if(r==='forecast'||r==='est'||r==='estimate'){return 'forecast';}return 'unknown';}
 function finite(v){return typeof v==='number'&&isFinite(v);}
 function readTheme(){if(!root.document){return 'light';}var e=root.document.documentElement,t=e.getAttribute('data-theme');if(t==='light'||t==='dark'){return t;}if(root.getComputedStyle){var bg=root.getComputedStyle(e).getPropertyValue('--bg').replace(/\s/g,'');if(/^#[0-9a-f]{6}$/i.test(bg)){return (parseInt(bg.slice(1,3),16)*.2126+parseInt(bg.slice(3,5),16)*.7152+parseInt(bg.slice(5,7),16)*.0722)>128?'light':'dark';}}return root.matchMedia&&root.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}
 function getTokens(t){var v=t||root.VIZ_CONTRACT;if(!v){throw new Error('VIZ_CONTRACT_REQUIRED');}return v.tokens||v;}
 function applySeriesStyle(series,role,tokens){
   var s=cp(series||{}),t=getTokens(tokens),r=roleOf(role),theme=s.theme==='light'?'light':'dark',pal=t.palette[theme],i=s.metric_index===undefined?(s.index||0):s.metric_index,color=pal[((i%pal.length)+pal.length)%pal.length],st=t.roles[r],marker=t.markers[(((i+Math.floor(i/8))%t.markers.length)+t.markers.length)%t.markers.length];
   s.role=r;s.statusLabel=st.label;s.borderColor=color;s.stroke=color;s.borderWidth=st.width;s.width=st.width;s.borderDash=st.dash.slice();s.dash=st.dash.slice();s.pointStyle=marker;s.marker=marker;s.hollow=st.hollow;s.pointRadius=r==='forecast'?3.4:2.4;s.pointBorderWidth=r==='derived'?2.5:1.5;s.pointBackgroundColor=st.hollow?t.background[theme]:color;s.backgroundColor=s.pointBackgroundColor;s.fill=s.backgroundColor;s.opacity=1;s.spanGaps=false;s.tension=0;
   s.label=(s.name||s.label||'계열')+' ['+(s.unit||s.vizUnit||'단위 미확인')+' · '+st.label+']';
   if(s.data){s.data=s.data.map(function(p){if(r==='unknown'){return null;}if(p===null||p===undefined){return null;}if(typeof p==='object'){var pr=roleOf(p.role||p.status||(p.est?'est':r));return pr==='unknown'?null:p;}return finite(p)?p:null;});}
   return s;
 }
 function normalizePoint(p,defaultRole){
   if(p===null||p===undefined){return {value:null,role:'unknown'};}
   if(Array.isArray(p)){return {value:finite(p[1])?p[1]:null,role:roleOf(defaultRole)};}
   if(typeof p==='object'){var r=roleOf(p.role||p.status||(p.est?'est':defaultRole)),v=finite(p.y)?p.y:(finite(p.value)?p.value:null);return {value:r==='unknown'?null:v,role:r,lo:finite(p.lo)?p.lo:null,hi:finite(p.hi)?p.hi:null};}
   if(Array.isArray(p)){return {value:finite(p[1])?p[1]:null,role:roleOf(defaultRole)};}return {value:finite(p)?p:null,role:roleOf(defaultRole)};
 }
 function splitSeries(series,tokens){
   var roles=['actual','derived','forecast'],out=[],raw=series.data||[],pts=raw.map(function(p){return normalizePoint(p,series.role||series.vizRole||'unknown');});
   roles.forEach(function(r){if(!pts.some(function(p){return p.role===r&&p.value!==null;})){return;}var s=cp(series),first=null;s.data=pts.map(function(p,i){var take=p.role===r;if(take&&p.value!==null&&first===null){first=i;}if(!take&&series.type!=='bar'&&r==='forecast'&&i+1<pts.length&&pts[i+1].role==='forecast'&&p.role!=='unknown'){take=true;}if(!take||p.value===null){return null;}if(raw[i]&&typeof raw[i]==='object'){if(Array.isArray(raw[i])){return raw[i].slice();}var q=cp(raw[i]);q.y=p.value;return q;}return p.value;});s=applySeriesStyle(s,r,tokens);s.vizForecastStartIndex=r==='forecast'?first:null;s.role=r;out.push(s);});return out;
 }
 function svgBand(points,opts){
   var o=opts||{},segments=[],seg=[],paths=[],x=o.x||function(i){return i;},y=o.y||function(v){return v;},meaning=o.meaning||'시나리오 lo~hi (확률 미보정)';
   points.forEach(function(p,i){var lo=p&&p[o.loKey||'lo'],hi=p&&p[o.hiKey||'hi'];var base=p&&(finite(p.base)?p.base:(finite(p.value)?p.value:p.y));if(!finite(lo)||!finite(hi)||!finite(base)||lo>base||base>hi||p.status==='unknown'||p.status==='NOT FOUND'){if(seg.length){segments.push(seg);}seg=[];return;}seg.push({x:x(i),lo:y(lo),hi:y(hi)});});if(seg.length){segments.push(seg);}
   segments.forEach(function(a){if(a.length<2){return;}if(!o.basis){throw new Error('BAND_BASIS_REQUIRED');}if(/%/.test(meaning)&&!(o.calibration&&o.calibration.validated===true)){throw new Error('BAND_PROBABILITY_UNVERIFIED');}var d='M'+a.map(function(p){return p.x+','+p.lo;}).join(' L')+' L'+a.slice().reverse().map(function(p){return p.x+','+p.hi;}).join(' L')+' Z';paths.push('<path data-viz-band="true" aria-label="'+esc(meaning)+'" d="'+d+'" fill="'+esc(o.color||getTokens(o.tokens).palette[o.theme==='dark'?'dark':'light'][0])+'" fill-opacity="0.14" stroke="'+esc(o.color||getTokens(o.tokens).palette[o.theme==='dark'?'dark':'light'][0])+'" stroke-width="1" stroke-dasharray="3 3"><title>'+esc(meaning)+'</title></path>');});return paths.join('');
 }
 function svgDivider(x,y1,y2,label,tokens){var t=getTokens(tokens),color=t.text[readTheme()];return '<g data-viz-forecast-start="true"><line x1="'+x+'" x2="'+x+'" y1="'+y1+'" y2="'+y2+'" stroke="'+color+'" stroke-dasharray="3 3"/><text x="'+(x+4)+'" y="'+(y1+12)+'" fill="'+color+'" font-size="11">'+esc(label||'전망 시작')+'</text></g>';}
 function makeForecastBand(series,opts){
   var o=opts||{},lo=[],hi=[],base=[],meaning=o.meaning||'시나리오 lo~hi (확률 미보정)';if(!(o.basis||series.basis)){throw new Error('BAND_BASIS_REQUIRED');}if(/%/.test(meaning)&&!(o.calibration&&o.calibration.validated===true)){throw new Error('BAND_PROBABILITY_UNVERIFIED');}
   (series.data||[]).forEach(function(p){var valid=p&&finite(p.lo)&&finite(p.hi)&&finite(p.base)&&p.lo<=p.base&&p.base<=p.hi&&p.status!=='unknown'&&p.status!=='NOT FOUND';lo.push(valid?p.lo:null);hi.push(valid?p.hi:null);base.push(p&&finite(p.base)?p.base:null);});
   var source=cp(series);source.theme=source.theme||readTheme();var lower=applySeriesStyle(source,'forecast',o.tokens),upper=applySeriesStyle(source,'forecast',o.tokens);lower.data=lo;upper.data=hi;lower.label=meaning+' 하단';upper.label=meaning;lower.pointRadius=0;upper.pointRadius=0;lower.borderWidth=1;upper.borderWidth=1;lower.fill=false;upper.fill='-1';upper.backgroundColor=hexAlpha(upper.borderColor,.14);lower.vizBand=true;upper.vizBand=true;lower.vizBandPart='lo';upper.vizBandPart='hi';return [lower,upper];
 }
 function hexAlpha(h,a){return 'rgba('+parseInt(h.slice(1,3),16)+','+parseInt(h.slice(3,5),16)+','+parseInt(h.slice(5,7),16)+','+a+')';}
 function styleDatasets(chart){
   var theme=readTheme(),names=[],expanded=[];
   chart.data.datasets.forEach(function(ds){var def=roleOf(ds.vizRole||ds.role||ds.status),rs=[];(ds.data||[]).forEach(function(p){if(p&&typeof p==='object'&&!Array.isArray(p)){var pr=roleOf(p.role||p.status||(p.est?'est':def));if(pr!=='unknown'&&rs.indexOf(pr)<0){rs.push(pr);}}});if(!ds._vizSplit&&rs.some(function(r){return r!==def;})){var src=cp(ds);src.type=ds.type||chart.config.type;src.role=def;src.name=ds._vizOriginalLabel||ds.label;splitSeries(src).forEach(function(s){s.vizRole=s.role;s.vizMetric=ds.vizMetric||ds.label;s._vizOriginalLabel=ds._vizOriginalLabel||ds.label;s._vizSplit=true;expanded.push(s);});}else{expanded.push(ds);}});chart.data.datasets=expanded;
   chart.data.datasets.forEach(function(ds,i){
     if(ds.vizBand){var bandStyle=applySeriesStyle({theme:theme,metric_index:ds.metric_index||0},'forecast');ds.borderColor=bandStyle.borderColor;ds.backgroundColor=ds.vizBandPart==='hi'?hexAlpha(bandStyle.borderColor,.14):bandStyle.backgroundColor;return;}var hasRole=ds.vizRole||ds.role||ds.status;if(!hasRole){return;}
     if(!ds._vizOriginalLabel){ds._vizOriginalLabel=ds.label||'계열';}var metric=ds.vizMetric||ds._vizOriginalLabel;if(names.indexOf(metric)<0){names.push(metric);}
     var s=applySeriesStyle({name:ds._vizOriginalLabel,unit:ds.vizUnit||ds.unit,metric_index:ds.metric_index===undefined?names.indexOf(metric):ds.metric_index,theme:theme},hasRole);
     ['borderColor','borderWidth','borderDash','pointStyle','pointRadius','pointBorderWidth','pointBackgroundColor','backgroundColor','spanGaps','label'].forEach(function(k){ds[k]=s[k];});
     if(roleOf(hasRole)==='unknown'){ds.data=(ds.data||[]).map(function(){return null;});}
     else {ds.data=(ds.data||[]).map(function(p){if(p&&typeof p==='object'&&(p.status==='NOT FOUND'||p.status==='unknown')){return null;}return p;});}
   });
   var labels=chart.data.datasets.filter(function(s){return !s.vizBand;}).map(function(s){return {label:s._vizOriginalLabel||s.label,unit:s.vizUnit||s.unit,role:s.vizRole||s.role||'unknown'};});
   chart.$vizLegend=root.VizScale.legendPlan(labels);
   var raw=(chart.config&&chart.config.options)||chart.options;if(!raw.plugins){raw.plugins={};}var cfg=raw.plugins;if(!cfg.legend){cfg.legend={};}cfg.legend.position='bottom';if(!cfg.legend.labels){cfg.legend.labels={};}cfg.legend.labels.usePointStyle=true;cfg.legend.display=false;
 }
 function drawForecastDividers(chart){
   if(chart.options&&chart.options.plugins&&chart.options.plugins.vizScale&&chart.options.plugins.vizScale.forecastDivider===false){return;}
   var start=null,labels=chart.data.labels||[],ctx=chart.ctx,a=chart.chartArea;
   chart.data.datasets.forEach(function(ds){if(roleOf(ds.vizRole||ds.role)!=='forecast'||ds.vizBand){return;}if(ds.vizForecastStartIndex!==undefined&&ds.vizForecastStartIndex!==null){start=start===null?ds.vizForecastStartIndex:Math.min(start,ds.vizForecastStartIndex);return;}(ds.data||[]).some(function(p,i){if(finite(p)||(p&&typeof p==='object'&&finite(p.y))){start=start===null?i:Math.min(start,i);return true;}return false;});});
   if(start===null||!chart.scales.x||!a){return;}var x=chart.scales.x.getPixelForValue(labels[start]===undefined?start:labels[start],start);ctx.save();ctx.strokeStyle='#9aa7b8';ctx.fillStyle=getTokens().text[readTheme()];ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(x,a.top);ctx.lineTo(x,a.bottom);ctx.stroke();ctx.setLineDash([]);var config=(chart.options.plugins||{}).vizScale||{},caption=config.forecastDivider===true?'전망 시작':'추정 시작 (시점 미확인)';ctx.fillText(caption,Math.min(x+4,a.right-130),a.top+12);ctx.restore();
 }
 function renderLegend(chart){
   if(!root.document||!chart.canvas||!chart.canvas.parentNode||!chart.$vizLegend){return;}
   var plan=chart.$vizLegend,host=chart.$vizLegendElement,t=getTokens(),theme=readTheme();
   if(!host){host=root.document.createElement('div');host.setAttribute('data-viz-legend','');host.setAttribute('aria-label','차트 범례; 버튼으로 계열 표시 전환');var parent=chart.canvas.parentNode;if(parent.parentNode&&parent.tagName!=='BODY'){parent.parentNode.insertBefore(host,parent.nextSibling);}else{parent.insertBefore(host,chart.canvas.nextSibling);}chart.$vizLegendElement=host;}
   host.style.cssText='display:flex;gap:8px;max-width:100%;padding:6px 0;font:12px sans-serif;'+(plan.placement==='scroll_group'?'overflow-x:auto;flex-wrap:nowrap;':'flex-wrap:wrap;');host.setAttribute('data-placement',plan.placement);while(host.firstChild){host.removeChild(host.firstChild);}
   chart.data.datasets.forEach(function(ds,i){
     if(ds.vizBand&&ds.vizBandPart==='lo'){return;}var b=root.document.createElement('button'),sw=root.document.createElement('span');b.type='button';b.style.cssText='display:inline-flex;align-items:center;gap:5px;flex-shrink:0;cursor:pointer;border:1px solid '+t.text[theme]+';border-radius:3px;padding:3px 5px;background:'+t.background[theme]+';color:'+t.text[theme]+';font:inherit;';b.setAttribute('aria-pressed',chart.isDatasetVisible?String(chart.isDatasetVisible(i)):'true');sw.textContent=(ds.pointStyle==='triangle'?'△':ds.pointStyle==='rect'||ds.pointStyle==='rectRot'?'□':'○');sw.style.color=ds.borderColor||t.text[theme];sw.style.borderBottom=(ds.borderWidth||2)+'px '+((ds.borderDash||[]).length?'dashed':'solid')+' '+(ds.borderColor||t.text[theme]);b.appendChild(sw);b.appendChild(root.document.createTextNode(ds.label||'계열'));b.onclick=function(){if(chart.setDatasetVisibility){chart.setDatasetVisibility(i,!chart.isDatasetVisible(i));chart.update();}};host.appendChild(b);
   });
   var raw=(chart.config&&chart.config.options)||chart.options;if(raw.plugins&&raw.plugins.legend){raw.plugins.legend.display=false;}
 }
 function clearUnitPanels(chart){
   (chart.$vizPanelCharts||[]).forEach(function(c){c.destroy();});chart.$vizPanelCharts=[];
   var host=chart.$vizPanelHost;if(host&&host.parentNode){host.parentNode.removeChild(host);}chart.$vizPanelHost=null;
   if(chart.$vizHiddenContainer){chart.$vizHiddenContainer.style.display=chart.$vizOldDisplay||'';chart.$vizHiddenContainer=null;}
 }
 function renderUnitPanels(chart){
   if(!root.document||!root.Chart||chart.$vizIsPanel||!chart.canvas||!chart.canvas.parentNode){return false;}
   var raw=(chart.config&&chart.config.options)||chart.options,cfg=(raw.plugins||{}).vizScale||{},axes=cfg.axes||{},units=[],selected=[];
   if(chart.config.type==='scatter'||raw.indexAxis==='y'){return false;}
   chart.data.datasets.forEach(function(ds,i){if(chart.isDatasetVisible&&!chart.isDatasetVisible(i)){return;}var axis=ds.yAxisID||'y',unit=ds.vizUnit||ds.unit||(axes[axis]||{}).unit;if(!unit){return;}if(units.indexOf(unit)<0){units.push(unit);}selected.push({dataset:ds,unit:unit,axis:axis});});
   if(units.length<=2){if(chart.$vizPanelHost){clearUnitPanels(chart);}return false;}
   clearUnitPanels(chart);
   if(chart.$vizLegendElement){chart.$vizLegendElement.remove();chart.$vizLegendElement=null;}
   var parent=chart.canvas.parentNode,hidden=parent.children.length===1?parent:chart.canvas,host=root.document.createElement('div');host.setAttribute('data-viz-unit-panels',String(units.length));host.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;';parent.parentNode.insertBefore(host,parent.nextSibling);chart.$vizPanelHost=host;chart.$vizHiddenContainer=hidden;chart.$vizOldDisplay=hidden.style.display;hidden.style.display='none';chart.$vizPanelCharts=[];
   for(var i=0;i<units.length;i+=2){
     var group=units.slice(i,i+2),box=root.document.createElement('div'),heading=root.document.createElement('div'),plot=root.document.createElement('div'),canvas=root.document.createElement('canvas'),scales={},meta={},datasets=[];
     heading.textContent=group.join(' / ')+' · 단위별 분리';heading.style.cssText='font:12px sans-serif;margin-bottom:5px;color:'+getTokens().text[readTheme()]+';';plot.style.cssText='position:relative;height:240px;';plot.appendChild(canvas);box.appendChild(heading);box.appendChild(plot);host.appendChild(box);
     selected.forEach(function(item){var j=group.indexOf(item.unit);if(j<0){return;}var key=j?'y2':'y',ds=cp(item.dataset);ds.data=(item.dataset.data||[]).slice();ds.yAxisID=key;datasets.push(ds);if(!scales[key]){scales[key]=cp((raw.scales||{})[item.axis]||{});scales[key].position=j?'right':'left';scales[key].axis='y';if(scales[key].ticks){scales[key].ticks=cp(scales[key].ticks);}if(scales[key].grid){scales[key].grid=cp(scales[key].grid);}meta[key]=cp(axes[item.axis]||{});meta[key].unit=item.unit;}});
     if(raw.scales&&raw.scales.x){scales.x=cp(raw.scales.x);}
     var childConfig={type:chart.config.type||'line',data:{labels:(chart.data.labels||[]).slice(),datasets:datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,scales:scales,plugins:{legend:{display:false},vizScale:{axes:meta,forecastDivider:cfg.forecastDivider}}}};
     var child=new root.Chart(canvas,childConfig);child.$vizIsPanel=true;chart.$vizPanelCharts.push(child);
   }
   chart.$vizMultiAxisStatus={status:'SPLIT_INTO_PANELS',units:units,panels:chart.$vizPanelCharts.length};return true;
 }
 var api={applySeriesStyle:applySeriesStyle,roleOf:roleOf,splitSeries:splitSeries,svgBand:svgBand,svgDivider:svgDivider,makeForecastBand:makeForecastBand,styleDatasets:styleDatasets,drawForecastDividers:drawForecastDividers,renderLegend:renderLegend,readTheme:readTheme,renderUnitPanels:renderUnitPanels,clearUnitPanels:clearUnitPanels};root.VizSeries=api;if(typeof module!=='undefined'&&module.exports){module.exports=api;}
}(typeof window!=='undefined'?window:(typeof global!=='undefined'?global:this)));
