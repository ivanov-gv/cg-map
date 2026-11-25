"""Command line for reproducible OSM extraction into reviewed source files."""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, replace
from pathlib import Path

import osmium

from . import ExtractionState
from .borders import BorderEdgesLayer, MunicipalitiesLayer
from .buildings import (
    BuildingGeometryLayer, BuildingsLayer, EntrancesLayer, RoadNameCollector
)
from .country import CountryLayer
from .identity import adopt_collection
from .land import LandLayer
from .neighbours import NeighbourCountriesLayer, NeighbourLandLayer
from .places import PlacesLayer
from .protected_areas import ProtectedAreasLayer
from .road_nodes import RoadNodesLayer
from .roads import RoadsLayer
from .settlement_areas import SettlementAreasLayer
from .settlements import SettlementsLayer
from .turn_restrictions import TurnRestrictionsLayer
from .water import WaterLayer
from .writing import read_collection, write_collection

DEFAULT_BBOX = (19.15, 42.37, 19.34, 42.51)
COVERAGE = (
    'Whole-city Podgorica detail; Montenegro major roads, attractions, '
    'settlements, municipality borders, country outline and water.'
)
# One selectable name owns every layer that contributes to a source file.
LAYER_GROUPS = {
    'buildings': (
        BuildingGeometryLayer, BuildingsLayer, RoadNameCollector,
        EntrancesLayer
    ),
    'roads': (RoadsLayer, RoadNodesLayer, TurnRestrictionsLayer),
    'land': (CountryLayer, LandLayer),
    'borders': (BorderEdgesLayer, MunicipalitiesLayer),
    'settlements': (SettlementsLayer, SettlementAreasLayer),
    'water': (WaterLayer,),
    # Always selected: the two context files and the ocean cut need one
    # derivation, even when only another group is regenerated.
    'neighbours': (NeighbourCountriesLayer, NeighbourLandLayer),
    'places': (BuildingGeometryLayer, PlacesLayer),
    'protected-areas': (ProtectedAreasLayer,),
}
# Country geometry is finalised before borders clip municipalities to land;
# settlements then use those areas to assign their municipality. Water and
# places finish last with the reviewed outline and building footprints.
FINISH_ORDER = (
    'buildings', 'roads', 'land', 'borders', 'neighbours', 'settlements',
    'water', 'places', 'protected-areas'
)
INDEPENDENT_PROVENANCE = frozenset({
    'places.geojson', 'transport-stops.geojson'
})


@dataclass(frozen=True)
class Options:
    """Inputs and policy shared by every layer during one extraction."""

    detail_bbox: tuple
    all_details: bool
    all_places: bool
    sources_directory: Path
    source_url: str
    source_date: str
    source_timestamp: str
    uses_fresh_country: bool

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

    def relation(self, relation):
        for layer in self.layers:
            if hasattr(layer, 'relation'):
                layer.relation(relation, self.options, self.state)


