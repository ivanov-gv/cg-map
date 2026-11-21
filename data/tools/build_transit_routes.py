"""Build transit-routes.json from ePodgorica data and OSM bus relations.

City routes come from the ePodgorica transit network (import-transit.py data).
Intercity routes come from OSM route=bus relations that leave Podgorica or run
between towns. Each route records number, name, network type, colour (if any),
and ordered stop lists for each direction.

The tool reads transit-network.json for city routes and the OSM PBF for intercity
routes. It writes data/sources/transit-routes.json and its provenance file.

Usage:
    python3 data/tools/build-transit-routes.py [--network FILE] [--pbf FILE]

Requires osmium and shapely from data/tools/requirements.txt for OSM parsing.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_NETWORK = ROOT / 'data/sources/transit-network.json'
DEFAULT_PBF = Path.home() / '.cache/cg-map/montenegro-2026-11-21.osm.pbf'
OUTPUT = ROOT / 'data/sources/transit-routes.json'

# Podgorica bounding box (approximate, in degrees)
PODGORICA_BOUNDS = {
    'min_lon': 19.0,
    'max_lon': 19.6,
    'min_lat': 42.3,
    'max_lat': 42.6,
}


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


def build_city_routes(network):
    """Build city bus routes from the ePodgorica transit network patterns.

    Groups patterns by route number and pairs opposite directions together.
    Returns a list of route objects.
    """
    # Group patterns by route number
    route_patterns = {}
    for pattern in network.get('patterns', []):
        route_number = pattern['route']
        route_patterns.setdefault(route_number, []).append(pattern)

    routes = []
    for route_number, patterns in sorted(route_patterns.items(), key=lambda x: x[0]):
        route_name = patterns[0].get('name', '')

        # Group directions by headsign — each unique stop sequence is a direction
        directions = []
        seen_stop_tuples = set()

        for pattern in patterns:
            stop_tuple = tuple(pattern['stops'])
            if stop_tuple not in seen_stop_tuples:
                seen_stop_tuples.add(stop_tuple)
                directions.append({
                    'headsign': pattern.get('headsign', ''),
                    'stops': pattern['stops'],
                })

        route = {
            'number': route_number,
            'name': route_name,
            'network': 'bus',
            'directions': directions,
        }

        # Add colour only if the source provides it
        # ePodgorica API does not currently publish colours
        if 'colour' in patterns[0]:
            route['colour'] = patterns[0]['colour']

        routes.append(route)

    return routes


def point_in_podgorica(lon, lat):
    """Check if a coordinate falls within the Podgorica bounding box."""
    return (PODGORICA_BOUNDS['min_lon'] <= lon <= PODGORICA_BOUNDS['max_lon'] and
            PODGORICA_BOUNDS['min_lat'] <= lat <= PODGORICA_BOUNDS['max_lat'])


def is_intercity_relation(relation_tags, member_nodes):
    """Determine if an OSM bus relation is an intercity route.

    A relation is intercity if it has stops outside Podgorica's bounds
    or connects different towns.
    """
    has_podgorica_stop = False
    has_outside_stop = False

    for lon, lat in member_nodes:
        if point_in_podgorica(lon, lat):
            has_podgorica_stop = True
        else:
            has_outside_stop = True

    # Intercity if it has stops outside Podgorica
    return has_outside_stop


def load_osm_bus_relations(pbf_path):
    """Load bus relations from an OSM PBF file using osmium.

    Returns a list of relation data with tags and member information.
    """
    try:
        import osmium
    except ImportError:
        print('Warning: osmium not available, skipping OSM intercity routes', flush=True)
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


def load_osm_nodes(pbf_path):
    """Load node coordinates from an OSM PBF file.

    Returns a dict mapping node ID to (lon, lat).
    """
    try:
        import osmium
    except ImportError:
        return {}

    class NodeHandler(osmium.SimpleHandler):
        def __init__(self):
            super().__init__()
            self.nodes = {}

        def node(self, n):
            self.nodes[n.id] = (n.location.lon, n.location.lat)

    handler = NodeHandler()
    handler.apply_file(str(pbf_path))
    return handler.nodes


def build_intercity_relations(osm_relations, osm_nodes):
    """Build intercity routes from OSM bus relations.

    Filters to only include relations that are truly intercity (not Podgorica city
    routes that also exist in ePodgorica data). Relations with the same route number
    are merged into one route with multiple directions.
    """
    # City route numbers from ePodgorica — skip these in OSM
    city_route_numbers = {
        '0', '1', '3', '4', '5', '6', '9', '10', '11', '12', '13', '15|7',
        '16', '18', '19', '20', '21', '23', '30', '38', '3A', '51|52',
        '53B', '54B', '55', '62', '6A', '8|53', '1B',
    }

    # Group by route number to merge opposite directions
    route_groups = {}

    for relation in osm_relations:
        tags = relation['tags']
        route_ref = tags.get('ref', '')

        # Skip if this is a city route already in ePodgorica
        if route_ref in city_route_numbers:
            continue

        # Get stop/platform members in order. OSM uses various roles:
        # 'stop', 'platform', 'platform_entry_only', 'platform_exit_only'
        stop_roles = {'stop', 'platform', 'platform_entry_only', 'platform_exit_only'}
        stop_members = [m for m in relation['members'] if m[2] in stop_roles]

        if not stop_members:
            # Some relations only have way members (the route path), no stops
            # Skip relations without stop information
            continue

        # Resolve node coordinates for stops. OSM member types are lowercase:
        # 'n' for node, 'w' for way, 'r' for relation.
        stop_coords = []
        stop_ids = []
        for member_type, member_ref, role in stop_members:
            if member_type == 'n':  # Node (osmium uses lowercase)
                node_id = member_ref
                if node_id in osm_nodes:
                    lon, lat = osm_nodes[node_id]
                    stop_coords.append((lon, lat))
                    stop_ids.append(f'node/{node_id}')
            # Way and relation members are less common as stops; skip for now

        if not stop_coords:
            continue

        # Check if this is intercity
        if not is_intercity_relation(tags, stop_coords):
            continue

        route_name = tags.get('name', route_ref)
        route_number = route_ref if route_ref else f'relation/{relation["id"]}'

        # Group by route number; for unnamed routes, each relation is its own route
        group_key = route_number
        group = route_groups.setdefault(group_key, {
            'number': route_number,
            'name': route_name,
            'network': 'intercity',
            'directions': [],
            'osm_ids': [],
            'osm_versions': [],
            'colours': [],
        })

        # Use the longest name across relations in the group
        if len(route_name) > len(group['name']):
            group['name'] = route_name

        group['directions'].append({
            'headsign': route_name,
            'stops': stop_ids,
        })
        group['osm_ids'].append(f'relation/{relation["id"]}')
        group['osm_versions'].append(relation['version'])
        colour = tags.get('colour', tags.get('color', ''))
        if colour:
            group['colours'].append(colour)

    # Build final route list from groups
    routes = []
    for group in route_groups.values():
        route = {
            'number': group['number'],
            'name': group['name'],
            'network': 'intercity',
            'directions': group['directions'],
        }

        # Use the first OSM ID as the primary identity
        route['osm_id'] = group['osm_ids'][0]
        route['osm_version'] = group['osm_versions'][0]

        # Add colour if any relation in the group has one
        if group['colours']:
            route['colour'] = group['colours'][0]

        routes.append(route)

    return routes


def build_transit_routes(network, pbf_path):
    """Build the complete transit routes from all sources."""
    print('Building city routes from ePodgorica data...')
    city_routes = build_city_routes(network)
    print(f'  {len(city_routes)} city routes')

    print(f'Loading OSM bus relations from {pbf_path}...')
    osm_relations = load_osm_bus_relations(pbf_path)
    print(f'  {len(osm_relations)} OSM bus relations')

    if osm_relations:
        print('Loading OSM node coordinates...')
        osm_nodes = load_osm_nodes(pbf_path)
        print(f'  {len(osm_nodes)} nodes loaded')

        print('Building intercity routes from OSM...')
        intercity_routes = build_intercity_relations(osm_relations, osm_nodes)
        print(f'  {len(intercity_routes)} intercity routes')
    else:
        intercity_routes = []

    all_routes = city_routes + intercity_routes
    return all_routes


def write_routes(path, routes, network):
    """Write the transit routes JSON with deterministic formatting."""
    data = {
        'version': 1,
        'retrievedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'source': 'https://epodgorica.me/javniprevoz/mapa',
        'routes': routes,
    }
    encoded = (json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    path.write_bytes(encoded)
    return encoded, data


def write_provenance(provenance_path, file_bytes, routes, network):
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
    output = json.dumps(provenance, indent=2, ensure_ascii=False) + '\n'
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
    file_bytes, data = write_routes(args.output, routes, network)

    provenance_path = args.output.with_suffix('.provenance.json')
    provenance = write_provenance(provenance_path, file_bytes, routes, network)

    print(f'Written {len(routes)} routes ({provenance["city_routes"]} city, {provenance["intercity_routes"]} intercity)')
    print(f'  {provenance["routes_with_colour"]} with colour')
    print(f'  {provenance["bytes"]} bytes, SHA-256 {provenance["sha256"][:16]}...')


if __name__ == '__main__':
    main()
