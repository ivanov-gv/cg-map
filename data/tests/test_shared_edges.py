"""Topology checks for the reviewed shared municipality border sources."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'data/sources'
TOOLS = ROOT / 'data/tools'
sys.path.insert(0, str(TOOLS))

import shared_edge_checks  # noqa: E402

from shapely.geometry import LineString, box, mapping  # noqa: E402


def collection(features):
    """Wrap features in the shape the checks read."""
    return {'type': 'FeatureCollection', 'features': features}


def feature(geometry, properties):
    """Build one GeoJSON feature with only the fields the checks need."""
    return {'type': 'Feature', 'geometry': geometry, 'properties': properties}


def square(minimum, maximum):
    """Return a closed GeoJSON square polygon."""
    return mapping(box(minimum, minimum, maximum, maximum))


def edge(identifier, left, right, coordinates=((0, 0), (1, 0))):
    """Return one shared edge with the given sides and coordinates."""
    return feature(
        mapping(LineString(coordinates)),
        {
            'entityId': identifier,
            'left': left,
            'right': right,
            'osmWays': [],
        },
    )


def square_edges(prefix='derived:edge-me-a-sea', left='ME-A', right='sea'):
    """Return the four edges and traversal-ordered references of one square."""
    sides = (
        ('south', ((0, 0), (1, 0))),
        ('east', ((1, 0), (1, 1))),
        ('north', ((1, 1), (0, 1))),
        ('west', ((0, 1), (0, 0))),
    )
    edges = [
        edge(f'{prefix}-{name}', left, right, coordinates)
        for name, coordinates in sides
    ]
    references = [
        {'id': feature['properties']['entityId'], 'direction': 1}
        for feature in edges
    ]
    return edges, references


def municipality(identifier, references, geometry=None):
    """Return one municipality whose edge references are supplied."""
    return feature(
        geometry or square(0, 1),
        {'ISO3166-2': identifier, 'edges': references},
    )


class SharedEdgesTest(unittest.TestCase):
    """Check the reviewed sources and fail on broken topology examples."""

    def test_reviewed_sources_pass_all_topology_checks(self):
        metrics = shared_edge_checks.check_sources(SOURCES)
        self.assertEqual(metrics['municipalities'], 25)
        self.assertEqual(metrics['edges'], 110)
        self.assertEqual(metrics['reconstructed'], 25)
        self.assertEqual(metrics['settlements'], 4009)
        self.assertLess(
            metrics['combined_bytes'],
            shared_edge_checks.MAX_COMBINED_BYTES,
        )
        self.assertLess(
            metrics['extra_area_sqm'],
            shared_edge_checks.EXTRA_AREA_TOLERANCE_SQM,
        )
        self.assertLess(
            metrics['missing_area_sqm'],
            shared_edge_checks.MISSING_AREA_TOLERANCE_SQM,
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

    def test_missing_area_tolerance_is_measured_in_square_metres(self):
        tolerance = shared_edge_checks.MISSING_AREA_TOLERANCE_SQM
        factor = shared_edge_checks.SQUARE_DEGREES_TO_SQUARE_METRES
        large_gap = 1.1 * (tolerance / factor) ** 0.5
        with self.assertRaisesRegex(ValueError, 'uncovered'):
            shared_edge_checks.check_coverage(
                [box(0, 0, large_gap, large_gap)],
                box(0, 0, 2 * large_gap, large_gap),
            )
        small_gap = 0.5 * (tolerance / factor) ** 0.5
        metrics = shared_edge_checks.check_coverage(
            [box(0, 0, small_gap, small_gap)],
            box(0, 0, 2 * small_gap, small_gap),
        )
        self.assertLess(metrics['missing_area_sqm'], tolerance)

    def test_extra_area_tolerance_is_measured_in_square_metres(self):
        tolerance = shared_edge_checks.EXTRA_AREA_TOLERANCE_SQM
        factor = shared_edge_checks.SQUARE_DEGREES_TO_SQUARE_METRES
        large_extension = 1.1 * (tolerance / factor)
        with self.assertRaisesRegex(ValueError, 'outside land'):
            shared_edge_checks.check_coverage(
                [box(0, 0, 1, 1 + large_extension)], box(0, 0, 1, 1)
            )
        small_extension = 0.5 * (tolerance / factor)
        metrics = shared_edge_checks.check_coverage(
            [box(0, 0, 1, 1 + small_extension)], box(0, 0, 1, 1)
        )
        self.assertLess(metrics['extra_area_sqm'], tolerance)

    def test_edges_need_one_municipality_on_each_municipal_side(self):
        edges, references = square_edges()
        shared_id = edges[0]['properties']['entityId']
        self.assertEqual(
            shared_edge_checks.check_edge_usage(
                edges, [municipality('ME-A', references)], set()
            ),
            len(edges),
        )
        wrong_direction = [
            {**reference, 'direction': -1}
            if reference['id'] == shared_id else reference
            for reference in references
        ]
        with self.assertRaisesRegex(ValueError, 'not used once'):
            shared_edge_checks.check_edge_usage(
                edges, [municipality('ME-A', wrong_direction)], set()
            )
        missing_reference = [
            reference for reference in references
            if reference['id'] != shared_id
        ]
        with self.assertRaisesRegex(ValueError, 'not used once'):
            shared_edge_checks.check_edge_usage(
                edges, [municipality('ME-A', missing_reference)], set()
            )
        unknown_reference = [
            *references, {'id': 'derived:missing', 'direction': 1}
        ]
        with self.assertRaisesRegex(ValueError, 'unknown edge'):
            shared_edge_checks.check_edge_usage(
                edges, [municipality('ME-A', unknown_reference)], set()
            )

    def test_unknown_outside_side_is_rejected(self):
        shared_edge = edge('derived:edge-me-a-narnia-1', 'ME-A', 'Narnia')
        reference = municipality(
            'ME-A', [{'id': 'derived:edge-me-a-narnia-1', 'direction': 1}]
        )
        with self.assertRaisesRegex(ValueError, 'unknown outside side'):
            shared_edge_checks.check_edge_usage(
                [shared_edge], [reference], set()
            )

    def test_polygon_rebuilds_from_four_ordered_edges(self):
        edges, references = square_edges()
        self.assertEqual(
            shared_edge_checks.check_reconstruction(
                edges, [municipality('ME-A', references)]
            ),
            1,
        )

    def test_displaced_polygon_does_not_rebuild_from_edges(self):
        edges, references = square_edges()
        displaced = municipality(
            'ME-A', references, geometry=square(0.1, 1.1)
        )
        with self.assertRaisesRegex(ValueError, 'does not rebuild'):
            shared_edge_checks.check_reconstruction(edges, [displaced])

    def test_references_out_of_traversal_order_are_rejected(self):
        edges, references = square_edges()
        shuffled = municipality('ME-A', list(reversed(references)))
        with self.assertRaisesRegex(ValueError, 'traversal order'):
            shared_edge_checks.check_reconstruction(edges, [shuffled])

    def test_unclosed_reference_ring_is_rejected(self):
        edges, references = square_edges()
        incomplete = municipality('ME-A', references[:-1])
        with self.assertRaisesRegex(ValueError, 'do not close a ring'):
            shared_edge_checks.check_reconstruction(edges, [incomplete])


if __name__ == '__main__':
    unittest.main()
