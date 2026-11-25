"""Summit clipping needs the GIS packages pinned in data/tools/requirements.txt."""
import os
import sys
import unittest
from pathlib import Path

import numpy as np
from shapely.geometry import Point, box, mapping

TOOLS_PATH = Path(os.environ.get(
    'RELIEF_TOOLS_PATH', Path(__file__).resolve().parents[1] / 'tools'
))
sys.path.insert(0, str(TOOLS_PATH))

from relief import derivations  # noqa: E402


class ConstantTerrainModel:
    """Return one elevation so height checks do not depend on a DEM."""

    def sample(self, longitude, latitude):
        return 120.0

    def surrounding_height(self, longitude, latitude):
        return 120.0


def summit(entity_id, coordinates, name):
    """Build the OSM-shaped summit record consumed by the relief builder."""
    return {
        'entityId': entity_id,
        'entityVersion': 1,
        'coordinates': coordinates,
        'kind': 'peak',
        'tags': {'ele': '120', 'name': name},
    }


class ReliefDerivationTests(unittest.TestCase):
    def test_summits_outside_synthetic_country_are_excluded(self):
        country = box(0, 0, 20, 10).difference(box(9.9999999, 1, 10.00000005, 9))
        land = {'features': [{
            'properties': {'kind': 'country', 'entityId': 'relation/53296'},
            'geometry': mapping(country),
        }]}
        osm = {'summits': [
            summit('node/1', [5.0, 5.0], 'Inside'),
            summit('node/2', [20.0, 5.0], 'Boundary'),
            summit('node/3', [30.0, 5.0], 'Outside'),
            summit('node/4', [20.0000001, 5.0], 'Rounds inside'),
            summit('node/5', [10.0000001, 5.0], 'Rounds outside'),
        ]}

        features, report = derivations.build_summits(
            ConstantTerrainModel(), osm, land, []
        )

        self.assertEqual(
            [feature['properties']['entityId'] for feature in features],
            ['node/1', 'node/2'],
        )
        self.assertEqual(report['features'], 2)
        self.assertEqual(report['summitsOutsideCountry'], 3)
        self.assertEqual(
            report['heightCheckCounts'], {'ok': 2, 'mismatch': 0, 'missing': 0}
        )

    def test_absent_summit_name_tags_are_omitted(self):
        land = {'features': [{
            'properties': {'kind': 'country', 'entityId': 'relation/53296'},
            'geometry': mapping(box(0, 0, 20, 10)),
        }]}
        osm = {'summits': [{
            'entityId': 'node/10',
            'entityVersion': 1,
            'coordinates': [5.0, 5.0],
            'kind': 'peak',
            'tags': {'ele': '120'},
        }]}
        features, _ = derivations.build_summits(ConstantTerrainModel(), osm, land, [])
        properties = features[0]['properties']
        self.assertNotIn('name', properties)
        self.assertNotIn('name:en', properties)

    def test_parse_elevation_accepts_units_and_rejects_ambiguous_values(self):
        self.assertEqual(derivations._parse_elevation('1234 m'), 1234.0)
        self.assertEqual(derivations._parse_elevation('1,234 m'), 1234.0)
        self.assertEqual(derivations._parse_elevation('1.234'), 1.234)
        self.assertEqual(derivations._parse_elevation('1,234,567'), 1234567.0)
        self.assertIsNone(derivations._parse_elevation('1,23'))
        self.assertIsNone(derivations._parse_elevation('12m34'))
        self.assertIsNone(derivations._parse_elevation(''))

    def test_a_rim_height_is_the_median_sample_rounded_to_whole_metres(self):
        rises = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0]
        latitude_metres = 111_320
        samples = [
            (index * 40, Point(0.0, 5.0 + index * 0.00036), rise)
            for index, rise in enumerate(rises)
        ]
        bank_samples = [(point, rise) for _, point, rise in samples]
        segments = derivations._segments_from_samples(samples, 60)
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0][1], bank_samples)

        cleaned = derivations._clean_rim_segments(segments, latitude_metres, 80_000)
        self.assertEqual(len(cleaned), 1)
        self.assertEqual(cleaned[0][1], bank_samples)
        self.assertEqual(
            derivations._rim_height([rise for _, rise in cleaned[0][1]]), 35
        )

        self.assertEqual(derivations._rim_height([10.0, 20.0]), 15)
        self.assertIsNone(derivations._rim_height([]))
        self.assertIsNone(derivations._rim_height([2601.0]))

    def test_an_osm_cliff_takes_height_only_from_nearby_bank_samples(self):
        part = derivations.LineString([(0.0, 5.0001), (0.002, 5.0001)])
        cliff = {'entityId': 'way/7', 'entityVersion': 3, 'coordinates': list(part.coords)}
        latitude_metres = 111_320
        bank = derivations.LineString([(0.0, 5.0002), (0.02, 5.0002)])
        nearby = [
            (Point(0.00005, 5.0002), 10.0),
            (Point(0.00015, 5.0002), 10.0),
        ]
        distant = [
            (Point(0.01, 5.0002), 100.0),
            (Point(0.012, 5.0002), 100.0),
            (Point(0.014, 5.0002), 100.0),
        ]
        def properties_for(segments):
            features = derivations._cliff_rim_features(
                [(part, cliff)], 'Ribnica', 'left', latitude_metres, 80_000, segments
            )
            return features[0]['properties']

        self.assertNotIn('height', properties_for(()))
        self.assertNotIn('height', properties_for([(bank, distant)]))
        self.assertEqual(properties_for([(bank, nearby + distant)])['height'], 10)

    def test_contours_run_with_uphill_on_their_left(self):
        longitudes = np.linspace(19.0, 19.01, 41)
        latitudes = np.linspace(42.01, 42.0, 41)
        column_grid, row_grid = np.meshgrid(np.arange(41), np.arange(41))
        # One round hill in the middle of the grid, 200 m high at its top.
        heights = 200.0 - np.hypot(column_grid - 20, row_grid - 20) * 8
        grid = {'longitudes': longitudes, 'latitudes': latitudes, 'heights': heights}
        features, _ = derivations.build_contours(grid)
        # Lines cut by the grid's edge have no inside; closed rings around the summit show the direction.
        rings = [
            feature for feature in features
            if feature['geometry']['coordinates'][0] == feature['geometry']['coordinates'][-1]
        ]
        self.assertTrue(rings)
        for feature in rings:
            coordinates = feature['geometry']['coordinates']
            signed_area = sum(
                start_x * end_y - end_x * start_y
                for (start_x, start_y), (end_x, end_y) in zip(coordinates[:-1], coordinates[1:])
            )
            # Counter-clockwise around the summit keeps the hill on the left.
            self.assertGreater(signed_area, 0, feature['properties'])

    def test_enclosing_contour_uses_highest_enclosing_level(self):
        land = {'features': [{
            'properties': {'kind': 'country', 'entityId': 'relation/53296'},
            'geometry': mapping(box(0, 0, 20, 10)),
        }]}
        contours = [
            {'properties': {'elevation': 100}, 'geometry': {'type': 'LineString', 'coordinates': list(box(1, 1, 9, 9).exterior.coords)}},
            {'properties': {'elevation': 120}, 'geometry': {'type': 'LineString', 'coordinates': list(box(2, 2, 8, 8).exterior.coords)}},
        ]
        osm = {'summits': [summit('node/1', [5.0, 5.0], 'Peak')]}
        features, _ = derivations.build_summits(ConstantTerrainModel(), osm, land, contours)
        self.assertEqual(features[0]['properties']['enclosingContourElevation'], 120)

    def test_canyon_rim_keeps_osm_cliff_identity_separate_from_dem_and_water_on_its_right(self):
        class RiverBankModel:
            def sample(self, longitude, latitude):
                if abs(latitude - 5.0) < 0.0002:
                    return 100.0
                if latitude > 5.0:
                    return 100.0 + (latitude - 5.0) * 200000
                return 100.0 + (5.0 - latitude) * 200000

        bounds = (0.0, 4.99, 0.01, 5.01)
        water = {'features': [{
            'properties': {'kind': 'river', 'name': 'Ribnica'},
            'geometry': {'type': 'LineString', 'coordinates': [[0.0, 5.0], [0.005, 5.0], [0.01, 5.0]]},
        }]}
        cliffs = [{
            'entityId': 'way/7',
            'entityVersion': 3,
            'kind': 'cliff',
            # Mapped against the river's flow, so the builder must reverse it to keep the water on its right.
            'coordinates': [[0.008, 5.0003], [0.002, 5.0003]],
        }]
        features, _ = derivations.build_canyon_rims(
            RiverBankModel(), water, cliffs, bounds, river_names=('Ribnica',), sample_spacing_metres=20
        )
        cliff_features = [f for f in features if f['properties'].get('method') == 'osm-cliff']
        dem_features = [f for f in features if f['properties'].get('method') == 'dem-canyon-bank']
        self.assertTrue(cliff_features)
        self.assertTrue(dem_features)
        self.assertEqual({f['properties']['entityId'] for f in cliff_features}, {'way/7'})
        self.assertEqual({f['properties']['entityVersion'] for f in cliff_features}, {3})
        self.assertTrue(all(f['properties']['kind'] == 'canyon-rim' for f in cliff_features))
        self.assertNotIn('cliffWays', cliff_features[0]['properties'])
        self.assertNotIn('minimumBankRiseMetres', cliff_features[0]['properties'])
        self.assertIn('lengthMetres', cliff_features[0]['properties'])
        self.assertTrue(all(f['properties']['entityId'].startswith('derived:canyon-rim-') for f in dem_features))
        self.assertEqual({feature['properties']['bank'] for feature in dem_features}, {'left', 'right'})
        for feature in features:
            (start_x, start_y), (end_x, end_y) = feature['geometry']['coordinates'][0], feature['geometry']['coordinates'][-1]
            river_y = 5.0
            # A negative cross product puts the river to the right of the line's direction.
            cross = (end_x - start_x) * (river_y - start_y) - (end_y - start_y) * ((start_x + end_x) / 2 - start_x)
            self.assertLess(cross, 0, feature['properties'])
