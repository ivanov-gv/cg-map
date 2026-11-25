"""Inland neighbour derivation for the reviewed context sources."""

import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from shapely.geometry import LineString, Point, box, mapping, shape

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'data/tools'
sys.path.insert(0, str(TOOLS))

from geo_area import SQUARE_DEGREES_TO_SQUARE_METRES  # noqa: E402
from osm_extract import ExtractionState  # noqa: E402
from osm_extract.borders import EDGE_FILE  # noqa: E402
from osm_extract.geometry import canonical_geometry, rounded_valid_geometry  # noqa: E402
from osm_extract.neighbours import (  # noqa: E402
    CONTEXT_FILE, LAND_FILE, NEIGHBOUR_SOURCE_FILE, assign_gap,
    assign_gap_pieces, derive_context_features,
)
from osm_extract.water import filter_non_coastal_ocean_parts  # noqa: E402
from osm_extract.writing import serialize_collection  # noqa: E402


def context_feature(name, geometry, entity_id):
    """Make one reviewed-style neighbour feature for a synthetic source."""
    return {
        'type': 'Feature',
        'geometry': mapping(geometry),
        'properties': {
            'entityId': entity_id, 'entityVersion': 'sha256:test',
            'kind': 'context', 'name': name,
        },
    }


def border_edge(left, right, line):
    """Make one published border edge with two outside-side labels."""
    return {
        'type': 'Feature',
        'geometry': mapping(line),
        'properties': {
            'entityId': f'derived:edge-{left}-{right}', 'kind': 'border',
            'left': left, 'right': right,
        },
    }


