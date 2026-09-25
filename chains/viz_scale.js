/* W01 VIZ scale engine: ES5, no dependency, JSON contract. */
(function (root) {
  'use strict';
  function finite(x) { return typeof x === 'number' && isFinite(x); }
  function clean(x) { return x === 0 ? 0 : Number(x.toPrecision(12)); }
  function copy(o) { var r = {}, k; for (k in o) { if (Object.prototype.hasOwnProperty.call(o,k)) { r[k]=o[k]; } } return r; }
  function classifySeries(m) {
    m=m||{};
    if(m.stacked || m.composition || m.type==='bar') { return 'zero_anchored'; }
    var c=m['class']||m.scale_class, kind=m.kind||m.metric_type||'';
    if(['zero_anchored','range_focus','symmetric','ratio','log_candidate','unknown'].indexOf(c)>=0) { return c; }
    if(['yoy','qoq','change','growth','return','spread_change'].indexOf(kind)>=0) { return 'symmetric'; }
    if(['utilization','margin','ratio','supply_demand'].indexOf(kind)>=0) { return 'ratio'; }
    if(['capacity','price','index','level','revenue','profit','volume'].indexOf(kind)>=0) { return 'range_focus'; }
    return 'unknown';
  }
  function axisNote(r) { return r.min!==null && (r.min>0 || r.max<0) ? '축 시작 ≠ 0' : ''; }
  function quantile(a,p) { var z=(a.length-1)*p,i=Math.floor(z); return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(z-i); }
  function niceScale(values,opts) {
    var o=opts||{},a=values.filter(finite).sort(function(x,y){return x-y;}),c=classifySeries(o),mn,mx,med,span,near,log,warnings=[],pad,lo,hi,refs=[],cap,width,exp,cands=[],e,m,mult,decExp,step,li,hiidx,n,score,ticks=[],i,magnitude,suffix='',divisor=1,units,ss,decimals=0,hint=null,q1,q99,core,result;
    if(c==='unknown'){c='range_focus';}
    if(!a.length){return {status:'NOT FOUND',scale_class:c,min:null,max:null,step:null,ticks:[],decimals:0,suffix:'',divisor:1,axis_note:'',clip_hint:null,near_flat:false,log_candidate:false,references:[],warnings:['NO_FINITE_DATA']};}
    mn=a[0];mx=a[a.length-1];med=quantile(a,.5);span=mx-mn;
    if(!isFinite(span)||Math.max(Math.abs(mn),Math.abs(mx))>1e200||(span&&span<1e-200)){throw new Error('UNSUPPORTED_NUMERIC_MAGNITUDE');}
    near=med ? span/Math.abs(med)<.08 : span===0;log=mn>0&&mx/mn>=1000;
    if(c==='log_candidate'&&!log){warnings.push('LOG_REQUIRES_POSITIVE_1000X_RANGE');}
    if(log){warnings.push('LOG_SUGGESTION_ONLY_LINEAR_RETAINED');}
    pad=span ? span*.12 : (Math.abs(med)*.02||.02);if(span&&pad<Math.abs(med)*1e-12){pad=Math.abs(med)*1e-12;warnings.push('NUMERIC_PRECISION_GUARD');}lo=mn-pad;hi=mx+pad;
    if(c==='zero_anchored'){lo=mn>=0?0:lo;hi=mx<=0&&mn<0?0:hi;}
    else if(c==='symmetric'){hi=Math.max(Math.abs(mn),Math.abs(mx))*1.12||.02;lo=-hi;refs=[0];}
    else if(c==='ratio'){
      cap=o.ratioMax===undefined?(['%','pct'].indexOf(o.unit)>=0?100:1):o.ratioMax;
      if(cap!==null&&(!finite(cap)||cap<=0)){throw new Error('INVALID_RATIO_MAX');}if(cap===null){cap=Math.max(0,mx);}
      lo=Math.min(0,mn<0?lo:0);hi=Math.max(cap,mx>cap?hi:cap);refs=[0,cap];
      if(finite(o.reference)){refs.push(o.reference);lo=Math.min(lo,o.reference);hi=Math.max(hi,o.reference);}
    }
    if(finite(o.reference)&&c!=='ratio'){refs.push(o.reference);lo=Math.min(lo,o.reference);hi=Math.max(hi,o.reference);}
    if(hi<=lo){hi=lo+.02;}width=hi-lo;exp=Math.floor(Math.log(width/4)/Math.LN10);
    for(e=exp-2;e<exp+4;e+=1){
      for(m=0;m<4;m+=1){
        mult=m===2?25:[1,2,2.5,5][m];decExp=m===2?e-1:e;step=Number(mult+'e'+decExp);li=Math.floor(lo/step+1e-10);hiidx=Math.ceil(hi/step-1e-10);
        if(c==='symmetric'){hiidx=Math.max(Math.abs(li),Math.abs(hiidx),2);li=-hiidx;}
        while(hiidx-li+1<4){
          if(c==='zero_anchored'&&mn>=0){hiidx+=1;}
          else if(c==='zero_anchored'&&mx<=0){li-=1;}
          else if(lo-li*step<=hiidx*step-hi){li-=1;}else{hiidx+=1;}
        }
        n=hiidx-li+1;
        if(n>=4&&n<=6){score=Math.abs(n-5)+((hiidx-li)*step-width)/width;cands.push([score,step,li,hiidx,mult,decExp]);}
      }
    }
    if(!cands.length){throw new Error('NO_NICE_SCALE');}
    cands.sort(function(a,b){return a[0]-b[0]||a[1]-b[1]||a[2]-b[2]||a[3]-b[3];});
    step=cands[0][1];li=cands[0][2];hiidx=cands[0][3];mult=cands[0][4];decExp=cands[0][5];for(i=0;i<=hiidx-li;i+=1){ticks.push(Number(((li+i)*mult)+'e'+decExp));}
    magnitude=Math.max(Math.abs(ticks[0]),Math.abs(ticks[ticks.length-1]));
    units=o.locale==='ko'?[[1e12,'조'],[1e8,'억'],[1e4,'만']]:[[1e12,'T'],[1e9,'B'],[1e6,'M'],[1e3,'K']];
    for(i=0;i<units.length;i+=1){if(magnitude>=units[i][0]){divisor=units[i][0];suffix=units[i][1];break;}}
    if(magnitude>0&&magnitude<1e-6){var sci=Math.floor(Math.log(magnitude)/Math.LN10);divisor=Number('1e'+sci);suffix='e'+sci;}ss=step/divisor;decimals=Math.max(0,Math.min(12,Math.ceil(-Math.log(ss)/Math.LN10)));while(decimals<12&&Math.abs(ss*Math.pow(10,decimals)-Math.floor(ss*Math.pow(10,decimals)+.5))>1e-7){decimals+=1;}
    if(a.length>=100){q1=quantile(a,.01);q99=quantile(a,.99);core=q99-q1;
      if((core>0&&Math.max(q1-mn,mx-q99)>3*core)||(core===0&&(mn<q1||mx>q99))){hint={suggested_min:clean(q1),suggested_max:clean(q99),below:a.filter(function(x){return x<q1;}).length,above:a.filter(function(x){return x>q99;}).length,applied:false,marker:'triangle+value',reason:'1% 꼬리가 중앙 98% 폭의 3배 초과; 사용자 선택 전 전체 범위 유지'};}
    }
    refs=refs.sort(function(a,b){return a-b;}).filter(function(x,i,a){return i===0||x!==a[i-1];});
    result={status:'ok',scale_class:c,min:ticks[0],max:ticks[ticks.length-1],step:clean(step),ticks:ticks,decimals:decimals,suffix:suffix,divisor:divisor,axis_note:'',clip_hint:hint,near_flat:near,log_candidate:log,references:refs,warnings:warnings};result.axis_note=axisNote(result);return result;
  }
  function legendPlan(series){
    var names={actual:'실적',reported:'실적',derived:'산출',calculated:'산출',forecast:'전망(est)',est:'전망(est)',estimate:'전망(est)',unknown:'NOT FOUND','NOT FOUND':'NOT FOUND'},n=series.length;
    return {placement:n<=3?'inline':(n<=8?'bottom_wrap':'scroll_group'),labels:series.map(function(s,i){var role=s.role||s.status||'unknown',idx=s.metric_index===undefined?i:s.metric_index;return {label:(s.label||s.name||('계열 '+(i+1)))+' ['+(s.unit||'단위 미확인')+' · '+(names[role]||'NOT FOUND')+']',palette_index:idx%8,marker_index:(idx+Math.floor(idx/8))%4,role:role};}),max_visible:8,min_distinguishers:2};
  }
  function axisPlan(series){
    var units=[],mapping=[],i,u;
    for(i=0;i<series.length;i+=1){u=series[i].unit||'단위 미확인';if(units.indexOf(u)<0){units.push(u);}mapping.push(units.indexOf(u)===0?'y':'y'+(units.indexOf(u)+1));}
    return {status:units.length>2?'SEPARATE_PANELS_REQUIRED':'ok',units:units,dataset_axes:mapping,zero_alignment:'both_zero_anchored_only',grid_primary_only:true};
  }
  function alignZero(ranges){
    var keys=Object.keys(ranges),negative=false,positive=false,out={};
    keys.forEach(function(k){out[k]=ranges[k];if(ranges[k].status==='ok'){negative=negative||ranges[k].min<0;positive=positive||ranges[k].max>0;}});
    if(keys.length<2||!negative||!positive||!keys.every(function(k){return ranges[k].status==='ok'&&ranges[k].scale_class==='zero_anchored';})){return out;}
    keys.forEach(function(k){var r=ranges[k],m=Math.max(Math.abs(r.min),Math.abs(r.max)),a=niceScale([-m,m],{'class':'symmetric'});a.scale_class='zero_anchored';a.zero_alignment='center';out[k]=a;});return out;
  }
  function dataValue(p){if(Array.isArray(p)){return finite(p[1])?p[1]:null;}if(p&&typeof p==='object'){if(p.status==='NOT FOUND'||p.status==='unknown'){return null;}return finite(p.y)?p.y:(finite(p.value)?p.value:null);}return finite(p)?p:null;}
  var vizScalePlugin={
    id:'vizScale',
    beforeUpdate:function(chart,args,pluginOptions){
      var op=(chart.config&&chart.config.options)||chart.options||{},cfg=pluginOptions||{},scales=op.scales||{},axes=cfg.axes||{},datasets=chart.data.datasets||[],keys=Object.keys(scales),results={},idx;
      if(cfg.enabled===false){return;}
      if(!keys.length){scales.y={};op.scales=scales;keys=['y'];}
      keys.forEach(function(key){
        var axis=scales[key],horizontal=op.indexAxis==='y',isValue=axis.axis?(axis.axis===(horizontal?'x':'y')):(horizontal?key.charAt(0)==='x':key.charAt(0)==='y'),vals=[],meta=copy(axes[key]||cfg),stacks={},hasBar=false;
        if(!isValue&&!axes[key]){return;}
        datasets.forEach(function(ds,di){
          var axisId=key.charAt(0)==='x'?(ds.xAxisID||'x'):(ds.yAxisID||'y'),typ=ds.type||chart.config.type,arr=ds.data||[];
          if(axisId!==key||(chart.isDatasetVisible&&!chart.isDatasetVisible(di))){return;}
          if(typ==='bar'){hasBar=true;}
          arr.forEach(function(p,i){var v=key.charAt(0)==='x'?(Array.isArray(p)?p[0]:(p&&typeof p==='object'&&finite(p.x)?p.x:dataValue(p))):dataValue(p);if(v===null){return;}vals.push(v);if(axis.stacked){var pointKey=(Array.isArray(p)?p[0]:(p&&typeof p==='object'?(horizontal?p.y:p.x):undefined));var group=(ds.stack||'default')+':'+(pointKey===undefined?i:typeof pointKey+':'+pointKey);if(!stacks[group]){stacks[group]=[0,0];}stacks[group][v<0?0:1]+=v;}});
        });
        Object.keys(stacks).forEach(function(k){vals.push(stacks[k][0],stacks[k][1]);});
        if(axis.stacked){meta.stacked=true;}if(hasBar){meta.type='bar';}
        var r=niceScale(vals,meta);results[key]=r;if(r.status!=='ok'){return;}
        axis.type='linear';axis.min=r.min;axis.max=r.max;axis.beginAtZero=r.scale_class==='zero_anchored';if(!axis.ticks){axis.ticks={};}axis.ticks.stepSize=r.step;axis.ticks.maxTicksLimit=6;axis.ticks.autoSkip=false;
        if(!axis.ticks.callback){axis.ticks.callback=function(v){return (v/r.divisor).toFixed(r.decimals)+r.suffix;};}
        if(!axis.title){axis.title={};}if(meta.unit){axis.title.display=true;axis.title.text=meta.unit;}
        if(root.VIZ_CONTRACT){var theme=root.VizSeries&&root.VizSeries.readTheme?root.VizSeries.readTheme():'light';axis.ticks.color=root.VIZ_CONTRACT.tokens.text[theme];axis.title.color=root.VIZ_CONTRACT.tokens.text[theme];}
        if(!axis.grid){axis.grid={};}axis.grid.drawOnChartArea=key===keys.filter(function(k){return k.charAt(0)===(horizontal?'x':'y');})[0];
      });
      results=alignZero(results);Object.keys(results).forEach(function(k){var r=results[k];if(r.zero_alignment){scales[k].min=r.min;scales[k].max=r.max;scales[k].ticks.stepSize=r.step;}});chart.$vizScales=results;
      if(root.VizSeries&&root.VizSeries.styleDatasets){root.VizSeries.styleDatasets(chart);}
      if(chart.options&&chart.options.plugins&&chart.options.plugins.legend){chart.options.plugins.legend.display=false;}
      if(chart.legend&&chart.legend.options){chart.legend.options.display=false;}
    },
    afterDataLimits:function(chart,args){var scale=args.scale,r=(chart.$vizScales||{})[scale.id];if(r&&r.status==='ok'){scale.min=r.min;scale.max=r.max;}},
    afterBuildTicks:function(chart,args){var scale=args.scale,r=(chart.$vizScales||{})[scale.id];if(r&&r.status==='ok'){scale.ticks=r.ticks.map(function(v){return {value:v};});}},
    afterUpdate:function(chart){if(root.VizSeries&&root.VizSeries.renderUnitPanels&&root.VizSeries.renderUnitPanels(chart)){return;}if(root.VizSeries&&root.VizSeries.renderLegend){root.VizSeries.renderLegend(chart);}},
    afterDestroy:function(chart){var e=chart.$vizLegendElement;if(e&&e.parentNode){e.parentNode.removeChild(e);}if(root.VizSeries&&root.VizSeries.clearUnitPanels){root.VizSeries.clearUnitPanels(chart);}},
    afterDraw:function(chart){
      var ctx=chart.ctx,area=chart.chartArea;if(!ctx||!area){return;}ctx.save();ctx.fillStyle=root.VizSeries&&root.VizSeries.readTheme&&root.VizSeries.readTheme()==='light'?'#202735':'#e9eef5';ctx.font='11px sans-serif';
      var notes=[];Object.keys(chart.$vizScales||{}).forEach(function(k){var r=chart.$vizScales[k],s=chart.scales[k];if(r.axis_note){notes.push(k+': '+r.axis_note);}if(s&&s.getPixelForValue){r.references.forEach(function(v){var pos=s.getPixelForValue(v),isX=s.axis==='x';if(pos>=(isX?area.left:area.top)&&pos<=(isX?area.right:area.bottom)){ctx.beginPath();ctx.setLineDash([2,3]);ctx.strokeStyle='#818994';if(isX){ctx.moveTo(pos,area.top);ctx.lineTo(pos,area.bottom);}else{ctx.moveTo(area.left,pos);ctx.lineTo(area.right,pos);}ctx.stroke();}});}});
      if(notes.length){ctx.setLineDash([]);ctx.fillText(notes.join(' / '),area.left+5,area.bottom-5);}
      ctx.restore();if(root.VizSeries&&root.VizSeries.drawForecastDividers){root.VizSeries.drawForecastDividers(chart);}
    }
  };
  var api={niceScale:niceScale,classifySeries:classifySeries,legendPlan:legendPlan,axisNote:axisNote,axisPlan:axisPlan,alignZero:alignZero,dataValue:dataValue,vizScalePlugin:vizScalePlugin};
  root.VizScale=api;if(typeof module!=='undefined'&&module.exports){module.exports=api;}
  if(root.Chart&&root.Chart.register){root.Chart.register(vizScalePlugin);}
}(typeof window!=='undefined'?window:(typeof global!=='undefined'?global:this)));
