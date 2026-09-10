import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('collector', Path(__file__).resolve().parents[2] / 'tools/collect_cloud.py')
c = importlib.util.module_from_spec(spec);spec.loader.exec_module(c)

class CollectorTests(unittest.TestCase):
    def rows(self):
        return {'jobs': [{'id': 'a', 'title': 'Data Center Engineer', 'data_center': True}], 'regions': [{'id': 'r', 'name': 'EU-NORTH1', 'status': 'operational'}], 'incidents': []}
    def test_baseline_is_not_new_hiring(self):
        first = c.update(None, self.rows(), {}, '2026-09-10T00:00:00Z')
        self.assertEqual(first['events'], [])
        next_rows = self.rows();next_rows['jobs'].append({'id': 'b', 'title': 'New', 'data_center': False})
        second = c.update(first, next_rows, {}, '2026-09-11T00:00:00Z')
        self.assertEqual(len(second['events']), 1)
        self.assertEqual(second['adapters']['jobs']['rows'][0]['first_seen_at'], '2026-09-10T00:00:00Z')
        self.assertEqual(first['adapters']['jobs']['rows'][0]['baseline_import'], True)
    def test_failure_keeps_last_good_without_false_removals(self):
        first = c.update(None, self.rows(), {}, '2026-09-10T00:00:00Z')
        second = c.update(first, self.rows(), {'jobs': 'HTTP 503'}, '2026-09-11T00:00:00Z')
        self.assertEqual(second['adapters']['jobs']['rows'], first['adapters']['jobs']['rows'])
        self.assertEqual(second['adapters']['jobs']['updated_at'], first['adapters']['jobs']['updated_at'])
        self.assertEqual(second['adapters']['jobs']['health'], 'error')
        self.assertEqual(second['events'], [])
    def test_components_not_counted_as_regions(self):
        rows = c.normalize('regions', {'components': [{'id': 'a', 'name': 'EU-NORTH1', 'status': 'operational', 'group': True}, {'id': 'b', 'name': 'Compute', 'status': 'operational', 'group': False}]})
        self.assertEqual(len(rows), 1)

if __name__ == '__main__': unittest.main()
