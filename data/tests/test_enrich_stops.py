"""Tests for the side-of-road calculation in enrich_stops.py."""
import math
import unittest
import sys
from pathlib import Path

# Add the tools directory to the path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
from enrich_stops import (
    build_lines_index,
    distance_squared_metres,
    enrich_stops,
    find_nearest_road_side,
    side_of_road,
)

# Reference latitude for tests — Podgorica is ~42.4°N
PODGORICA_LAT = 42.4


class TestSideOfRoad(unittest.TestCase):
    """Test side-of-road determination against known geometries."""

    def test_stop_left_of_west_to_road(self):
        """A stop north of a road drawn west to east is on the left."""
        road = [[0, 0], [1, 0]]
        stop = [0.5, 0.01]
        self.assertEqual(side_of_road(stop, road, PODGORICA_LAT), 'left')

    def test_stop_right_of_west_to_road(self):
        """A stop south of a road drawn west to east is on the right."""
        road = [[0, 0], [1, 0]]
        stop = [0.5, -0.01]
        self.assertEqual(side_of_road(stop, road, PODGORICA_LAT), 'right')

    def test_stop_left_of_south_to_north(self):
        """A stop west of a road drawn south to north is on the left."""
        road = [[0, 0], [0, 1]]
        stop = [-0.01, 0.5]
        self.assertEqual(side_of_road(stop, road, PODGORICA_LAT), 'left')

    def test_stop_right_of_south_to_north(self):
        """A stop east of a road drawn south to north is on the right."""
        road = [[0, 0], [0, 1]]
        stop = [0.01, 0.5]
        self.assertEqual(side_of_road(stop, road, PODGORICA_LAT), 'right')

    def test_stop_on_road_returns_none(self):
        """A stop exactly on the road line has no side."""
        road = [[0, 0], [1, 0]]
        stop = [0.5, 0]
        self.assertIsNone(side_of_road(stop, road, PODGORICA_LAT))

    def test_single_point_road_returns_none(self):
        """A road with fewer than 2 points yields no side."""
        road = [[0, 0]]
        stop = [0.5, 0.5]
        self.assertIsNone(side_of_road(stop, road, PODGORICA_LAT))

    def test_multisegment_road_uses_closest_segment(self):
        """Side is determined from the closest segment of a multi-segment road."""
        road = [[0, 0], [1, 0], [1, 1]]
        stop = [0.5, 0.01]
        self.assertEqual(side_of_road(stop, road, PODGORICA_LAT), 'left')


class TestDistanceProjection(unittest.TestCase):
    """Test that longitude is projected by cos(latitude) for metre distances."""

    def test_25_metres_east_is_within_30m(self):
        """A stop 25 m east of a north-south road is within range."""
        # Use real Podgorica coordinates so the projection is consistent
        base_lon = 19.26
        base_lat = 42.44
        cos_lat = math.cos(math.radians(base_lat))
        lon_offset = 25 / (111139 * cos_lat)
        # Road runs north-south at base_lon
        roads = [{
            'geometry': {
                'type': 'LineString',
                'coordinates': [[base_lon, base_lat - 0.01],
                                [base_lon, base_lat + 0.01]],
            }
        }]
        stop = [base_lon + lon_offset, base_lat]
        self.assertEqual(find_nearest_road_side(stop, roads), 'right')

    def test_35_metres_east_is_outside_30m(self):
        """A stop 35 m east of a north-south road is outside range."""
        base_lon = 19.26
        base_lat = 42.44
        cos_lat = math.cos(math.radians(base_lat))
        lon_offset = 35 / (111139 * cos_lat)
        roads = [{
            'geometry': {
                'type': 'LineString',
                'coordinates': [[base_lon, base_lat - 0.01],
                                [base_lon, base_lat + 0.01]],
            }
        }]
        stop = [base_lon + lon_offset, base_lat]
        self.assertIsNone(find_nearest_road_side(stop, roads))

    def test_distance_squared_metres_symmetric(self):
        """distance_squared_metres is symmetric and zero for identical points."""
        a = [19.26, 42.44]
        b = [19.27, 42.45]
        self.assertAlmostEqual(
            distance_squared_metres(a, b, PODGORICA_LAT),
            distance_squared_metres(b, a, PODGORICA_LAT),
        )
        self.assertEqual(distance_squared_metres(a, a, PODGORICA_LAT), 0.0)


