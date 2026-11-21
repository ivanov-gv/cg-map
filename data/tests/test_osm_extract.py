"""Reproducibility and source identity checks for the OSM extractor."""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TOOLS = ROOT / 'data/tools'
SOURCES = ROOT / 'data/sources'
sys.path.insert(0, str(TOOLS))

from osm_extract.writing import serialize_collection  # noqa: E402

FIXTURE = ROOT / 'data/tests/fixtures/osm-extract-simple.osm'
SNAPSHOT_TIME = '2026-11-20T21:21:21Z'
REQUIRED_SOURCES = (
    'context-countries.geojson',
    'transport-stops.geojson',
    'transport-stops.provenance.json',
    'provenance.json',
    'place-visibility-policy.json',
)
GENERATED_FILES = (
    'buildings.geojson',
    'context-countries.geojson',
    'extract-metadata.json',
    'land.geojson',
    'places.geojson',
    'provenance.json',
    'roads.geojson',
    'transport-stops.geojson',
    'transport-stops.provenance.json',
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
    'buildings.geojson', 'building-labels.geojson',
    'context-countries.geojson', 'land.geojson', 'places.geojson',
    'roads.geojson', 'transport-stops.geojson', 'water.geojson',
)
LAYER_FILES = {
    'buildings': ('buildings.geojson',),
    'roads': ('roads.geojson',),
    'land': ('land.geojson',),
    'water': ('water.geojson',),
    'places': ('places.geojson',),
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
    """Build a disposable repository shape with the static snapshots."""
    root = Path(directory)
    sources = root / 'data/sources'
    contracts = root / 'packages/contracts'
    sources.mkdir(parents=True)
    contracts.mkdir(parents=True)
    for name in REQUIRED_SOURCES:
        shutil.copy2(SOURCES / name, sources / name)
    policy = ROOT / 'packages/contracts/place-visibility.json'
    shutil.copy2(policy, contracts / 'place-visibility.json')
    return root


def extract(root, layers=None):
    """Run the reviewed entry point against the tiny OSM fixture."""
    command = [
        sys.executable, str(TOOLS / 'extract-osm.py'), str(FIXTURE),
        '--root', str(root), '--source-timestamp', SNAPSHOT_TIME,
    ]
    if layers:
        command.extend(['--layers', *layers])
    environment = dict(os.environ, PYTHONPATH=str(TOOLS))
    subprocess.run(
        command, check=True, env=environment, stdout=subprocess.DEVNULL
    )


def source_features(root, filename):
    """Read one generated collection with its schema version."""
    text = (root / 'data/sources' / filename).read_text(encoding='utf-8')
    collection = json.loads(text)
    return collection['entitySchemaVersion'], collection['features']


def coordinate_values(value):
    """Yield every number inside a GeoJSON coordinate structure."""
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from coordinate_values(item)
    else:
        yield value


def node_serialization(filename):
    """Serialize one reviewed source with the shared Node writer."""
    result = subprocess.run(
        [
            'node', '--input-type=module', '-e', NODE_WRITER, filename
        ],
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
                    (
                        self.first_root / 'data/sources' / name
                    ).read_bytes(),
                    (
                        self.second_root / 'data/sources' / name
                    ).read_bytes(),
                )

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
            ('way/2001', None): 5,
            ('way/2003', None): 4,
            ('way/2005', None): 11,
            ('way/2006', 0): 12,
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
        baseline = {
            name: (self.first_root / 'data/sources' / name).read_bytes()
            for name in GENERATED_GEOJSON
        }
        for group, filenames in LAYER_FILES.items():
            with self.subTest(group=group):
                root = prepared_root(self.temporary_path / group)
                sources = root / 'data/sources'
                preserved = ('context-countries.geojson',)
                if group == 'water':
                    preserved += ('land.geojson',)
                marker = b'not regenerated by this run\n'
                for name in GENERATED_GEOJSON:
                    contents = (
                        baseline[name] if name in preserved else marker
                    )
                    (sources / name).write_bytes(contents)
                extract(root, layers=[group])
                for name in GENERATED_GEOJSON:
                    with self.subTest(group=group, name=name):
                        if name in filenames:
                            expected = baseline[name]
                        elif name in preserved:
                            expected = baseline[name]
                        else:
                            expected = marker
                        self.assertEqual(
                            (sources / name).read_bytes(), expected
                        )


if __name__ == '__main__':
    unittest.main()
