"""Assemble and publish the five deterministic relief source collections."""

import hashlib
import json
import os
from pathlib import Path

from . import derivations
from .sources import TerrainModel, read_geojson, read_osm, sha256_file
from .terrain import serialize_collection

ROOT = Path(__file__).resolve().parents[3]
DETAIL_BOUNDS = (19.15, 42.37, 19.34, 42.51)
OSM_SHA256 = '70de54274bad52be8452852995f34280b5cbf37f2bbb207dcf56cb90410a3a5b'
REPORT_PATH = '.build/relief-report.json'
MAX_CONTOUR_BYTES = 5_000_000
OUTPUT_NAMES = (
    'contours.geojson',
    'summits.geojson',
    'slopes.geojson',
    'ridges.geojson',
    'canyon-rims.geojson',
)
TOOL_FILES = (
    'data/tools/build-relief.py',
    'data/tools/relief/__init__.py',
    'data/tools/relief/build.py',
    'data/tools/relief/derivations.py',
    'data/tools/relief/sources.py',
    'data/tools/relief/terrain.py',
)


def _default_paths():
    return {
        'dem': Path(os.environ.get('RELIEF_DEM_DIR', Path.home() / '.cache/cg-map/dem')),
        'osm': Path(os.environ.get('RELIEF_OSM_PATH', Path.home() / '.cache/cg-map/montenegro-2026-11-21.osm.pbf')),
    }


def _sha256_bytes(payload):
    return hashlib.sha256(payload).hexdigest()


def _canonical_json(value):
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n'


def _input_record(root, paths, osm_sha256):
    dem_directory = paths['dem']
    tile_hashes = {}
    for line in (dem_directory / 'SHA256SUMS').read_text(encoding='utf8').splitlines():
        digest, filename = line.split()
        tile_hashes[filename] = digest
    return {
        'dem': {
            'bucket': derivations.LICENSE_BLOCK['bucket'],
            'directory': str(dem_directory),
            'tiles': tile_hashes,
            'sha256OfChecksumList': _sha256_bytes((dem_directory / 'SHA256SUMS').read_bytes()),
        },
        'osm': {
            'path': str(paths['osm']),
            'sha256': osm_sha256,
        },
        'reviewedSources': {
            name: sha256_file(root / 'data/sources' / name)
            for name in ('land.geojson', 'water.geojson')
        },
        'contracts': {
            'editor-layers.json': sha256_file(root / 'packages/contracts/editor-layers.json')
        },
        'tools': {
            name: sha256_file(root / name) for name in TOOL_FILES
        },
    }


def build(root=ROOT, paths=None, osm_sha256=None):
    """Return the generated sources, report and provenance entry; never writes files."""
    root = Path(root).resolve()
    paths = paths or _default_paths()
    osm_sha256 = osm_sha256 or os.environ.get('RELIEF_OSM_SHA256', OSM_SHA256)
    sources_directory = root / 'data/sources'
    land = read_geojson(sources_directory / 'land.geojson')
    water = read_geojson(sources_directory / 'water.geojson')
    inputs = _input_record(root, paths, osm_sha256)

    with TerrainModel(paths['dem']) as model:
        grid = model.detail_grid(DETAIL_BOUNDS)
        osm = read_osm(paths['osm'], osm_sha256, DETAIL_BOUNDS)
        contours, contour_report = derivations.build_contours(grid)
        summits, summit_report = derivations.build_summits(model, osm, land, contours)
        slopes, slope_report = derivations.build_slopes(
            grid, land, derivations.GREEN_KINDS, DETAIL_BOUNDS
        )
        ridges, ridge_report = derivations.build_ridges(grid, summits)
        canyon_rims, rim_report = derivations.build_canyon_rims(
            model, water, osm['cliffs'], DETAIL_BOUNDS
        )

    collections = {
        'contours.geojson': contours,
        'summits.geojson': summits,
        'slopes.geojson': slopes,
        'ridges.geojson': ridges,
        'canyon-rims.geojson': canyon_rims,
    }
    outputs = {
        name: serialize_collection(features).encode('utf8')
        for name, features in collections.items()
    }
    if len(outputs['contours.geojson']) > MAX_CONTOUR_BYTES:
        raise ValueError(
            f'contours.geojson is {len(outputs["contours.geojson"])} bytes, '
            f'above the {MAX_CONTOUR_BYTES}-byte limit'
        )
    report = {
        'schemaVersion': 1,
        'detailBounds': list(DETAIL_BOUNDS),
        'osmSnapshot': osm['timestamp'],
        'inputs': inputs,
        'license': derivations.LICENSE_BLOCK,
        'contours': contour_report,
        'summits': summit_report,
        'slopes': slope_report,
        'ridges': ridge_report,
        'canyonRims': rim_report,
        'layers': {
            name: {
                'features': len(features),
                'bytes': len(outputs[name]),
                'sha256': _sha256_bytes(outputs[name]),
            }
            for name, features in collections.items()
        },
    }
    report_bytes = _canonical_json(report).encode('utf8')
    return {**outputs, 'relief-report.json': report_bytes}


