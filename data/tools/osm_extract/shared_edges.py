"""Build shared boundary edges and rebuild municipality polygons from them."""

from collections import defaultdict
from itertools import combinations

from shapely.geometry import (
    LineString, MultiLineString, Point, Polygon, mapping
)
from shapely.ops import linemerge, polygonize, unary_union

from .geometry import rounded_geometry
from .identity import content_version, osm_identity

EDGE_SIMPLIFY_DEGREES = 0.00003
SAMPLE_OFFSET_DEGREES = 0.00002
OUTSIDE_COUNTRY = 'ME'
SEA = 'sea'


def coordinate_key(line):
    """Return a direction-independent key for a line's rounded coordinates."""
    coordinates = tuple(
        (round(point[0], 6), round(point[1], 6)) for point in line.coords
    )
    return min(coordinates, coordinates[::-1])


def line_parts(geometry):
    """Return every LineString inside a shapely boundary result."""
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'LineString':
        return [geometry]
    if hasattr(geometry, 'geoms'):
        return [
            line for part in geometry.geoms for line in line_parts(part)
        ]
    return []


def merged_lines(geometries):
    """Join touching boundary pieces so one edge is stored once."""
    if not geometries:
        return []
    if len(geometries) == 1:
        return geometries
    joined = linemerge(MultiLineString(geometries))
    return [line for line in line_parts(joined) if line.length > 0]


def shared_boundaries(areas):
    """Return each boundary segment shared by two municipality areas."""
    edges = []
    for (left_code, left_area), (right_code, right_area) in combinations(
        areas, 2
    ):
        shared = left_area.boundary.intersection(right_area.boundary)
        for line in merged_lines(line_parts(shared)):
            edges.append((line, left_code, right_code))
    return edges


def outside_boundaries(areas):
    """Return each municipality boundary that no other municipality shares."""
    edges = []
    for index, (iso_code, area) in enumerate(areas):
        neighbours = unary_union([
            other.boundary
            for other_index, (_, other) in enumerate(areas)
            if other_index != index
        ])
        outer = area.boundary.difference(neighbours)
        for line in merged_lines(line_parts(outer)):
            edges.append((line, iso_code, None))
    return edges


def label_at(point, municipalities, land, context):
    """Name the area containing a sample point, including outside context."""
    for iso_code, area in municipalities:
        if area.covers(point):
            return iso_code
    if land.covers(point):
        return OUTSIDE_COUNTRY
    for name, area in context:
        if area.covers(point):
            return name
    return SEA


def direction_at(line, fraction):
    """Return the segment direction at one point along a line."""
    coordinates = list(line.coords)
    target = line.length * fraction
    travelled = 0.0
    for start, end in zip(coordinates, coordinates[1:]):
        segment = LineString([start, end])
        if travelled + segment.length >= target:
            return end[0] - start[0], end[1] - start[1]
        travelled += segment.length
    return (
        coordinates[-1][0] - coordinates[0][0],
        coordinates[-1][1] - coordinates[0][1],
    )


def side_labels_at(line, fraction, municipalities, land, context):
    """Sample the two sides of a line at one position."""
    point = line.interpolate(fraction, normalized=True)
    delta_longitude, delta_latitude = direction_at(line, fraction)
    length = (delta_longitude ** 2 + delta_latitude ** 2) ** 0.5
    if length == 0:
        delta_longitude, delta_latitude, length = 1.0, 0.0, 1.0
    offset = min(SAMPLE_OFFSET_DEGREES, line.length / 4)
    normal_longitude = -delta_latitude / length * offset
    normal_latitude = delta_longitude / length * offset
    left = Point(
        point.x - normal_longitude, point.y - normal_latitude
    )
    right = Point(
        point.x + normal_longitude, point.y + normal_latitude
    )
    return (
        label_at(left, municipalities, land, context),
        label_at(right, municipalities, land, context),
    )


