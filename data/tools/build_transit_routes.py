"""Build transit-routes.json from ePodgorica data and OSM bus relations.

City routes (network "bus") come from the ePodgorica transit network.
OSM routes are classified as "bus" or "intercity" by municipality geography:
the reviewed municipalities GeoJSON provides every Montenegrin municipality
boundary with ISO3166-2 starting "ME-". A route is "intercity" when its first
and last stops lie in different municipalities, or either end lies outside
Montenegro; otherwise it is "bus". Each direction records the ISO codes of its
first and last municipality (fromMunicipality, toMunicipality).

Each OSM relation becomes one direction with its own entityId and entityVersion.
Directions are grouped only by their route_master membership; relations without
a route_master are each their own line.

Usage:
    python3 data/tools/build_transit_routes.py [--network FILE] [--pbf FILE]
"""
import argparse
import collections
import hashlib
import json
import sys
from pathlib import Path

import osmium
from shapely.geometry import MultiPolygon, Point, Polygon, shape

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_NETWORK = ROOT / 'data/sources/transit-network.json'
DEFAULT_NETWORK_PROVENANCE = ROOT / 'data/sources/transit-network.provenance.json'
DEFAULT_MUNICIPALITIES = ROOT / 'data/sources/municipalities.geojson'
DEFAULT_PBF = Path.home() / '.cache/cg-map/montenegro-2026-11-21.osm.pbf'
DEFAULT_OUTPUT = ROOT / 'data/sources/transit-routes.json'
EXPECTED_MUNICIPALITY_COUNT = 25


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network', type=Path, default=DEFAULT_NETWORK,
                        help='Path to transit-network.json')
    parser.add_argument('--network-provenance', type=Path,
                        default=DEFAULT_NETWORK_PROVENANCE,
                        help='Path to transit-network.provenance.json')
    parser.add_argument('--municipalities', type=Path, default=DEFAULT_MUNICIPALITIES,
                        help='Path to municipalities.geojson')
    parser.add_argument('--pbf', type=Path, default=DEFAULT_PBF,
                        help='Path to OSM PBF file')
    parser.add_argument('--output', type=Path, default=DEFAULT_OUTPUT,
                        help='Output transit-routes.json path')
    return parser.parse_args()


def load_json(path):
    """Load a JSON file from *path*."""
    with open(path, 'r', encoding='utf-8') as file:
        return json.load(file)


def load_network(path):
    """Load the transit network JSON."""
    return load_json(path)


def load_network_retrieved_at(path):
    """Read the ePodgorica retrieval time from transit network provenance."""
    provenance = load_json(path)
    retrieved_at = provenance.get('retrieved_at')
    if not isinstance(retrieved_at, str) or not retrieved_at:
        raise ValueError(f'{path}: missing retrieved_at')
    return retrieved_at


def load_pbf_metadata(pbf_path):
    """Read PBF file name, SHA-256 and replication timestamp for provenance."""
    header = osmium.io.Reader(str(pbf_path)).header()
    timestamp = header.get('osmosis_replication_timestamp')
    if timestamp is None:
        replication_timestamp = None
    else:
        replication_timestamp = timestamp.isoformat() if hasattr(timestamp, 'isoformat') else str(timestamp)
    sha256 = hashlib.sha256()
    with open(pbf_path, 'rb') as pbf_file:
        for chunk in iter(lambda: pbf_file.read(1024 * 1024), b''):
            sha256.update(chunk)
    return {
        'fileName': pbf_path.name,
        'sha256': sha256.hexdigest(),
        'replicationTimestamp': replication_timestamp,
    }


# ---------------------------------------------------------------------------
# City routes from ePodgorica
# ---------------------------------------------------------------------------

def direction_key_from_sample_trip(sample_trip):
    """Return AB/BA direction key from a sampleTrip code, or None."""
    if '_AB_' in sample_trip:
        return 'AB'
    if '_BA_' in sample_trip:
        return 'BA'
    return None


