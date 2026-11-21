"""Build transit-routes.json from ePodgorica data and OSM bus relations.

City routes (network "bus") come from the ePodgorica transit network.
OSM routes are classified as "bus" (city line of their own town) or "intercity"
based on distance and settlement count — see classify_relation() for the rule.

Each OSM relation becomes one direction with its own entityId and entityVersion.
Directions sharing the same OSM ref and route_master relation are grouped into
one line; without route_master, directions sharing ref are grouped.

Usage:
    python3 data/tools/build_transit_routes.py [--network FILE] [--pbf FILE]

Requires osmium from data/tools/requirements.txt for OSM parsing.
"""
import argparse
import collections
import datetime
import hashlib
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_NETWORK = ROOT / 'data/sources/transit-network.json'
DEFAULT_PBF = Path.home() / '.cache/cg-map/montenegro-2026-11-21.osm.pbf'
OUTPUT = ROOT / 'data/sources/transit-routes.json'

# Minimum distance (metres) between first and last stop for intercity classification.
INTERCITY_MIN_DISTANCE_METRES = 15000

# Minimum number of distinct settlements for intercity classification.
INTERCITY_MIN_SETTLEMENTS = 2


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network', default=DEFAULT_NETWORK, help='Path to transit-network.json')
    parser.add_argument('--pbf', default=DEFAULT_PBF, help='Path to OSM PBF file')
    parser.add_argument('--output', default=OUTPUT, help='Output transit-routes.json path')
    return parser.parse_args()


def load_network(path):
    """Load the transit network JSON."""
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# City routes from ePodgorica
# ---------------------------------------------------------------------------

def _direction_key(sample_trip):
    """Extract the direction indicator from a sampleTrip code.

    The sampleTrip field encodes direction: '_AB_' means outward (A→B),
    '_BA_' means return (B→A). Variants may carry extra tags like '_PR_'
    (special route) but share the same base direction.

    Returns 'AB' or 'BA', or None if the pattern cannot be parsed.
    """
    if '_AB_' in sample_trip:
        return 'AB'
    if '_BA_' in sample_trip:
        return 'BA'
    return None


def build_city_routes(network):
    """Build city bus routes from the ePodgorica transit network patterns.

    Patterns are grouped by route number, then by direction (AB/BA from
    sampleTrip). Each direction gets one primary stop list and a variants
    array for alternative sampled sequences of the same direction.

    Returns a list of route objects sorted by number then name.
    """
    route_patterns = collections.defaultdict(list)
    for pattern in network.get('patterns', []):
        route_patterns[pattern['route']].append(pattern)

    routes = []
    for route_number in sorted(route_patterns):
        patterns = route_patterns[route_number]
        route_name = patterns[0].get('name', '')

        # Group patterns by direction key (AB / BA)
        direction_groups = collections.defaultdict(list)
        for pattern in patterns:
            key = _direction_key(pattern.get('sampleTrip', ''))
            if key is None:
                key = 'unknown'
            direction_groups[key].append(pattern)

        directions = []
        for direction_key in sorted(direction_groups):
            group = direction_groups[direction_key]
            # Use the first pattern as the primary direction
            primary = group[0]
            direction_entry = {
                'headsign': primary.get('headsign', ''),
                'stops': primary['stops'],
            }
            # Collect variants (other stop sequences for this direction)
            if len(group) > 1:
                variants = []
                for variant in group[1:]:
                    variant_stops = variant['stops']
                    if variant_stops != primary['stops']:
                        variants.append({
                            'headsign': variant.get('headsign', ''),
                            'stops': variant_stops,
                        })
                if variants:
                    direction_entry['variants'] = variants
            directions.append(direction_entry)

        route = {
            'number': route_number,
            'name': route_name,
            'network': 'bus',
            'directions': directions,
        }
        if 'colour' in patterns[0]:
            route['colour'] = patterns[0]['colour']
        routes.append(route)

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
    """Load bus relations from an OSM PBF file using osmium (first pass).

    Returns a list of relation dicts with id, version, tags and members.
    """
    try:
        import osmium
    except ImportError:
        print('Warning: osmium not available, skipping OSM routes', flush=True)
        return []

    class BusRelationHandler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.relations = []

        def relation(self, r):
            if r.tags.get('route') == 'bus':
                self.relations.append({
                    'id': r.id,
                    'version': r.version,
                    'tags': dict(r.tags),
                    'members': [(m.type, m.ref, m.role) for m in r.members],
                })

    handler = BusRelationHandler()
    handler.apply_file(str(pbf_path))
    return handler.relations


