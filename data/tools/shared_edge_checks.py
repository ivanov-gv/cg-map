"""GIS topology checks for the shared municipality border sources."""

import json
from itertools import combinations
from pathlib import Path

from shapely.geometry import LineString, box, shape
from shapely.ops import polygonize, unary_union

from geo_area import (
    EXTRA_AREA_TOLERANCE_SQM, MISSING_AREA_TOLERANCE_SQM,
    SQUARE_DEGREES_TO_SQUARE_METRES,
)
from osm_extract.neighbours import OCEAN_BOUNDS, touches_sea
from osm_extract.shared_edges import (
    OSM_ONLY_AUTHORITIES, edge_lines, ordered_edge_references,
    rebuild_municipality
)

EDGE_FILE = 'border-edges.geojson'
MUNICIPALITY_FILE = 'municipalities.geojson'
LAND_FILE = 'land.geojson'
WATER_FILE = 'water.geojson'
SETTLEMENT_FILE = 'settlements.geojson'
CONTEXT_FILE = 'context-countries.geojson'
MUNICIPALITY_PREFIX = 'ME-'
MUNICIPALITY_KIND = 'municipality'
UNASSIGNED_WATER_KIND = 'unassigned-water'
INSIDE_COUNTRY = 'ME'
SEA = 'sea'

OVERLAP_AREA_TOLERANCE = 1e-10
RECONSTRUCTION_AREA_TOLERANCE = 1e-10
MAX_COMBINED_BYTES = 5 * 1024 * 1024
NEIGHBOUR_OVERLAP_TOLERANCE_SQM = 20_000
INLAND_GAP_TOLERANCE_SQM = 20_000
INLAND_OCEAN_TOLERANCE_SQM = 20_000


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


def area_identity(feature):
    """Return the edge-side identifier of one published polygon."""
    properties = feature['properties']
    if properties.get('kind') == UNASSIGNED_WATER_KIND:
        return properties.get('entityId')
    if 'ISO3166-2' in properties:
        return properties.get('ISO3166-2')
    raise ValueError('published area has an unsupported kind')


def area_identities(features):
    """Return the distinct edge-side identifiers of published polygons."""
    identities = set()
    for feature in features:
        identifier = area_identity(feature)
        if not identifier:
            raise ValueError('published area is missing its identifier')
        if identifier in identities:
            raise ValueError(f'duplicate area identity {identifier}')
        identities.add(identifier)
    return identities


def check_pairwise_intersections(polygons):
    """Reject any positive-area overlap between two published polygons."""
    for first, second in combinations(polygons, 2):
        if first.intersection(second).area > OVERLAP_AREA_TOLERANCE:
            raise ValueError('published polygons overlap')
    return len(polygons)


