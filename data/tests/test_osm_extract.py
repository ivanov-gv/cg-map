"""Reproducibility and source identity checks for the OSM extractor."""

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from shapely.geometry import LinearRing, shape

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'data/tools'
SOURCES = ROOT / 'data/sources'
sys.path.insert(0, str(TOOLS))

from osm_extract import cli  # noqa: E402
from osm_extract.identity import content_version  # noqa: E402
from osm_extract.roads import classify_path, road_level  # noqa: E402
from osm_extract.writing import serialize_collection  # noqa: E402
from osm_extract.places import (  # noqa: E402
    category_for,
    collect_facts,
    is_standalone_kind,
    get_kind,
    has_sight_promotion,
    STANDALONE_HISTORIC,
    STANDALONE_TOURISM,
    STANDALONE_AMENITY,
    STANDALONE_AMENITY_SIGHTS,
    STANDALONE_AMENITY_NO_CATEGORY,
)

FIXTURE = ROOT / 'data/tests/fixtures/osm-extract-simple.osm'
FIXTURE_HASH = hashlib.sha256(FIXTURE.read_bytes()).hexdigest()
SOURCE_URL = 'https://example.test/montenegro.osm.pbf'
SOURCE_DATE = '2026-11-21'
SNAPSHOT_TIME = '2026-11-20T21:21:21Z'
REQUIRED_SOURCES = (
    'context-countries.geojson',
    'transport-stops.geojson',
    'transport-stops.provenance.json',
    'provenance.json',
    'place-visibility-policy.json',
)
GENERATED_FILES = (
    'building-entrances.geojson',
    'buildings.geojson',
    'context-countries.geojson',
    'land.geojson',
    'places.geojson',
    'provenance.json',
    'road-nodes.geojson',
    'roads.geojson',
    'transport-stops.geojson',
    'transport-stops.provenance.json',
    'turn-restrictions.json',
    'water.geojson',
)
GENERATED_GEOJSON = tuple(
    name for name in GENERATED_FILES if name.endswith('.geojson')
)
EXTRACTED_GEOJSON = tuple(
    name for name in GENERATED_GEOJSON
    if name not in (
        'context-countries.geojson', 'transport-stops.geojson'
    )
)
REVIEWED_GEOJSON = (
    'building-entrances.geojson', 'buildings.geojson',
    'building-labels.geojson',
    'context-countries.geojson', 'land.geojson', 'places.geojson',
    'road-nodes.geojson', 'roads.geojson', 'transport-stops.geojson',
    'water.geojson',
)
LAYER_FILES = {
    'buildings': ('building-entrances.geojson', 'buildings.geojson'),
    'roads': ('roads.geojson', 'road-nodes.geojson', 'turn-restrictions.json'),
    'land': ('land.geojson',),
    'water': ('water.geojson',),
    'places': ('places.geojson',),
}
COVERED_SEA = {
    'type': 'Polygon',
    'coordinates': [[
        [17.5, 41.0], [21.5, 41.0], [21.5, 44.2],
        [17.5, 44.2], [17.5, 41.0],
    ]],
}
NODE_WRITER = (
    "import {readFileSync} from 'node:fs';\n"
    "import {serializeSourceCollection} from "
    "'./data/tools/source-json.mjs';\n"
    "const name = process.argv[1];\n"
    "const collection = JSON.parse(\n"
    "  readFileSync(`data/sources/${name}`, 'utf8')\n"
    ");\n"
    "process.stdout.write(serializeSourceCollection(collection));\n"
)


def prepared_root(directory):
    """Build a disposable repository shape pinned to the test PBF."""
    root = Path(directory)
    sources = root / 'data/sources'
    contracts = root / 'packages/contracts'
    sources.mkdir(parents=True)
    contracts.mkdir(parents=True)
    for name in REQUIRED_SOURCES:
        shutil.copy2(SOURCES / name, sources / name)
    for name in ('place-visibility.json', 'editor-layers.json'):
        shutil.copy2(ROOT / 'packages/contracts' / name, contracts / name)
    provenance_path = sources / 'provenance.json'
    provenance = json.loads(provenance_path.read_text(encoding='utf-8'))
    provenance.update({
        'input_pbf_sha256': FIXTURE_HASH,
        'input_url': SOURCE_URL,
        'input_date': SOURCE_DATE,
    })
    provenance_path.write_text(
        json.dumps(provenance, indent=2) + '\n', encoding='utf-8'
    )
    return root


def extract_arguments(
    root, layers=None, input_pbf=FIXTURE,
    source_url=SOURCE_URL, source_date=SOURCE_DATE
):
    """Build the reviewed entry point's arguments for a fixture run."""
    arguments = [
        str(input_pbf), '--root', str(root),
        '--source-timestamp', SNAPSHOT_TIME,
        '--source-url', source_url, '--source-date', source_date,
    ]
    if layers:
        arguments.extend(['--layers', *layers])
    return arguments


def extract(
    root, layers=None, check=True, input_pbf=FIXTURE,
    source_url=SOURCE_URL, source_date=SOURCE_DATE
):
    """Run the reviewed entry point against the tiny OSM fixture."""
    command = [
        sys.executable, str(TOOLS / 'extract-osm.py'),
        *extract_arguments(root, layers, input_pbf, source_url, source_date)
    ]
    environment = dict(os.environ, PYTHONPATH=str(TOOLS))
    result = subprocess.run(
        command, env=environment, stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE, text=True
    )
    if check and result.returncode:
        raise subprocess.CalledProcessError(
            result.returncode, command, stderr=result.stderr
        )
    return result


def source_features(root, filename):
    """Read one generated collection with its schema version."""
    text = (root / 'data/sources' / filename).read_text(encoding='utf-8')
    collection = json.loads(text)
    return collection['entitySchemaVersion'], collection['features']


def file_contents(root):
    """Snapshot every generated file so failure tests can compare bytes."""
    return {
        name: (root / 'data/sources' / name).read_bytes()
        for name in GENERATED_FILES
    }


def coordinate_values(value):
    """Yield every number inside a GeoJSON coordinate structure."""
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from coordinate_values(item)
    else:
        yield value


def feature_with(features, entity_id):
    """Find one feature by its source identity."""
    return next(
        feature for feature in features
        if feature['properties']['entityId'] == entity_id
    )


def features_by_entity_id(root, filename):
    """Group generated features by their preserved source identity."""
    _, features = source_features(root, filename)
    grouped = {}
    for feature in features:
        entity_id = feature['properties']['entityId']
        grouped.setdefault(entity_id, []).append(feature)
    return grouped


def single_feature(grouped, entity_id):
    """Return the one feature expected for an unsplit source object."""
    features = grouped[entity_id]
    if len(features) != 1:
        raise AssertionError(f'{entity_id}: expected one feature, got {len(features)}')
    return features[0]