def side_labels(line, municipalities, land, context):
    """Return distinct labels on the sides of an edge, sampling as needed."""
    for fraction in (0.5, 0.25, 0.75, 0.1, 0.9):
        labels = side_labels_at(
            line, fraction, municipalities, land, context
        )
        if labels[0] != labels[1]:
            return labels
    return side_labels_at(line, 0.5, municipalities, land, context)


def slug(value):
    """Make an area name safe for a derived entity ID."""
    return '-'.join(
        part for part in ''.join(
            character.lower()
            if character.isascii() and character.isalnum() else ' '
            for character in value
        ).split()
    )


def segment_key(start, end):
    """Identify an OSM way segment independently of its direction."""
    rounded_start = (round(start[0], 6), round(start[1], 6))
    rounded_end = (round(end[0], 6), round(end[1], 6))
    return min((rounded_start, rounded_end), (rounded_end, rounded_start))


def way_segment_index(boundary_ways):
    """Index OSM way IDs by the segments they contribute to boundaries."""
    index = defaultdict(set)
    for way_id, way in boundary_ways.items():
        coordinates = way['coordinates']
        for start, end in zip(coordinates, coordinates[1:]):
            index[segment_key(start, end)].add(way_id)
    return index


def matching_way(line, way_keys):
    """Return an OSM way ID only when exactly one way has this full geometry."""
    key = coordinate_key(line)
    matches = [
        way_id for way_id, way_key in way_keys.items() if way_key == key
    ]
    return matches[0] if len(matches) == 1 else None


def edge_osm_ways(line, segment_index):
    """List OSM ways that contributed segments to one edge."""
    ways = set()
    coordinates = list(line.coords)
    for start, end in zip(coordinates, coordinates[1:]):
        ways.update(segment_index.get(segment_key(start, end), ()))
    return sorted(ways, key=int)


def simplified_geometry(line):
    """Simplify one edge once and round it to reviewed coordinate precision."""
    simplified = line.simplify(
        EDGE_SIMPLIFY_DEGREES, preserve_topology=True
    )
    return rounded_geometry(mapping(simplified))


def ordered_edge(line, first, second, areas, land, context):
    """Direct an edge so its left label sorts before its right label."""
    sampled = side_labels(line, areas, land, context)
    if second is None:
        if first == sampled[0]:
            geometric = (first, sampled[1])
        elif first == sampled[1]:
            geometric = (sampled[0], first)
        else:
            outside = next(
                (label for label in sampled if label != first),
                SEA if SEA in sampled else OUTSIDE_COUNTRY,
            )
            geometric = (first, outside)
    elif set(sampled) == {first, second}:
        geometric = sampled
    else:
        geometric = (first, second)
    coordinates = list(line.coords)
    left, right = geometric
    if left > right:
        coordinates.reverse()
        left, right = right, left
    return LineString(coordinates), left, right


def build_edges(areas, land, context, boundary_ways):
    """Return one feature per shared edge between two areas."""
    segments = [
        *shared_boundaries(areas), *outside_boundaries(areas)
    ]
    segment_index = way_segment_index(boundary_ways)
    way_keys = {
        way_id: coordinate_key(LineString(way['coordinates']))
        for way_id, way in boundary_ways.items()
    }
    derived_counts = defaultdict(int)
    used_ways = set()
    edges = []
    for raw_line, first, second in sorted(
        segments, key=lambda segment: coordinate_key(segment[0])
    ):
        line, left, right = ordered_edge(
            raw_line, first, second, areas, land, context
        )
        osm_ways = edge_osm_ways(line, segment_index)
        full_way = matching_way(line, way_keys)
        if full_way is not None and full_way not in used_ways:
            used_ways.add(full_way)
            version = boundary_ways[full_way]['version']
            identity = osm_identity('way', full_way, version)
        else:
            pair = f'{slug(left)}-{slug(right)}'
            derived_counts[pair] += 1
            identity = {
                'entityId': (
                    f'derived:edge-{pair}-{derived_counts[pair]}'
                ),
                'entityVersion': None,
            }
        properties = {
            'kind': 'border',
            'left': left,
            'right': right,
            'osmWays': [f'way/{way_id}' for way_id in osm_ways],
        }
        geometry = simplified_geometry(line)
        if identity['entityVersion'] is None:
            identity['entityVersion'] = content_version({
                'geometry': geometry, 'properties': properties
            })
        edges.append({
            'type': 'Feature', 'geometry': geometry,
            'properties': {**properties, **identity},
        })
    return edges


