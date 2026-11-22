"""Build shared boundary edges and rebuild municipality polygons from them."""

from collections import defaultdict
from dataclasses import dataclass, field
from itertools import combinations

from shapely import STRtree
from shapely.geometry import (
    LineString, MultiLineString, Point, Polygon, mapping
)
from shapely.ops import linemerge, polygonize, unary_union

from .geometry import rounded_geometry
from .identity import content_version, osm_identity

EDGE_SIMPLIFY_DEGREES = 0.00003
SAMPLE_OFFSET_DEGREES = 0.00002
GEOMETRY_SAMPLE_DIVISORS = (1, 10, 100)
OUTSIDE_COUNTRY = 'ME'
SEA = 'sea'
COUNTRY_NAME_TAGS = ('left:country', 'right:country', 'name:en', 'int_name', 'name')
# Kosovo has reviewed OSM admin-level-2 ways but no Natural Earth context polygon.
OSM_ONLY_AUTHORITIES = frozenset({'Kosovo'})
COUNTRY_NAME_ALIASES = {
    'bosna i hercegovina': 'Bosnia and Herzegovina',
    'hrvatska': 'Croatia',
    'kosova': 'Kosovo',
    'shqipëria': 'Albania',
    'srbija': 'Republic of Serbia',
}
TERRITORIAL_WATERS = 'territorial waters'
OUTSIDE_MATCH_TOLERANCE_DEGREES = 0.00001
# A way touching one endpoint covers only about tolerance/segment_length of the
# segment. The reviewed outline has shallow crossings that cover under 1% but
# still more than an endpoint touch, so 0.1% separates the two without guessing
# a label from a single shared vertex.
MIN_AUTHORITY_OVERLAP_FRACTION = 0.001
# Buffer endpoints also appear where a way merely passes within the match
# tolerance. A supported overlap must extend further than the widest possible
# pass-through chord, so those touches cannot become transition cuts.
AUTHORITY_SUPPORT_TOLERANCES = 4


@dataclass
class EdgeBuildContext:
    """Inputs and counters shared while building one edge set."""

    areas: list
    land: object
    context: list
    boundary_ways: dict
    segment_index: dict
    way_keys: dict
    derived_counts: dict = field(default_factory=lambda: defaultdict(int))
    used_ways: set = field(default_factory=set)


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
    """Name the area containing a sample point, or None outside every area.

    Sea is not a fallback: an exterior way must claim it through coastline
    geometry before an edge can carry that label.
    """
    for iso_code, area in municipalities:
        if area.covers(point):
            return iso_code
    if land.covers(point):
        return OUTSIDE_COUNTRY
    for name, area in context:
        if area.covers(point):
            return name
    return None


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


def side_points_at(line, fraction, offset_divisor=1):
    """Return offset points on the left and right of one line position."""
    point = line.interpolate(fraction, normalized=True)
    delta_longitude, delta_latitude = direction_at(line, fraction)
    length = (delta_longitude ** 2 + delta_latitude ** 2) ** 0.5
    if length == 0:
        delta_longitude, delta_latitude, length = 1.0, 0.0, 1.0
    offset = min(SAMPLE_OFFSET_DEGREES, line.length / 4) / offset_divisor
    normal_longitude = -delta_latitude / length * offset
    normal_latitude = delta_longitude / length * offset
    return (
        Point(point.x + normal_longitude, point.y + normal_latitude),
        Point(point.x - normal_longitude, point.y - normal_latitude),
    )


def side_labels_at(line, fraction, municipalities, land, context):
    """Sample the two sides of a line at one position."""
    left, right = side_points_at(line, fraction)
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