class RelationHandler(osmium.SimpleHandler):
    """Second pass that dispatches relations to layers that need them."""

    def __init__(self, layers, options, state):
        super().__init__()
        self.layers = layers
        self.options = options
        self.state = state

    def relation(self, relation):
        for layer in self.layers:
            if hasattr(layer, 'relation'):
                layer.relation(relation, self.options, self.state)


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
        '--source-url', required=True,
        help='URL of the input PBF download; recorded verbatim in provenance.'
    )
    parser.add_argument(
        '--source-date', required=True,
        help='Date the input PBF was downloaded; recorded in provenance.'
    )
    parser.add_argument(
        '--source-timestamp',
        help=(
            'Override the PBF replication timestamp, '
            'for fixtures without one.'
        )
    )
    parser.add_argument(
        '--accept-new-place-facts', action='store_true',
        help=(
            'Accept changed place facts after review and update their '
            'provenance; without it the extractor leaves place provenance '
            'for a separate review.'
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


def read_provenance(root):
    """Read the reviewed provenance record from a repository root."""
    path = root / 'data/sources/provenance.json'
    return json.loads(path.read_text(encoding='utf-8'))


def require_reviewed_input(root, input_hash):
    """Refuse a partial run whose PBF is not the one behind the sources."""
    expected = read_provenance(root).get('input_pbf_sha256')
    if input_hash != expected:
        raise ValueError(
            f'Partial --layers extraction requires the reviewed PBF '
            f'(SHA-256 {expected}); got {input_hash}. '
            'Run a full extract first.'
        )


def adopt_static_files(sources_directory):
    """Adopt preserved snapshots once and return their filenames."""
    context_path = sources_directory / 'context-countries.geojson'
    context = adopt_collection(
        read_collection(context_path), lambda feature: f'ne:{feature["id"]}'
    )
    write_collection(context_path, context['features'])
    stops_path = sources_directory / 'transport-stops.geojson'
    stops = adopt_collection(
        read_collection(stops_path),
        lambda feature: f'epodgorica:{feature["properties"]["stopId"]}'
    )
    write_collection(stops_path, stops['features'])
    provenance_path = sources_directory / 'transport-stops.provenance.json'
    provenance = json.loads(provenance_path.read_text(encoding='utf-8'))
    bytes_of_stops = stops_path.read_bytes()
    provenance['bytes'] = len(bytes_of_stops)
    provenance['sha256'] = hashlib.sha256(bytes_of_stops).hexdigest()
    provenance_path.write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + '\n',
        encoding='utf-8'
    )
    return [context_path.name, stops_path.name]


def count_features(source_bytes):
    """Count features or restrictions in a source file."""
    data = json.loads(source_bytes)
    if 'features' in data:
        return len(data['features'])
    if 'restrictions' in data:
        return len(data['restrictions'])
    return 0


def layer_checksum(root, filename):
    """Return the reviewed inventory entry for one generated source file."""
    source_bytes = (root / 'data/sources' / filename).read_bytes()
    return {
        'features': count_features(source_bytes),
        'bytes': len(source_bytes),
        'sha256': hashlib.sha256(source_bytes).hexdigest(),
    }


def updated_provenance(root, options, filenames, input_hash, is_partial, details=None):
    """Update generated file inventory; full runs also record their input."""
    provenance = read_provenance(root)
    if not is_partial:
        provenance['layers'].pop('places.geojson', None)
    for filename in filenames:
        if filename in INDEPENDENT_PROVENANCE:
            # These have their own provenance fields, not a layer checksum.
            continue
        provenance['layers'][filename] = layer_checksum(root, filename)
    if details:
        provenance['building_details'] = {
            **provenance.get('building_details', {}), **details
        }
    if not is_partial:
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
    provenance_path = root / 'data/sources/provenance.json'
    # UTF-8 like the relief build, which writes the same file: escaping would rewrite its © notices on every run.
    provenance_path.write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2, sort_keys=True) + '\n',
        encoding='utf-8'
    )


def apply_visibility(root, accept_new_place_facts):
    """Reapply the reviewed policy, refusing overrides for vanished places."""
    script = (
        Path(__file__).resolve().parents[1] / 'apply-place-visibility.mjs'
    )
    command = [
        'node', str(script), '--root', str(root),
        '--contracts-directory', str(root / 'packages/contracts')
    ]
    if accept_new_place_facts:
        command.extend(['--update-provenance', '--accept-new-facts'])
    subprocess.run(command, check=True)


def finish_layers(group_layers, selected_groups, options, state):
    """Finalise selected groups in the order their shared geometry requires."""
    for group in FINISH_ORDER:
        if group not in selected_groups:
            continue
        for layer in group_layers[group]:
            layer.features = layer.finish(options, state)


def write_layer_files(layers, sources_directory, filenames):
    """Write each finished source file from its contributing layers.

    Handles both GeoJSON feature lists and non-GeoJSON structured output
    (e.g., turn-restrictions.json returns a dict from finish()).
    """
    for filename in sorted(filenames):
        owning_layers = [
            layer for layer in layers if layer.filename == filename
        ]
        first_result = owning_layers[0].features
        if isinstance(first_result, dict):
            # Non-GeoJSON structured output: one record per line, sorted keys.
            output_path = sources_directory / filename
            restrictions = sorted(
                first_result.get('restrictions', []),
                key=lambda restriction: restriction.get('entityId', '')
            )
            lines = [
                json.dumps(
                    restriction, ensure_ascii=False, sort_keys=True,
                    separators=(',', ':')
                )
                for restriction in restrictions
            ]
            text = (
                '{"entitySchemaVersion":1,"restrictions":[\n'
                + ',\n'.join(lines)
                + '\n]}\n'
            )
            output_path.write_text(text, encoding='utf-8')
            size = output_path.stat().st_size
            print(f'{filename} {len(restrictions)} restrictions bytes={size}')
        else:
            # GeoJSON features from all layers sharing this filename
            features = [
                feature
                for layer in owning_layers
                for feature in layer.features
            ]
            write_collection(sources_directory / filename, features)
            size = (sources_directory / filename).stat().st_size
            print(f'{filename} {len(features)} bytes={size}')


def stage_repository(root, staging_root, sources_directory):
    """Copy the inputs a run may read into a disposable repository shape."""
    staged_sources = staging_root / 'data/sources'
    shutil.copytree(sources_directory, staged_sources)
    shutil.copytree(
        root / 'packages/contracts', staging_root / 'packages/contracts'
    )
    return staged_sources


