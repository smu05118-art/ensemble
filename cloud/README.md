# Ensemble AI·Cloud

The AI–Cloud workspace is owned by Ensemble. Entry: `/#tab=cloud&company=NBIS` or `/cloud/`.
Both home documents load `ensemble-tab.js`; the existing home and chain views retain their original behavior.
After regenerating either home, run `python3 tools/inject_cloud_tab.py` to preserve the entry.

## Coverage

22 provider pages retain Phalanx's cloud, CAPEX, FCF, ASP, transcript references and underlying archived datasets.
Six reviewed capacity models cover NBIS, CRWV, IREN, APLD, CIFR and WULF. Model scopes differ: revenue-equivalent MW, active power, critical IT MW and gross MW must not be summed.
No customer allocation is invented as a confirmed disclosure. Solid customer colors identify disclosed contract MW; hatching identifies assumed MW. Monthly timing remains estimated except explicit deliveries.

`research.json` contains curated official sources, publication dates, earnings comparisons, contract economics and scenario assumptions. Reference calculator: NBISTracker, 425 MW × (40%×12 + 50%×20 + 10%×40) = $7.99B exit ARR. Period revenue uses average monthly capacity. Meta's $15B residual-capacity agreement is not added to its $12B dedicated capacity.

`ledger.json` preserves original unverified observations, official checks and revisions. Targets, unverifiable figures and observations older than 180 days do not enter actual-direction scores. Scores summarize rule-based direction; no return prediction, backtest or trading performance is claimed.

`operations.json` collects public Nebius Greenhouse jobs and Statuspage regional groups/incidents. The first collection is a baseline. Created dates are not inferred from job update timestamps. Failed adapters retain last good data with visible error health. Daily collection is configured in `cloud-observations.yml`; financial filings still require deliberate source review.

`exports.json` is the machine-readable handoff for other modules. It contains provider IDs, units, scopes, publication and discovery times, evidence groups, actual-direction summaries and explicitly marked monthly scenarios. Chain links to rack, memory, optics and power are navigable. Statistical integration is conditional on customer allocation/BOM and publication-time alignment; it is not automatically a validated forecast model.

## Update and validation

```sh
python3 tools/collect_cloud.py
python3 tools/enrich_cloud_ledger.py
python3 tools/inject_cloud_tab.py
node tools/export_cloud.cjs
node --test cloud/tests/*.test.cjs
python3 -m unittest discover -s cloud/tests -p 'test_*.py'
python3 tools/validate_cloud.py
```

Scenario edits stay on the current device in localStorage and are labeled as user assumptions. CSV exports include the scenario inputs. Shared page links select the provider/view but do not transmit local scenario edits.

Existing GitHub Pages branch deployment is preserved. The daily collector explicitly requests a Pages build because a `GITHUB_TOKEN` commit does not itself trigger a new Pages build.