def outside_way_label(tags, context_names):
    """Return the authority a boundary way claims on its non-municipal side."""
    if tags.get('natural') == 'coastline':
        return SEA
    is_country_border = (
        tags.get('boundary') == 'administrative'
        and tags.get('admin_level') == '2'
    )
    if not is_country_border:
        return None
    if TERRITORIAL_WATERS in tags.get('name', '').casefold():
        return SEA
    candidates = [
        tags[name].strip() for name in COUNTRY_NAME_TAGS if tags.get(name)
    ]
    authorities = set(context_names) | OSM_ONLY_AUTHORITIES
    ordered_names = sorted(authorities, key=lambda name: (-len(name), name))
    for candidate in candidates:
        candidate_key = candidate.casefold()
        for name in ordered_names:
            name_key = name.casefold()
            if (
                candidate_key == name_key
                or name_key in candidate_key
                or candidate_key in name_key
            ):
                return name
        for alias, name in sorted(
            COUNTRY_NAME_ALIASES.items(), key=lambda item: -len(item[0])
        ):
            if name in authorities and alias in candidate_key:
                return name
    return None


class OutsideAuthorityIndex:
    """Match boundary segments to the nearest authoritative OSM way."""

    def __init__(self, boundary_ways, context_names):
        self.authorities = [
            (LineString(way['coordinates']), label)
            for way in boundary_ways.values()
            if (label := outside_way_label(way['tags'], context_names))
            is not None
        ]
        self.tree = STRtree([geometry for geometry, _ in self.authorities])

    def label_for(self, segment):
        """Return the authority whose way runs alongside a boundary segment.

        Distance alone lets a way that touches one endpoint claim a whole
        segment. Score candidates by how much of the segment lies within the
        match tolerance, then prefer the closer way when authorities overlap it
        equally.
        """
        if not self.authorities or segment.length <= 0:
            return None
        tolerance = OUTSIDE_MATCH_TOLERANCE_DEGREES
        candidates = []
        for index in self.tree.query(segment.buffer(tolerance)):
            geometry, label = self.authorities[int(index)]
            overlap = segment.intersection(geometry.buffer(tolerance)).length
            candidates.append((
                overlap / segment.length, -segment.distance(geometry), label
            ))
        if not candidates:
            return None
        fraction, _, label = max(candidates)
        if fraction <= MIN_AUTHORITY_OVERLAP_FRACTION:
            return None
        return label

    def transition_fractions(self, segment):
        """Return where the outside authority changes along a segment.

        A simplified outline can jump over the junction between two authority
        ways. Collect the ends of overlapping coverage, keep only overlaps long
        enough to be real support, and split where different authorities end and
        begin together. A way that merely passes within the match tolerance
        has too little coverage to enter the event list.
        """
        if segment.length <= 0:
            return []
        tolerance = OUTSIDE_MATCH_TOLERANCE_DEGREES
        min_support = max(
            MIN_AUTHORITY_OVERLAP_FRACTION,
            (AUTHORITY_SUPPORT_TOLERANCES * tolerance) / segment.length,
        )
        cluster_distance = 3 * tolerance / segment.length
        events = []
        for index in self.tree.query(segment.buffer(tolerance)):
            geometry, label = self.authorities[int(index)]
            covered = segment.intersection(geometry.buffer(tolerance))
            for line in line_parts(covered):
                coordinates = list(line.coords)
                start = segment.project(Point(coordinates[0]), normalized=True)
                end = segment.project(Point(coordinates[-1]), normalized=True)
                if end < start:
                    start, end = end, start
                if end - start < min_support:
                    continue
                events.extend(((start, label), (end, label)))
        events.sort()
        clusters = []
        for fraction, label in events:
            if not clusters or fraction - clusters[-1][-1][0] > cluster_distance:
                clusters.append([])
            clusters[-1].append((fraction, label))
        transitions = []
        for cluster in clusters:
            if len({label for _, label in cluster}) > 1:
                transitions.append(
                    sum(fraction for fraction, _ in cluster) / len(cluster)
                )
        return transitions


def outside_authority_index(boundary_ways, context_names):
    """Build the nearest-way index used to split exterior chains."""
    return OutsideAuthorityIndex(boundary_ways, context_names)


