import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('sec_facts', Path(__file__).resolve().parents[2] / 'tools/collect_cloud_sec_facts.py')
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)

class SecFactsTests(unittest.TestCase):
    def facts(self):
        return {'facts': {'us-gaap': {'Revenues': {'units': {'USD': [
            {'form': '10-Q', 'start': '2026-01-01', 'end': '2026-03-31', 'filed': '2026-05-01', 'val': 100000000, 'fy': 2026, 'fp': 'Q1', 'frame': 'CY2026Q1'},
            {'form': '10-Q', 'start': '2026-01-01', 'end': '2026-06-30', 'filed': '2026-08-01', 'val': 250000000, 'fy': 2026, 'fp': 'Q2'},
            {'form': '10-Q', 'start': '2026-04-01', 'end': '2026-06-30', 'filed': '2026-08-01', 'val': 160000000, 'fy': 2026, 'fp': 'Q2', 'frame': 'CY2026Q2'},
            {'form': '10-K', 'start': '2025-01-01', 'end': '2025-12-31', 'filed': '2026-02-01', 'val': 600000000, 'fy': 2025, 'fp': 'FY'},
        ]}}}}}

    def test_selects_direct_quarters_not_cumulative_or_future_annual(self):
        rows = c.direct_quarters(self.facts(), 'USD', '2026-10-14')
        self.assertEqual([(x['end'], x['val']) for x in rows], [('2026-03-31', 100000000), ('2026-06-30', 160000000)])
        annual = c.direct_annuals(self.facts(), 'USD', '2026-10-14')
        self.assertEqual([(x['end'], x['val']) for x in annual], [('2025-12-31', 600000000)])

    def test_repeated_fact_is_a_noop_and_is_not_scored(self):
        ledger = {'providers': {'TEST': {'currency': 'USD'}}, 'signals': []}
        registry = {'providers': {'TEST': {'kind': 'sec_filing_index', 'url': 'https://data.sec.gov/submissions/CIK0000000001.json'}}}
        first, added = c.collect(ledger, registry, '2026-10-14T00:00:00Z', fetch=lambda _: self.facts())
        self.assertEqual(len(added), 3)
        self.assertTrue(all(x['verified'] and x['evidence'] == 'confirmed' for x in added))
        self.assertTrue(all(x['direction'] is None and not x['rule'] for x in added))
        self.assertTrue(all(x['effective_at'] in x['period'] for x in added))
        second, again = c.collect(first, registry, '2026-10-15T00:00:00Z', fetch=lambda _: self.facts())
        self.assertEqual(again, [])
        self.assertIs(second, first)

if __name__ == '__main__': unittest.main()
