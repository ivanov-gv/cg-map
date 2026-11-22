"""GIS topology checks for the shared municipality border sources."""

import json
from itertools import combinations
from pathlib import Path

from shapely.geometry import LineString, shape
from shapely.ops import unary_union

from geo_area import (
    EXTRA_AREA_TOLERANCE_SQM, MISSING_AREA_TOLERANCE_SQM,
    SQUARE_DEGREES_TO_SQUARE_METRES,
)
from osm_extract.shared_edges import (
    OSM_ONLY_AUTHORITIES, edge_lines, ordered_edge_references,
    rebuild_municipality
)

EDGE_FILE = 'border-edges.geojson'
MUNICIPALITY_FILE = 'municipalities.geojson'
LAND_FILE = 'land.geojson'
SETTLEMENT_FILE = 'settlements.geojson'
CONTEXT_FILE = 'context-countries.geojson'
MUNICIPALITY_PREFIX = 'ME-'
INSIDE_COUNTRY = 'ME'
SEA = 'sea'

OVERLAP_AREA_TOLERANCE = 1e-10
RECONSTRUCTION_AREA_TOLERANCE = 1e-10
MAX_COMBINED_BYTES = 5 * 1024 * 1024


def read_collection(path):
    """Read one reviewed GeoJSON collection from disk."""
    return json.loads(Path(path).read_text(encoding='utf-8'))


def polygons_in(collection, label):
    """Return valid, positive-area polygons from one source collection."""
    polygons = []
    for index, feature in enumerate(collection['features']):
        geometry = shape(feature['geometry'])
        if geometry.geom_type not in ('Polygon', 'MultiPolygon'):
            raise ValueError(f'{label} feature {index}: not a polygon')
        if not geometry.is_valid or geometry.area <= 0:
            raise ValueError(f'{label} feature {index}: invalid polygon')
        polygons.append(geometry)
    return polygons


def check_pairwise_intersections(polygons):
    """Reject any positive-area overlap between two municipality polygons."""
    for first, second in combinations(polygons, 2):
        if first.intersection(second).area > OVERLAP_AREA_TOLERANCE:
            raise ValueError('municipality polygons overlap')
    return len(polygons)


def check_coverage(polygons, country):
    """Compare the municipality union with the reviewed country outline.

    The extractor assigns every internal country gap, including inland water,
    to a municipality. Only the coordinate-rounding residue may remain, so the
    check bounds both uncovered and extra land in local square metres.
    """
    union = unary_union(polygons)
    missing_area_sqm = (
        country.difference(union).area * SQUARE_DEGREES_TO_SQUARE_METRES
    )
    extra_area_sqm = (
        union.difference(country).area * SQUARE_DEGREES_TO_SQUARE_METRES
    )
    if missing_area_sqm > MISSING_AREA_TOLERANCE_SQM:
        raise ValueError(
            f'municipality union leaves {missing_area_sqm:.1f} square metres '
            'uncovered'
        )
    if extra_area_sqm > EXTRA_AREA_TOLERANCE_SQM:
        raise ValueError(
            f'municipality union extends {extra_area_sqm:.1f} square metres '
            'outside land'
        )
    return {
        'missing_area_sqm': missing_area_sqm,
        'extra_area_sqm': extra_area_sqm,
    }