def split_outside_line(line, index):
    """Split an exterior chain wherever its outside authority changes."""
    # Clipping leaves floating-point duplicate vertices; they are not segments.
    coordinates = []
    for point in line.coords:
        previous = coordinates[-1] if coordinates else None
        if previous is None or (
            abs(point[0] - previous[0]) + abs(point[1] - previous[1])
            > 1e-12
        ):
            coordinates.append(point)
    labelled_points = []
    for start, end in zip(coordinates, coordinates[1:]):
        segment = LineString([start, end])
        cuts = [start]
        for fraction in index.transition_fractions(segment):
            cuts.append(tuple(segment.interpolate(fraction * segment.length).coords[0]))
        cuts.append(end)
        for cut_start, cut_end in zip(cuts, cuts[1:]):
            label = index.label_for(LineString([cut_start, cut_end]))
            if not labelled_points or labelled_points[-1][0] != cut_start:
                labelled_points.append((cut_start, label))
            elif labelled_points[-1][1] != label:
                labelled_points[-1] = (cut_start, label)
            if labelled_points[-1][0] != cut_end:
                labelled_points.append((cut_end, label))
    pieces = []
    for (start, label), (end, _) in zip(labelled_points, labelled_points[1:]):
        if pieces and pieces[-1][1] == label:
            pieces[-1][0].append(end)
        else:
            pieces.append(([start, end], label))
    return [
        (LineString(points), label) for points, label in pieces
        if len(points) > 1 and LineString(points).length > 0
    ]


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


def ordered_edge(
    line, first, second, areas, land, context, outside=None,
    allow_unlabelled=False
):
    """Direct an edge so its left label sorts before its right label.

    An exterior edge carries the authority from its OSM way. Sampling decides
    only which end of the line to walk; it invents a sea side solely for a
    fixture with no matched outside authority at all.
    """
    sampled = side_labels(line, areas, land, context)
    if second is None:
        if outside is None:
            outside = outside_from_sample(first, sampled, allow_unlabelled)
        try:
            geometric = geometric_sides(first, outside, sampled)
        except ValueError:
            geometric = geometric_sides_from_area(
                line, first, outside, areas
            )
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


def outside_from_sample(first, sampled, allow_unlabelled=False):
    """Return the sampled side that is not the municipality."""
    outside = next(
        (
            label for label in sampled
            if label is not None and label != first
        ),
        None,
    )
    if outside is not None:
        return outside
    if allow_unlabelled and any(label is None for label in sampled):
        return SEA
    raise ValueError(f'no authoritative outside side for {first}')


def geometric_sides(first, outside, sampled):
    """Return physical sides once the edge's two authorities are known."""
    if first == sampled[0]:
        return first, outside
    if first == sampled[1]:
        return outside, first
    if outside == sampled[0]:
        return outside, first
    if outside == sampled[1]:
        return first, outside
    raise ValueError(f'cannot orient edge between {first} and {outside}')


def geometric_sides_from_area(line, first, outside, areas):
    """Orient an exterior edge by testing which side lies inside its area."""
    area = next(
        (geometry for identifier, geometry in areas if identifier == first),
        None,
    )
    if area is None:
        raise ValueError(f'cannot orient edge between {first} and {outside}')
    for fraction in (0.5, 0.25, 0.75, 0.1, 0.9):
        for divisor in GEOMETRY_SAMPLE_DIVISORS:
            left, right = side_points_at(line, fraction, divisor)
            if area.covers(left):
                return first, outside
            if area.covers(right):
                return outside, first
    # A gap narrower than the sample offsets has no covered side point. Its
    # interior still lies on one side of the edge's direction of travel.
    interior = area.representative_point()
    start, end = line.coords[0], line.coords[-1]
    cross = (
        (end[0] - start[0]) * (interior.y - start[1])
        - (end[1] - start[1]) * (interior.x - start[0])
    )
    if cross > 0:
        return first, outside
    if cross < 0:
        return outside, first
    raise ValueError(f'cannot orient edge between {first} and {outside}')


