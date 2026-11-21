"""GIS topology checks for the shared municipality border sources."""

import json
from itertools import combinations
from pathlib import Path

from shapely.geometry import LineString, shape
from shapely.ops import unary_union

EDGE_FILE = 'border-edges.geojson'
MUNICIPALITY_FILE = 'municipalities.geojson'
LAND_FILE = 'land.geojson'
SETTLEMENT_FILE = 'settlements.geojson'
WATER_FILE = 'water.geojson'
CONTEXT_FILE = 'context-countries.geojson'
MUNICIPALITY_PREFIX = 'ME-'
INSIDE_COUNTRY = 'ME'
SEA = 'sea'

OVERLAP_AREA_TOLERANCE = 1e-10
EXTRA_AREA_TOLERANCE = 1e-6
MISSING_AREA_TOLERANCE = 0.003
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


def check_coverage(polygons, country, water=None):
    """Compare the municipality union with the coastline-cut country outline.

    Inland water is not municipality land: Lake Skadar's gap is expected. A
    small residual remains where the water and outline sources are simplified
    differently, so only non-water gaps are bounded by the tolerance. Extra
    municipality area must stay at coordinate-rounding scale.
    """
    union = unary_union(polygons)
    missing = country.difference(union)
    unexplained = missing if water is None else missing.difference(water)
    missing_area = missing.area
    unexplained_area = unexplained.area
    extra_area = union.difference(country).area
    if unexplained_area > MISSING_AREA_TOLERANCE:
        raise ValueError(
            f'municipality union leaves {unexplained_area} square degrees '
            'outside water uncovered'
        )
    if extra_area > EXTRA_AREA_TOLERANCE:
        raise ValueError(
            f'municipality union extends {extra_area} square degrees outside land'
        )
    return {
        'missing_area': missing_area,
        'unexplained_gap_area': unexplained_area,
        'extra_area': extra_area,
    }


def water_polygons(collection):
    """Return the polygon water bodies used to explain inland gaps."""
    geometries = [
        shape(feature['geometry']) for feature in collection['features']
    ]
    return unary_union([
        geometry for geometry in geometries
        if geometry.geom_type in ('Polygon', 'MultiPolygon')
    ])


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
    outside_names = {INSIDE_COUNTRY, SEA, *context_names}
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
    water = water_polygons(read_collection(sources / WATER_FILE))
    metrics = check_coverage(
        polygons, country_geometry(read_collection(sources / LAND_FILE)), water
    )
    return {
        'edges': check_edge_usage(
            edges['features'], municipalities['features'],
            {
                feature['properties']['name']
                for feature in context['features']
            },
        ),
        'municipalities': check_pairwise_intersections(polygons),
        'settlements': len(settlements['features']),
        'combined_bytes': check_size(sources),
        **metrics,
    }
