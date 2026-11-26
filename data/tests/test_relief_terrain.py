"""Relief terrain arithmetic uses NumPy only, so plain python3 can test it."""
import importlib.util
import os
from pathlib import Path
import unittest

import numpy as np

DEFAULT_TERRAIN = Path(__file__).resolve().parents[1] / 'tools/relief/terrain.py'
TERRAIN_PATH = Path(os.environ.get('RELIEF_TERRAIN_PATH', DEFAULT_TERRAIN))
SPEC = importlib.util.spec_from_file_location('relief_terrain_under_test', TERRAIN_PATH)
TERRAIN = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(TERRAIN)


class ReliefTerrainTests(unittest.TestCase):
    def test_contour_levels_are_20_metres_apart_and_indexed_every_100(self):
        levels = TERRAIN.contour_levels(25, 255)
        self.assertEqual(levels, list(range(40, 241, 20)))
        self.assertEqual([TERRAIN.is_index_level(level) for level in levels].count(True), 2)
        self.assertTrue(TERRAIN.is_index_level(100))
        self.assertFalse(TERRAIN.is_index_level(120))

    def test_south_facing_slope_is_sunlit_and_north_facing_is_shaded(self):
        south_facing = np.array([[100, 100, 100], [80, 80, 80], [60, 60, 60]])
        north_facing = np.array([[60, 60, 60], [80, 80, 80], [100, 100, 100]])
        flat = np.full((3, 3), 80.0)
        _, south_aspect = TERRAIN.slope_and_aspect(south_facing, 30, 30)
        _, north_aspect = TERRAIN.slope_and_aspect(north_facing, 30, 30)
        self.assertAlmostEqual(float(south_aspect[1, 1]), 180, places=4)
        self.assertAlmostEqual(float(north_aspect[1, 1]), 0, places=4)
        sunlit = TERRAIN.sunlit_mask(south_facing, 30, 30)
        shaded = TERRAIN.sunlit_mask(north_facing, 30, 30)
        flat_sunlit = TERRAIN.sunlit_mask(flat, 30, 30)
        self.assertTrue(bool(sunlit[1, 1]))
        self.assertFalse(bool(shaded[1, 1]))
        self.assertTrue(bool(flat_sunlit[1, 1]))

    def test_synthetic_ridge_dem_puts_ridge_on_the_light_class_boundary(self):
        # An east-west ridge with a steep north face and a steep south face. The crest falls
        # between two pixel rows, so one row is wholly shaded and the next wholly sunlit.
        crest_heights = np.array([0, 20, 40, 60, 80, 100, 90, 70, 50, 30, 10, -10], dtype=float)
        heights = np.tile(crest_heights[:, None], (1, 11))
        longitudes = np.linspace(19.250, 19.253, 11)
        latitudes = np.linspace(42.450, 42.447, 12)

        def cell_edges(coordinates):
            step = coordinates[1] - coordinates[0]
            return np.linspace(
                coordinates[0] - step / 2,
                coordinates[-1] + step / 2,
                len(coordinates) + 1,
            )

        x_edges = cell_edges(longitudes)
        y_edges = cell_edges(latitudes)
        is_sunlit = TERRAIN.sunlit_mask(heights, 30, 30)
        cell_classes = np.where(is_sunlit, 1, 0)
        paths = TERRAIN.aspect_boundary_paths(cell_classes, x_edges, y_edges)
        crest_latitude = (latitudes[5] + latitudes[6]) / 2

        self.assertEqual(TERRAIN.RIDGE_MINIMUM_LENGTH_METRES, 100)
        self.assertEqual(TERRAIN.RIDGE_SUMMIT_LINK_DISTANCE_METRES, 50)
        self.assertEqual(len(paths), len(longitudes))
        for path in paths:
            self.assertEqual(len(path), 2)
            self.assertAlmostEqual(path[0][1], crest_latitude, places=9)
            self.assertAlmostEqual(path[1][1], crest_latitude, places=9)
            midpoint_longitude = (path[0][0] + path[1][0]) / 2
            column = int(np.argmin(np.abs(longitudes - midpoint_longitude)))
            self.assertFalse(bool(is_sunlit[5, column]))
            self.assertTrue(bool(is_sunlit[6, column]))

    def test_distinct_contour_levels_never_cross(self):
        longitudes = np.linspace(19.24, 19.26, 15)
        latitudes = np.linspace(42.455, 42.435, 15)
        mesh_x, mesh_y = np.meshgrid(longitudes, latitudes)
        heights = (
            20 + 300 * np.exp(-((mesh_x - 19.25) ** 2 + (mesh_y - 42.445) ** 2) / 0.00008)
            + 40 * (mesh_x - 19.24) / 0.02
        )
        levels = TERRAIN.contour_levels(float(heights.min()), float(heights.max()))
        segments = list(TERRAIN.contour_paths_from_grid(heights, longitudes, latitudes, levels))
        self.assertGreater(len(segments), 20)
        TERRAIN.assert_contours_do_not_cross(segments)

    def test_a_forced_crossing_is_detected(self):
        first = {'level': 100, 'path': [[0.0, 0.0], [1.0, 1.0]]}
        second = {'level': 120, 'path': [[0.0, 1.0], [1.0, 0.0]]}
        crossings = TERRAIN.contour_crossing_pairs([first, second])
        self.assertEqual(len(crossings), 1)
        with self.assertRaises(ValueError):
            TERRAIN.assert_contours_do_not_cross([first, second])

    def test_serialisation_and_content_versions_are_deterministic(self):
        features = [
            {
                'type': 'Feature',
                'geometry': {'type': 'Point', 'coordinates': [19.26, 42.44]},
                'properties': {'entityId': 'derived:ridge-b', 'entityVersion': 1, 'kind': 'ridge'},
            },
            {
                'type': 'Feature',
                'geometry': {'type': 'Point', 'coordinates': [19.25, 42.44]},
                'properties': {'entityId': 'derived:ridge-a', 'entityVersion': 1, 'kind': 'ridge'},
            },
        ]
        text = TERRAIN.serialize_collection(features)
        self.assertEqual(text, TERRAIN.serialize_collection(list(reversed(features))))
        self.assertTrue(text.endswith('\n'))
        lines = text.splitlines()
        self.assertEqual(lines[0], '{"entitySchemaVersion":1,"features":[')
        self.assertEqual(lines[-1], '],"type":"FeatureCollection"}')
        self.assertEqual(len(lines), 4)
        self.assertTrue(lines[1].startswith('{"geometry"'))
        self.assertTrue(lines[1].endswith(','))
        self.assertTrue(lines[2].endswith('}'))
        self.assertEqual(
            TERRAIN.content_hash(features[0]),
            TERRAIN.content_hash({
                'type': 'Feature',
                'geometry': {'type': 'Point', 'coordinates': [19.26, 42.44]},
                'properties': {'entityId': 'derived:ridge-b', 'entityVersion': 1, 'kind': 'ridge'},
            }),
        )
        versioned = TERRAIN.versioned_properties({'entityId': 'derived:ridge-gorica', 'kind': 'ridge'},
                                                 {'type': 'Point', 'coordinates': [19.25, 42.44]})
        self.assertTrue(versioned['entityVersion'].startswith('sha256:'))

    def test_height_check_uses_contour_or_large_dem_difference_only(self):
        self.assertEqual(TERRAIN.classify_height_check(None, 131.04, None), 'missing')
        self.assertEqual(TERRAIN.classify_height_check(130.0, 131.04, None), 'ok')
        self.assertEqual(TERRAIN.classify_height_check(130.0, 131.04, 120), 'ok')
        self.assertEqual(TERRAIN.classify_height_check(130.0, 131.04, 140), 'mismatch')
        self.assertEqual(TERRAIN.classify_height_check(130.0, 160.04, None), 'mismatch')

    def test_bank_below_canyon_threshold_is_not_a_rim(self):
        self.assertEqual(TERRAIN.CANYON_BANK_RISE_METRES, 8)
        self.assertEqual(TERRAIN.CANYON_SEARCH_DISTANCE_METRES, 60)
        self.assertFalse(TERRAIN.is_canyon_bank(100, [105, 107.9]))
        self.assertTrue(TERRAIN.is_canyon_bank(100, [105, 108]))
        self.assertEqual(TERRAIN.bank_rise(100, [105, 107]), 7)

    def test_rim_paths_group_only_gaps_under_sixty_metres(self):
        self.assertEqual(TERRAIN.CANYON_RIM_JOIN_GAP_METRES, 60)
        first = [[0.0, 0.0], [10.0, 0.0]]
        near = [[15.0, 0.0], [25.0, 0.0]]
        far = [[85.0, 0.0], [95.0, 0.0]]
        groups = TERRAIN.join_short_gap_groups(
            [first, near, far], TERRAIN.CANYON_RIM_JOIN_GAP_METRES, 1, 1
        )
        self.assertEqual(groups, [[0, 1], [2]])

    def test_rim_paths_under_one_hundred_metres_are_dropped(self):
        self.assertEqual(TERRAIN.CANYON_RIM_MINIMUM_LENGTH_METRES, 100)
        short = [[0.0, 0.0], [99.9, 0.0]]
        long_enough = [[0.0, 1.0], [100.0, 1.0]]
        kept = TERRAIN.drop_short_paths(
            [short, long_enough], TERRAIN.CANYON_RIM_MINIMUM_LENGTH_METRES, 1, 1
        )
        self.assertEqual(kept, [long_enough])

    def test_each_connected_line_path_stays_a_separate_feature(self):
        first = [[19.20, 42.44], [19.21, 42.44]]
        second = [[19.30, 42.50], [19.31, 42.50]]
        lines = TERRAIN.separate_line_paths([second, first])
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0][0], first[0])
        self.assertEqual(lines[1][0], second[0])

    def test_features_sort_by_identity_and_split_part(self):
        features = [
            {'properties': {'entityId': 'derived:rim', 'entityPart': 1}},
            {'properties': {'entityId': 'derived:contour'}},
            {'properties': {'entityId': 'derived:rim', 'entityPart': 0}},
        ]
        self.assertEqual(
            [feature['properties'].get('entityPart') for feature in TERRAIN.sort_features(features)],
            [None, 0, 1],
        )


if __name__ == '__main__':
    unittest.main()