def group_patterns_by_route(patterns):
    """Group transit network patterns by route number."""
    patterns_by_route = collections.defaultdict(list)
    for pattern in patterns:
        patterns_by_route[pattern['route']].append(pattern)
    return patterns_by_route


def group_patterns_by_direction(patterns):
    """Group route patterns by AB/BA direction key."""
    patterns_by_direction = collections.defaultdict(list)
    for pattern in patterns:
        direction_key = direction_key_from_sample_trip(pattern.get('sampleTrip', ''))
        if direction_key is None:
            direction_key = 'unknown'
        patterns_by_direction[direction_key].append(pattern)
    return patterns_by_direction


def build_city_direction(patterns_for_direction):
    """Build one city direction with variant stop sequences."""
    primary_pattern = patterns_for_direction[0]
    direction = {
        'headsign': primary_pattern.get('headsign', ''),
        'stops': primary_pattern['stops'],
    }
    variants = []
    for variant_pattern in patterns_for_direction[1:]:
        variant_stops = variant_pattern['stops']
        if variant_stops == primary_pattern['stops']:
            continue
        variants.append({
            'headsign': variant_pattern.get('headsign', ''),
            'stops': variant_stops,
        })
    if variants:
        direction['variants'] = variants
    return direction


def build_city_route(route_number, patterns):
    """Build one city route from all of its network patterns."""
    directions = []
    patterns_by_direction = group_patterns_by_direction(patterns)
    for direction_key in sorted(patterns_by_direction):
        directions.append(build_city_direction(patterns_by_direction[direction_key]))
    route = {
        'number': route_number,
        'name': patterns[0].get('name', ''),
        'network': 'bus',
        'directions': directions,
    }
    if 'colour' in patterns[0]:
        route['colour'] = patterns[0]['colour']
    return route


def build_city_routes(network):
    """Build city bus routes from ePodgorica transit network patterns."""
    patterns_by_route = group_patterns_by_route(network.get('patterns', []))
    routes = []
    for route_number in sorted(patterns_by_route):
        routes.append(build_city_route(route_number, patterns_by_route[route_number]))
    return routes


# ---------------------------------------------------------------------------
# OSM parsing — memory efficient two-pass approach
# ---------------------------------------------------------------------------

def _collect_member_node_ids(osm_relations):
    """Collect all stop/platform node IDs referenced by bus relations.

    Returns a set of integer node IDs.
    """
    stop_roles = {'stop', 'platform', 'platform_entry_only', 'platform_exit_only'}
    node_ids = set()
    for relation in osm_relations:
        for member_type, member_ref, role in relation['members']:
            if member_type == 'n' and role in stop_roles:
                node_ids.add(member_ref)
    return node_ids


def load_osm_bus_relations(pbf_path):
    """Load bus route and route_master relations from an OSM PBF file.

    Returns (bus_relations, route_masters).
    """
    class BusRelationHandler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.bus_relations = []
            self.route_masters = []

        def relation(self, relation):
            tags = dict(relation.tags)
            if tags.get('route') == 'bus':
                self.bus_relations.append({
                    'id': relation.id,
                    'version': relation.version,
                    'tags': tags,
                    'members': [(member.type, member.ref, member.role)
                                for member in relation.members],
                })
            if tags.get('type') == 'route_master':
                self.route_masters.append({
                    'id': relation.id,
                    'version': relation.version,
                    'tags': tags,
                    'members': [(member.type, member.ref, member.role)
                                for member in relation.members],
                })

    handler = BusRelationHandler()
    handler.apply_file(str(pbf_path))
    return handler.bus_relations, handler.route_masters


def load_osm_nodes_for_ids(pbf_path, node_ids):
    """Load only the named node IDs from an OSM PBF (second pass)."""

    class SelectiveNodeHandler(osmium.SimpleHandler):
        def __init__(self, target_ids):
            super().__init__()
            self.target_ids = target_ids
            self.nodes = {}

        def node(self, node):
            if node.id not in self.target_ids:
                return
            tags = dict(node.tags) if node.tags else {}
            self.nodes[node.id] = {
                'lon': node.location.lon,
                'lat': node.location.lat,
                'tags': tags,
            }

    handler = SelectiveNodeHandler(node_ids)
    handler.apply_file(str(pbf_path))
    return handler.nodes