def assert_osm_names(test_case, properties, name=None, english_name=None):
    """Check that only mapped, nonblank OSM names are published."""
    if name is None:
        test_case.assertNotIn('name', properties)
    else:
        test_case.assertEqual(properties.get('name'), name)
    if english_name is None:
        test_case.assertNotIn('name:en', properties)
    else:
        test_case.assertEqual(properties.get('name:en'), english_name)


def polygon_rings(geometry):
    """Return the coordinate rings of every polygon in a GeoJSON geometry."""
    if geometry['type'] == 'Polygon':
        return [geometry['coordinates']]
    return geometry['coordinates']


def node_serialization(filename):
    """Serialize one reviewed source with the shared Node writer."""
    result = subprocess.run(
        ['node', '--input-type=module', '-e', NODE_WRITER, filename],
        cwd=ROOT, check=True, capture_output=True
    )
    return result.stdout.decode('utf-8')


class OsmExtractTest(unittest.TestCase):
    """Exercise the extractor without touching the reviewed source files."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(
            prefix='cg-map-osm-extract-'
        )
        self.addCleanup(temporary.cleanup)
        temporary_path = Path(temporary.name)
        self.first_root = prepared_root(temporary_path / 'first')
        self.second_root = prepared_root(temporary_path / 'second')
        self.temporary_path = temporary_path

    def test_two_runs_write_identical_bytes(self):
        extract(self.first_root)
        extract(self.second_root)
        for name in GENERATED_FILES:
            with self.subTest(name=name):
                self.assertEqual(
                    file_contents(self.first_root)[name],
                    file_contents(self.second_root)[name],
                )

    def test_source_options_are_required(self):
        result = subprocess.run(
            [
                sys.executable, str(TOOLS / 'extract-osm.py'), str(FIXTURE),
                '--root', str(self.first_root)
            ],
            env=dict(os.environ, PYTHONPATH=str(TOOLS)),
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('the following arguments are required', result.stderr)

    def test_visibility_review_is_explicit(self):
        arguments = [
            str(FIXTURE), '--root', str(self.first_root),
            '--source-timestamp', SNAPSHOT_TIME,
            '--source-url', SOURCE_URL, '--source-date', SOURCE_DATE,
        ]
        with mock.patch.object(cli, 'apply_visibility') as visibility:
            cli.run(cli.parse_args(arguments))
        self.assertFalse(visibility.call_args.args[1])
        with mock.patch.object(cli, 'apply_visibility') as visibility:
            cli.run(cli.parse_args([
                *arguments, '--accept-new-place-facts'
            ]))
        self.assertTrue(visibility.call_args.args[1])

    def test_features_keep_source_identity_and_upstream_version(self):
        extract(self.first_root)
        identities = {}
        for name in GENERATED_GEOJSON:
            schema_version, features = source_features(self.first_root, name)
            self.assertEqual(schema_version, 1, name)
            for feature in features:
                properties = feature['properties']
                key = (
                    properties['entityId'], properties.get('entityPart')
                )
                identities.setdefault(key, properties['entityVersion'])
                self.assertTrue(properties['entityVersion'], name)
        expected = {
            ('node/1001', None): 3,
            ('node/1002', None): 2,
            ('node/6001', None): 1,
            ('node/6002', None): 1,
            ('way/2001', None): 5,
            ('way/2003', None): 4,
            ('way/2005', None): 11,
            ('way/2006', 0): 12,
            ('way/2007', None): 2,
            ('way/2008', None): 1,
            ('way/2009', None): 1,
            ('relation/3001', None): 9,
            ('relation/3003', 0): 13,
            ('relation/3003', 1): 13,
            ('relation/3004', 0): 14,
            ('relation/3004', 1): 14,
            ('way/4000', None): 6,
        }
        for key, version in expected.items():
            with self.subTest(key=key):
                self.assertEqual(identities[key], version)
        for key in [('derived:ocean', None), ('ne:ALB', None)]:
            with self.subTest(key=key):
                self.assertTrue(identities[key].startswith('sha256:'))
        self.assertTrue(
            any(key[0].startswith('epodgorica:') for key in identities),
            'transport stops keep their own source namespace',
        )

    def test_split_multipolygons_number_every_part(self):
        extract(self.first_root)
        parts = {}
        for name in GENERATED_GEOJSON:
            _, features = source_features(self.first_root, name)
            for feature in features:
                properties = feature['properties']
                entity_id = properties['entityId']
                if entity_id in ('relation/3003', 'relation/3004'):
                    parts.setdefault(entity_id, []).append(
                        properties.get('entityPart')
                    )
        for entity_id in ('relation/3003', 'relation/3004'):
            with self.subTest(entity_id=entity_id):
                self.assertEqual(sorted(parts[entity_id]), [0, 1])

    def test_files_use_one_sorted_feature_per_line(self):
        extract(self.first_root)
        for name in GENERATED_GEOJSON:
            with self.subTest(name=name):
                text = (
                    self.first_root / 'data/sources' / name
                ).read_text(encoding='utf-8')
                lines = text.splitlines()
                header = '{"entitySchemaVersion":1,"features":['
                self.assertEqual(lines[0], header)
                self.assertEqual(lines[-1], '],"type":"FeatureCollection"}')
                records = []
                for line in lines[1:-1]:
                    encoded = line.removesuffix(',')
                    feature = json.loads(encoded)
                    self.assertEqual(
                        encoded,
                        json.dumps(
                            feature, ensure_ascii=False, sort_keys=True,
                            separators=(',', ':')
                        ),
                    )
                    properties = feature['properties']
                    part = properties.get('entityPart', -1)
                    records.append(
                        (properties['entityId'], part, encoded)
                    )
                self.assertEqual(records, sorted(records))

    def test_turn_restrictions_is_valid_json(self):
        extract(self.first_root)
        restrictions_path = (
            self.first_root / 'data/sources' / 'turn-restrictions.json'
        )
        data = json.loads(restrictions_path.read_text(encoding='utf-8'))
        self.assertEqual(data['entitySchemaVersion'], 1)
        self.assertIsInstance(data['restrictions'], list)

    def test_turn_restriction_relation_is_extracted(self):
        extract(self.first_root)
        restrictions_path = (
            self.first_root / 'data/sources' / 'turn-restrictions.json'
        )
        data = json.loads(restrictions_path.read_text(encoding='utf-8'))
        restrictions = data['restrictions']
        by_id = {r['entityId']: r for r in restrictions}
        self.assertIn('relation/9100', by_id)
        restriction = by_id['relation/9100']
        self.assertEqual(restriction['entityVersion'], 1)
        self.assertEqual(restriction['restriction'], 'no_left_turn')
        self.assertEqual(restriction['from'], 2003)
        self.assertEqual(restriction['to'], 2007)
        self.assertEqual(restriction['viaNodes'], [2032])
        self.assertNotIn('relation/9101', by_id)
        self.assertNotIn('relation/9102', by_id)
        self.assertNotIn('relation/9103', by_id)

    def test_clipped_road_omits_node_at_clip_boundary(self):
        extract(self.first_root)
        _, features = source_features(self.first_root, 'roads.geojson')
        parts = [
            feature for feature in features
            if feature['properties']['entityId'] == 'way/3010'
        ]
        self.assertEqual(len(parts), 1)
        properties = parts[0]['properties']
        self.assertEqual(properties['startNode'], 7001)
        self.assertEqual(properties['startLevel'], 0)
        self.assertNotIn('endNode', properties)
        self.assertNotIn('endLevel', properties)

    def test_turn_restrictions_file_is_one_per_line_sorted(self):
        extract(self.first_root)
        restrictions_path = (
            self.first_root / 'data/sources' / 'turn-restrictions.json'
        )
        lines = restrictions_path.read_text(encoding='utf-8').splitlines()
        self.assertEqual(lines[0], '{"entitySchemaVersion":1,"restrictions":[')
        self.assertEqual(lines[-1], ']}')
        records = []
        for line in lines[1:-1]:
            encoded = line.removesuffix(',')
            restriction = json.loads(encoded)
            self.assertEqual(
                encoded,
                json.dumps(
                    restriction, ensure_ascii=False, sort_keys=True,
                    separators=(',', ':')
                ),
            )
            records.append(restriction['entityId'])
        self.assertEqual(records, sorted(records))

    def test_road_nodes_omit_empty_name(self):
        extract(self.first_root)
        _, features = source_features(self.first_root, 'road-nodes.geojson')
        by_id = {
            feature['properties']['entityId']: feature['properties']
            for feature in features
        }
        self.assertIn('node/6001', by_id)
        self.assertNotIn('name', by_id['node/6001'])

    def test_coordinates_use_reviewed_precision(self):
        extract(self.first_root)
        for name in EXTRACTED_GEOJSON:
            with self.subTest(name=name):
                _, features = source_features(self.first_root, name)
                for feature in features:
                    coordinates = feature['geometry']['coordinates']
                    for number in coordinate_values(coordinates):
                        self.assertEqual(number, round(number, 6))

    def assert_rfc7946_rings(self, geometry, label):
        """Check counterclockwise exteriors and clockwise holes."""
        for index, rings in enumerate(polygon_rings(geometry)):
            self.assertTrue(LinearRing(rings[0]).is_ccw, f'{label} exterior {index}')
            for hole_index, hole in enumerate(rings[1:]):
                self.assertFalse(
                    LinearRing(hole).is_ccw,
                    f'{label} hole {index}.{hole_index}'
                )

    def test_green_areas_carry_osm_tag_kind_and_destination(self):
        extract(self.first_root)
        land = features_by_entity_id(self.first_root, 'land.geojson')
        expected = {
            'way/5001': ('garden', 'leisure=garden', None, 'Test Garden'),
            'way/5002': ('woods', 'natural=wood', None, None),
            'way/5003': ('meadow', 'landuse=meadow', True, 'Test Meadow'),
            'way/5004': ('meadow', 'landuse=meadow', True, None),
            'way/5010': ('meadow', 'natural=grassland', True, None),
            'way/5012': ('grass', 'landuse=grass', None, None),
            'way/5005': ('grass', 'leisure=common', True, 'Test Common'),
            'way/5006': ('scrub', 'natural=scrub', None, None),
            'way/5007': ('sports', 'leisure=pitch', None, None),
            'way/5008': ('cemetery', 'landuse=cemetery', None, None),
            'way/5009': ('playground', 'leisure=playground', None, None),
            'relation/5200': ('park', 'leisure=park', None, 'Park With Hole'),
        }
        for entity_id, (kind, osm_tag, destination, name) in expected.items():
            with self.subTest(entity_id=entity_id):
                properties = single_feature(land, entity_id)['properties']
                self.assertEqual(properties['kind'], kind)
                self.assertEqual(properties['osmTag'], osm_tag)
                self.assertEqual(properties.get('destination'), destination)
                assert_osm_names(self, properties, name)
                self.assertIsInstance(properties['entityVersion'], int)

    def test_protected_areas_and_localities_are_not_land_cover(self):
        extract(self.first_root)
        land = features_by_entity_id(self.first_root, 'land.geojson')
        for entity_id in ('way/5011', 'way/5013'):
            with self.subTest(entity_id=entity_id, no_land_cover=True):
                self.assertNotIn(entity_id, land)
        grass = single_feature(land, 'way/5012')['properties']
        self.assertEqual(grass['kind'], 'grass')
        self.assertEqual(grass['osmTag'], 'landuse=grass')
        self.assertNotIn('destination', grass)

    def test_absent_and_blank_names_are_omitted(self):
        extract(self.first_root)
        cases = (
            ('way/5002', features_by_entity_id(self.first_root, 'land.geojson')),
            ('way/6003', features_by_entity_id(self.first_root, 'water.geojson')),
        )
        for entity_id, grouped in cases:
            with self.subTest(entity_id=entity_id):
                properties = single_feature(grouped, entity_id)['properties']
                assert_osm_names(self, properties)

    def test_water_kinds_names_and_waterway_line_tags(self):
        extract(self.first_root)
        water = features_by_entity_id(self.first_root, 'water.geojson')
        areas = {
            'way/6001': ('lake', 'water=lake', 'Test Lake', 'Test Lake EN'),
            'way/6002': ('river', 'water=river', 'Test River Area', None),
            'way/6003': ('reservoir', 'water=reservoir', None, None),
            'way/6004': ('pond', 'water=pond', None, None),
            'way/6005': ('basin', 'water=basin', None, None),
            'way/6006': ('river', 'waterway=riverbank', 'Test Bank', None),
            'relation/6100': (
                'lake', 'water=lake', 'Lake With Island', 'Lake With Island EN'
            ),
        }
        for entity_id, (kind, osm_tag, name, english_name) in areas.items():
            with self.subTest(entity_id=entity_id, area=True):
                properties = single_feature(water, entity_id)['properties']
                self.assertEqual(properties['kind'], kind)
                self.assertEqual(properties['osmTag'], osm_tag)
                assert_osm_names(self, properties, name, english_name)
        lines = {
            'way/7001': ('river', 'Test River', 'Test River EN', 'yes', 'no'),
            'way/7002': ('stream', 'Test Stream', None, None, None),
            'way/7003': ('canal', None, None, None, 'yes'),
            'way/7004': ('ditch', None, None, None, None),
            'way/7005': ('drain', None, None, None, None),
        }
        for entity_id, (kind, name, english_name, tunnel, intermittent) in lines.items():
            with self.subTest(entity_id=entity_id, line=True):
                properties = single_feature(water, entity_id)['properties']
                self.assertEqual(properties['kind'], kind)
                self.assertEqual(properties['osmTag'], f'waterway={kind}')
                assert_osm_names(self, properties, name, english_name)
                self.assertEqual(properties.get('tunnel'), tunnel)
                self.assertEqual(properties.get('intermittent'), intermittent)
                self.assertNotIn('entityPart', properties)
        river = single_feature(water, 'way/7001')['geometry']['coordinates']
        self.assertEqual(river[0], [19.2, 42.4])
        self.assertEqual(river[-1], [19.22, 42.4])
        coastline = single_feature(water, 'way/8001')['geometry']['coordinates']
        self.assertEqual(coastline, [[19.315, 42.4], [19.315, 42.41]])
        for entity_id in ('way/8001', 'way/8002'):
            with self.subTest(entity_id=entity_id, coastline=True):
                feature = single_feature(water, entity_id)
                self.assertEqual(feature['properties']['kind'], 'coastline')
                self.assertEqual(
                    feature['properties']['osmTag'], 'natural=coastline'
                )
        self.assertNotEqual(
            single_feature(water, 'way/8001')['geometry'],
            single_feature(water, 'way/8002')['geometry']
        )

    def test_minor_waterways_are_clipped_to_the_detail_box(self):
        extract(self.first_root)
        water = features_by_entity_id(self.first_root, 'water.geojson')
        for entity_id in ('way/7006', 'way/7007', 'way/7008'):
            with self.subTest(entity_id=entity_id, outside=True):
                self.assertNotIn(entity_id, water)
        clipped = {
            'way/7009': ('stream', 42.39),
            'way/7010': ('ditch', 42.395),
            'way/7011': ('drain', 42.4),
        }
        for entity_id, (kind, latitude) in clipped.items():
            with self.subTest(entity_id=entity_id, clipped=True):
                feature = single_feature(water, entity_id)
                properties = feature['properties']
                self.assertEqual(properties['kind'], kind)
                self.assertEqual(properties['osmTag'], f'waterway={kind}')
                self.assertEqual(properties['entityPart'], 0)
                self.assertEqual(
                    feature['geometry']['coordinates'],
                    [[19.15, latitude], [19.2, latitude]],
                )
        for entity_id in ('way/7001', 'way/7003'):
            with self.subTest(entity_id=entity_id, countrywide=True):
                self.assertNotIn(
                    'entityPart', single_feature(water, entity_id)['properties']
                )

    def test_multipolygon_holes_survive_with_rfc7946_rings(self):
        extract(self.first_root)
        cases = (
            ('land.geojson', 'relation/5200'),
            ('water.geojson', 'relation/6100'),
        )
        for filename, entity_id in cases:
            with self.subTest(entity_id=entity_id):
                feature = single_feature(
                    features_by_entity_id(self.first_root, filename), entity_id
                )
                rings = polygon_rings(feature['geometry'])
                self.assertTrue(
                    any(len(part_rings) > 1 for part_rings in rings),
                    f'{entity_id}: inner ring missing'
                )
                self.assertTrue(shape(feature['geometry']).is_valid, entity_id)
                self.assert_rfc7946_rings(feature['geometry'], entity_id)

    def test_every_extracted_polygon_is_valid_and_rightly_wound(self):
        extract(self.first_root)
        cases = (
            (
                'land.geojson',
                {
                    'park', 'garden', 'woods', 'meadow', 'grass', 'scrub',
                    'sports', 'cemetery', 'playground'
                }
            ),
            (
                'water.geojson',
                {
                    'lake', 'river', 'reservoir', 'pond', 'basin', 'water',
                    'ocean'
                }
            ),
        )
        for filename, kinds in cases:
            _, features = source_features(self.first_root, filename)
            checked = 0
            for feature in features:
                kind = feature['properties']['kind']
                is_polygon = feature['geometry']['type'] in (
                    'Polygon', 'MultiPolygon'
                )
                if kind not in kinds or not is_polygon:
                    continue
                checked += 1
                geometry = feature['geometry']
                self.assertTrue(shape(geometry).is_valid, f'{filename}: {kind}')
                self.assert_rfc7946_rings(geometry, f'{filename}: {kind}')
            self.assertGreater(checked, 0, filename)

    def test_python_and_node_writers_agree(self):
        for name in REVIEWED_GEOJSON:
            with self.subTest(name=name):
                collection = json.loads(
                    (SOURCES / name).read_text(encoding='utf-8')
                )
                expected = serialize_collection(collection['features'])
                self.assertEqual(node_serialization(name), expected)

    def test_each_layer_group_replaces_only_its_source_file(self):
        extract(self.first_root)
        baseline = file_contents(self.first_root)
        # These files are always regenerated by the extractor regardless of
        # which layer group is selected; skip them in this test.
        always_regenerated = ('provenance.json',)
        for group, filenames in LAYER_FILES.items():
            with self.subTest(group=group):
                root = prepared_root(self.temporary_path / group)
                sources = root / 'data/sources'
                preserved = ('context-countries.geojson',)
                if group == 'water':
                    preserved += ('land.geojson',)
                marker = b'not regenerated by this run\n'
                for name in GENERATED_FILES:
                    if name in baseline and name not in always_regenerated:
                        contents = (
                            baseline[name] if name in preserved else marker
                        )
                        (sources / name).write_bytes(contents)
                extract(root, layers=[group])
                for name in GENERATED_FILES:
                    if name not in baseline or name in always_regenerated:
                        continue
                    with self.subTest(group=group, name=name):
                        if name in filenames or name in preserved:
                            expected = baseline[name]
                        else:
                            expected = marker
                        self.assertEqual(
                            (sources / name).read_bytes(), expected
                        )
    def test_building_attributes_and_address_joins(self):
        extract(self.first_root)
        _, buildings = source_features(self.first_root, 'buildings.geojson')
        by_id = {
            feature['properties']['entityId']: feature['properties']
            for feature in buildings
        }
        atlas = by_id['way/2001']
        for tag, value in (
            ('building', 'apartments'), ('building:levels', '4'),
            ('building:material', 'brick'), ('start_date', '2001'),
            ('roof:levels', '1'), ('name', 'Atlas House'),
            ('addr:street', 'Test Street'),
        ):
            with self.subTest(tag=tag):
                self.assertEqual(atlas[tag], value)
        # Two road groups normalise to "test street", so no join is published.
        self.assertNotIn('addr:streetEntityId', atlas)
        house = by_id['way/2002']
        self.assertEqual(house['nohousenumber'], 'yes')
        self.assertNotIn('addr:housenumber', house)
        self.assertEqual(house['addr:streetEntityId'], 'way/2015')
        self.assertEqual(house['addr:streetEntityIds'], ['way/2015'])
        # Two ways share an endpoint, so the case- and whitespace-folded name joins as one group.
        joined = by_id['way/4103']
        self.assertEqual(joined['addr:streetEntityId'], 'way/4101')
        self.assertEqual(joined['addr:streetEntityIds'], ['way/4101', 'way/4102'])
        # Two disconnected groups still leave the address unjoined.
        self.assertNotIn('addr:streetEntityId', by_id['way/4106'])
        details = json.loads(
            (self.first_root / 'data/sources/provenance.json').read_text()
        )['building_details']
        self.assertEqual(details['nohousenumber'], 1)
        self.assertEqual(details['addr:streetUnjoined'], 2)
        self.assertEqual(details['addr:streetEntityId'], 2)
        self.assertEqual(details['addr:streetEntityIds'], 2)

    def test_entrances_keep_osm_tags_and_join_to_a_nearby_building(self):
        extract(self.first_root)
        _, entrances = source_features(
            self.first_root, 'building-entrances.geojson'
        )
        by_id = {
            feature['properties']['entityId']: feature
            for feature in entrances
        }
        self.assertEqual(set(by_id), {'node/5001', 'node/5002', 'node/5004'})
        first = by_id['node/5001']
        properties = first['properties']
        self.assertEqual(properties['entityVersion'], 4)
        self.assertEqual(properties['entrance'], 'yes')
        self.assertEqual(properties['ref'], 'A')
        self.assertEqual(properties['level'], '0')
        self.assertEqual(properties['wheelchair'], 'yes')
        self.assertEqual(properties['door'], 'hinged')
        self.assertEqual(properties['addr:housenumber'], '12')
        self.assertEqual(properties['addr:street'], 'Test Street')
        self.assertEqual(properties['buildingEntityId'], 'way/2001')
        self.assertEqual(
            first['geometry']['coordinates'], [19.2505, 42.44]
        )
        placeholder = by_id['node/5002']['properties']
        self.assertNotIn('addr:housenumber', placeholder)
        self.assertEqual(placeholder['nohousenumber'], 'yes')
        self.assertEqual(
            by_id['node/5004']['properties']['buildingEntityId'], 'way/2002'
        )
        details = json.loads(
            (self.first_root / 'data/sources/provenance.json').read_text()
        )['building_details']
        self.assertEqual(details['entrance:nohousenumber'], 1)

    def test_places_inside_a_footprint_get_its_building_identity(self):
        extract(self.first_root)
        _, places = source_features(self.first_root, 'places.geojson')
        by_name = {
            feature['properties']['name']: feature['properties']
            for feature in places
        }
        self.assertEqual(
            by_name['Inside Cafe']['buildingEntityId'], 'way/2001'
        )
        self.assertEqual(
            by_name['Inside Bakery']['buildingEntityId'], 'way/2002'
        )
        self.assertNotIn('buildingEntityId', by_name['Outside Pharmacy'])
        # The green-area fixture adds a named viewpoint as a destination marker;
        # it is published as a place outside every building footprint.
        self.assertNotIn('buildingEntityId', by_name['Test Lookout'])
        details = json.loads(
            (self.first_root / 'data/sources/provenance.json').read_text()
        )['building_details']
        self.assertEqual(details['placesInsideBuildings'], 3)
        # node/1013 (tower) and node/1017 (lighthouse) are outside; gate is not
        self.assertEqual(details['placesOutsideBuildings'], 10)

    def test_containment_sets_building_id_and_standalone_together(self):
        """One footprint join decides both published location properties."""
        extract(self.first_root)
        _, places = source_features(self.first_root, 'places.geojson')
        by_id = {
            feature['properties']['entityId']: feature['properties']
            for feature in places
        }
        outside = by_id['node/1011']
        self.assertNotIn('buildingEntityId', outside)
        self.assertTrue(outside['standalone'])
        inside = by_id['node/1016']
        self.assertEqual(inside['buildingEntityId'], 'way/2001')
        self.assertNotIn('standalone', inside)

    def test_partial_run_refuses_a_different_input_pbf(self):
        extract(self.first_root)
        provenance_path = self.first_root / 'data/sources/provenance.json'
        provenance = json.loads(provenance_path.read_text(encoding='utf-8'))
        provenance['input_pbf_sha256'] = '0' * 64
        provenance_path.write_text(json.dumps(provenance, indent=2) + '\n')
        before = file_contents(self.first_root)
        result = extract(self.first_root, layers=['water'], check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Run a full extract first', result.stderr)
        self.assertEqual(file_contents(self.first_root), before)

    def test_partial_run_preserves_global_provenance(self):
        extract(self.first_root)
        provenance_path = self.first_root / 'data/sources/provenance.json'
        provenance = json.loads(provenance_path.read_text(encoding='utf-8'))
        reviewed_fields = {
            'export_date': 'reviewed date',
            'upstream_snapshot': 'reviewed snapshot',
            'coverage': 'reviewed coverage',
            'input_url': 'reviewed URL',
            'input_date': 'reviewed input date',
            'detail_bbox': [1, 2, 3, 4],
            'extract_flags': {
                'all_details': True,
                'all_places': True,
                'layers': ['reviewed.geojson'],
            },
        }
        provenance.update(reviewed_fields)
        provenance['layers']['water.geojson']['sha256'] = 'stale checksum'
        provenance_path.write_text(json.dumps(provenance, indent=2) + '\n')
        extract(self.first_root, layers=['water'])
        updated = json.loads(provenance_path.read_text(encoding='utf-8'))
        for field, expected in reviewed_fields.items():
            with self.subTest(field=field):
                self.assertEqual(updated[field], expected)
        self.assertNotEqual(
            updated['layers']['water.geojson']['sha256'], 'stale checksum'
        )
        self.assertFalse(
            (self.first_root / 'data/sources/extract-metadata.json').exists()
        )

    def test_partial_water_uses_the_reviewed_land_outline(self):
        extract(self.first_root)
        before = feature_with(
            source_features(self.first_root, 'water.geojson')[1],
            'derived:ocean'
        )
        land_path = self.first_root / 'data/sources/land.geojson'
        land = json.loads(land_path.read_text(encoding='utf-8'))
        country = feature_with(land['features'], 'way/4000')
        self.assertEqual(country['properties']['kind'], 'country')
        country['geometry'] = COVERED_SEA
        land_path.write_text(json.dumps(land, indent=2) + '\n')
        extract(self.first_root, layers=['water'])
        after = feature_with(
            source_features(self.first_root, 'water.geojson')[1],
            'derived:ocean'
        )
        self.assertTrue(
            after['geometry'] != before['geometry'],
            'partial water kept the fresh country instead of reviewed land'
        )
        expected_version = content_version({
            'geometry': after['geometry'],
            'properties': {'kind': 'ocean'},
        })
        self.assertEqual(
            after['properties']['entityVersion'], expected_version
        )

    def test_failed_extract_leaves_reviewed_sources_untouched(self):
        extract(self.first_root)
        sentinel = self.first_root / 'data/sources/buildings.geojson'
        sentinel.write_text('reviewed buildings sentinel\n', encoding='utf-8')
        before = file_contents(self.first_root)
        arguments = cli.parse_args(extract_arguments(self.first_root))
        # Provenance runs after visibility and every layer write, so a refusal
        # there is a late failure: an in-place writer already replaced sources.
        with mock.patch.object(
            cli, 'updated_provenance',
            side_effect=RuntimeError('provenance review failed')
        ):
            with self.assertRaisesRegex(RuntimeError, 'provenance review failed'):
                cli.run(arguments)
        self.assertEqual(file_contents(self.first_root), before)

    def test_late_publication_failure_restores_reviewed_sources(self):
        extract(self.first_root)
        sentinel = self.first_root / 'data/sources/buildings.geojson'
        sentinel.write_text('reviewed buildings sentinel\n', encoding='utf-8')
        before = file_contents(self.first_root)
        arguments = cli.parse_args(extract_arguments(self.first_root))
        real_replace = cli.replace_file
        attempts = []

        def replace_with_late_failure(source, destination):
            attempts.append(destination)
            # The first file is already published; fail while replacing the
            # second, where an earlier writer left a mixed source bundle.
            if len(attempts) == 2:
                raise OSError('destination write failed')
            return real_replace(source, destination)

        with mock.patch.object(
            cli, 'replace_file', side_effect=replace_with_late_failure
        ):
            with self.assertRaisesRegex(OSError, 'destination write failed'):
                cli.run(arguments)
        self.assertEqual(file_contents(self.first_root), before)
        self.assertGreaterEqual(len(attempts), 3)
        self.assertEqual(
            list((self.first_root / 'data/sources').glob('*.new')), []
        )
        self.assertEqual(
            list((self.first_root / 'data/sources').glob('*.old')), []
        )

    def test_partial_run_does_not_publish_unselected_sources(self):
        extract(self.first_root)
        sources = self.first_root / 'data/sources'
        (sources / 'buildings.geojson').write_text(
            'reviewed buildings sentinel\n', encoding='utf-8'
        )
        (sources / 'roads.geojson').write_text(
            'reviewed roads sentinel\n', encoding='utf-8'
        )
        before = file_contents(self.first_root)
        extract(self.first_root, layers=['buildings'])
        after = file_contents(self.first_root)
        self.assertNotEqual(
            after['buildings.geojson'], before['buildings.geojson']
        )
        self.assertEqual(after['roads.geojson'], before['roads.geojson'])


class PathClassTest(unittest.TestCase):
    """Test the classify_path function for walking route classification."""

    def test_paved_footway_is_main(self):
        self.assertEqual(
            classify_path({'highway': 'footway', 'surface': 'asphalt'}),
            'main',
        )

    def test_paved_pedestrian_is_main(self):
        self.assertEqual(
            classify_path({'highway': 'pedestrian', 'surface': 'concrete'}),
            'main',
        )

    def test_paved_cycleway_is_main(self):
        self.assertEqual(
            classify_path({'highway': 'cycleway', 'surface': 'paved'}),
            'main',
        )

    def test_paved_path_is_main(self):
        self.assertEqual(
            classify_path({'highway': 'path', 'surface': 'asphalt'}),
            'main',
        )

    def test_unpaved_path_is_trail(self):
        self.assertEqual(
            classify_path({'highway': 'path', 'surface': 'gravel'}),
            'trail',
        )

    def test_track_is_trail(self):
        self.assertEqual(
            classify_path({'highway': 'track'}),
            'trail',
        )

    def test_bridleway_is_trail(self):
        self.assertEqual(
            classify_path({'highway': 'bridleway'}),
            'trail',
        )

    def test_sac_scale_is_trail(self):
        self.assertEqual(
            classify_path({'highway': 'path', 'sac_scale': 'hiking_mountains'}),
            'trail',
        )

    def test_footway_without_surface_is_main(self):
        self.assertEqual(
            classify_path({'highway': 'footway'}),
            'main',
        )

    def test_footway_with_explicitly_unpaved_surface_is_unclassified(self):
        self.assertIsNone(
            classify_path({'highway': 'footway', 'surface': 'gravel'}),
        )

    def test_path_without_surface_is_unclassified(self):
        self.assertIsNone(
            classify_path({'highway': 'path'}),
        )

    def test_residential_road_is_none(self):
        self.assertIsNone(
            classify_path({'highway': 'residential'}),
        )

    def test_paved_path_with_sac_scale_is_main(self):
        # Paved path takes main over trail even with sac_scale
        self.assertEqual(
            classify_path({
                'highway': 'path',
                'surface': 'asphalt',
                'sac_scale': 'hiking_mountains',
            }),
            'main',
        )


class RoadLevelTest(unittest.TestCase):
    """Test the road_level function for bridge/tunnel level computation."""

    def test_default_level_is_zero(self):
        self.assertEqual(road_level({}), 0)

    def test_explicit_layer(self):
        self.assertEqual(road_level({'layer': '3'}), 3)

    def test_negative_layer(self):
        self.assertEqual(road_level({'layer': '-2'}), -2)

    def test_bridge_without_layer_gets_one(self):
        self.assertEqual(road_level({'bridge': 'yes'}), 1)

    def test_tunnel_without_layer_gets_minus_one(self):
        self.assertEqual(road_level({'tunnel': 'yes'}), -1)

    def test_bridge_with_explicit_layer_uses_layer(self):
        self.assertEqual(
            road_level({'bridge': 'yes', 'layer': '2'}),
            2,
        )

    def test_tunnel_with_explicit_layer_uses_layer(self):
        self.assertEqual(
            road_level({'tunnel': 'yes', 'layer': '-3'}),
            -3,
        )

    def test_bridge_no_gets_zero(self):
        self.assertEqual(road_level({'bridge': 'no'}), 0)

    def test_non_numeric_layer_falls_back_to_bridge(self):
        self.assertEqual(
            road_level({'bridge': 'yes', 'layer': 'unknown'}),
            1,
        )


class EndNodePreservationTest(unittest.TestCase):
    """Verify that simplification preserves both end nodes exactly."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(
            prefix='cg-map-end-node-'
        )
        self.addCleanup(temporary.cleanup)
        temporary_path = Path(temporary.name)
        self.first_root = prepared_root(temporary_path / 'root')

    def test_simplification_keeps_end_coordinates(self):
        """A road with many points is simplified; first/last coords match."""
        from shapely.geometry import LineString
        # Build a line with many intermediate points
        coords = [
            (19.250000, 42.440000),  # Start
            (19.250010, 42.440010),
            (19.250020, 42.440005),
            (19.250030, 42.440015),
            (19.250040, 42.440008),
            (19.250050, 42.440012),
            (19.250060, 42.440003),
            (19.250070, 42.440018),
            (19.250080, 42.440007),
            (19.250090, 42.440014),
            (19.251000, 42.441000),  # End
        ]
        line = LineString(coords)
        simplified = line.simplify(0.000015, preserve_topology=True)
        simplified_coords = list(simplified.coords)
        # Endpoints must be preserved exactly
        self.assertEqual(simplified_coords[0], coords[0],
                         'simplification changed start coordinate')
        self.assertEqual(simplified_coords[-1], coords[-1],
                         'simplification changed end coordinate')

    def test_end_nodes_match_osm_after_simplification(self):
        """Extract a road and verify startNode/endNode equal OSM node IDs."""
        extract(self.first_root, layers=['roads'])
        _, features = source_features(self.first_root, 'roads.geojson')
        # The fixture has way/2003 (residential) with nodes 2031, 2032
        # and way/2007 (primary bridge) with nodes 2091, 2092
        found_2003 = [f for f in features
                       if f['properties']['entityId'] == 'way/2003']
        found_2007 = [f for f in features
                       if f['properties']['entityId'] == 'way/2007']
        if found_2003:
            p = found_2003[0]['properties']
            self.assertEqual(p['startNode'], 2031,
                             'way/2003 startNode should be OSM node 2031')
            self.assertEqual(p['endNode'], 2032,
                             'way/2003 endNode should be OSM node 2032')
        if found_2007:
            p = found_2007[0]['properties']
            self.assertEqual(p['startNode'], 2091,
                             'way/2007 startNode should be OSM node 2091')
            self.assertEqual(p['endNode'], 2092,
                             'way/2007 endNode should be OSM node 2092')


