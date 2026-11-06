"""Recover OSM address labels for unchanged reviewed footprints.

Run with data/tools/requirements.txt installed. Exact rounded geometry matches
recover real way IDs; address nodes are used only when associated unambiguously.
"""
import argparse
import datetime
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MAX_ENTRANCES = 100
MAX_ADDRESS_TEXT_LENGTH = 128
COORDINATE_TOLERANCE_DEGREES = 0.000001
REVIEWED_PBF_HASH = '574423f1685e7b0a82a14166ba492376fc824294680ea0c576426ff408230397'


def house_number(raw):
    value = raw.strip()
    normalized = ''.join(c for c in value.casefold() if c not in ' ./-_')
    # Local 'bb' means 'bez broja' (no number); do not display it as a house number.
    return '' if normalized in ['', 'bb', 'бб', 'bezbroja', 'безброја', 'na', '?'] else value


def ring_key(ring):
    points = [(round(p[0], 6), round(p[1], 6)) for p in ring]
    if points and points[0] == points[-1]:
        points.pop()
    if not points:
        return ()
    minimum = min(points)
    rotations = []
    for order in [points, list(reversed(points))]:
        for i, point in enumerate(order):
            if point == minimum:
                rotations.append(tuple(order[i:] + order[:i]))
    return min(rotations)


def footprint_key(coordinates):
    return (ring_key(coordinates[0]), tuple(sorted(ring_key(r) for r in coordinates[1:])))


def entrance_bearing(coordinates, polygon_coordinates):
    """Return the nearest wall's inward Mercator normal, clockwise from north."""
    def projected_offset(vertex):
        def northing(latitude):
            return math.log(math.tan(math.pi / 4 + math.radians(latitude) / 2))
        return (
            math.radians(vertex[0] - coordinates[0]),
            northing(vertex[1]) - northing(coordinates[1]),
        )

    closest_wall = None
    for ring_index, ring in enumerate(polygon_coordinates):
        vertices = [projected_offset(vertex) for vertex in ring]
        signed_area = sum(
            start[0] * end[1] - end[0] * start[1]
            for start, end in zip(vertices, vertices[1:]))
        if not math.isfinite(signed_area) or signed_area == 0:
            raise ValueError('Entrance footprint has a degenerate ring')
        ring_sign = 1 if signed_area > 0 else -1
        inward_sign = ring_sign * (1 if ring_index == 0 else -1)
        for start, end in zip(vertices, vertices[1:]):
            east = end[0] - start[0]
            north = end[1] - start[1]
            squared_length = east * east + north * north
            if squared_length == 0:
                continue
            projection = -(start[0] * east + start[1] * north) / squared_length
            fraction = max(0, min(1, projection))
            distance = math.hypot(
                start[0] + fraction * east, start[1] + fraction * north)
            if closest_wall and distance >= closest_wall[0]:
                continue
            closest_wall = (distance, -north * inward_sign, east * inward_sign)
    if closest_wall is None:
        raise ValueError('Entrance footprint has no wall')
    bearing = math.degrees(math.atan2(closest_wall[1], closest_wall[2])) % 360
    return round(bearing, 6) % 360


def building_properties(building, address_nodes, entrances, footprint_index):
    """Keep separately known building and entrance numbers with original sources."""
    if len(entrances) > MAX_ENTRANCES:
        raise ValueError('More than 100 entrances; review the building contract')
    address_sources = {address['osm_id'] for address in address_nodes}
    entrance_sources = {entrance['id'] for entrance in entrances}
    properties = {
        'kind': 'building',
        'osm_id': building['osm_id'],
        'footprintIndex': footprint_index,
        'address_sources': sorted(address_sources | entrance_sources),
    }
    numbers = sorted({address['number'] for address in address_nodes})
    if numbers:
        properties['addr:housenumber'] = '; '.join(numbers)
    if entrances:
        properties['entrances'] = sorted(entrances, key=lambda entrance: entrance['id'])
        if building['number']:
            properties['building_number'] = building['number']
    streets = sorted({address['street'] for address in address_nodes if address['street']})
    if building['street']:
        properties['addr:street'] = building['street']
    elif len(streets) == 1:
        properties['addr:street'] = streets[0]
    return properties


