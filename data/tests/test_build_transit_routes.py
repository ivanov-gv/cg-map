"""Tests for municipality-based route classification in build_transit_routes.py."""
import json
import tempfile
import unittest
import sys
from pathlib import Path

from shapely.geometry import Polygon

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'tools'))
from build_transit_routes import (
    build_city_routes,
    build_route_master_membership,
    classify_by_municipality,
    direction_headsign,
    find_municipality,
    group_osm_directions,
    should_skip_city_duplicate,
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


class TestFindMunicipality(unittest.TestCase):
    """Test point-in-municipality with synthetic polygons."""

    def test_point_inside_polygon(self):
        """A point inside a synthetic municipality polygon is found."""
        # Simple rectangle covering (0,0) to (1,1)
        municipalities = {
            'ME-01': Polygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]),
        }
        self.assertEqual(find_municipality(0.5, 0.5, municipalities), 'ME-01')

    def test_point_outside_all_polygons(self):
        """A point outside all polygons returns None."""
        municipalities = {
            'ME-01': Polygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]),
        }
        self.assertIsNone(find_municipality(5, 5, municipalities))

    def test_point_on_boundary_is_found(self):
        """A point on the boundary of a polygon is considered inside."""
        municipalities = {
            'ME-01': Polygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]),
        }
        self.assertEqual(find_municipality(0.0, 0.5, municipalities), 'ME-01')

    def test_two_disjoint_municipalities(self):
        """Two disjoint polygons return the correct one for each point."""
        municipalities = {
            'ME-01': Polygon([(0, 0), (1, 0), (1, 1), (0, 1), (0, 0)]),
            'ME-02': Polygon([(2, 0), (3, 0), (3, 1), (2, 1), (2, 0)]),
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
            write_routes(tmp_path, routes, '2026-10-18T19:54:19.226051+00:00')
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


class TestUnnamedRouteRule(unittest.TestCase):
    """Test that OSM routes without a name omit name rather than using relation/N."""

    def test_unnamed_route_omits_name(self):
        """Routes without an OSM name tag must not have name set to relation/N."""
        routes_data = json.loads(
            Path('data/sources/transit-routes.json').read_text(encoding='utf-8')
        )
        for route in routes_data['routes']:
            if route.get('name'):
                # Name must never be an OSM ID
                self.assertNotRegex(
                    route['name'],
                    r'^relation/\d+$',
                    f"Route {route.get('number', '?')} has name as OSM ID",
                )


class TestCityDirectionGrouping(unittest.TestCase):
    """Test city route grouping by sampleTrip direction and variants."""

    def test_groups_ab_and_ba_with_variants(self):
        network = {
            'patterns': [
                {'route': '1', 'name': 'Line 1', 'headsign': 'A',
                 'sampleTrip': '1_AB_1', 'stops': ['s1', 's2', 's3']},
                {'route': '1', 'name': 'Line 1', 'headsign': 'A',
                 'sampleTrip': '1_AB_PR_1', 'stops': ['s1', 's4', 's3']},
                {'route': '1', 'name': 'Line 1', 'headsign': 'B',
                 'sampleTrip': '1_BA_1', 'stops': ['s3', 's2', 's1']},
            ]
        }
        routes = build_city_routes(network)
        self.assertEqual(len(routes), 1)
        route = routes[0]
        self.assertEqual(route['number'], '1')
        self.assertEqual(len(route['directions']), 2)
        ab_direction = route['directions'][0]
        self.assertEqual(ab_direction['stops'], ['s1', 's2', 's3'])
        self.assertEqual(ab_direction['variants'], [
            {'headsign': 'A', 'stops': ['s1', 's4', 's3']},
        ])
        ba_direction = route['directions'][1]
        self.assertEqual(ba_direction['stops'], ['s3', 's2', 's1'])
        self.assertNotIn('variants', ba_direction)


class TestRouteMasterGrouping(unittest.TestCase):
    """Test OSM direction grouping by route_master membership."""

    def test_groups_only_by_route_master_membership(self):
        route_masters = [{
            'id': 100,
            'tags': {'type': 'route_master'},
            'members': [('r', 10, ''), ('r', 20, '')],
        }]
        membership = build_route_master_membership(route_masters)
        directions = [
            {'relation_id': 10, 'ref': '1'},
            {'relation_id': 20, 'ref': '1'},
            {'relation_id': 30, 'ref': '1'},
        ]
        groups = group_osm_directions(directions, membership)
        self.assertEqual(len(groups), 2)
        master_group = groups[('route_master', 100)]
        self.assertEqual({direction['relation_id'] for direction in master_group}, {10, 20})
        own_group = groups[('relation', 30)]
        self.assertEqual([direction['relation_id'] for direction in own_group], [30])

    def test_relations_without_route_master_are_own_lines(self):
        directions = [
            {'relation_id': 10, 'ref': '2'},
            {'relation_id': 20, 'ref': '2'},
        ]
        groups = group_osm_directions(directions, {})
        self.assertEqual(len(groups), 2)
        self.assertIn(('relation', 10), groups)
        self.assertIn(('relation', 20), groups)


class TestCityRefDeduplication(unittest.TestCase):
    """Test city-ref collision handling."""

    def test_keeps_number_for_outside_extent_collision(self):
        city_refs = {'1'}
        extent = (19.0, 19.5, 42.0, 42.5)
        direction = {
            'ref': '1',
            'stops': [{'coordinates': [18.0, 42.5]}],
        }
        self.assertFalse(should_skip_city_duplicate(direction, city_refs, extent))

    def test_skips_inside_extent_duplicate(self):
        city_refs = {'1'}
        extent = (19.0, 19.5, 42.0, 42.5)
        direction = {
            'ref': '1',
            'stops': [{'coordinates': [19.2, 42.3]}],
        }
        self.assertTrue(should_skip_city_duplicate(direction, city_refs, extent))

    def test_outside_extent_collision_keeps_route_number(self):
        import build_transit_routes as module

        osm_relations = [{
            'id': 10,
            'version': 1,
            'tags': {'route': 'bus', 'ref': '1', 'name': 'Herceg Novi 1'},
            'members': [('n', 1, 'stop'), ('n', 2, 'stop')],
        }]
        network = {
            'stops': {
                'city-a': {'coordinates': [19.26, 42.44]},
                'city-b': {'coordinates': [19.27, 42.45]},
            },
            'patterns': [{'route': '1', 'name': 'City 1', 'sampleTrip': '1_AB_1',
                          'headsign': 'A', 'stops': ['city-a', 'city-b']}],
        }
        municipalities = {
            'ME-08': Polygon([(18.0, 42.0), (19.0, 42.0), (19.0, 43.0), (18.0, 43.0), (18.0, 42.0)]),
        }
        osm_nodes = {
            1: {'lon': 18.5, 'lat': 42.45, 'tags': {'name': 'A'}},
            2: {'lon': 18.6, 'lat': 42.46, 'tags': {'name': 'B'}},
        }
        original_collect = module._collect_member_node_ids
        original_load_nodes = module.load_osm_nodes_for_ids
        try:
            module._collect_member_node_ids = lambda relations: {1, 2}
            module.load_osm_nodes_for_ids = lambda pbf_path, node_ids: osm_nodes
            routes = module.build_osm_routes(osm_relations, [], network, municipalities, 'dummy.pbf')
        finally:
            module._collect_member_node_ids = original_collect
            module.load_osm_nodes_for_ids = original_load_nodes
        self.assertEqual(len(routes), 1)
        self.assertEqual(routes[0].get('number'), '1')


class TestHeadsignPrecedence(unittest.TestCase):
    """Test headsign derivation operator precedence."""

    def test_named_route_with_unnamed_end_stop_uses_route_name(self):
        headsign = direction_headsign('Igalo - Meljine', [
            {'name': 'Igalo', 'coordinates': [18.5, 42.4]},
            {'name': '', 'coordinates': [18.6, 42.4]},
        ])
        self.assertEqual(headsign, 'Igalo - Meljine')


class TestCliTypePath(unittest.TestCase):
    """Test CLI path arguments are parsed as Path objects."""

    def test_build_transit_routes_accepts_temp_paths(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output = Path(tmpdir) / 'routes.json'
            argv = ['build_transit_routes.py', '--output', str(output)]
            original_argv = sys.argv
            try:
                sys.argv = argv
                from build_transit_routes import parse_args as parse_routes_args
                args = parse_routes_args()
            finally:
                sys.argv = original_argv
            self.assertEqual(args.output, output)
            self.assertIsInstance(args.output, Path)

    def test_enrich_stops_accepts_temp_paths(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            stops = Path(tmpdir) / 'stops.geojson'
            argv = ['enrich_stops.py', '--stops', str(stops)]
            original_argv = sys.argv
            try:
                sys.argv = argv
                from enrich_stops import parse_args as parse_stops_args
                args = parse_stops_args()
            finally:
                sys.argv = original_argv
            self.assertEqual(args.stops, stops)
            self.assertIsInstance(args.stops, Path)


class TestMunicipalityCountGuard(unittest.TestCase):
    """Test that municipality loading fails if count is not 25."""

    def test_load_municipalities_exits_on_wrong_count(self):
        import build_transit_routes as module

        original = module.load_municipalities_from_geojson
        try:
            module.load_municipalities_from_geojson = lambda path: {
                'ME-01': Polygon([(0, 0), (1, 0), (1, 1), (0, 0)]),
            }
            with tempfile.TemporaryDirectory() as tmpdir:
                municipalities_path = Path(tmpdir) / 'municipalities.geojson'
                municipalities_path.write_text('{}', encoding='utf-8')
                with self.assertRaises(SystemExit):
                    module.load_municipalities(municipalities_path, Path(tmpdir) / 'fake.pbf')
        finally:
            module.load_municipalities_from_geojson = original


class TestProvenanceSources(unittest.TestCase):
    """Test provenance records per-source licence and attribution."""

    def test_write_provenance_records_osm_odbl_and_no_home_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            tmpdir_path = Path(tmpdir)
            network_provenance = tmpdir_path / 'transit-network.provenance.json'
            network_provenance.write_text(json.dumps({
                'source': 'https://epodgorica.me/javniprevoz/mapa',
                'retrieved_at': '2026-10-18T19:54:19.226051+00:00',
                'license': 'No explicit reuse license found; attribution retained.',
            }), encoding='utf-8')
            pbf_path = tmpdir_path / 'montenegro.osm.pbf'
            pbf_path.write_bytes(b'fake')
            municipalities_path = tmpdir_path / 'municipalities.geojson'
            municipalities_path.write_text(json.dumps({'type': 'FeatureCollection', 'features': []}), encoding='utf-8')

            import build_transit_routes as module
            original = module.load_pbf_metadata
            try:
                module.load_pbf_metadata = lambda path: {
                    'fileName': path.name,
                    'sha256': 'a' * 64,
                    'replicationTimestamp': '2026-11-21T00:00:00Z',
                }
                provenance_path = tmpdir_path / 'transit-routes.provenance.json'
                routes = [{'number': '1', 'name': 'R1', 'network': 'bus', 'directions': [{'headsign': 'A', 'stops': ['s1', 's2']}]}]
                provenance = module.write_provenance(
                    provenance_path, b'{}', routes, network_provenance, pbf_path, municipalities_path,
                )
            finally:
                module.load_pbf_metadata = original

            sources = provenance['sources']
            osm_source = [source for source in sources if 'OpenStreetMap contributors' in source.get('attribution', '') and source.get('fileName')]
            self.assertTrue(osm_source)
            self.assertEqual(osm_source[0]['license'], 'Open Database License 1.0 (ODbL)')
            self.assertNotIn('/home/', json.dumps(provenance))


if __name__ == '__main__':
    unittest.main()