if __name__ == '__main__':
    unittest.main()


class StandalonePlacesTest(unittest.TestCase):
    """Test standalone point extraction and fact collection for #327."""

    def test_standalone_historic_kinds_map_to_sights(self):
        for kind in STANDALONE_HISTORIC:
            with self.subTest(kind=kind):
                tags = {'name': 'Test', 'historic': kind}
                self.assertEqual(category_for(tags), 'sights')

    def test_standalone_tourism_kinds_map_to_sights(self):
        for kind in STANDALONE_TOURISM:
            with self.subTest(kind=kind):
                tags = {'name': 'Test', 'tourism': kind}
                self.assertEqual(category_for(tags), 'sights')

    def test_standalone_amenity_sights_map_to_sights(self):
        """Only fountain maps to sights without extra tags."""
        for kind in STANDALONE_AMENITY_SIGHTS:
            with self.subTest(kind=kind):
                tags = {'name': 'Test', 'amenity': kind}
                self.assertEqual(category_for(tags), 'sights')

    def test_standalone_amenity_no_category_returns_empty(self):
        """cinema, library, etc. return no category without sight promotion."""
        for kind in STANDALONE_AMENITY_NO_CATEGORY:
            with self.subTest(kind=kind):
                tags = {'name': 'Test', 'amenity': kind}
                self.assertEqual(category_for(tags), '')

    def test_standalone_amenity_promoted_to_sights(self):
        """place_of_worship/theatre/arts_centre become sights with heritage."""
        for kind in ('place_of_worship', 'theatre', 'arts_centre'):
            for promo_tag, promo_value in [
                ('tourism', 'attraction'),
                ('heritage', 'yes'),
                ('historic', 'yes'),
            ]:
                with self.subTest(kind=kind, tag=promo_tag):
                    tags = {'name': 'Test', 'amenity': kind, promo_tag: promo_value}
                    self.assertEqual(category_for(tags), 'sights')

    def test_has_sight_promotion_detects_promotion_tags(self):
        self.assertTrue(has_sight_promotion({'tourism': 'attraction'}))
        self.assertTrue(has_sight_promotion({'heritage': 'yes'}))
        self.assertTrue(has_sight_promotion({'historic': 'monument'}))
        self.assertFalse(has_sight_promotion({'amenity': 'library'}))
        self.assertFalse(has_sight_promotion({}))
        # Only tourism=attraction promotes, not other tourism values
        self.assertFalse(has_sight_promotion({'tourism': 'hotel'}))
        self.assertFalse(has_sight_promotion({'tourism': 'museum'}))
        self.assertFalse(has_sight_promotion({'tourism': 'music_school'}))
        self.assertFalse(has_sight_promotion({'tourism': 'drinking_water'}))

    def test_standalone_barrier_kinds_not_extracted(self):
        """barrier=gate is not extracted — no category for it (ADR 0023)."""
        tags = {'name': 'Test', 'barrier': 'gate'}
        self.assertEqual(category_for(tags), '')
        self.assertFalse(is_standalone_kind(tags))

    def test_named_towers_and_lighthouses_are_sights(self):
        """tower and lighthouse are extracted with the OSM value as kind."""
        for kind in ('tower', 'lighthouse'):
            with self.subTest(kind=kind):
                tags = {'name': 'Test', 'man_made': kind}
                self.assertEqual(category_for(tags), 'sights')
                self.assertTrue(is_standalone_kind(tags))
                self.assertEqual(get_kind(tags), kind)

    def test_man_made_bridge_not_extracted(self):
        """A bridge is linear, not a standalone place point (ADR 0023)."""
        tags = {'name': 'Test', 'man_made': 'bridge'}
        self.assertEqual(category_for(tags), '')
        self.assertFalse(is_standalone_kind(tags))

    def test_existing_categories_unchanged(self):
        self.assertEqual(
            category_for({'name': 'X', 'amenity': 'cafe'}), 'food'
        )
        self.assertEqual(
            category_for({'name': 'X', 'shop': 'clothes'}), 'shops'
        )
        self.assertEqual(
            category_for({'name': 'X', 'tourism': 'hotel'}), 'stay'
        )
        self.assertEqual(
            category_for({'name': 'X', 'amenity': 'pharmacy'}), 'essentials'
        )
        self.assertEqual(
            category_for({'name': 'X', 'tourism': 'museum'}), 'sights'
        )

    def test_tourism_information_not_extracted(self):
        """tourism=information is not extracted — too many non-sights (ADR 0023)."""
        tags = {'name': 'Summit Travel Agency', 'tourism': 'information'}
        self.assertEqual(category_for(tags), '')
        self.assertFalse(is_standalone_kind(tags))

    def test_is_standalone_kind_returns_true_for_extracted_kinds(self):
        self.assertTrue(is_standalone_kind({'historic': 'fort'}))
        self.assertTrue(is_standalone_kind({'tourism': 'viewpoint'}))
        self.assertTrue(is_standalone_kind({'amenity': 'fountain'}))
        self.assertTrue(is_standalone_kind({'man_made': 'tower'}))
        self.assertTrue(is_standalone_kind({'man_made': 'lighthouse'}))

    def test_is_standalone_kind_returns_false_for_gaps(self):
        """Gate, bridge and information remain category gaps (ADR 0023)."""
        self.assertFalse(is_standalone_kind({'barrier': 'gate'}))
        self.assertFalse(is_standalone_kind({'man_made': 'bridge'}))
        self.assertFalse(is_standalone_kind({'tourism': 'information'}))

    def test_is_standalone_kind_returns_false_for_regular_kinds(self):
        self.assertFalse(is_standalone_kind({'amenity': 'cafe'}))
        self.assertFalse(is_standalone_kind({'shop': 'clothes'}))
        self.assertFalse(is_standalone_kind({'tourism': 'hotel'}))


    def test_collect_facts_copies_standard_tags(self):
        tags = {
            'name:en': 'English Name',
            'name:sr-Latn': 'Srpsko Ime',
            'website': 'https://example.com',
            'opening_hours': 'Mo-Fr 09:00-18:00',
            'phone': '+382 20 123',
            'wheelchair': 'yes',
            'wikidata': 'Q123',
            'wikipedia': 'en:Example',
            'cuisine': 'serbian',
            'level': '2',
            'addr:street': 'Main St',
            'addr:housenumber': '1',
            'email': 'test@example.com',
        }
        facts = collect_facts(tags)
        for key, expected in tags.items():
            with self.subTest(key=key):
                self.assertEqual(facts[key], expected)

    def test_collect_facts_normalises_contact_phone(self):
        tags = {'contact:phone': '+382 20 999'}
        facts = collect_facts(tags)
        self.assertEqual(facts['phone'], '+382 20 999')

    def test_collect_facts_normalises_contact_website(self):
        tags = {'contact:website': 'https://contact.example.com'}
        facts = collect_facts(tags)
        self.assertEqual(facts['website'], 'https://contact.example.com')

    def test_collect_facts_normalises_contact_email(self):
        tags = {'contact:email': 'contact@example.com'}
        facts = collect_facts(tags)
        self.assertEqual(facts['email'], 'contact@example.com')

    def test_collect_facts_plain_key_takes_precedence(self):
        tags = {
            'phone': '+382 20 111',
            'contact:phone': '+382 20 222',
            'website': 'https://plain.com',
            'contact:website': 'https://contact.com',
            'email': 'plain@example.com',
            'contact:email': 'contact@example.com',
        }
        facts = collect_facts(tags)
        self.assertEqual(facts['phone'], '+382 20 111')
        self.assertEqual(facts['website'], 'https://plain.com')
        self.assertEqual(facts['email'], 'plain@example.com')

    def test_standalone_places_are_extracted(self):
        """Verify the fixture standalone points appear in the extract."""
        temporary = tempfile.TemporaryDirectory(
            prefix='cg-map-standalone-'
        )
        self.addCleanup(temporary.cleanup)
        root = prepared_root(Path(temporary.name))
        extract(root)
        _, features = source_features(root, 'places.geojson')
        place_ids = {f['properties']['id'] for f in features}
        # New standalone points from the fixture
        self.assertIn('node/1010', place_ids, 'monument extracted')
        self.assertIn('node/1011', place_ids, 'fountain extracted')
        self.assertIn('node/1012', place_ids, 'library extracted')
        self.assertIn('node/1013', place_ids, 'tower extracted')
        self.assertNotIn('node/1014', place_ids, 'gate not extracted')
        self.assertIn('node/1015', place_ids, 'place_of_worship extracted')
        self.assertIn('node/1017', place_ids, 'lighthouse extracted')

    def test_tower_and_lighthouse_are_published_as_sights(self):
        """Named man-made sights keep their OSM kind and standalone flag."""
        temporary = tempfile.TemporaryDirectory(prefix='cg-map-man-made-')
        self.addCleanup(temporary.cleanup)
        root = prepared_root(Path(temporary.name))
        extract(root)
        _, features = source_features(root, 'places.geojson')
        by_id = {f['properties']['id']: f for f in features}
        expected = (
            ('node/1013', 'tower'),
            ('node/1017', 'lighthouse'),
        )
        for place_id, kind in expected:
            with self.subTest(place_id=place_id):
                self.assertTrue(place_id in by_id, f'{place_id} missing from extract')
                properties = by_id[place_id]['properties']
                self.assertEqual(properties['category'], 'sights')
                self.assertEqual(properties['kind'], kind)
                self.assertTrue(properties['standalone'])

    def test_standalone_flag_set_outside_building(self):
        """Points outside buildings get standalone:true."""
        temporary = tempfile.TemporaryDirectory(
            prefix='cg-map-standalone-flag-'
        )
        self.addCleanup(temporary.cleanup)
        root = prepared_root(Path(temporary.name))
        extract(root)
        _, features = source_features(root, 'places.geojson')
        by_id = {f['properties']['id']: f for f in features}
        # node/1010 (monument at 42.441, 19.251) is outside building 2001
        monument = by_id.get('node/1010')
        self.assertIsNotNone(monument, 'monument should be extracted')
        self.assertTrue(
            monument['properties'].get('standalone'),
            'monument outside building should be standalone',
        )

    def test_place_inside_building_not_standalone(self):
        """node/1016 is inside building 2001; should NOT be standalone."""
        temporary = tempfile.TemporaryDirectory(
            prefix='cg-map-inside-building-'
        )
        self.addCleanup(temporary.cleanup)
        root = prepared_root(Path(temporary.name))
        extract(root)
        _, features = source_features(root, 'places.geojson')
        by_id = {f['properties']['id']: f for f in features}
        inside = by_id.get('node/1016')
        self.assertIsNotNone(inside, 'inside monument should be extracted')
        self.assertNotIn(
            'standalone', inside['properties'],
            'place inside building should not have standalone',
        )

    def test_new_facts_appear_in_extract(self):
        """Verify new fact tags are copied to the extract."""
        temporary = tempfile.TemporaryDirectory(
            prefix='cg-map-facts-'
        )
        self.addCleanup(temporary.cleanup)
        root = prepared_root(Path(temporary.name))
        extract(root)
        _, features = source_features(root, 'places.geojson')
        by_id = {f['properties']['id']: f for f in features}
        # node/1010 has name:en and wikidata
        monument = by_id.get('node/1010', {})
        props = monument.get('properties', {})
        self.assertEqual(props.get('name:en'), 'Test Monument')
        self.assertEqual(props.get('wikidata'), 'Q123')
        # node/1012 has contact:phone normalised to phone
        library = by_id.get('node/1012', {})
        l_props = library.get('properties', {})
        self.assertEqual(l_props.get('phone'), '+382 20 123 456')
        self.assertEqual(l_props.get('wheelchair'), 'yes')
        tower = by_id.get('node/1013', {})
        self.assertEqual(tower.get('properties', {}).get('name:sr-Latn'), 'Test Kula')
        # node/1015 has website and contact:email normalised to email
        church = by_id.get('node/1015', {})
        c_props = church.get('properties', {})
        self.assertEqual(c_props.get('website'), 'https://example.com')
        self.assertEqual(c_props.get('email'), 'info@example.com')
