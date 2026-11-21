"""Enrich transport-stops.geojson with lines, side-of-road, and name:en.

Lines come from transit-network.json patterns (which routes serve each stop).
Side is computed from the nearest road in roads.geojson using its drawing direction.
name:en is added only where the ePodgorica API publishes one.

Usage:
    python3 data/tools/enrich-stops.py [--stops FILE] [--network FILE] [--roads FILE]

The tool reads the existing files, writes the enriched stops back, and updates
the provenance hash and byte count. It exits non-zero on invalid input.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_STOPS = ROOT / 'data/sources/transport-stops.geojson'
DEFAULT_NETWORK = ROOT / 'data/sources/transit-network.json'
DEFAULT_ROADS = ROOT / 'data/sources/roads.geojson'

# Maximum distance in degrees for a road to count as "nearby".
# 30 metres at Podgorica's latitude (~42.4°N) is about 0.00027 degrees.
MAX_ROAD_DISTANCE_DEGREES = 0.00027


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stops', default=DEFAULT_STOPS, help='Path to transport-stops.geojson')
    parser.add_argument('--network', default=DEFAULT_NETWORK, help='Path to transit-network.json')
    parser.add_argument('--roads', default=DEFAULT_ROADS, help='Path to roads.geojson')
    return parser.parse_args()


def load_stops(path):
    """Load the stop GeoJSON and return the FeatureCollection."""
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if data.get('type') != 'FeatureCollection':
        raise ValueError(f'{path}: expected FeatureCollection')
    return data


def load_network(path):
    """Load the transit network JSON."""
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_roads(path):
    """Load the roads GeoJSON and return the features."""
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    if data.get('type') != 'FeatureCollection':
        raise ValueError(f'{path}: expected FeatureCollection')
    return data['features']


def build_lines_index(network):
    """Build a mapping from stop ID to sorted list of route numbers that serve it."""
    stop_lines = {}
    for pattern in network.get('patterns', []):
        route_number = pattern['route']
        for stop_id in pattern['stops']:
            stop_lines.setdefault(stop_id, set()).add(route_number)
    # Sort line lists for deterministic output
    return {stop_id: sorted(lines) for stop_id, lines in stop_lines.items()}


def distance_squared(a, b):
    """Squared Euclidean distance between two [lon, lat] points (planar approximation)."""
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def closest_point_on_segment(point, segment_start, segment_end):
    """Return the closest point on a line segment to a given point.

    All coordinates are [longitude, latitude] in the planar approximation.
    """
    px, py = point
    sx, sy = segment_start
    ex, ey = segment_end

    # Vector from segment start to end
    dx = ex - sx
    dy = ey - sy
    squared_length = dx * dx + dy * dy

    if squared_length == 0:
        return segment_start

    # Project point onto segment, clamped to [0, 1]
    t = ((px - sx) * dx + (py - sy) * dy) / squared_length
    t = max(0.0, min(1.0, t))

    return [sx + t * dx, sy + t * dy]


def closest_distance_to_road(point, coordinates):
    """Return the minimum squared distance from a point to any segment of a road.

    coordinates is a list of [lon, lat] points forming the road LineString.
    """
    min_dist = float('inf')
    for i in range(len(coordinates) - 1):
        closest = closest_point_on_segment(point, coordinates[i], coordinates[i + 1])
        dist = distance_squared(point, closest)
        if dist < min_dist:
            min_dist = dist
    return min_dist


def side_of_road(stop_point, road_coordinates):
    """Determine whether a stop lies to the left or right of a road.

    The road's drawing direction defines "forward". We find the closest segment,
    compute the cross product of the segment direction and the vector from the
    segment to the stop. Positive cross product means left, negative means right.

    Returns 'left', 'right', or None if the road has fewer than 2 points.
    """
    if len(road_coordinates) < 2:
        return None

    # Find the closest segment
    min_dist = float('inf')
    best_segment = None

    for i in range(len(road_coordinates) - 1):
        closest = closest_point_on_segment(stop_point, road_coordinates[i], road_coordinates[i + 1])
        dist = distance_squared(stop_point, closest)
        if dist < min_dist:
            min_dist = dist
            best_segment = i

    if best_segment is None:
        return None

    segment_start = road_coordinates[best_segment]
    segment_end = road_coordinates[best_segment + 1]

    # Direction vector of the road segment
    dx = segment_end[0] - segment_start[0]
    dy = segment_end[1] - segment_start[1]

    # Vector from the closest point on segment to the stop
    closest = closest_point_on_segment(stop_point, segment_start, segment_end)
    vx = stop_point[0] - closest[0]
    vy = stop_point[1] - closest[1]

    # Cross product (2D): dx * vy - dy * vx
    # Positive means the stop is to the left of the road direction
    cross = dx * vy - dy * vx

    if cross > 0:
        return 'left'
    elif cross < 0:
        return 'right'
    else:
        # Stop is exactly on the road line — treat as no side
        return None


def find_nearest_road_side(stop_point, roads):
    """Find the nearest road within the distance threshold and return its side.

    Returns 'left', 'right', or None if no road is within range.
    """
    max_squared = MAX_ROAD_DISTANCE_DEGREES ** 2
    best_side = None
    best_dist = max_squared

    for road in roads:
        geometry = road.get('geometry', {})
        coords = geometry.get('coordinates', [])

        # Handle LineString and MultiLineString
        if geometry['type'] == 'LineString':
            line_sets = [coords]
        elif geometry['type'] == 'MultiLineString':
            line_sets = coords
        else:
            continue

        for line_coords in line_sets:
            dist = closest_distance_to_road(stop_point, line_coords)
            if dist < best_dist:
                best_dist = dist
                side = side_of_road(stop_point, line_coords)
                if side is not None:
                    best_side = side

    if best_dist <= max_squared and best_side is not None:
        return best_side
    return None


def enrich_stops(stops_data, network, roads):
    """Add lines, side, and name:en to each stop feature.

    - lines: sorted list of route numbers from the transit network
    - side: 'left' or 'right' of the nearest road, or omitted
    - name:en: only if the source (ePodgorica) publishes it

    Returns the count of stops enriched with each field.
    """
    lines_index = build_lines_index(network)
    stops_with_lines = 0
    stops_with_side = 0
    stops_with_name_en = 0

    for feature in stops_data['features']:
        stop_id = feature['id']
        properties = feature['properties']
        coordinates = feature['geometry']['coordinates']

        # Add lines from transit network
        if stop_id in lines_index:
            properties['lines'] = lines_index[stop_id]
            stops_with_lines += 1

        # Compute side of road
        side = find_nearest_road_side(coordinates, roads)
        if side is not None:
            properties['side'] = side
            stops_with_side += 1

        # name:en is only added if the source publishes it
        # Currently ePodgorica does not publish name:en, so this remains empty
        if 'name:en' in properties and properties['name:en']:
            stops_with_name_en += 1

    return stops_with_lines, stops_with_side, stops_with_name_en


def write_stops(path, data):
    """Write the enriched stops GeoJSON with deterministic formatting."""
    encoded = (json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    path.write_bytes(encoded)
    return encoded


def update_provenance(provenance_path, file_bytes):
    """Update the provenance JSON with new byte count and SHA-256."""
    with open(provenance_path, 'r', encoding='utf-8') as f:
        provenance = json.load(f)
    provenance['bytes'] = len(file_bytes)
    provenance['sha256'] = hashlib.sha256(file_bytes).hexdigest()
    output = json.dumps(provenance, indent=2, ensure_ascii=False) + '\n'
    provenance_path.write_text(output, encoding='utf-8')
    return provenance


def main():
    args = parse_args()

    print(f'Loading stops from {args.stops}')
    stops_data = load_stops(args.stops)
    print(f'  {len(stops_data["features"])} stops')

    print(f'Loading transit network from {args.network}')
    network = load_network(args.network)
    print(f'  {len(network.get("patterns", []))} patterns')

    print(f'Loading roads from {args.roads}')
    roads = load_roads(args.roads)
    print(f'  {len(roads)} road features')

    print('Enriching stops...')
    with_lines, with_side, with_name_en = enrich_stops(stops_data, network, roads)

    print(f'Writing enriched stops to {args.stops}')
    file_bytes = write_stops(args.stops, stops_data)

    provenance_path = args.stops.with_suffix('.provenance.json')
    if provenance_path.exists():
        provenance = update_provenance(provenance_path, file_bytes)
        print(f'Updated provenance: {provenance["bytes"]} bytes, SHA-256 {provenance["sha256"][:16]}...')

    print(f'Result: {with_lines} stops with lines, {with_side} with side, {with_name_en} with name:en')


if __name__ == '__main__':
    main()
