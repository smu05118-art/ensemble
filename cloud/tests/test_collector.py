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

    def test_official_source_change_is_candidate_not_observation(self):
        registry = {'providers': {'TEST': {'label': 'Issuer IR', 'kind': 'official_investor_index', 'url': 'https://issuer.example/ir'}}}
        first, events = c.watch_official_sources({}, registry, '2026-10-14T00:00:00Z',
            fetcher=lambda _: {'content_hash': 'a', 'content_type': 'text/html', 'etag': None, 'last_modified': None, 'bytes': 10, 'final_url': 'https://issuer.example/ir'})
        self.assertEqual(events, [])
        second, events = c.watch_official_sources({'disclosures': first}, registry, '2026-10-15T00:00:00Z',
            fetcher=lambda _: {'content_hash': 'b', 'content_type': 'text/html', 'etag': None, 'last_modified': None, 'bytes': 12, 'final_url': 'https://issuer.example/ir'})
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]['type'], 'source_changed')
        self.assertEqual(second['providers']['TEST']['content_hash'], 'b')
        self.assertNotIn('value', second['providers']['TEST'])

    def test_official_source_error_keeps_last_good_fingerprint(self):
        registry = {'providers': {'TEST': {'label': 'Issuer IR', 'kind': 'official_investor_index', 'url': 'https://issuer.example/ir'}}}
        old = {'disclosures': {'providers': {'TEST': {'content_hash': 'stable', 'last_good_at': '2026-10-14T00:00:00Z'}}}}
        watched, events = c.watch_official_sources(old, registry, '2026-10-15T00:00:00Z',
            fetcher=lambda _: (_ for _ in ()).throw(RuntimeError('HTTP 503')))
        row = watched['providers']['TEST']
        self.assertEqual(row['health'], 'error')
        self.assertEqual(row['content_hash'], 'stable')
        self.assertEqual(events, [])

if __name__ == '__main__': unittest.main()
