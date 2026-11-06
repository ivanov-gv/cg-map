"""Address assembly uses no PBF, GIS dependencies or network."""
import importlib.util
import json
from pathlib import Path
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'tools/build-building-labels.py'
SPEC = importlib.util.spec_from_file_location('building_labels', SCRIPT)
LABELS = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LABELS)


class BuildingAddressTests(unittest.TestCase):
    def test_explicit_entrances_do_not_replace_building_number(self):
        building = {'osm_id': 'way/1', 'number': '1', 'street': 'Ulica Slobode'}
        entrances = [{'id': 'node/2', 'number': '32', 'coordinates': [19.26, 42.44]},
                 {'id': 'node/1', 'number': '27', 'coordinates': [19.261, 42.44]}]
        result = LABELS.building_properties(building, [building], entrances, 0)
        self.assertEqual(result['building_number'], '1')
        self.assertEqual(result['addr:housenumber'], '1')
        self.assertEqual(result['entrances'], list(reversed(entrances)))
        self.assertEqual(result['address_sources'], ['node/1', 'node/2', 'way/1'])

    def test_node_only_addresses_are_not_invented_entrances(self):
        building = {'osm_id': 'way/1', 'number': '', 'street': ''}
        address_nodes = [{'osm_id': 'node/1', 'number': '27', 'street': 'Slobode'}]
        result = LABELS.building_properties(building, address_nodes, [], 0)
        self.assertNotIn('building_number', result)
        self.assertNotIn('entrances', result)
        self.assertEqual(result['addr:housenumber'], '27')
        self.assertEqual(result['addr:street'], 'Slobode')

    def test_numberless_entrance_keeps_its_position_without_a_number(self):
        building = {'osm_id': 'way/1', 'number': '', 'street': ''}
        entrances = [{'id': 'node/1', 'ref': 'M', 'coordinates': [19.26, 42.44]}]
        result = LABELS.building_properties(building, [], entrances, 0)
        self.assertNotIn('building_number', result)
        self.assertNotIn('addr:housenumber', result)
        self.assertEqual(result['entrances'], entrances)
        with self.assertRaises(ValueError):
            LABELS.building_properties(building, [], entrances * 101, 0)

    def test_wall_normals_match_the_shared_orientation_cases(self):
        fixtures = SCRIPT.parents[2] / 'packages/contracts/fixtures/entrance-orientation-cases.json'
        for case in json.loads(fixtures.read_text()):
            with self.subTest(case=case['name']):
                bearing = LABELS.entrance_bearing(
                    case['entrance'], case['polygon']['coordinates'])
                difference = abs((bearing - case['bearing'] + 540) % 360 - 180)
                self.assertLess(difference, 0.00001)

    def test_no_number_placeholders_are_excluded(self):
        for raw in ['', 'bb', 'B. B.', 'bez broja', 'бб', '?']:
            with self.subTest(raw=raw):
                self.assertEqual(LABELS.house_number(raw), '')
        self.assertEqual(LABELS.house_number(' 27B '), '27B')


if __name__ == '__main__':
    unittest.main()