# ---------------------------------------------------------------------------
# Intercity classification
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Municipality geography — point-in-polygon classification
# ---------------------------------------------------------------------------

def load_municipalities_from_geojson(path):
    """Load municipality boundaries from the reviewed GeoJSON source."""
    data = load_json(path)
    municipalities = {}
    for feature in data.get('features', []):
        properties = feature.get('properties', {})
        iso_code = properties.get('ISO3166-2', '')
        if not iso_code.startswith('ME-'):
            continue
        geometry = feature.get('geometry')
        if not geometry:
            continue
        municipalities[iso_code] = shape(geometry)
    return municipalities


def load_municipalities_from_pbf(pbf_path):
    """Load Montenegrin municipality boundaries from the OSM PBF."""

    class MunicipalityAreaHandler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.municipalities = {}

        def area(self, area):
            tags = dict(area.tags)
            if tags.get('boundary') != 'administrative':
                return
            if tags.get('admin_level') != '6':
                return
            iso_code = tags.get('ISO3166-2', '')
            if not iso_code.startswith('ME-'):
                return

            outer_rings = []
            ring_holes = []
            for outer_ring in area.outer_rings():
                outer_coordinates = [(node.location.lon, node.location.lat)
                                     for node in outer_ring]
                outer_rings.append(outer_coordinates)
                holes = []
                for inner_ring in area.inner_rings(outer_ring):
                    holes.append([(node.location.lon, node.location.lat)
                                  for node in inner_ring])
                ring_holes.append(holes)

            if len(outer_rings) == 1:
                polygon = Polygon(outer_rings[0], ring_holes[0])
            elif len(outer_rings) > 1:
                polygons = [Polygon(coordinates) for coordinates in outer_rings]
                polygon = MultiPolygon(polygons)
            else:
                return

            self.municipalities[iso_code] = polygon

    handler = MunicipalityAreaHandler()
    handler.apply_file(str(pbf_path))
    return handler.municipalities


def load_municipalities(municipalities_path, pbf_path):
    """Load municipalities, preferring the reviewed GeoJSON source."""
    if municipalities_path.exists():
        print(f'  Loading municipality boundaries from {municipalities_path}...')
        municipalities = load_municipalities_from_geojson(municipalities_path)
        source = municipalities_path.name
    else:
        print(f'  Loading municipality boundaries from {pbf_path}...')
        municipalities = load_municipalities_from_pbf(pbf_path)
        source = pbf_path.name
    if len(municipalities) != EXPECTED_MUNICIPALITY_COUNT:
        print(
            f'Error: expected {EXPECTED_MUNICIPALITY_COUNT} municipalities, '
            f'found {len(municipalities)} in {source}',
            file=sys.stderr,
        )
        sys.exit(1)
    print(f'  {len(municipalities)} municipalities loaded')
    return municipalities


def find_municipality(longitude, latitude, municipalities):
    """Return the ISO3166-2 municipality code containing a WGS84 point."""
    point = Point(longitude, latitude)
    for iso_code, polygon in municipalities.items():
        if polygon.covers(point):
            return iso_code
    return None


def classify_by_municipality(first_muni, last_muni):
    """Classify a route direction as 'bus' or 'intercity' by municipality.

    A route is 'intercity' when its first and last stops lie in different
    municipalities, or either end lies outside Montenegro (no municipality
    found). Otherwise it is 'bus'.

    Returns 'intercity' or 'bus'.
    """
    if first_muni is None or last_muni is None:
        return 'intercity'
    if first_muni != last_muni:
        return 'intercity'
    return 'bus'


# ---------------------------------------------------------------------------
# OSM route building
# ---------------------------------------------------------------------------

STOP_MEMBER_ROLES = {'stop', 'platform', 'platform_entry_only', 'platform_exit_only'}


def get_city_route_refs(network):
    """Return city route numbers already covered by ePodgorica."""
    route_refs = set()
    for pattern in network.get('patterns', []):
        route_refs.add(pattern['route'])
    return route_refs


