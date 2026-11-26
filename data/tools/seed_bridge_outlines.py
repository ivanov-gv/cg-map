"""Seed traced bridge outlines once from the reviewed bridge roads.

This is a deliberate seed step, not part of a normal build. OSM man_made=bridge areas stay as extracted; every road with
a bridge value other than 'no' that no area covers gets one traced outline. Later extractions carry the reviewed traced
features forward without deriving them again.
"""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path

from shapely import transform, unary_union
from shapely.geometry import mapping, shape
from shapely.geometry.polygon import orient
from shapely.strtree import STRtree

from osm_extract.geometry import rounded_geometry
from osm_extract.identity import content_version, make_feature
from osm_extract.rings import orient_feature
from osm_extract.writing import write_collection

SOURCE_FILE = 'bridges.geojson'
ROAD_FILE = 'roads.geojson'
JOIN_DISTANCE_METRES = 15
OUTLINE_HALF_WIDTH_METRES = 10
SIMPLIFICATION_METRES = 1
WALKING_KINDS = frozenset({
    'footway', 'cycleway', 'path', 'pedestrian', 'track', 'bridleway'
})
ABSENT_BRIDGE_VALUES = frozenset({'', 'no', None})
METRES_PER_LATITUDE_DEGREE = 111320


def detail_midpoint(detail_bbox):
    """Return the centre latitude of the reviewed detail box."""
    _, south, _, north = detail_bbox
    return (south + north) / 2


def local_scales(reference_latitude):
    """Return approximate local metres per degree at one latitude."""
    return (
        METRES_PER_LATITUDE_DEGREE * math.cos(
            math.radians(reference_latitude)
        ),
        METRES_PER_LATITUDE_DEGREE,
    )


def to_local(geometry, scales):
    """Scale WGS84 geometry to local metres for distance and buffer rules."""
    longitude_scale, latitude_scale = scales
    return transform(
        geometry,
        lambda coordinates: [
            (longitude * longitude_scale, latitude * latitude_scale)
            for longitude, latitude in coordinates
        ]
    )


def to_wgs84(geometry, scales):
    """Return a local-metre geometry in published WGS84 coordinates."""
    longitude_scale, latitude_scale = scales
    return transform(
        geometry,
        lambda coordinates: [
            (longitude / longitude_scale, latitude / latitude_scale)
            for longitude, latitude in coordinates
        ]
    )


def bridge_roads(roads):
    """Return the published roads whose bridge tag selects a crossing."""
    return [
        feature for feature in roads['features']
        if feature['properties'].get('bridge') not in ABSENT_BRIDGE_VALUES
    ]


def osm_areas(bridges):
    """Return the extracted OSM bridge polygons that cover bridge roads."""
    return [
        shape(feature['geometry']) for feature in bridges['features']
        if feature['properties'].get('method') == 'osm'
    ]


def covered_road_indexes(roads, areas):
    """Index every bridge road touched by an OSM bridge outline."""
    if not areas:
        return set()
    index = STRtree(areas)
    covered = set()
    for position, feature in enumerate(roads):
        geometry = shape(feature['geometry'])
        if any(
            areas[int(candidate)].intersects(geometry)
            for candidate in index.query(geometry)
        ):
            covered.add(position)
    return covered


def shares_endpoint(first, second):
    """Report whether two road pieces meet at the same published OSM node."""
    first_ends = {
        first.get('startNode'), first.get('endNode')
    } - {None}
    second_ends = {
        second.get('startNode'), second.get('endNode')
    } - {None}
    return bool(first_ends & second_ends)


def belongs_together(first, second):
    """Decide whether two nearby road pieces are parts of one crossing."""
    if shares_endpoint(first, second):
        return True
    first_name = first.get('name')
    if first_name and first_name == second.get('name'):
        return True
    return (
        first.get('kind') in WALKING_KINDS
        or second.get('kind') in WALKING_KINDS
    )


def connected_groups(roads, lines, covered):
    """Group uncovered road pieces that connect or run alongside each other."""
    parent = list(range(len(lines)))

    def find(position):
        while parent[position] != position:
            parent[position] = parent[parent[position]]
            position = parent[position]
        return position

    index = STRtree(lines)
    for first, line in enumerate(lines):
        if first in covered:
            continue
        distance_limit = line.buffer(JOIN_DISTANCE_METRES)
        for candidate in index.query(distance_limit):
            second = int(candidate)
            if second <= first or second in covered:
                continue
            if line.distance(lines[second]) > JOIN_DISTANCE_METRES:
                continue
            if belongs_together(
                roads[first]['properties'], roads[second]['properties']
            ):
                parent[find(first)] = find(second)

    groups = {}
    for position in range(len(lines)):
        if position not in covered:
            groups.setdefault(find(position), []).append(position)
    return list(groups.values())


