"""Tests for municipality-based route classification in build_transit_routes.py."""
import json
import tempfile
import unittest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
from build_transit_routes import (
    classify_by_municipality,
    find_municipality,
    write_routes,
)


class TestClassifyByMunicipality(unittest.TestCase):
    """Test intercity vs bus classification by municipality ISO codes."""

    def test_same_municipality_is_bus(self):
        """Both ends in the same municipality → bus."""
        self.assertEqual(
            classify_by_municipality('ME-16', 'ME-16'),
            'bus',
        )

    def test_different_municipalities_is_intercity(self):
        """First and last stops in different municipalities → intercity."""
        self.assertEqual(
            classify_by_municipality('ME-16', 'ME-05'),
            'intercity',
        )

    def test_first_outside_montenegro_is_intercity(self):
        """First stop outside Montenegro (None) → intercity."""
        self.assertEqual(
            classify_by_municipality(None, 'ME-16'),
            'intercity',
        )

    def test_last_outside_montenegro_is_intercity(self):
        """Last stop outside Montenegro (None) → intercity."""
        self.assertEqual(
            classify_by_municipality('ME-16', None),
            'intercity',
        )

    def test_both_outside_montenegro_is_intercity(self):
        """Both stops outside Montenegro → intercity."""
        self.assertEqual(
            classify_by_municipality(None, None),
            'intercity',
        )


_shapely_available = False
try:
    from shapely.geometry import Polygon as _ShapelyPolygon
    _shapely_available = True
except ImportError:
    pass


@unittest.skipUnless(_shapely_available, 'shapely not installed')
class TestFindMunicipality(unittest.TestCase):
    """Test point-in-municipality with synthetic polygons."""

    def test_point_inside_polygon(self):
        """A point inside a synthetic municipality polygon is found."""
        # Simple rectangle covering (0,0) to (1,1)
        municipalities = {
            'ME-01': _ShapelyPolygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]),
        }
        self.assertEqual(find_municipality(0.5, 0.5, municipalities), 'ME-01')

    def test_point_outside_all_polygons(self):
        """A point outside all polygons returns None."""
        municipalities = {
            'ME-01': _ShapelyPolygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]),
        }
        self.assertIsNone(find_municipality(5, 5, municipalities))

    def test_point_on_boundary_is_found(self):
        """A point on the boundary of a polygon is considered inside."""
        municipalities = {
            'ME-01': _ShapelyPolygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]),
        }
        self.assertEqual(find_municipality(0.0, 0.5, municipalities), 'ME-01')

    def test_two_disjoint_municipalities(self):
        """Two disjoint polygons return the correct one for each point."""
        municipalities = {
            'ME-01': _ShapelyPolygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]),
            'ME-02': _ShapelyPolygon([(2, 0), (3, 0), (3, 1), (2, 1), (2, 0)]),
        }
        self.assertEqual(find_municipality(0.5, 0.5, municipalities), 'ME-01')
        self.assertEqual(find_municipality(2.5, 0.5, municipalities), 'ME-02')


class TestWriteRoutesFormat(unittest.TestCase):
    """Test that write_routes produces one route per line."""

    def test_one_route_per_line(self):
        """Each route in transit-routes.json appears on its own line."""
        routes = [
            {
                'number': '1',
                'name': 'Route 1',
                'network': 'bus',
                'directions': [
                    {
                        'headsign': 'A to B',
                        'stops': ['s1', 's2'],
                    }
                ],
            },
            {
                'number': '2',
                'name': 'Route 2',
                'network': 'intercity',
                'directions': [
                    {
                        'entityId': 'relation/123',
                        'entityVersion': 1,
                        'headsign': 'X to Y',
                        'stops': [
                            {'id': 'node/1', 'name': 'X', 'coordinates': [19.0, 42.0]},
                            {'id': 'node/2', 'name': 'Y', 'coordinates': [19.1, 42.1]},
                        ],
                    }
                ],
            },
        ]
        with tempfile.NamedTemporaryFile(suffix='.json', delete=False) as tmp:
            tmp_path = Path(tmp.name)

        try:
            write_routes(tmp_path, routes)
            text = tmp_path.read_text(encoding='utf-8')
            lines = text.strip().split('\n')

            # The file should have more than 1 line (header + routes + closing)
            self.assertGreater(len(lines), 1,
                               'transit-routes.json should have more than 1 line')

            # Each route should appear on its own line
            # The first line contains the header (retrievedAt, source, version, routes start)
            # Each subsequent line (except the last "]") is one route
            route_line_count = 0
            for line in lines:
                stripped = line.strip().rstrip(',')
                # A route line starts with '{' and contains 'number' or 'name'
                if stripped.startswith('{') and ('"number"' in stripped or '"name"' in stripped):
                    route_line_count += 1

            self.assertEqual(route_line_count, len(routes),
                             f'Expected {len(routes)} route lines, got {route_line_count}')

            # Verify the JSON is still valid (strip trailing newline for strict parsers)
            data = json.loads(text.strip())
            self.assertEqual(len(data['routes']), len(routes))
        finally:
            tmp_path.unlink()


if __name__ == '__main__':
    unittest.main()