def epodgorica_stops_extent(network):
    """Return the bounding box of all ePodgorica stops."""
    stops = network.get('stops', {})
    if not stops:
        return None
    longitudes = [stop['coordinates'][0] for stop in stops.values()]
    latitudes = [stop['coordinates'][1] for stop in stops.values()]
    return (min(longitudes), max(longitudes), min(latitudes), max(latitudes))


def point_in_extent(point, extent):
    """Return whether (longitude, latitude) falls inside a bounding box."""
    if extent is None:
        return False
    longitude, latitude = point
    min_longitude, max_longitude, min_latitude, max_latitude = extent
    return (min_longitude <= longitude <= max_longitude
            and min_latitude <= latitude <= max_latitude)


def build_route_master_membership(route_masters):
    """Map route relation IDs to the route_master relation that contains them."""
    membership = {}
    for route_master in route_masters:
        route_master_id = route_master['id']
        for member_type, member_ref, _ in route_master['members']:
            if member_type == 'r':
                membership.setdefault(member_ref, route_master_id)
    return membership


def relation_stop_node_ids(relation):
    """Return stop/platform node member IDs in relation order."""
    node_ids = []
    for member_type, member_ref, role in relation['members']:
        if member_type == 'n' and role in STOP_MEMBER_ROLES:
            node_ids.append(member_ref)
    return node_ids


def relation_stops(relation, osm_nodes):
    """Build stop objects for a relation from resolved OSM nodes."""
    stops = []
    for node_id in relation_stop_node_ids(relation):
        if node_id not in osm_nodes:
            continue
        node_data = osm_nodes[node_id]
        longitude = round(node_data['lon'], 6)
        latitude = round(node_data['lat'], 6)
        stop_name = node_data['tags'].get('name', '')
        stops.append({
            'id': f'node/{node_id}',
            'name': stop_name,
            'coordinates': [longitude, latitude],
        })
    return stops


def all_stops_in_extent(stops, extent):
    """Return whether every stop coordinate falls inside the extent."""
    if not stops:
        return False
    for stop in stops:
        if not point_in_extent(stop['coordinates'], extent):
            return False
    return True


def direction_headsign(route_name, stops):
    """Derive a direction headsign from route name or endpoint stop names."""
    if route_name:
        return route_name
    if not stops:
        return ''
    first_stop_name = stops[0].get('name', '')
    last_stop_name = stops[-1].get('name', '')
    if first_stop_name and last_stop_name:
        return f'{first_stop_name} - {last_stop_name}'
    return ''


def build_osm_direction(relation, stops, municipalities):
    """Build one route direction from an OSM bus relation."""
    tags = relation['tags']
    route_name = tags.get('name', '')
    colour = tags.get('colour') or tags.get('color')
    first_coordinates = stops[0]['coordinates']
    last_coordinates = stops[-1]['coordinates']
    first_municipality = find_municipality(
        first_coordinates[0], first_coordinates[1], municipalities,
    )
    last_municipality = find_municipality(
        last_coordinates[0], last_coordinates[1], municipalities,
    )
    direction = {
        'relation_id': relation['id'],
        'relation_version': relation['version'],
        'ref': tags.get('ref', ''),
        'name': route_name,
        'colour': colour if colour else None,
        'network': classify_by_municipality(first_municipality, last_municipality),
        'headsign': direction_headsign(route_name, stops),
        'stops': stops,
        'fromMunicipality': first_municipality,
        'toMunicipality': last_municipality,
    }
    return direction


def should_skip_city_duplicate(direction, city_refs, extent):
    """Return whether an OSM direction duplicates an ePodgorica city route."""
    route_ref = direction['ref']
    if not route_ref or route_ref not in city_refs:
        return False
    return all_stops_in_extent(direction['stops'], extent)


