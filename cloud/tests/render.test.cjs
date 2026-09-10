/* Rendering contract tests in a plain JS VM with string sinks; no browser or DOM parser. */
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),E=require('../signals-core.js'),M=require('../model.js');
const data=Object.fromEntries(['ledger','research','phalanx','operations'].map(k=>[k,JSON.parse(fs.readFileSync(path.join(__dirname,'../data',k+'.json'),'utf8'))]));
async function render(provider,view,opsError=false){
 const sinks={app:{innerHTML:'',addEventListener(){}},asof:{textContent:''}},errors=[];
 const context={PhxCloud:E,CloudModel:M,URL,URLSearchParams,Date,Number,Blob,Map,Set,structuredClone,
  location:new URL('https://example.test/ensemble/cloud/?company='+provider+'&view='+view),
  history:{replaceState(){}},localStorage:{getItem(){return null;}},addEventListener(){},
  document:{getElementById:id=>sinks[id],body:{classList:{add(){}}}},
  fetch:async url=>{const name=url.split('/').at(-1).split('.')[0];if(opsError&&name==='operations')throw Error('offline');return {ok:true,json:async()=>data[name]};},
  console:{error:e=>errors.push(e)},setTimeout};
 context.window=context;context.parent=context;
 await vm.runInNewContext(script,context,{timeout:2000});
 assert.equal(errors.length,0,errors.map(e=>e.stack).join('\n'));
 assert.ok(!sinks.app.innerHTML.includes('<h3>입력 확인</h3>'),provider+'/'+view+' rendering failed');
 return sinks.app.innerHTML;
}
test('all 22 providers and eight views produce valid content without runtime failures',async()=>{
 for(const provider of Object.keys(data.ledger.providers))for(const view of ['overview','capacity','earnings','calculator','history','evidence','compare','links']){
  const output=await render(provider,view);assert.ok(output.includes('class="layout"'));assert.ok(!output.includes('NaN'),'NaN in '+provider+'/'+view);
 }
});
test('capacity, calculator and integration expose their required outputs',async()=>{
 const ramp=await render('IREN','capacity');assert.ok(ramp.includes('Microsoft'));assert.ok(ramp.includes('NVIDIA'));assert.ok(ramp.includes('월별 수치와 고객 배정'));
 const calc=await render('NBIS','calculator');assert.ok(calc.includes('$7.99B'));assert.ok(calc.includes('2027 매출 민감도'));
 const links=await render('NBIS','links');assert.ok(links.includes('../chains/memory.html'));assert.ok(links.includes('data/exports.json'));
});
test('an unavailable operations feed does not remove financial and capacity views',async()=>{
 const output=await render('NBIS','overview',true);assert.ok(output.includes('운영 데이터 로드 실패'));assert.ok(output.includes('고객 배정'));
});
