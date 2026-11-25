"""Settlement areas: which settlement an area belongs to, and which is kept."""

import sys
import unittest
from pathlib import Path

from shapely.geometry import box, mapping

REPOSITORY = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY / 'data/tools'))

from osm_extract import ExtractionState, cli  # noqa: E402
from osm_extract.settlement_areas import SettlementAreasLayer  # noqa: E402

OPTIONS = cli.Options(
    (19.15, 42.37, 19.34, 42.51), False, False, Path('.'),
    'https://example.org/extract.osm.pbf', '2026-11-21',
    '2026-11-20T21:21:21Z', False,
)


def settlement(node_id, name, longitude, latitude):
    return {
        'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': [longitude, latitude]},
        'properties': {'entityId': f'node/{node_id}', 'name': name},
    }


def area(way_id, name, bounds, is_place=True, centre=None):
    return {
        'tags': {'name': name},
        'is_place': is_place,
        'shape': box(*bounds),
        'identity': {'entityId': f'way/{way_id}', 'entityVersion': 1},
        'centre': centre,
    }


class SettlementAreasTest(unittest.TestCase):
    def published(self, *areas):
        state = ExtractionState(
            settlement_features=[
                settlement(1, 'Alpha', 19.205, 42.405),
                settlement(2, 'Alpha', 19.305, 42.405),
                settlement(3, 'Beta', 19.255, 42.455),
            ],
            municipality_sources=[{
                'iso': 'ME-1',
                'geometry': mapping(box(19.0, 42.0, 20.0, 43.0)),
            }],
        )
        layer = SettlementAreasLayer()
        layer._areas = list(areas)
        return [
            feature['properties'] for feature in layer.finish(OPTIONS, state)
        ]

    def test_an_area_belongs_to_the_settlement_of_its_name_inside_it(self):
        [properties] = self.published(
            area(10, 'Alpha', (19.30, 42.40, 19.31, 42.41))
        )
        self.assertEqual(properties['settlementEntityId'], 'node/2')
        self.assertEqual(properties['kind'], 'settlement-area')

    def test_the_node_a_boundary_names_as_its_centre_decides(self):
        [properties] = self.published(area(
            10, 'Old Beta', (19.40, 42.40, 19.41, 42.41),
            is_place=False, centre=3
        ))
        self.assertEqual(properties['settlementEntityId'], 'node/3')

    def test_a_bilingual_area_is_known_by_either_name(self):
        [properties] = self.published(
            area(10, 'Beta - Gamma', (19.25, 42.45, 19.26, 42.46))
        )
        self.assertEqual(properties['settlementEntityId'], 'node/3')

    def test_the_place_is_preferred_over_the_boundary_around_it(self):
        [properties] = self.published(
            area(10, 'Beta', (19.25, 42.45, 19.26, 42.46), is_place=False),
            area(11, 'Beta', (19.24, 42.44, 19.27, 42.47)),
        )
        self.assertEqual(properties['entityId'], 'way/11')

    def test_a_place_without_a_point_keeps_its_area_and_a_boundary_does_not(
        self
    ):
        properties = self.published(
            area(10, 'Quarter', (19.25, 42.45, 19.26, 42.46)),
            area(11, 'District', (19.25, 42.45, 19.26, 42.46),
                 is_place=False),
        )
        self.assertEqual([entry['name'] for entry in properties], ['Quarter'])
        self.assertNotIn('settlementEntityId', properties[0])

    def test_an_area_outside_every_municipality_is_left_out(self):
        self.assertEqual(
            self.published(area(10, 'Abroad', (21.0, 42.4, 21.1, 42.5))), []
        )


if __name__ == '__main__':
    unittest.main()
