"""Tests for the side-of-road calculation in enrich-stops.py."""
import unittest
import sys
from pathlib import Path

# Add the tools directory to the path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
from enrich_stops import side_of_road, find_nearest_road_side, build_lines_index


class TestSideOfRoad(unittest.TestCase):
    """Test side-of-road determination against known geometries."""

    def test_stop_left_of_west_to_road(self):
        """A stop north of a road drawn west to east is on the left."""
        # Road goes from (0, 0) to (1, 0) — west to east
        road = [[0, 0], [1, 0]]
        # Stop is at (0.5, 0.01) — slightly north of the road
        stop = [0.5, 0.01]
        self.assertEqual(side_of_road(stop, road), 'left')

    def test_stop_right_of_west_to_road(self):
        """A stop south of a road drawn west to east is on the right."""
        # Road goes from (0, 0) to (1, 0) — west to east
        road = [[0, 0], [1, 0]]
        # Stop is at (0.5, -0.01) — slightly south of the road
        stop = [0.5, -0.01]
        self.assertEqual(side_of_road(stop, road), 'right')

    def test_stop_left_of_south_to_north(self):
        """A stop west of a road drawn south to north is on the left."""
        # Road goes from (0, 0) to (0, 1) — south to north
        road = [[0, 0], [0, 1]]
        # Stop is at (-0.01, 0.5) — west of the road
        stop = [-0.01, 0.5]
        self.assertEqual(side_of_road(stop, road), 'left')

    def test_stop_right_of_south_to_north(self):
        """A stop east of a road drawn south to north is on the right."""
        # Road goes from (0, 0) to (0, 1) — south to north
        road = [[0, 0], [0, 1]]
        # Stop is at (0.01, 0.5) — east of the road
        stop = [0.01, 0.5]
        self.assertEqual(side_of_road(stop, road), 'right')

    def test_stop_on_road_returns_none(self):
        """A stop exactly on the road line has no side."""
        road = [[0, 0], [1, 0]]
        stop = [0.5, 0]
        self.assertIsNone(side_of_road(stop, road))

    def test_single_point_road_returns_none(self):
        """A road with fewer than 2 points yields no side."""
        road = [[0, 0]]
        stop = [0.5, 0.5]
        self.assertIsNone(side_of_road(stop, road))

    def test_multisegment_road_uses_closest_segment(self):
        """Side is determined from the closest segment of a multi-segment road."""
        # Road: (0,0) -> (1,0) -> (1,1)
        road = [[0, 0], [1, 0], [1, 1]]
        # Stop near the first segment, above it
        stop = [0.5, 0.01]
        self.assertEqual(side_of_road(stop, road), 'left')

    def test_nearest_road_within_threshold(self):
        """find_nearest_road_side returns the side of the closest nearby road."""
        roads = [
            {
                'geometry': {
                    'type': 'LineString',
                    'coordinates': [[0, 0], [1, 0]],
                }
            }
        ]
        # Stop just above the road, well within threshold
        stop = [0.5, 0.00001]
        self.assertEqual(find_nearest_road_side(stop, roads), 'left')

    def test_nearest_road_outside_threshold(self):
        """find_nearest_road_side returns None when no road is within range."""
        roads = [
            {
                'geometry': {
                    'type': 'LineString',
                    'coordinates': [[0, 0], [1, 0]],
                }
            }
        ]
        # Stop far from the road (1 degree is way more than 30m)
        stop = [0.5, 1.0]
        self.assertIsNone(find_nearest_road_side(stop, roads))

    def test_multilinestring_road(self):
        """find_nearest_road_side handles MultiLineString geometry."""
        roads = [
            {
                'geometry': {
                    'type': 'MultiLineString',
                    'coordinates': [[[0, 0], [1, 0]]],
                }
            }
        ]
        stop = [0.5, 0.00001]
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


if __name__ == '__main__':
    unittest.main()
