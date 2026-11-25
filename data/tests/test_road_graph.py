"""The road graph: shared points, the levels of junctions, and turn rules."""

import sys
import unittest
from pathlib import Path

from shapely.geometry import LineString

REPOSITORY = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPOSITORY / 'data/tools'))

from osm_extract import ExtractionState, cli  # noqa: E402
from osm_extract.geometry import simplified_line  # noqa: E402
from osm_extract.roads import (  # noqa: E402
    RoadGraph, RoadsLayer, RoadWay, nearest_to_ground, road_level,
    road_properties
)
from osm_extract.turn_restrictions import TurnRestrictionsLayer  # noqa: E402

OPTIONS = cli.Options(
    (19.15, 42.37, 19.34, 42.51), False, False, Path('.'),
    'https://example.org/extract.osm.pbf', '2026-11-21',
    '2026-11-20T21:21:21Z', False,
)
# About five metres apart, on one line: simplification drops what it may.
STEP_DEGREES = 0.00006


def point(index, offset=0.0):
    return (19.25 + index * STEP_DEGREES, 42.44 + offset)


def road_way(way_id, nodes, positions, **tags):
    tags = {'highway': 'residential', **tags}
    return RoadWay(
        nodes=tuple(nodes),
        coordinates=tuple(positions),
        level=road_level(tags),
        is_local=any(OPTIONS.contains(*position) for position in positions),
        identity={'entityId': f'way/{way_id}', 'entityVersion': 1},
        properties=road_properties(tags),
    )


def published(*ways):
    layer = RoadsLayer()
    layer._ways = list(ways)
    features = layer.finish(OPTIONS, ExtractionState())
    return {feature['properties']['entityId']: feature for feature in features}


def rounded(position):
    return [round(value, 6) for value in position]