def read_addresses(input_pbf, footprint_indexes):
    """Read tagged nodes and recover source ways by exact reviewed footprint match."""
    import osmium
    from shapely.geometry import Point

    class Addresses(osmium.SimpleHandler):
        """Retain node membership so nearby buildings never compete by distance."""

        def __init__(self):
            super().__init__()
            self.nodes = []
            self.matches = {}
            self.members = {}

        def node(self, node):
            """Preserve a point only when it is an address or an explicit entrance."""
            number = house_number(node.tags.get('addr:housenumber', ''))
            is_entrance = node.tags.get('entrance', '') not in ['', 'no']
            if not (number or is_entrance) or not node.location.valid():
                return
            self.nodes.append({
                'osm_id': 'node/' + str(node.id),
                'node_id': node.id,
                'point': Point(node.location.lon, node.location.lat),
                'number': number,
                'street': node.tags.get('addr:street', ''),
                'entrance': is_entrance,
                'ref': node.tags.get('ref', ''),
            })

        def way(self, building):
            """Recover a real way ID only when its rounded geometry matches once."""
            if not building.tags.get('building') or not building.is_closed():
                return
            try:
                coordinates = [(node.lon, node.lat) for node in building.nodes]
            except osmium.InvalidLocationError:
                return
            candidates = footprint_indexes.get(footprint_key([coordinates]), [])
            if len(candidates) != 1:
                return
            footprint_index = candidates[0]
            self.matches.setdefault(footprint_index, []).append({
                'osm_id': 'way/' + str(building.id),
                'number': house_number(building.tags.get('addr:housenumber', '')),
                'street': building.tags.get('addr:street', ''),
            })
            for node in building.nodes:
                self.members.setdefault(node.ref, set()).add(footprint_index)

    addresses = Addresses()
    addresses.apply_file(str(input_pbf), locations=True, idx='flex_mem')
    return addresses


def associate_nodes(addresses, matched_buildings, polygons):
    """Return unique address/entrance joins; skip all ambiguous memberships."""
    from shapely.strtree import STRtree

    polygon_index = STRtree(polygons)
    node_addresses = {}
    entrances = {}
    ambiguous_count = 0
    for node in addresses.nodes:
        point = node['point']
        members = addresses.members.get(node['node_id'], set())
        candidates = list(members) if members else [
            int(index) for index in polygon_index.query(point, predicate='intersects')
        ]
        if len(candidates) != 1:
            ambiguous_count += len(candidates) > 1
            continue
        footprint_index = candidates[0]
        if footprint_index not in matched_buildings:
            continue
        if node['number']:
            node_addresses.setdefault(footprint_index, []).append(node)
        if not node['entrance']:
            continue
        entrance = {'id': node['osm_id'], 'coordinates': [point.x, point.y]}
        for field in ['number', 'ref', 'street']:
            if node[field]:
                entrance[field] = node[field]
        entrances.setdefault(footprint_index, []).append(entrance)
    return node_addresses, entrances, ambiguous_count