def discard_publication_staging(prepared):
    """Remove sibling staging files left by a publication attempt."""
    for _, temporary in prepared:
        temporary.unlink(missing_ok=True)


def prepare_publication_files(staged_sources, sources_directory, filenames):
    """Copy owned outputs beside their destinations without replacing sources."""
    prepared = []
    try:
        for filename in sorted(filenames):
            destination = sources_directory / filename
            temporary = destination.with_name(f'{destination.name}.new')
            prepared.append((destination, temporary))
            shutil.copyfile(staged_sources / filename, temporary)
    except Exception:
        discard_publication_staging(prepared)
        raise
    return prepared


def replace_file(source, destination):
    """Move one sibling file onto its destination atomically."""
    os.replace(source, destination)


def restore_publication(backups, created):
    """Undo replacements after a late publication failure."""
    for destination in created:
        destination.unlink(missing_ok=True)
    for destination, backup in backups.items():
        replace_file(backup, destination)


def publish_sources(staged_sources, sources_directory, filenames):
    """Publish owned files atomically, restoring originals if a later file fails."""
    prepared = prepare_publication_files(
        staged_sources, sources_directory, filenames
    )
    backups = {}
    created = set()
    try:
        for destination, temporary in prepared:
            if destination.exists():
                backup = destination.with_name(f'{destination.name}.old')
                shutil.copy2(destination, backup)
                backups[destination] = backup
            else:
                created.add(destination)
            replace_file(temporary, destination)
    except Exception:
        restore_publication(backups, created)
        raise
    else:
        for backup in backups.values():
            backup.unlink()
    finally:
        discard_publication_staging(prepared)


def run(args):
    """Extract selected groups, then replace only the files they own."""
    root = args.root.resolve()
    sources_directory = root / 'data/sources'
    sources_directory.mkdir(parents=True, exist_ok=True)
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
    is_partial = args.layers is not None
    requested_groups = set(args.layers or LAYER_GROUPS)
    selected_groups = requested_groups | {'neighbours'}
    if is_partial:
        require_reviewed_input(root, input_hash)
    options = Options(
        detail_bbox=tuple(args.detail_bbox),
        all_details=args.all_details,
        all_places=args.all_places,
        sources_directory=sources_directory,
        source_url=args.source_url,
        source_date=args.source_date,
        source_timestamp=timestamp,
        uses_fresh_country=not is_partial or 'land' in requested_groups,
    )
    group_layers = {
        name: [layer_class() for layer_class in layer_classes]
        for name, layer_classes in LAYER_GROUPS.items()
    }
    layers = [
        layer for group in group_layers.values() for layer in group
    ]
    layer_filenames = {
        layer.filename
        for name in selected_groups
        for layer in group_layers[name]
        if layer.filename
    }
    written_filenames = set(layer_filenames)
    if not is_partial:
        written_filenames.update((
            'context-countries.geojson', 'transport-stops.geojson'
        ))
    published_filenames = set(written_filenames)
    published_filenames.add('provenance.json')
    if 'places.geojson' in written_filenames:
        published_filenames.add('place-visibility-policy.json')
    if not is_partial:
        published_filenames.add('transport-stops.provenance.json')

    state = ExtractionState()
    with tempfile.TemporaryDirectory(prefix='cg-map-extract-') as directory:
        staging_root = Path(directory)
        staged_sources = stage_repository(
            root, staging_root, sources_directory
        )
        staged_options = replace(
            options, sources_directory=staged_sources
        )
        handler = ExtractHandler(layers, staged_options, state)
        handler.apply_file(str(input_path), locations=True, idx='flex_mem')
        if not is_partial:
            # Land appends the preserved context, so adopt it first.
            adopt_static_files(staged_sources)
        finish_layers(
            group_layers, selected_groups, staged_options, state
        )
        # Neighbours also owns land.geojson, so writing every layer here would
        # publish unselected country and green areas alongside the context.
        selected_layers = [
            layer for group in FINISH_ORDER if group in selected_groups
            for layer in group_layers[group]
        ]
        write_layer_files(selected_layers, staged_sources, layer_filenames)
        if 'places.geojson' in layer_filenames:
            apply_visibility(
                staging_root, args.accept_new_place_facts
            )
        detail_groups = {'buildings', 'places'} & selected_groups
        details = dict(state.building_counts) if detail_groups else None
        updated_provenance(
            staging_root, staged_options, written_filenames, input_hash,
            is_partial, details
        )
        publish_sources(
            staged_sources, sources_directory, published_filenames
        )


def main(argv=None):
    """Run the CLI and return a process exit code."""
    run(parse_args(argv))
    return 0
