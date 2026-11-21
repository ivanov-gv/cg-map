"""Command line for reproducible OSM extraction into reviewed source files."""

import argparse
import hashlib
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import osmium

from . import ExtractionState
from .buildings import BuildingsLayer
from .country import CountryLayer
from .identity import adopt_collection
from .land import LandLayer
from .places import PlacesLayer
from .roads import RoadsLayer
from .water import WaterLayer
from .writing import read_collection, write_collection

DEFAULT_BBOX = (19.15, 42.37, 19.34, 42.51)
DEFAULT_SOURCE_URL = (
    'https://download.geofabrik.de/europe/montenegro/'
    'montenegro-latest.osm.pbf'
)
DEFAULT_SOURCE_DATE = '2026-11-21'
COVERAGE = (
    'Whole-city Podgorica detail; Montenegro major roads, attractions, '
    'country outline and water.'
)
# One selectable name owns every layer that contributes to a source file.
LAYER_GROUPS = {
    'buildings': (BuildingsLayer,),
    'roads': (RoadsLayer,),
    'land': (CountryLayer, LandLayer),
    'water': (WaterLayer,),
    'places': (PlacesLayer,),
}


@dataclass(frozen=True)
class Options:
    """Inputs and policy shared by every layer during one extraction."""

    detail_bbox: tuple
    all_details: bool
    all_places: bool
    sources_dir: Path
    source_url: str
    source_date: str
    source_timestamp: str

    def contains(self, longitude, latitude):
        """Report whether a WGS84 coordinate lies in the detail box."""
        west, south, east, north = self.detail_bbox
        return west <= longitude <= east and south <= latitude <= north


class ExtractHandler(osmium.SimpleHandler):
    """Dispatch one OSM pass to each layer module's declared handlers."""

    def __init__(self, layers, options, state):
        super().__init__()
        self.layers = layers
        self.options = options
        self.state = state

    def node(self, node):
        for layer in self.layers:
            layer.node(node, self.options, self.state)

    def way(self, way):
        for layer in self.layers:
            layer.way(way, self.options, self.state)

    def area(self, area):
        for layer in self.layers:
            layer.area(area, self.options, self.state)


def parse_args(argv=None):
    """Parse the documented extractor CLI and its source options."""
    parser = argparse.ArgumentParser(
        description=(
            'Small OSM display extractor; not a full cartographic pipeline.'
        )
    )
    parser.add_argument('input_pbf')
    parser.add_argument(
        '--all-details', action='store_true',
        help=(
            'Include roads and buildings beyond the local detail box; '
            'increases build cost.'
        )
    )
    parser.add_argument(
        '--all-places', action='store_true',
        help='Include supported named place categories throughout the extract.'
    )
    parser.add_argument(
        '--detail-bbox', nargs=4, type=float, default=list(DEFAULT_BBOX),
        metavar=('WEST', 'SOUTH', 'EAST', 'NORTH')
    )
    parser.add_argument(
        '--layers', nargs='+', choices=sorted(LAYER_GROUPS),
        help='Regenerate only the source files owned by these groups.'
    )
    parser.add_argument(
        '--root', type=Path, default=Path(__file__).resolve().parents[3],
        help='Repository root holding data/sources and the visibility policy.'
    )
    parser.add_argument(
        '--source-url', default=DEFAULT_SOURCE_URL,
        help='URL of the input PBF download.'
    )
    parser.add_argument(
        '--source-date', default=DEFAULT_SOURCE_DATE,
        help='Date the input PBF was downloaded.'
    )
    parser.add_argument(
        '--source-timestamp',
        help=(
            'Override the PBF replication timestamp, '
            'for fixtures without one.'
        )
    )
    return parser.parse_args(argv)


def sha256_file(path):
    """Hash the original input without keeping it in Git."""
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def adopt_static_files(sources_dir):
    """Adopt preserved snapshots once and return their filenames."""
    context_path = sources_dir / 'context-countries.geojson'
    context = adopt_collection(
        read_collection(context_path), lambda feature: f'ne:{feature["id"]}'
    )
    write_collection(context_path, context['features'])
    stops_path = sources_dir / 'transport-stops.geojson'
    stops = adopt_collection(
        read_collection(stops_path),
        lambda feature: f'epodgorica:{feature["properties"]["stopId"]}'
    )
    write_collection(stops_path, stops['features'])
    provenance_path = sources_dir / 'transport-stops.provenance.json'
    provenance = json.loads(provenance_path.read_text(encoding='utf-8'))
    bytes_of_stops = stops_path.read_bytes()
    provenance['bytes'] = len(bytes_of_stops)
    provenance['sha256'] = hashlib.sha256(bytes_of_stops).hexdigest()
    provenance_path.write_text(
        json.dumps(provenance, indent=2) + '\n', encoding='utf-8'
    )
    return [context_path.name, stops_path.name]