def build_labels(matched_buildings, polygons, node_addresses, entrances):
    """Build interior labels without replacing way numbers with entrance numbers."""
    from shapely.geometry import Point
    from shapely.ops import polylabel

    labels = []
    direct_count = 0
    node_count = 0
    for footprint_index, building in sorted(matched_buildings.items()):
        address_nodes = [building] if building['number'] else node_addresses.get(footprint_index, [])
        building_entrances = entrances.get(footprint_index, [])
        polygon = polygons[footprint_index]
        for entrance in building_entrances:
            distance_degrees = polygon.boundary.distance(Point(entrance['coordinates']))
            if distance_degrees > COORDINATE_TOLERANCE_DEGREES:
                raise ValueError('Entrance must lie on a building wall: ' + entrance['id'])
        if (not address_nodes and not building_entrances) or not polygon.is_valid:
            continue
        numbers = sorted({address['number'] for address in address_nodes})
        if len('; '.join(numbers)) > MAX_ADDRESS_TEXT_LENGTH:
            continue
        anchor = polylabel(polygon, tolerance=COORDINATE_TOLERANCE_DEGREES)
        if not polygon.covers(anchor):
            raise ValueError('Label anchor outside its footprint')
        polygon_coordinates = [list(polygon.exterior.coords)]
        polygon_coordinates.extend(list(ring.coords) for ring in polygon.interiors)
        oriented_entrances = [
            {**entrance, 'bearing': entrance_bearing(
                entrance['coordinates'], polygon_coordinates)}
            for entrance in building_entrances
        ]
        properties = building_properties(
            building, address_nodes, oriented_entrances, footprint_index)
        # Retain sub-metre anchor precision so tiny footprints stay valid.
        labels.append({
            'type': 'Feature',
            'id': building['osm_id'],
            'geometry': {'type': 'Point', 'coordinates': [anchor.x, anchor.y]},
            'properties': properties,
        })
        direct_count += bool(building['number'])
        node_count += not bool(building['number'])
    return labels, direct_count, node_count


def main():
    """Replace the label snapshot only after the reviewed PBF has been checked."""
    from shapely.geometry import shape

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_pbf')
    arguments = parser.parse_args()
    input_pbf = Path(arguments.input_pbf)
    input_hash = hashlib.sha256(input_pbf.read_bytes()).hexdigest()
    if input_hash != REVIEWED_PBF_HASH:
        raise ValueError('Use the reviewed OSM snapshot; review provenance before changing the input.')
    source_bytes = (ROOT / 'data/sources/buildings.geojson').read_bytes()
    features = json.loads(source_bytes)['features']
    polygons = [shape(feature['geometry']) for feature in features]
    footprint_indexes = {}
    for index, feature in enumerate(features):
        key = footprint_key(feature['geometry']['coordinates'])
        footprint_indexes.setdefault(key, []).append(index)
    addresses = read_addresses(input_pbf, footprint_indexes)
    matched_buildings = {
        index: matches[0] for index, matches in addresses.matches.items() if len(matches) == 1
    }
    node_addresses, entrances, ambiguous_count = associate_nodes(addresses, matched_buildings, polygons)
    labels, direct_count, node_count = build_labels(matched_buildings, polygons, node_addresses, entrances)
    collection = {'type': 'FeatureCollection', 'features': labels}
    data = (json.dumps(collection, ensure_ascii=False, separators=(',', ':')) + '\n').encode()
    metadata = {
        'source': 'OpenStreetMap / Geofabrik Montenegro',
        'upstream_snapshot': '2026-10-17T20:20:51Z',
        'input_pbf_sha256': input_hash,
        'buildings_sha256': hashlib.sha256(source_bytes).hexdigest(),
        'generated_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'features': len(labels),
        'direct_building_addresses': direct_count,
        'node_derived_addresses': node_count,
        'ambiguous_address_nodes_skipped': ambiguous_count,
        'matched_footprints': len(matched_buildings),
        'bytes': len(data),
        'sha256': hashlib.sha256(data).hexdigest(),
        'license': 'ODbL 1.0',
        'method': ('Exact footprint match at existing six-decimal precision. Separate way numbers '
                   'and explicitly tagged entrance nodes; unambiguous node membership/containment only. '
                   'Non-entrance addresses remain legacy labels. Anchor is inside the polygon. '
                   'No inferred entrances, numbering or nearest-building assignment; '
                   'no-number placeholders (bb/bez broja) are excluded.'),
    }
    (ROOT / 'data/sources/building-labels.geojson').write_bytes(data)
    (ROOT / 'data/sources/building-labels.provenance.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata), flush=True)


if __name__ == '__main__':
    main()
