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

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'data/tools'
SOURCES = ROOT / 'data/sources'
sys.path.insert(0, str(TOOLS))

# These imports need osmium (pinned in data/tools/requirements.txt).
# Guard them so the test module loads even without the venv.
try:
    from osm_extract import cli  # noqa: E402
    from osm_extract.identity import content_version  # noqa: E402
    from osm_extract.roads import classify_path, road_level  # noqa: E402
    from osm_extract.writing import serialize_collection  # noqa: E402
    HAS_OSMIUM = True
except ImportError:
    HAS_OSMIUM = False
    cli = None  # type: ignore[assignment]
    content_version = None  # type: ignore[assignment]
    classify_path = None  # type: ignore[assignment]
    road_level = None  # type: ignore[assignment]
    serialize_collection = None  # type: ignore[assignment]

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


def node_serialization(filename):
    """Serialize one reviewed source with the shared Node writer."""
    result = subprocess.run(
        ['node', '--input-type=module', '-e', NODE_WRITER, filename],
        cwd=ROOT, check=True, capture_output=True
    )
    return result.stdout.decode('utf-8')


@unittest.skipUnless(HAS_OSMIUM, 'osmium not installed')
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

    def test_coordinates_use_reviewed_precision(self):
        extract(self.first_root)
        for name in EXTRACTED_GEOJSON:
            with self.subTest(name=name):
                _, features = source_features(self.first_root, name)
                for feature in features:
                    coordinates = feature['geometry']['coordinates']
                    for number in coordinate_values(coordinates):
                        self.assertEqual(number, round(number, 6))

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
        details = json.loads(
            (self.first_root / 'data/sources/provenance.json').read_text()
        )['building_details']
        self.assertEqual(details['placesInsideBuildings'], 2)
        self.assertEqual(details['placesOutsideBuildings'], 3)

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


@unittest.skipUnless(HAS_OSMIUM, 'osmium not installed')
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

    def test_unpaved_footway_is_none(self):
        # footway without surface is not classified
        self.assertIsNone(
            classify_path({'highway': 'footway'}),
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


@unittest.skipUnless(HAS_OSMIUM, 'osmium not installed')
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


if __name__ == '__main__':
    unittest.main()