def build_edges(areas, land, context, boundary_ways):
    """Return one feature per shared edge between two areas."""
    segments = [
        *shared_boundaries(areas), *outside_boundaries(areas)
    ]
    segment_index = way_segment_index(boundary_ways)
    outside_index = outside_authority_index(
        boundary_ways, {name for name, _ in context}
    )
    way_keys = {
        way_id: coordinate_key(LineString(way['coordinates']))
        for way_id, way in boundary_ways.items()
    }
    build_context = EdgeBuildContext(
        areas=areas, land=land, context=context, boundary_ways=boundary_ways,
        segment_index=segment_index, way_keys=way_keys,
    )
    prepared = []
    for raw_line, first, second in sorted(
        segments, key=lambda segment: coordinate_key(segment[0])
    ):
        source_lines = (
            [(raw_line, None)] if second is not None
            else split_outside_line(raw_line, outside_index)
        )
        prepared.append((first, second, source_lines))
    has_outside_authority = any(
        outside is not None
        for _, second, source_lines in prepared if second is None
        for _, outside in source_lines
    )
    edges = []
    allow_unlabelled = not has_outside_authority
    for first, second, source_lines in prepared:
        for line, outside in source_lines:
            edges.append(build_edge(
                line, first, second, outside, build_context, allow_unlabelled
            ))
    return edges


def build_edge(line, first, second, outside, build_context, allow_unlabelled):
    """Build one stored edge from one unsplit line and its authorities."""
    line, left, right = ordered_edge(
        line, first, second, build_context.areas, build_context.land,
        build_context.context, outside, allow_unlabelled
    )
    osm_ways = edge_osm_ways(line, build_context.segment_index)
    full_way = matching_way(line, build_context.way_keys)
    if full_way is not None and full_way not in build_context.used_ways:
        build_context.used_ways.add(full_way)
        version = build_context.boundary_ways[full_way]['version']
        identity = osm_identity('way', full_way, version)
    else:
        pair = f'{slug(left)}-{slug(right)}'
        build_context.derived_counts[pair] += 1
        identity = {
            'entityId': (
                f'derived:edge-{pair}-{build_context.derived_counts[pair]}'
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
    return {
        'type': 'Feature', 'geometry': geometry,
        'properties': {**properties, **identity},
    }


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


def walk_rings(references, lines):
    """Return each closed ring with the edge references walked in order."""
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
        ring_references = [references[first_index]]
        unused.remove(first_index)
        while ring[-1] != ring[0]:
            next_options = [
                option for option in choices.get(tuple(ring[-1]), ())
                if option[0] in unused
            ]
            if not next_options:
                raise ValueError('municipality edges do not close a ring')
            next_index, next_reference, next_coordinates = min(
                next_options, key=lambda option: option[1]['id']
            )
            ring.extend(next_coordinates[1:])
            ring_references.append(next_reference)
            unused.remove(next_index)
        rings.append((
            [list(coordinate) for coordinate in ring], ring_references
        ))
    return rings


def trace_rings(references, lines):
    """Walk directed edge references until every ring closes."""
    return [coordinates for coordinates, _ in walk_rings(references, lines)]


def ordered_edge_references(references, lines):
    """Return references in the order their edges form each closed ring."""
    return [
        reference
        for _, ring_references in walk_rings(references, lines)
        for reference in ring_references
    ]


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
    references = [
        {
            'id': edge_feature['properties']['entityId'],
            'direction': 1 if is_left else -1,
        }
        for edge_feature, is_left in sorted(
            touching,
            key=lambda edge_side: edge_side[0]['properties']['entityId'],
        )
    ]
    return ordered_edge_references(references, edge_lines(edges))