def _updated_provenance(provenance, outputs, report_bytes):
    updated = json.loads(json.dumps(provenance))
    for name in OUTPUT_NAMES:
        payload = outputs[name]
        updated['layers'][name] = {
            'features': len(json.loads(payload)['features']),
            'bytes': len(payload),
            'sha256': _sha256_bytes(payload),
        }
    report = json.loads(report_bytes)
    updated['relief'] = {
        'reportFile': REPORT_PATH,
        'reportBytes': len(report_bytes),
        'reportSha256': _sha256_bytes(report_bytes),
        'detailBounds': report['detailBounds'],
        'osmSnapshot': report['osmSnapshot'],
        'inputs': report['inputs'],
        'license': report['license'],
        'summary': {
            'contourFeatures': report['contours']['features'],
            'summitFeatures': report['summits']['features'],
            'summitHeightChecks': report['summits']['heightCheckCounts'],
            'summitsOutsideCountry': report['summits']['summitsOutsideCountry'],
            'slopeFeatures': report['slopes']['features'],
            'greenKindsPresentInLand': report['slopes']['presentGreenKindsInLand'],
            'ridgeFeatures': report['ridges']['features'],
            'canyonRimFeatures': sum(
                entry['features'] for entry in report['canyonRims']['riverBanks']
            ),
            'contourCrossingPairs': report['contours']['crossingPairs'],
        },
    }
    return _canonical_json(updated).encode('utf8')


def write_outputs(root=ROOT, outputs=None):
    """Write the five reviewed sources, the temporary report and their provenance entry."""
    root = Path(root).resolve()
    outputs = outputs or build(root)
    sources_directory = root / 'data/sources'
    provenance_path = sources_directory / 'provenance.json'
    provenance = json.loads(provenance_path.read_text(encoding='utf8'))
    provenance_bytes = _updated_provenance(provenance, outputs, outputs['relief-report.json'])
    report_path = root / REPORT_PATH
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_bytes(outputs['relief-report.json'])
    for name in OUTPUT_NAMES:
        (sources_directory / name).write_bytes(outputs[name])
    provenance_path.write_bytes(provenance_bytes)
    return outputs


def main(argv=None):
    """Print a short, deterministic build summary after writing the relief sources."""
    outputs = write_outputs()
    report = json.loads(outputs['relief-report.json'])
    checks = report['summits']['heightCheckCounts']
    rim_parts = sum(entry['features'] for entry in report['canyonRims']['riverBanks'])
    print(
        f'Relief: {report["contours"]["features"]} contour lines, '
        f'{report["summits"]["features"]} Montenegro summits '
        f'({checks["ok"]} ok, {checks["mismatch"]} mismatch, {checks["missing"]} missing), '
        f'{report["slopes"]["features"]} slope polygons, '
        f'{report["ridges"]["features"]} ridge lines, {rim_parts} canyon-rim segments.'
    )
    print(f'Report: {REPORT_PATH} ({len(outputs["relief-report.json"])} bytes)')
    return 0
