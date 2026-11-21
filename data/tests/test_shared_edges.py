"""Topology checks for the reviewed shared municipality border sources."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'data/sources'
TOOLS = ROOT / 'data/tools'
sys.path.insert(0, str(TOOLS))

import shared_edge_checks  # noqa: E402

from shapely.geometry import box, mapping  # noqa: E402


def collection(features):
    """Wrap features in the shape the checks read."""
    return {'type': 'FeatureCollection', 'features': features}


def feature(geometry, properties):
    """Build one GeoJSON feature with only the fields the checks need."""
    return {'type': 'Feature', 'geometry': geometry, 'properties': properties}


def square(minimum, maximum):
    """Return a closed GeoJSON square polygon."""
    return mapping(box(minimum, minimum, maximum, maximum))


def edge(identifier, left, right):
    """Return one horizontal shared edge with the given sides."""
    return feature(
        {'type': 'LineString', 'coordinates': [[0, 0], [1, 0]]},
        {
            'entityId': identifier,
            'left': left,
            'right': right,
            'osmWays': [],
        },
    )


def municipality(identifier, references):
    """Return one municipality whose edge references are supplied."""
    return feature(
        square(0, 1),
        {'ISO3166-2': identifier, 'edges': references},
    )


class SharedEdgesTest(unittest.TestCase):
    """Check the reviewed sources and fail on broken topology examples."""

    def test_reviewed_sources_pass_all_topology_checks(self):
        metrics = shared_edge_checks.check_sources(SOURCES)
        self.assertEqual(metrics['municipalities'], 25)
        self.assertEqual(metrics['edges'], 113)
        self.assertEqual(metrics['settlements'], 4009)
        self.assertLess(
            metrics['combined_bytes'],
            shared_edge_checks.MAX_COMBINED_BYTES,
        )
        self.assertLess(
            metrics['extra_area'],
            shared_edge_checks.EXTRA_AREA_TOLERANCE,
        )
        self.assertLess(
            metrics['unexplained_gap_area'],
            shared_edge_checks.MISSING_AREA_TOLERANCE,
        )

    def test_invalid_polygon_is_rejected(self):
        bowtie = {
            'type': 'Polygon',
            'coordinates': [
                [[0, 0], [1, 1], [0, 1], [1, 0], [0, 0]]
            ],
        }
        with self.assertRaisesRegex(ValueError, 'invalid polygon'):
            shared_edge_checks.polygons_in(
                collection([feature(bowtie, {})]), 'test'
            )

    def test_overlapping_polygons_are_rejected(self):
        polygons = [
            box(0, 0, 1, 1),
            box(0.5, 0, 1.5, 1),
        ]
        with self.assertRaisesRegex(ValueError, 'overlap'):
            shared_edge_checks.check_pairwise_intersections(polygons)

    def test_uncovered_land_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'uncovered'):
            shared_edge_checks.check_coverage(
                [box(0, 0, 1, 1)], box(0, 0, 2, 1)
            )

    def test_edges_need_one_municipality_on_each_municipal_side(self):
        edge_id = 'derived:edge-me-a-sea-1'
        shared_edge = edge(edge_id, 'ME-A', 'sea')
        correct = municipality(
            'ME-A', [{'id': edge_id, 'direction': 1}]
        )
        self.assertEqual(
            shared_edge_checks.check_edge_usage(
                [shared_edge], [correct], set()
            ),
            1,
        )
        wrong_direction = municipality(
            'ME-A', [{'id': edge_id, 'direction': -1}]
        )
        with self.assertRaisesRegex(ValueError, 'not used once'):
            shared_edge_checks.check_edge_usage(
                [shared_edge], [wrong_direction], set()
            )
        missing_reference = municipality('ME-A', [])
        with self.assertRaisesRegex(ValueError, 'not used once'):
            shared_edge_checks.check_edge_usage(
                [shared_edge], [missing_reference], set()
            )
        unknown_reference = municipality(
            'ME-A', [
                {'id': edge_id, 'direction': 1},
                {'id': 'derived:missing', 'direction': 1},
            ]
        )
        with self.assertRaisesRegex(ValueError, 'unknown edge'):
            shared_edge_checks.check_edge_usage(
                [shared_edge], [unknown_reference], set()
            )

    def test_unknown_outside_side_is_rejected(self):
        edge_id = 'derived:edge-me-a-narnia-1'
        shared_edge = edge(edge_id, 'ME-A', 'Narnia')
        reference = municipality(
            'ME-A', [{'id': edge_id, 'direction': 1}]
        )
        with self.assertRaisesRegex(ValueError, 'unknown outside side'):
            shared_edge_checks.check_edge_usage(
                [shared_edge], [reference], set()
            )


if __name__ == '__main__':
    unittest.main()