def group_osm_directions(directions, route_master_membership):
    """Group directions by route_master membership; others stay as own lines."""
    groups = collections.defaultdict(list)
    for direction in directions:
        relation_id = direction['relation_id']
        route_master_id = route_master_membership.get(relation_id)
        if route_master_id is None:
            group_key = ('relation', relation_id)
        else:
            group_key = ('route_master', route_master_id)
        groups[group_key].append(direction)
    return groups


def build_route_from_directions(directions):
    """Build one published route object from grouped OSM directions."""
    first_direction = directions[0]
    route_number = first_direction['ref'] or None
    network_counts = collections.Counter(direction['network']
                                        for direction in directions)
    group_network = network_counts.most_common(1)[0][0]

    route_directions = []
    for direction in directions:
        direction_entry = {
            'entityId': f"relation/{direction['relation_id']}",
            'entityVersion': direction['relation_version'],
            'headsign': direction['headsign'],
            'stops': direction['stops'],
        }
        from_municipality = direction.get('fromMunicipality')
        to_municipality = direction.get('toMunicipality')
        if from_municipality:
            direction_entry['fromMunicipality'] = from_municipality
        if to_municipality:
            direction_entry['toMunicipality'] = to_municipality
        route_directions.append(direction_entry)

    route = {
        'network': group_network,
        'directions': route_directions,
    }
    if first_direction['name']:
        route['name'] = first_direction['name']
    if route_number:
        route['number'] = route_number
    if first_direction['colour']:
        route['colour'] = first_direction['colour']
    return route


def build_osm_routes(osm_relations, route_masters, network, municipalities, pbf_path):
    """Build routes from OSM bus relations.

    Each OSM relation becomes one direction with entityId and entityVersion.
    Directions are grouped only by route_master membership; relations without a
    route_master are each their own line.
    """
    city_refs = get_city_route_refs(network)
    extent = epodgorica_stops_extent(network)
    route_master_membership = build_route_master_membership(route_masters)

    member_node_ids = _collect_member_node_ids(osm_relations)
    print(f'  {len(member_node_ids)} unique stop node IDs to resolve')
    osm_nodes = load_osm_nodes_for_ids(pbf_path, member_node_ids)
    print(f'  {len(osm_nodes)} nodes resolved')

    directions = []
    for relation in osm_relations:
        stops = relation_stops(relation, osm_nodes)
        if not stops:
            continue
        direction = build_osm_direction(relation, stops, municipalities)
        if should_skip_city_duplicate(direction, city_refs, extent):
            continue
        directions.append(direction)

    grouped_directions = group_osm_directions(directions, route_master_membership)
    routes = [build_route_from_directions(group) for group in grouped_directions.values()]
    return routes


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def route_sort_key(route):
    """Sort routes by network, then number, then name."""
    network_order = 0 if route['network'] == 'bus' else 1
    number = route.get('number') or ''
    name = route.get('name') or ''
    return (network_order, number, name)


def build_transit_routes(network, pbf_path, municipalities_path):
    """Build the complete transit routes from all sources."""
    print('Building city routes from ePodgorica data...')
    city_routes = build_city_routes(network)
    print(f'  {len(city_routes)} city routes')

    print(f'Loading OSM bus relations from {pbf_path}...')
    osm_relations, route_masters = load_osm_bus_relations(pbf_path)
    print(f'  {len(osm_relations)} OSM bus relations, {len(route_masters)} route masters')

    municipalities = load_municipalities(municipalities_path, pbf_path)

    print('Building OSM routes...')
    osm_routes = build_osm_routes(osm_relations, route_masters, network,
                                  municipalities, pbf_path)
    bus_count = sum(1 for route in osm_routes if route['network'] == 'bus')
    intercity_count = sum(1 for route in osm_routes if route['network'] == 'intercity')
    print(f'  {len(osm_routes)} OSM routes ({bus_count} bus, {intercity_count} intercity)')

    all_routes = city_routes + osm_routes
    all_routes.sort(key=route_sort_key)
    return all_routes