class TestNearestRoadThreshold(unittest.TestCase):
    """Test find_nearest_road_side with metre-based threshold."""

    def test_nearest_road_within_threshold(self):
        """find_nearest_road_side returns the side of the closest nearby road."""
        roads = [{
            'geometry': {
                'type': 'LineString',
                'coordinates': [[0, 0], [1, 0]],
            }
        }]
        # 1 cm above the road at Podgorica latitude
        lat_offset = 0.01 / 111139
        stop = [0.5, lat_offset]
        self.assertEqual(find_nearest_road_side(stop, roads), 'left')

    def test_nearest_road_outside_threshold(self):
        """find_nearest_road_side returns None when no road is within range."""
        roads = [{
            'geometry': {
                'type': 'LineString',
                'coordinates': [[0, 0], [1, 0]],
            }
        }]
        # 1 degree is way more than 30 m
        stop = [0.5, 1.0]
        self.assertIsNone(find_nearest_road_side(stop, roads))

    def test_multilinestring_road(self):
        """find_nearest_road_side handles MultiLineString geometry."""
        roads = [{
            'geometry': {
                'type': 'MultiLineString',
                'coordinates': [[[0, 0], [1, 0]]],
            }
        }]
        lat_offset = 0.01 / 111139
        stop = [0.5, lat_offset]
        self.assertEqual(find_nearest_road_side(stop, roads), 'left')


class TestLinesIndex(unittest.TestCase):
    """Test the lines index builder from transit network patterns."""

    def test_build_lines_from_patterns(self):
        """Lines are collected from all patterns and sorted."""
        network = {
            'patterns': [
                {'route': '1', 'stops': ['a', 'b', 'c']},
                {'route': '2', 'stops': ['b', 'c', 'd']},
                {'route': '1', 'stops': ['c', 'b', 'a']},
            ]
        }
        index = build_lines_index(network)
        self.assertEqual(index['a'], ['1'])
        self.assertEqual(index['b'], ['1', '2'])
        self.assertEqual(index['c'], ['1', '2'])
        self.assertEqual(index['d'], ['2'])

    def test_empty_network(self):
        """Empty network yields empty index."""
        network = {'patterns': []}
        index = build_lines_index(network)
        self.assertEqual(index, {})


class TestEnrichStopsStaleProperties(unittest.TestCase):
    """Test that rerunning enrichment removes stale derived properties."""

    def test_rerun_removes_stale_lines_and_side(self):
        stops_data = {
            'type': 'FeatureCollection',
            'features': [{
                'type': 'Feature',
                'id': 'stop-1',
                'geometry': {'type': 'Point', 'coordinates': [19.26, 42.44]},
                'properties': {
                    'name': 'Stop 1',
                    'lines': ['1', '2'],
                    'side': 'left',
                },
            }],
        }
        network = {'patterns': []}
        roads = []

        enrich_stops(stops_data, network, roads)

        properties = stops_data['features'][0]['properties']
        self.assertNotIn('lines', properties)
        self.assertNotIn('side', properties)


class TestNearestRoadSideAmbiguity(unittest.TestCase):
    """Test side is omitted when the nearest road is ambiguous."""

    def test_nearest_road_on_line_omits_side(self):
        roads = [{
            'geometry': {
                'type': 'LineString',
                'coordinates': [[19.0, 42.0001], [19.1, 42.0001]],
            }
        }, {
            'geometry': {
                'type': 'LineString',
                'coordinates': [[19.0, 42.0], [19.1, 42.0]],
            }
        }]
        stop = [19.05, 42.0]
        self.assertIsNone(find_nearest_road_side(stop, roads))


if __name__ == '__main__':
    unittest.main()