def load_osm_nodes_for_ids(pbf_path, node_ids):
    """Load only the named node IDs from an OSM PBF (second pass).

    Returns a dict mapping node ID to (lon, lat, tags_dict).
    Only reads nodes whose ID is in *node_ids*, keeping memory low.
    """
    try:
        import osmium
    except ImportError:
        return {}

    class SelectiveNodeHandler(osmium.SimpleHandler):
        def __init__(self, target_ids):
            super().__init__()
            self.target_ids = target_ids
            self.nodes = {}

        def node(self, n):
            if n.id in self.target_ids:
                tags = dict(n.tags) if n.tags else {}
                self.nodes[n.id] = {
                    'lon': n.location.lon,
                    'lat': n.location.lat,
                    'tags': tags,
                }

    handler = SelectiveNodeHandler(node_ids)
    handler.apply_file(str(pbf_path))
    return handler.nodes


# ---------------------------------------------------------------------------
# Intercity classification
# ---------------------------------------------------------------------------

def haversine_distance_metres(lon1, lat1, lon2, lat2):
    """Great-circle distance in metres between two WGS84 points."""
    R = 6371000
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (math.sin(d_lat / 2) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(d_lon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _extract_settlements_from_name(name):
    """Extract settlement names from an OSM route name or ref.

    Route names often encode endpoints: 'Budva -> Sveti Stefan',
    'Bar -> Budva'. Only arrow-style separators ('->', '=>') are trusted
    as intercity indicators; plain dashes may separate neighborhoods
    within one town ('Tivat centar - Gradiošnica').

    Returns a set of settlement name strings, or empty set if the name
    uses only dash separators (which may be local routes).
    """
    if not name:
        return set()
    # Only trust arrow separators for intercity classification.
    # Plain dashes may separate neighborhoods within one town.
    if '->' not in name and '=>' not in name:
        return set()
    parts = re.split(r'\s*[-=>]+\s*|,\s*', name)
    cleaned = set()
    for part in parts:
        part = part.strip().strip('"()')
        if part and len(part) > 1:
            cleaned.add(part)
    return cleaned


def classify_relation(stop_coords, relation_name, relation_ref):
    """Classify an OSM bus relation as 'bus' or 'intercity'.

    Rule: a relation is 'intercity' when its first and last stops are at
    least 15 km apart, or its stops lie in two or more distinct settlements.
    Settlements are derived from the relation's name/ref (e.g. 'Budva -> Sveti
    Stefan') since OSM stop node names are stop/landmark names, not settlements.
    Only arrow-style separators ('->', '=>') are trusted; plain dashes may
    separate neighborhoods within one town. Short shuttles (under 2 km) are
    always 'bus' even when the name mentions two places.

    Returns 'intercity' or 'bus'.
    """
    # Minimum distance for the settlement-based criterion (metres).
    # Very short shuttles (e.g. 'Budva -> Lastva' at 1 km) are local.
    _settlement_min_distance_metres = 2000

    if len(stop_coords) >= 2:
        first_last_distance = haversine_distance_metres(
            stop_coords[0][0], stop_coords[0][1],
            stop_coords[-1][0], stop_coords[-1][1],
        )
        if first_last_distance >= INTERCITY_MIN_DISTANCE_METRES:
            return 'intercity'

        # Settlement criterion: 2+ settlements AND meaningful distance
        settlements = _extract_settlements_from_name(relation_name)
        settlements |= _extract_settlements_from_name(relation_ref)
        if (len(settlements) >= INTERCITY_MIN_SETTLEMENTS and
                first_last_distance >= _settlement_min_distance_metres):
            return 'intercity'

    return 'bus'


# ---------------------------------------------------------------------------
# OSM route building
# ---------------------------------------------------------------------------

def _get_city_route_refs(network):
    """Derive the set of city route numbers already covered by ePodgorica.

    Returns a set of route number strings from the transit network.
    """
    refs = set()
    for pattern in network.get('patterns', []):
        refs.add(pattern['route'])
    return refs


def _epodgorica_stops_extent(network):
    """Compute the bounding box of all ePodgorica stops.

    Returns (min_lon, max_lon, min_lat, max_lat) or None if no stops.
    """
    stops = network.get('stops', {})
    if not stops:
        return None
    lons = [s['coordinates'][0] for s in stops.values()]
    lats = [s['coordinates'][1] for s in stops.values()]
    return (min(lons), max(lons), min(lats), max(lats))


def _point_in_extent(point, extent):
    """Check if (lon, lat) falls inside a bounding box."""
    if extent is None:
        return False
    lon, lat = point
    min_lon, max_lon, min_lat, max_lat = extent
    return min_lon <= lon <= max_lon and min_lat <= lat <= max_lat


def build_osm_routes(osm_relations, network, pbf_path):
    """Build routes from OSM bus relations.

    Each OSM relation becomes one direction with entityId and entityVersion.
    Directions are grouped into lines when they share the same OSM ref and
    the same route_master relation (none exist in the current PBF, so grouping
    is by ref alone). Routes without ref are kept as separate lines.

    Classification ('bus' vs 'intercity') uses distance and settlement count.
    OSM routes whose ref matches an ePodgorica city route and whose stops
    fall inside the ePodgorica extent are skipped (already covered).

    Returns a list of route objects.
    """
    city_refs = _get_city_route_refs(network)
    ep_extent = _epodgorica_stops_extent(network)

    # First pass: collect member node IDs
    stop_roles = {'stop', 'platform', 'platform_entry_only', 'platform_exit_only'}
    member_node_ids = _collect_member_node_ids(osm_relations)
    print(f'  {len(member_node_ids)} unique stop node IDs to resolve')

    # Second pass: load only those nodes
    osm_nodes = load_osm_nodes_for_ids(pbf_path, member_node_ids)
    print(f'  {len(osm_nodes)} nodes resolved')

    # Process each relation into a direction
    raw_directions = []
    for relation in osm_relations:
        tags = relation['tags']
        route_ref = tags.get('ref', '')
        route_name = tags.get('name', '')
        route_master = tags.get('route_master', '')
        colour = tags.get('colour', tags.get('color', ''))

        # Skip relations already covered by ePodgorica.
        # If ref matches a city ref and all stops are inside the ePodgorica
        # extent, this is a duplicate of the city route — skip it.
        # If ref matches but stops are outside Podgorica, this is a different
        # route that happens to share the number (e.g. Herceg Novi ref=1 vs
        # Podgorica ref=1). Keep it but clear the number to avoid conflicts.
        if route_ref and route_ref in city_refs:
            stop_members = [m for m in relation['members']
                            if m[2] in stop_roles and m[0] == 'n']
            all_stops_in_extent = True
            for _, member_ref, _ in stop_members:
                if member_ref in osm_nodes:
                    node_data = osm_nodes[member_ref]
                    if not _point_in_extent((node_data['lon'], node_data['lat']), ep_extent):
                        all_stops_in_extent = False
                        break
            if all_stops_in_extent and stop_members:
                continue
            # Different route with same number — clear ref to avoid conflict
            route_ref = ''

        # Extract stop members with position and name
        stop_members = [m for m in relation['members']
                        if m[2] in stop_roles and m[0] == 'n']
        stops = []
        stop_coords = []
        for _, member_ref, _ in stop_members:
            if member_ref in osm_nodes:
                node_data = osm_nodes[member_ref]
                lon = round(node_data['lon'], 6)
                lat = round(node_data['lat'], 6)
                stop_name = node_data['tags'].get('name', '')
                stops.append({
                    'id': f'node/{member_ref}',
                    'name': stop_name,
                    'coordinates': [lon, lat],
                })
                stop_coords.append((lon, lat))

        if not stops:
            continue

        classification = classify_relation(stop_coords, route_name, route_ref)

        # Derive headsign from name, or from first/last stop names
        first_stop = stops[0].get('name', '') if stops else ''
        last_stop = stops[-1].get('name', '') if stops else ''
        headsign = (route_name or
                    f'{first_stop} - {last_stop}' if first_stop and last_stop else
                    f'relation/{relation["id"]}')

        raw_directions.append({
            'relation_id': relation['id'],
            'relation_version': relation['version'],
            'ref': route_ref,
            'name': route_name,
            'route_master': route_master,
            'colour': colour if colour else None,
            'network': classification,
            'headsign': headsign,
            'stops': stops,
        })

    # Group directions into lines by (ref, route_master)
    # Each direction keeps its own entityId/entityVersion
    group_key_func = lambda d: (d['ref'] or f'relation/{d["relation_id"]}',
                                 d['route_master'])
    groups = collections.defaultdict(list)
    for direction in raw_directions:
        groups[group_key_func(direction)].append(direction)

    routes = []
    for directions in groups.values():
        first = directions[0]
        route_number = first['ref'] if first['ref'] else None

        # Determine the network type for the group (majority vote)
        network_counts = collections.Counter(d['network'] for d in directions)
        group_network = network_counts.most_common(1)[0][0]

        route_directions = []
        for d in directions:
            dir_entry = {
                'entityId': f'relation/{d["relation_id"]}',
                'entityVersion': d['relation_version'],
                'headsign': d['headsign'],
                'stops': d['stops'],
            }
            route_directions.append(dir_entry)

        # Use the first direction's headsign as route name when the OSM
        # relation has no name tag.
        route_name = first['name'] or first['headsign']
        route = {
            'name': route_name,
            'network': group_network,
            'directions': route_directions,
        }
        if route_number:
            route['number'] = route_number
        if first['colour']:
            route['colour'] = first['colour']
        routes.append(route)

    return routes


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def _route_sort_key(route):
    """Sort routes by network, then number (empty last), then name."""
    net_order = 0 if route['network'] == 'bus' else 1
    number = route.get('number', '') or ''
    return (net_order, number, route['name'])


def build_transit_routes(network, pbf_path):
    """Build the complete transit routes from all sources."""
    print('Building city routes from ePodgorica data...')
    city_routes = build_city_routes(network)
    print(f'  {len(city_routes)} city routes')

    print(f'Loading OSM bus relations from {pbf_path}...')
    osm_relations = load_osm_bus_relations(pbf_path)
    print(f'  {len(osm_relations)} OSM bus relations')

    osm_routes = []
    if osm_relations:
        print('Building OSM routes...')
        osm_routes = build_osm_routes(osm_relations, network, pbf_path)
        bus_count = sum(1 for r in osm_routes if r['network'] == 'bus')
        intercity_count = sum(1 for r in osm_routes if r['network'] == 'intercity')
        print(f'  {len(osm_routes)} OSM routes ({bus_count} bus, {intercity_count} intercity)')

    all_routes = city_routes + osm_routes
    all_routes.sort(key=_route_sort_key)
    return all_routes


def write_routes(path, routes):
    """Write the transit routes JSON with deterministic formatting.

    Routes are sorted by network, number, name. Keys are sorted for
    clean git diffs.
    """
    data = {
        'version': 1,
        'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': 'https://epodgorica.me/javniprevoz/mapa',
        'routes': routes,
    }
    encoded = (json.dumps(data, ensure_ascii=False, separators=(',', ':'),
                          sort_keys=True) + '\n').encode('utf-8')
    path.write_bytes(encoded)
    return encoded


def write_provenance(provenance_path, file_bytes, routes):
    """Write the provenance JSON for transit routes."""
    city_count = sum(1 for r in routes if r['network'] == 'bus')
    intercity_count = sum(1 for r in routes if r['network'] == 'intercity')
    with_colour = sum(1 for r in routes if 'colour' in r)

    provenance = {
        'source': 'https://epodgorica.me/javniprevoz/mapa',
        'osm_source': str(DEFAULT_PBF),
        'retrieved_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'bytes': len(file_bytes),
        'sha256': hashlib.sha256(file_bytes).hexdigest(),
        'routes': len(routes),
        'city_routes': city_count,
        'intercity_routes': intercity_count,
        'routes_with_colour': with_colour,
        'license': 'No explicit reuse license found; attribution retained.',
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

    print('Building transit routes...')
    routes = build_transit_routes(network, args.pbf)

    print(f'Writing routes to {args.output}')
    file_bytes = write_routes(args.output, routes)

    provenance_path = args.output.with_suffix('.provenance.json')
    provenance = write_provenance(provenance_path, file_bytes, routes)

    print(f'Written {len(routes)} routes '
          f'({provenance["city_routes"]} city, {provenance["intercity_routes"]} intercity)')
    print(f'  {provenance["routes_with_colour"]} with colour')
    print(f'  {provenance["bytes"]} bytes, SHA-256 {provenance["sha256"][:16]}...')


if __name__ == '__main__':
    main()