class NeighbourDerivationTest(unittest.TestCase):
    """Check that context areas fill land gaps but not the connected sea."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.country = box(1, 1, 2, 2)
        overlap = box(1.5, 1.2, 1.8, 1.5)
        hole = box(1.2, 2.82, 1.5, 2.92)
        sea_hole = box(1.2, 0.4, 1.5, 0.6)
        preserved = [
            context_feature(
                'A', box(0, 1, 0.8, 3).union(overlap), 'ne:A'
            ),
            context_feature('B', box(2.2, 1, 3, 3), 'ne:B'),
            context_feature('C', box(1, 2.8, 2, 3).difference(hole), 'ne:C'),
            context_feature('D', box(0, 0, 3, 1).difference(sea_hole), 'ne:D'),
            context_feature('E', box(0, 2.95, 3, 3), 'ne:E'),
        ]
        collection = {'type': 'FeatureCollection', 'features': preserved}
        for name in (CONTEXT_FILE, NEIGHBOUR_SOURCE_FILE):
            (self.directory / name).write_text(
                json.dumps(collection), encoding='utf-8'
            )
        self.state = ExtractionState()
        self.state.country_geometry = mapping(self.country)
        self.state.border_edges = [
            border_edge(
                'A', 'ME-01', LineString([(0.8, 1), (0.8, 2.95)])
            ),
            border_edge(
                'ME-01', 'B', LineString([(2.2, 1), (2.2, 2.95)])
            ),
            border_edge(
                'A', 'ME-01', LineString([(1, 2), (1, 2.95)])
            ),
            border_edge(
                'ME-01', 'B', LineString([(2, 2), (2, 2.95)])
            ),
            border_edge('ME-01', 'sea', sea_hole.boundary),
            border_edge('Kosovo', 'ME-01', hole.boundary),
        ]
        (self.directory / EDGE_FILE).write_text(
            json.dumps({'type': 'FeatureCollection', 'features': self.state.border_edges}),
            encoding='utf-8',
        )
        self.options = SimpleNamespace(
            sources_directory=self.directory, uses_fresh_country=True
        )

    def reviewed_source_copy(self):
        """Copy the reviewed derivation inputs into a temporary directory."""
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory = Path(temporary.name)
        for name in (NEIGHBOUR_SOURCE_FILE, LAND_FILE, EDGE_FILE):
            shutil.copyfile(ROOT / 'data/sources' / name, directory / name)
        return directory

    def reviewed_derivation_text(self, sources_directory):
        """Serialize derivation from a copied set of reviewed inputs."""
        options = SimpleNamespace(
            sources_directory=sources_directory, uses_fresh_country=False
        )
        features = derive_context_features(options, ExtractionState())
        return serialize_collection(features)

    def derived(self):
        """Return the derived features by their authority name."""
        features = derive_context_features(
            self.options, self.state, (0, 0, 3, 3)
        )
        self.state.context_features = features
        return {
            feature['properties']['name']: shape(feature['geometry'])
            for feature in features
        }

    def test_existing_neighbours_stop_at_the_country_border(self):
        areas = self.derived()
        self.assertEqual(areas['A'].intersection(self.country).area, 0)
        self.assertTrue(areas['A'].covers(Point(0.9, 1.5)))
        self.assertTrue(areas['B'].covers(Point(2.1, 1.5)))

    def test_gap_between_two_authorities_is_split_between_them(self):
        areas = self.derived()
        self.assertTrue(areas['A'].covers(Point(1.25, 2.4)))
        self.assertTrue(areas['B'].covers(Point(1.75, 2.4)))
        self.assertEqual(areas['A'].intersection(areas['B']).area, 0)

    def test_hole_becomes_a_derived_land_authority(self):
        areas = self.derived()
        kosovo = next(
            feature for feature in self.state.context_features
            if feature['properties']['name'] == 'Kosovo'
        )
        self.assertEqual(
            kosovo['properties']['entityId'], 'derived:context-kosovo'
        )
        self.assertTrue(areas['Kosovo'].covers(Point(1.35, 2.87)))

    def test_sea_connected_gap_stays_outside_the_neighbours(self):
        areas = self.derived()
        for area in areas.values():
            self.assertFalse(area.covers(Point(1.35, 0.5)))

    def test_partial_run_uses_the_reviewed_border_edges(self):
        self.state.border_edges = []
        features = derive_context_features(
            self.options, self.state, (0, 0, 3, 3)
        )
        names = {feature['properties']['name'] for feature in features}
        self.assertIn('Kosovo', names)

    def test_unlabelled_residue_is_not_neighbour_land(self):
        path = self.directory / NEIGHBOUR_SOURCE_FILE
        collection = json.loads(path.read_text(encoding='utf-8'))
        neighbour_d = next(
            feature for feature in collection['features']
            if feature['properties']['name'] == 'D'
        )
        residue = box(2.6, 0.2, 2.8, 0.4)
        neighbour_d['geometry'] = mapping(
            shape(neighbour_d['geometry']).difference(residue)
        )
        path.write_text(json.dumps(collection), encoding='utf-8')
        areas = self.derived()
        for area in areas.values():
            self.assertFalse(area.covers(Point(2.7, 0.3)))

    def test_a_big_gap_keeps_only_the_near_sliver_for_a_shaped_authority(self):
        # The band is the first 0.2 degrees north of Montenegro. A is a shaped
        # neighbour; Kosovo has no Natural Earth outline. One Voronoi cell stays
        # inside the band, the other reaches into the far field.
        near_border_region = box(0, 0, 1, 0.2)
        near_sliver = box(0.1, 0.05, 0.3, 0.15)
        far_field = box(0.3, 0.05, 0.9, 3)
        split = {'A': near_sliver, 'Kosovo': far_field}
        pieces = assign_gap_pieces(split, near_border_region, {'A'})
        self.assertTrue(pieces['A'].equals(near_sliver))
        self.assertTrue(pieces['Kosovo'].equals(far_field))

    def test_a_long_cell_gives_the_whole_hole_to_the_unshaped_authority(self):
        near_border_region = box(0, 0, 1, 0.2)
        hole = box(0.1, 0.05, 0.9, 3)
        long_cell = box(0.1, 0.05, 0.3, 2)
        far_field = hole.difference(long_cell)
        split = {'A': long_cell, 'Kosovo': far_field}
        pieces = assign_gap(hole, split, near_border_region, {'A'})
        self.assertEqual(list(pieces), ['Kosovo'])
        self.assertTrue(pieces['Kosovo'].equals(hole))

    def test_reviewed_towns_have_the_authority_natural_earth_leaves_them_in(self):
        collection = json.loads(
            (ROOT / 'data/sources' / CONTEXT_FILE).read_text(encoding='utf-8')
        )
        expected = {
            'Kosovo': (
                (20.87, 42.89), (20.80, 43.10), (21.19, 42.91),
                (21.17, 42.67), (21.42, 42.47), (20.74, 42.21),
                (20.47, 42.78),
            ),
            'Republic of Serbia': ((20.51, 43.14),),
        }
        areas = {
            feature['properties']['name']: shape(feature['geometry'])
            for feature in collection['features']
        }
        for name, towns in expected.items():
            for town in towns:
                with self.subTest(authority=name, town=town):
                    self.assertTrue(areas[name].covers(Point(*town)))

    def test_reviewed_derivation_is_stable_over_its_own_output(self):
        options = SimpleNamespace(
            sources_directory=ROOT / 'data/sources', uses_fresh_country=False
        )
        published = (
            ROOT / 'data/sources' / CONTEXT_FILE
        ).read_text(encoding='utf-8')
        self.assertEqual(
            serialize_collection(
                derive_context_features(options, ExtractionState())
            ),
            published,
        )

    def test_hostile_published_ocean_cannot_change_the_reviewed_areas(self):
        sources = self.reviewed_source_copy()
        hostile_ocean = {
            'type': 'FeatureCollection',
            'features': [{
                'type': 'Feature',
                'geometry': mapping(box(19.5, 41.5, 21.6, 43.5)),
                'properties': {'kind': 'ocean'},
            }],
        }
        (sources / 'water.geojson').write_text(
            json.dumps(hostile_ocean), encoding='utf-8'
        )
        published = (
            ROOT / 'data/sources' / CONTEXT_FILE
        ).read_text(encoding='utf-8')
        self.assertEqual(self.reviewed_derivation_text(sources), published)

    def test_reviewed_derivation_needs_no_published_ocean(self):
        sources = self.reviewed_source_copy()
        self.assertFalse((sources / 'water.geojson').exists())
        published = (
            ROOT / 'data/sources' / CONTEXT_FILE
        ).read_text(encoding='utf-8')
        self.assertEqual(self.reviewed_derivation_text(sources), published)

    def test_reviewed_derivation_publishes_valid_polygons(self):
        options = SimpleNamespace(
            sources_directory=ROOT / 'data/sources', uses_fresh_country=False
        )
        features = derive_context_features(options, ExtractionState())
        for feature in features:
            geometry = shape(feature['geometry'])
            self.assertTrue(
                geometry.is_valid,
                f"{feature['properties']['name']} has invalid geometry",
            )

    def test_canonical_geometry_ignores_ring_start_and_winding(self):
        original = {
            'type': 'Polygon',
            'coordinates': [[
                [0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0],
            ]],
        }
        rotated = {
            'type': 'Polygon',
            'coordinates': [[
                [2, 1], [1, 1], [1, 2], [0, 2], [0, 0], [2, 0], [2, 1],
            ]],
        }
        reversed_ring = {
            'type': 'Polygon',
            'coordinates': [list(reversed(original['coordinates'][0]))],
        }
        self.assertEqual(
            canonical_geometry(original),
            canonical_geometry(rotated),
        )
        self.assertEqual(
            canonical_geometry(original),
            canonical_geometry(reversed_ring),
        )

    def test_non_coastal_ocean_slivers_are_dropped(self):
        coastal = box(0, 0, 1, 1)
        inland = box(3, 3, 3.0001, 3.0001)
        sea_line = LineString([(0, 0), (1, 0)])
        kept = filter_non_coastal_ocean_parts(
            coastal.union(inland), [sea_line]
        )
        self.assertEqual(kept.geom_type, 'Polygon')
        self.assertTrue(kept.equals(coastal))

    def test_snapping_a_coastal_sliver_keeps_it_valid(self):
        # This outline comes from the reviewed ocean cut: rounding its last
        # three coordinates alone makes the two long edges overlap.
        sliver = {
            'type': 'Polygon',
            'coordinates': [[
                [20.275821590189885, 42.818236143606875],
                [20.309330842521387, 42.828314024347314],
                [20.293433, 42.823532],
                [20.290289, 42.822587],
                [20.286844, 42.821551],
                [20.283908, 42.820668],
                [20.282432, 42.820224],
                [20.281952924327793, 42.820079872498695],
                [20.275821590189885, 42.818236143606875],
            ]],
        }
        geometry = shape(rounded_valid_geometry(sliver))
        self.assertTrue(geometry.is_valid)


if __name__ == '__main__':
    unittest.main()