def trace_outline(group_lines):
    """Return one simplified polygon around the road pieces of a crossing."""
    deck = unary_union([
        line.buffer(OUTLINE_HALF_WIDTH_METRES) for line in group_lines
    ])
    if deck.geom_type != 'Polygon':
        deck = deck.convex_hull
    outline = deck.simplify(SIMPLIFICATION_METRES, preserve_topology=True)
    if outline.geom_type != 'Polygon':
        outline = outline.convex_hull
    return outline


def unanimous_property(roads, field):
    """Return a shared road name, or omit a disputed or absent name."""
    values = {
        road['properties'][field] for road in roads
        if road['properties'].get(field)
    }
    return values.pop() if len(values) == 1 else None


def traced_feature(group, roads, outlines, scales):
    """Return one adopted traced outline with its contributing road identities."""
    source_road_ids = sorted({
        roads[position]['properties']['entityId'] for position in group
    })
    group_roads = [roads[position] for position in group]
    properties = {
        'kind': 'bridge',
        'method': 'traced',
        'sourceRoadIds': source_road_ids,
    }
    for field in ('name', 'name:en'):
        value = unanimous_property(group_roads, field)
        if value:
            properties[field] = value
    geometry = rounded_geometry(mapping(
        orient(to_wgs84(trace_outline([outlines[i] for i in group]), scales))
    ))
    entity_id = f'derived:bridge-{source_road_ids[0].replace("/", "-")}'
    identity = {
        'entityId': entity_id,
        'entityVersion': content_version({'geometry': geometry, 'properties': properties}),
    }
    return orient_feature(make_feature(geometry, properties, identity))


def seed(root):
    """Write the reviewed bridge source and its provenance from the pinned roads."""
    sources = root / 'data/sources'
    roads = json.loads((sources / ROAD_FILE).read_text(encoding='utf-8'))
    bridges = json.loads((sources / SOURCE_FILE).read_text(encoding='utf-8'))
    provenance_path = sources / 'provenance.json'
    provenance = json.loads(provenance_path.read_text(encoding='utf-8'))
    reference_latitude = detail_midpoint(provenance['detail_bbox'])
    scales = local_scales(reference_latitude)

    candidates = bridge_roads(roads)
    areas = osm_areas(bridges)
    covered = covered_road_indexes(candidates, areas)
    local_lines = [
        to_local(shape(feature['geometry']), scales) for feature in candidates
    ]
    groups = connected_groups(candidates, local_lines, covered)
    traced = [
        traced_feature(group, candidates, local_lines, scales)
        for group in groups
    ]
    features = [
        feature for feature in bridges['features']
        if feature['properties'].get('method') == 'osm'
    ] + traced
    write_collection(sources / SOURCE_FILE, features)

    source_bytes = (sources / SOURCE_FILE).read_bytes()
    provenance['layers'][SOURCE_FILE] = {
        'features': len(features),
        'bytes': len(source_bytes),
        'sha256': hashlib.sha256(source_bytes).hexdigest(),
    }
    provenance['bridge_counts'] = {
        'osmAreas': len(areas),
        'tracedOutlines': len(traced),
        'bridgeRoadFeatures': len(candidates),
        'coveredByOsm': len(covered),
        'tracedRoadFeatures': len(candidates) - len(covered),
    }
    provenance['bridge_seed'] = {
        'sourceFile': ROAD_FILE,
        'joinDistanceMetres': JOIN_DISTANCE_METRES,
        'outlineHalfWidthMetres': OUTLINE_HALF_WIDTH_METRES,
        'simplificationMetres': SIMPLIFICATION_METRES,
        'walkingKinds': sorted(WALKING_KINDS),
        'referenceLatitude': round(reference_latitude, 6),
    }
    temporary = provenance_path.with_name('provenance.json.new')
    temporary.write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2, sort_keys=True) + '\n',
        encoding='utf-8'
    )
    os.replace(temporary, provenance_path)
    print(
        f'{SOURCE_FILE} {len(features)} outlines: {len(areas)} OSM, '
        f'{len(traced)} traced from {len(candidates) - len(covered)} roads; '
        f'{len(covered)} covered by OSM bytes={len(source_bytes)}'
    )


def main():
    """Parse the reviewed root and seed its bridge outlines once."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--root', type=Path, default=Path(__file__).resolve().parents[2],
        help='Repository root holding data/sources'
    )
    arguments = parser.parse_args()
    seed(arguments.root.resolve())
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