class RoadGraphTest(unittest.TestCase):
    def setUp(self):
        positions = [point(index) for index in range(5)]
        self.main_road = road_way(1, [10, 11, 12, 13, 14], positions)
        self.side_road = road_way(2, [12, 20], [point(2), point(2, 0.001)])

    def test_the_point_a_side_road_joins_survives_simplification(self):
        alone = published(self.main_road)['way/1']
        self.assertEqual(
            alone['geometry']['coordinates'],
            [rounded(point(0)), rounded(point(4))],
        )
        joined = published(self.main_road, self.side_road)
        self.assertEqual(
            joined['way/1']['geometry']['coordinates'],
            [rounded(point(0)), rounded(point(2)), rounded(point(4))],
        )
        self.assertEqual(
            joined['way/2']['geometry']['coordinates'][0], rounded(point(2))
        )

    def test_a_traffic_light_stays_on_its_road(self):
        layer = RoadsLayer()
        layer._ways = [self.main_road]
        layer._furniture_node_ids = {13}
        [road] = layer.finish(OPTIONS, ExtractionState())
        self.assertIn(rounded(point(3)), road['geometry']['coordinates'])

    def test_a_bridge_ends_on_the_level_of_the_road_it_continues(self):
        bridge = road_way(
            3, [14, 30], [point(4), point(5)], bridge='yes', layer='1'
        )
        onward = road_way(4, [30, 31], [point(5), point(6)])
        roads = published(self.main_road, bridge, onward)
        properties = roads['way/3']['properties']
        self.assertEqual(
            (properties['startLevel'], properties['endLevel']), (0, 0)
        )
        self.assertEqual(properties['layer'], '1')

    def test_two_parts_of_one_bridge_meet_on_its_level(self):
        first = road_way(3, [14, 30], [point(4), point(5)], bridge='yes')
        second = road_way(4, [30, 31], [point(5), point(6)], bridge='yes')
        roads = published(first, second)
        self.assertEqual(roads['way/3']['properties']['endLevel'], 1)
        self.assertEqual(roads['way/4']['properties']['startLevel'], 1)

    def test_a_road_that_ends_on_a_passing_one_takes_its_level(self):
        underpass = road_way(
            3, [40, 12, 41],
            [point(2, -0.001), point(2), point(2, 0.001)],
            highway='footway', tunnel='yes',
        )
        stairs = road_way(4, [12, 42], [point(2), point(3, 0.001)])
        roads = published(underpass, stairs)
        self.assertEqual(roads['way/4']['properties']['startLevel'], -1)

    def test_ways_that_cross_on_different_levels_are_reported(self):
        tunnel = road_way(
            3, [40, 12, 41],
            [point(2, -0.001), point(2), point(2, 0.001)], tunnel='yes'
        )
        graph = RoadGraph([self.main_road, tunnel])
        self.assertEqual(graph.split_level_nodes, [12])

    def test_a_major_road_crosses_the_detail_box_whole(self):
        positions = [(19.25, 42.50), (19.25, 42.52)]
        roads = published(
            road_way(5, [50, 51], positions, highway='primary'),
            road_way(6, [50, 52], positions),
        )
        major = roads['way/5']
        self.assertEqual(major['properties']['endNode'], 51)
        self.assertEqual(
            major['geometry']['coordinates'][-1], [19.25, 42.52]
        )
        self.assertNotIn('entityPart', major['properties'])
        clipped = roads['way/6']
        self.assertEqual(
            clipped['geometry']['coordinates'][-1], [19.25, 42.51]
        )
        self.assertNotIn('endNode', clipped['properties'])

    def test_a_way_that_meets_itself_stays_one_road(self):
        loop = [point(0), point(2), point(2, 0.001), point(3), point(2)]
        roads = published(road_way(9, [90, 91, 92, 93, 91], loop))
        properties = roads['way/9']['properties']
        self.assertNotIn('entityPart', properties)
        self.assertEqual(
            (properties['startNode'], properties['endNode']), (90, 91)
        )

    def test_a_road_beyond_the_detail_box_has_its_junctions_too(self):
        far = [(19.6, 42.8), (19.60001, 42.80001), (19.7, 42.9)]
        roads = published(
            road_way(7, [60, 61, 62], far, highway='primary'),
            road_way(8, [61, 63], [far[1], (19.61, 42.8)],
                     highway='tertiary'),
        )
        properties = roads['way/7']['properties']
        self.assertEqual(
            (properties['startNode'], properties['endNode']), (60, 62)
        )
        self.assertIn(
            [19.60001, 42.80001], roads['way/7']['geometry']['coordinates']
        )

    def test_the_level_nearest_to_the_ground_wins_and_the_upper_of_two(self):
        self.assertEqual(nearest_to_ground([2, 1]), 1)
        self.assertEqual(nearest_to_ground([-2, -1]), -1)
        self.assertEqual(nearest_to_ground([-1, 1]), 1)

    def test_a_closed_line_keeps_its_shape_between_kept_points(self):
        ring = [(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]
        simplified = simplified_line(LineString(ring), 0.1, frozenset())
        self.assertEqual(list(simplified.coords)[0], (0, 0))
        self.assertEqual(list(simplified.coords)[-1], (0, 0))
        self.assertGreater(len(simplified.coords), 3)

    def test_a_turn_rule_needs_its_roads_and_its_junction(self):
        layer = TurnRestrictionsLayer()
        rule = {
            'entityId': 'relation/1', 'entityVersion': 1,
            'restriction': 'no_left_turn',
        }
        layer._restrictions = [
            {**rule, 'from': 1, 'to': 2, 'viaNodes': [12]},
            {**rule, 'from': 1, 'to': 9, 'viaNodes': [12]},
            {**rule, 'from': 1, 'to': 2, 'viaNodes': [99]},
            # Way 3 only passes the junction, so there is no turn from it.
            {**rule, 'from': 3, 'to': 2, 'viaNodes': [12]},
        ]
        state = ExtractionState(
            road_way_ids={1, 2, 3},
            identified_road_node_ids={12},
            road_end_node_ids={1: {12}, 2: {12, 13}, 3: {14}},
        )
        result = layer.finish(OPTIONS, state)
        self.assertEqual(len(result['restrictions']), 1)
        self.assertEqual(result['restrictions'][0]['to'], 2)


if __name__ == '__main__':
    unittest.main()