def check_coverage(polygons, country):
    """Compare the published area union with the reviewed country outline.

    Derived unassigned-water polygons cover material gaps alongside the
    municipalities. Only coordinate-rounding residue may remain, so the check
    bounds both uncovered and extra land in local square metres.
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
            f'published area union leaves {missing_area_sqm:.1f} square metres '
            'uncovered'
        )
    if extra_area_sqm > EXTRA_AREA_TOLERANCE_SQM:
        raise ValueError(
            f'published area union extends {extra_area_sqm:.1f} square metres '
            'outside land'
        )
    return {
        'missing_area_sqm': missing_area_sqm,
        'extra_area_sqm': extra_area_sqm,
    }


def check_edge_usage(edges, areas, context_names):
    """Require every edge to have exactly one published area on each side."""
    area_ids = area_identities(areas)
    references = {}
    for feature in areas:
        identifier = area_identity(feature)
        for reference in feature['properties']['edges']:
            edge_id = reference['id']
            if reference['direction'] not in (1, -1):
                raise ValueError(f'{edge_id}: invalid edge direction')
            references.setdefault(edge_id, []).append(
                (identifier, reference['direction'])
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
            if side not in area_ids and side not in outside_names:
                raise ValueError(
                    f'{edge_id}: unknown outside side {side}'
                )
        used = references.get(edge_id, [])
        for side, direction in ((left, 1), (right, -1)):
            if side not in area_ids:
                continue
            if used.count((side, direction)) != 1:
                raise ValueError(f'{edge_id}: side {side} is not used once')
        if len(used) != sum(side in area_ids for side in (left, right)):
            raise ValueError(f'{edge_id}: unexpected area references')

    for edge_id in references:
        if edge_id not in edge_ids:
            raise ValueError(f'{edge_id}: area references unknown edge')
    return len(edges)


def check_reconstruction(edges, areas):
    """Rebuild every polygon from its edge references and check their order."""
    lines = edge_lines(edges)
    for feature in areas:
        identifier = area_identity(feature)
        references = feature['properties']['edges']
        try:
            expected = ordered_edge_references(references, lines)
            rebuilt = rebuild_municipality(feature, lines)
        except ValueError as error:
            raise ValueError(f'{identifier}: {error}') from error
        if references != expected:
            raise ValueError(
                f'{identifier}: edge references are not in traversal order'
            )
        stored = shape(feature['geometry'])
        difference = rebuilt.symmetric_difference(stored).area
        if difference > RECONSTRUCTION_AREA_TOLERANCE:
            raise ValueError(
                f'{identifier}: stored polygon does not rebuild from its edges'
            )
    return len(areas)


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


def check_neighbour_geometry(sources_dir, country, context, edges, water):
    """Keep neighbours at the border and land gaps out of the ocean."""
    context_polygons = polygons_in(context, CONTEXT_FILE)
    overlap_sqm = sum(
        country.intersection(polygon).area
        * SQUARE_DEGREES_TO_SQUARE_METRES
        for polygon in context_polygons
    )
    if overlap_sqm > NEIGHBOUR_OVERLAP_TOLERANCE_SQM:
        raise ValueError(
            f'neighbour areas overlap Montenegro by {overlap_sqm:.1f} m2'
        )

    covered = unary_union([country, *context_polygons])
    uncovered = box(*OCEAN_BOUNDS).difference(covered)
    sea_lines = [
        LineString(feature['geometry']['coordinates'])
        for feature in edges['features']
        if 'sea' in (
            feature['properties']['left'], feature['properties']['right']
        )
    ]
    inland_gap_sqm = sum(
        polygon.area * SQUARE_DEGREES_TO_SQUARE_METRES
        for polygon in polygonize(uncovered.boundary)
        if uncovered.covers(polygon.representative_point())
        and not touches_sea(polygon, sea_lines)
    )
    if inland_gap_sqm > INLAND_GAP_TOLERANCE_SQM:
        raise ValueError(
            f'inland gaps cover {inland_gap_sqm:.1f} m2 outside neighbours'
        )

    ocean_polygons = [
        shape(feature['geometry']) for feature in water['features']
        if feature['properties'].get('kind') == 'ocean'
    ]
    if not ocean_polygons:
        raise ValueError('water.geojson has no ocean polygon')
    inland_ocean_sqm = (
        unary_union(ocean_polygons).intersection(covered).area
        * SQUARE_DEGREES_TO_SQUARE_METRES
    )
    if inland_ocean_sqm > INLAND_OCEAN_TOLERANCE_SQM:
        raise ValueError(
            f'ocean covers {inland_ocean_sqm:.1f} m2 of land'
        )
    return {
        'neighbour_overlap_sqm': overlap_sqm,
        'inland_gap_sqm': inland_gap_sqm,
        'inland_ocean_sqm': inland_ocean_sqm,
    }


def check_sources(sources_dir):
    """Run every shared-border topology check on one reviewed source tree."""
    sources = Path(sources_dir)
    edges = read_collection(sources / EDGE_FILE)
    areas = read_collection(sources / MUNICIPALITY_FILE)
    settlements = read_collection(sources / SETTLEMENT_FILE)
    context = read_collection(sources / CONTEXT_FILE)
    water = read_collection(sources / WATER_FILE)
    polygons = polygons_in(areas, MUNICIPALITY_FILE)
    metrics = check_coverage(
        polygons, country_geometry(read_collection(sources / LAND_FILE))
    )
    municipality_count = 0
    water_count = 0
    for feature in areas['features']:
        kind = feature['properties'].get('kind')
        if kind == MUNICIPALITY_KIND:
            municipality_count += 1
        elif kind == UNASSIGNED_WATER_KIND:
            water_count += 1
    return {
        'edges': check_edge_usage(
            edges['features'], areas['features'],
            {
                feature['properties']['name']
                for feature in context['features']
            },
        ),
        'reconstructed': check_reconstruction(
            edges['features'], areas['features']
        ),
        'areas': check_pairwise_intersections(polygons),
        'municipalities': municipality_count,
        'unassigned_water': water_count,
        'settlements': len(settlements['features']),
        'combined_bytes': check_size(sources),
        **metrics,
        **check_neighbour_geometry(
            sources,
            country_geometry(read_collection(sources / LAND_FILE)),
            context, edges, water
        ),
    }