def write_routes(path, routes, retrieved_at):
    """Write transit routes JSON with one route per line for git merges."""
    header = json.dumps({
        'retrievedAt': retrieved_at,
        'source': 'https://epodgorica.me/javniprevoz/mapa',
        'version': 1,
    }, ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    route_lines = [json.dumps(route, ensure_ascii=False, separators=(',', ':'),
                              sort_keys=True) for route in routes]
    body = ',\n'.join(route_lines)
    full_text = header[:-1] + ',"routes":[\n' + body + '\n]}\n'
    encoded = full_text.encode('utf-8')
    path.write_bytes(encoded)
    return encoded


def write_provenance(provenance_path, file_bytes, routes, network_provenance_path,
                     pbf_path, municipalities_path):
    """Write provenance for transit routes.

    The output records each source with its own licence and attribution. The
    ePodgorica retrieval time comes from transit-network.provenance.json, and
    the PBF is recorded by file name, SHA-256 and replication timestamp.
    """
    network_provenance = load_json(network_provenance_path)
    pbf_metadata = load_pbf_metadata(pbf_path)
    city_route_count = sum(1 for route in routes if route.get('number') and
                           not any(direction.get('entityId')
                                   for direction in route.get('directions', [])))
    osm_route_count = sum(1 for route in routes
                          if any(direction.get('entityId')
                                 for direction in route.get('directions', [])))
    intercity_count = sum(1 for route in routes if route['network'] == 'intercity')

    municipality_source = {
        'fileName': municipalities_path.name,
    }
    if municipalities_path.exists():
        municipality_bytes = municipalities_path.read_bytes()
        municipality_source['sha256'] = hashlib.sha256(municipality_bytes).hexdigest()

    provenance = {
        'bytes': len(file_bytes),
        'city_routes': city_route_count,
        'intercity_routes': intercity_count,
        'osm_routes': osm_route_count,
        'routes': len(routes),
        'routes_with_colour': sum(1 for route in routes if 'colour' in route),
        'sha256': hashlib.sha256(file_bytes).hexdigest(),
        'sources': [
            {
                'attribution': 'ePodgorica (https://epodgorica.me/javniprevoz/mapa)',
                'license': network_provenance.get(
                    'license',
                    'No explicit reuse license found; attribution retained.',
                ),
                'retrieved_at': network_provenance['retrieved_at'],
                'source': network_provenance['source'],
            },
            {
                'attribution': '© OpenStreetMap contributors',
                'fileName': pbf_metadata['fileName'],
                'license': 'Open Database License 1.0 (ODbL)',
                'replicationTimestamp': pbf_metadata['replicationTimestamp'],
                'sha256': pbf_metadata['sha256'],
                'source': 'https://download.geofabrik.de/europe/montenegro/montenegro-latest.osm.pbf',
            },
            {
                'attribution': '© OpenStreetMap contributors (municipality boundaries from reviewed source)',
                'license': 'Open Database License 1.0 (ODbL)',
                'source': 'data/sources/municipalities.geojson',
                **municipality_source,
            },
        ],
    }
    output = json.dumps(provenance, indent=2, ensure_ascii=False,
                        sort_keys=True) + '\n'
    provenance_path.write_text(output, encoding='utf-8')
    return provenance


def main():
    args = parse_args()

    print(f'Loading transit network from {args.network}')
    network = load_network(args.network)
    print(f'  {len(network.get("patterns", []))} patterns')

    network_retrieved_at = load_network_retrieved_at(args.network_provenance)

    print('Building transit routes...')
    routes = build_transit_routes(network, args.pbf, args.municipalities)

    print(f'Writing routes to {args.output}')
    file_bytes = write_routes(args.output, routes, network_retrieved_at)

    provenance_path = args.output.with_suffix('.provenance.json')
    provenance = write_provenance(provenance_path, file_bytes, routes,
                                  args.network_provenance, args.pbf,
                                  args.municipalities)

    print(f'Written {len(routes)} routes '
          f'({provenance["city_routes"]} city, {provenance["intercity_routes"]} intercity)')
    print(f'  {provenance["routes_with_colour"]} with colour')
    print(f'  {provenance["bytes"]} bytes, SHA-256 {provenance["sha256"][:16]}...')


if __name__ == '__main__':
    main()
