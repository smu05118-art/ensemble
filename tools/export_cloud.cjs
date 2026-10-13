/* Machine-readable handoff for Ensemble chains and Phalanx consumers. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),E=require('../cloud/signals-core.js'),M=require('../cloud/model.js');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'cloud/data',name+'.json'),'utf8'));
const ledger=read('ledger'),research=read('research'),operations=read('operations');
const asof=new Date().toISOString().slice(0,10);
const data={schema:'ensemble_cloud_exports/1',asof,primary_key:['provider','metric','period','scope','unit'],
 source_updated_at:{financial_review:research.updated,operations:operations.attempted_at,sec_companyfacts:ledger.signals.filter(s=>s.origin==='sec_companyfacts').map(s=>s.observed_at).sort().at(-1)||null,legacy:'2026-08-13'},
 observations:E.current(ledger.signals,asof).filter(s=>s.verified),
 official_disclosures:Object.values(operations.disclosures?.providers||{}).map(row=>({provider:row.provider,label:row.label,url:row.url,kind:row.kind,automated:row.automated,health:row.health,last_checked_at:row.last_checked_at,last_good_at:row.last_good_at,last_changed_at:row.last_changed_at,error:row.error||null})),
 ensemble:Object.keys(ledger.providers).map(p=>E.ensemble(ledger.signals,p,asof)),
 monthly_scenarios:Object.entries(research.profiles).map(([provider,p])=>({provider,kind:'scenario',scope:p.scope,unit:p.unit,baseline_mw:p.baseline_mw,assumptions:{calculator:p.calculator,tranches:p.tranches,notes:p.notes},rows:M.forecast(p).rows})),
 integration:{shared_capex_equal:ledger.integration.shared_capex_equal,checks:ledger.integration.checks,links:{rack:'chains/rack.html',memory:'chains/memory.html',optics:'chains/optics.html',power:'chains/power.html'}},
 rules:['Targets and scenarios are excluded from observed-direction scores.','Do not sum IT MW, gross MW, power commitments, or revenue-equivalent MW.','Deduplicate source_url and correlation_group before combining evidence.','Observations use published_at and first_seen_at, never retroactive discovery dates.']};
fs.writeFileSync(path.join(root,'cloud/data/exports.json'),JSON.stringify(data,null,2)+'\n');
console.log(`${data.observations.length} reviewed observations; ${data.monthly_scenarios.length} capacity profiles; ${data.ensemble.length} providers`);