def edge_lines(edges):
    """Index simplified edge geometries by their published entity ID."""
    lines = {}
    for feature in edges:
        properties = feature['properties']
        lines[properties['entityId']] = LineString(
            feature['geometry']['coordinates']
        )
    if len(lines) != len(edges):
        raise ValueError('shared edges have duplicate entity IDs')
    return lines


def directed_coordinates(reference, lines):
    """Return the coordinates a municipality walks for one edge reference."""
    coordinates = list(lines[reference['id']].coords)
    if reference['direction'] == -1:
        coordinates.reverse()
    return coordinates


def trace_rings(references, lines):
    """Walk directed edge references until every ring closes."""
    choices = defaultdict(list)
    for index, reference in enumerate(references):
        coordinates = directed_coordinates(reference, lines)
        choices[tuple(coordinates[0])].append(
            (index, reference, coordinates)
        )
    unused = set(range(len(references)))
    rings = []
    while unused:
        first_index = min(unused)
        ring = list(directed_coordinates(references[first_index], lines))
        unused.remove(first_index)
        while ring[-1] != ring[0]:
            next_options = [
                option for option in choices.get(tuple(ring[-1]), ())
                if option[0] in unused
            ]
            if not next_options:
                raise ValueError('municipality edges do not close a ring')
            next_index, _, next_coordinates = min(
                next_options, key=lambda option: option[1]['id']
            )
            ring.extend(next_coordinates[1:])
            unused.remove(next_index)
        rings.append([list(coordinate) for coordinate in ring])
    return rings


def polygon_from_rings(rings):
    """Fill an even-odd set of rings to rebuild a municipality polygon."""
    polygons = [Polygon(ring) for ring in rings]
    faces = list(polygonize([LineString(ring) for ring in rings]))
    selected = [
        face for face in faces
        if sum(
            polygon.covers(face.representative_point())
            for polygon in polygons
        ) % 2 == 1
    ]
    if not selected:
        raise ValueError('municipality rings enclose no area')
    geometry = unary_union(selected)
    if geometry.geom_type not in ('Polygon', 'MultiPolygon'):
        raise ValueError('municipality rings do not rebuild a polygon')
    return geometry


def rebuild_municipality(feature, lines):
    """Rebuild one municipality's polygon solely from its edge references."""
    references = feature['properties']['edges']
    if not references:
        raise ValueError('municipality has no edges')
    for reference in references:
        if reference['id'] not in lines:
            raise ValueError(f'unknown edge: {reference["id"]}')
        if reference['direction'] not in (1, -1):
            raise ValueError('edge direction must be 1 or -1')
    return polygon_from_rings(trace_rings(references, lines))


def directed_references(iso_code, edges):
    """Return directed edge references that close one municipality's rings."""
    touching = [
        (edge_feature, edge_feature['properties']['left'] == iso_code)
        for edge_feature in edges
        if iso_code in (
            edge_feature['properties']['left'],
            edge_feature['properties']['right'],
        )
    ]
    return [
        {
            'id': edge_feature['properties']['entityId'],
            'direction': 1 if is_left else -1,
        }
        for edge_feature, is_left in sorted(
            touching,
            key=lambda edge_side: edge_side[0]['properties']['entityId'],
        )
    ]