INDEPENDENT_PROVENANCE = frozenset({
    'places.geojson', 'transport-stops.geojson'
})


def updated_provenance(root, options, filenames, input_hash):
    """Update reviewed files written by this run, plus input metadata."""
    provenance_path = root / 'data/sources/provenance.json'
    provenance = json.loads(provenance_path.read_text(encoding='utf-8'))
    provenance['layers'].pop('places.geojson', None)
    for filename in filenames:
        if filename in INDEPENDENT_PROVENANCE:
            # These have their own provenance fields, not a layer checksum.
            continue
        path = root / 'data/sources' / filename
        source_bytes = path.read_bytes()
        provenance['layers'][filename] = {
            'features': len(json.loads(source_bytes)['features']),
            'bytes': len(source_bytes),
            'sha256': hashlib.sha256(source_bytes).hexdigest(),
        }
    provenance.update({
        'export_date': options.source_date,
        'upstream_snapshot': options.source_timestamp,
        'coverage': COVERAGE,
        'input_url': options.source_url,
        'input_date': options.source_date,
        'input_pbf_sha256': input_hash,
        'detail_bbox': list(options.detail_bbox),
        'extract_flags': {
            'all_details': options.all_details,
            'all_places': options.all_places,
            'layers': sorted(filenames),
        },
    })
    provenance_path.write_text(
        json.dumps(provenance, indent=2) + '\n', encoding='utf-8'
    )


def write_metadata(root, options, filenames, input_hash):
    """Record deterministic run parameters beside the source files."""
    files = {}
    for filename in sorted(filenames):
        source_bytes = (root / 'data/sources' / filename).read_bytes()
        files[filename] = {
            'features': len(json.loads(source_bytes)['features']),
            'bytes': len(source_bytes),
            'sha256': hashlib.sha256(source_bytes).hexdigest(),
        }
    metadata = {
        'source_url': options.source_url,
        'source_date': options.source_date,
        'input_pbf_sha256': input_hash,
        'source_timestamp': options.source_timestamp,
        'detail_bbox': list(options.detail_bbox),
        'extract_flags': {
            'all_details': options.all_details,
            'all_places': options.all_places,
        },
        'files': files,
    }
    (root / 'data/sources/extract-metadata.json').write_text(
        json.dumps(metadata, indent=2) + '\n', encoding='utf-8'
    )


def apply_visibility(root):
    """Reapply the reviewed policy, refusing overrides for vanished places."""
    script = (
        Path(__file__).resolve().parents[1] / 'apply-place-visibility.mjs'
    )
    subprocess.run(
        [
            'node', str(script), '--root', str(root),
            '--update-provenance', '--accept-new-facts'
        ],
        check=True
    )


def run(args):
    """Extract selected groups and replace only the files they own."""
    root = args.root.resolve()
    sources_dir = root / 'data/sources'
    sources_dir.mkdir(parents=True, exist_ok=True)
    input_path = Path(args.input_pbf).resolve()
    input_hash = sha256_file(input_path)
    timestamp = args.source_timestamp or osmium.io.Reader(
        str(input_path)
    ).header().get('osmosis_replication_timestamp')
    if not timestamp:
        raise ValueError(
            'Input has no replication timestamp; '
            'pass --source-timestamp to record one.'
        )
    options = Options(
        detail_bbox=tuple(args.detail_bbox),
        all_details=args.all_details,
        all_places=args.all_places,
        sources_dir=sources_dir,
        source_url=args.source_url,
        source_date=args.source_date,
        source_timestamp=timestamp,
    )
    state = ExtractionState()
    group_layers = {
        name: [layer_class(options) for layer_class in layer_classes]
        for name, layer_classes in LAYER_GROUPS.items()
    }
    layers = [
        layer for group in group_layers.values() for layer in group
    ]
    handler = ExtractHandler(layers, options, state)
    handler.apply_file(str(input_path), locations=True, idx='flex_mem')

    selected = set(args.layers or LAYER_GROUPS)
    layer_filenames = {
        layer.filename
        for name in selected
        for layer in group_layers[name]
    }
    written_filenames = set(layer_filenames)
    if not args.layers:
        # LandLayer copies context into land.geojson, so adopt static files
        # before any layer finishes.
        written_filenames.update(adopt_static_files(sources_dir))
    for layer in layers:
        layer.features = layer.finish(options, state)

    for filename in sorted(layer_filenames):
        features = [
            feature
            for layer in layers
            if layer.filename == filename
            for feature in layer.features
        ]
        write_collection(sources_dir / filename, features)
        size = (sources_dir / filename).stat().st_size
        print(f'{filename} {len(features)} bytes={size}')
    if 'places.geojson' in layer_filenames:
        apply_visibility(root)
    updated_provenance(root, options, written_filenames, input_hash)
    write_metadata(root, options, written_filenames, input_hash)


def main(argv=None):
    """Run the CLI and return a process exit code."""
    run(parse_args(argv))
    return 0