def check_edge_usage(edges, municipalities, context_names):
    """Require every edge to have exactly one municipality on each side."""
    codes = {
        feature['properties']['ISO3166-2'] for feature in municipalities
    }
    references = {}
    for feature in municipalities:
        properties = feature['properties']
        for reference in properties['edges']:
            edge_id = reference['id']
            if reference['direction'] not in (1, -1):
                raise ValueError(f'{edge_id}: invalid edge direction')
            if properties['ISO3166-2'] not in codes:
                raise ValueError('municipality is missing its ISO code')
            references.setdefault(edge_id, []).append(
                (properties['ISO3166-2'], reference['direction'])
            )

    edge_ids = set()
    outside_names = {
        INSIDE_COUNTRY, SEA, *context_names, *OSM_ONLY_AUTHORITIES
    }
    for feature in edges:
        properties = feature['properties']
        edge_id = properties['entityId']
        if edge_id in edge_ids:
            raise ValueError(f'{edge_id}: duplicate shared edge')
        edge_ids.add(edge_id)
        geometry = LineString(feature['geometry']['coordinates'])
        if geometry.geom_type != 'LineString' or geometry.length <= 0:
            raise ValueError(f'{edge_id}: unusable edge geometry')
        left = properties['left']
        right = properties['right']
        if not left or not right or left == right:
            raise ValueError(f'{edge_id}: edge needs two distinct sides')
        for side in (left, right):
            if side not in codes and side not in outside_names:
                raise ValueError(
                    f'{edge_id}: unknown outside side {side}'
                )
        used = references.get(edge_id, [])
        for side, direction in ((left, 1), (right, -1)):
            if side not in codes:
                continue
            if used.count((side, direction)) != 1:
                raise ValueError(f'{edge_id}: side {side} is not used once')
        if len(used) != sum(side in codes for side in (left, right)):
            raise ValueError(f'{edge_id}: unexpected municipality references')

    for edge_id in references:
        if edge_id not in edge_ids:
            raise ValueError(f'{edge_id}: municipality references unknown edge')
    return len(edges)


def check_reconstruction(edges, municipalities):
    """Rebuild every polygon from its edge references and check their order."""
    lines = edge_lines(edges)
    for feature in municipalities:
        code = feature['properties']['ISO3166-2']
        references = feature['properties']['edges']
        try:
            expected = ordered_edge_references(references, lines)
            rebuilt = rebuild_municipality(feature, lines)
        except ValueError as error:
            raise ValueError(f'{code}: {error}') from error
        if references != expected:
            raise ValueError(f'{code}: edge references are not in traversal order')
        stored = shape(feature['geometry'])
        difference = rebuilt.symmetric_difference(stored).area
        if difference > RECONSTRUCTION_AREA_TOLERANCE:
            raise ValueError(
                f'{code}: stored polygon does not rebuild from its edges'
            )
    return len(municipalities)


def check_size(sources_dir):
    """Keep the three new source files below the reviewed combined limit."""
    paths = [
        Path(sources_dir) / name for name in (
            EDGE_FILE, MUNICIPALITY_FILE, SETTLEMENT_FILE
        )
    ]
    combined = sum(path.stat().st_size for path in paths)
    if combined > MAX_COMBINED_BYTES:
        raise ValueError(
            f'new sources use {combined} bytes, above {MAX_COMBINED_BYTES}'
        )
    return combined


def country_geometry(land):
    """Return the coastline-cut country polygon from land.geojson."""
    for feature in land['features']:
        if feature['properties'].get('kind') == 'country':
            return shape(feature['geometry'])
    raise ValueError('land.geojson has no country feature')


def check_sources(sources_dir):
    """Run every shared-border topology check on one reviewed source tree."""
    sources = Path(sources_dir)
    edges = read_collection(sources / EDGE_FILE)
    municipalities = read_collection(sources / MUNICIPALITY_FILE)
    settlements = read_collection(sources / SETTLEMENT_FILE)
    context = read_collection(sources / CONTEXT_FILE)
    polygons = polygons_in(municipalities, MUNICIPALITY_FILE)
    metrics = check_coverage(
        polygons, country_geometry(read_collection(sources / LAND_FILE))
    )
    return {
        'edges': check_edge_usage(
            edges['features'], municipalities['features'],
            {
                feature['properties']['name']
                for feature in context['features']
            },
        ),
        'reconstructed': check_reconstruction(
            edges['features'], municipalities['features']
        ),
        'municipalities': check_pairwise_intersections(polygons),
        'settlements': len(settlements['features']),
        'combined_bytes': check_size(sources),
        **metrics,
    }
