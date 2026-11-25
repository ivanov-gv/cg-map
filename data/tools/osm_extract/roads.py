"""Display roads: local detail plus countrywide major roads.

Extracts OSM road attributes, computes a path class for walking routes, and
keeps the road graph: the points that roads share, and the node and level at
each end. Two roads join where they share a point on the same level.
"""

from collections import defaultdict
from dataclasses import dataclass

from . import Layer
from .geometry import (
    clipped_features, geometry_features, way_coordinates
)
from .identity import osm_identity
from .road_nodes import node_has_road_tag

SOURCE_FILE = 'roads.geojson'
MAJOR_KINDS = {
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary',
    'motorway_link', 'trunk_link', 'primary_link', 'secondary_link',
}
SKIPPED_KINDS = {'proposed', 'construction', 'platform'}
DETAIL_SIMPLIFY_DEGREES = 0.000015
COUNTRY_SIMPLIFY_DEGREES = 0.0001

# OSM tags copied verbatim to the road feature when present.
ROAD_ATTRIBUTES = [
    'bridge', 'tunnel', 'layer', 'oneway', 'access',
    'motor_vehicle', 'foot', 'bicycle', 'maxspeed',
    'surface', 'lit', 'sac_scale', 'smoothness',
    'parking:left', 'parking:right', 'parking:both',
    'parking:lane:left', 'parking:lane:right', 'parking:lane:both',
    'junction', 'ref', 'name:en',
]

# Paved surface values that indicate a hard, constructed surface.
PAVED_SURFACES = {
    'asphalt', 'concrete', 'paved', 'metal', 'wood', 'stone',
    'cobblestone', 'unhewn_cobblestone', 'sett', 'paving_stones',
}

# Highway kinds that are trails when explicitly unpaved or marked.
TRAIL_KINDS = {'path', 'track', 'bridleway'}


def classify_path(tags):
    """Return a path class for walking routes, or None.

    Rules (documented and tested):
    - 'main': footway unless its surface is explicitly unpaved; paved
      pedestrian, cycleway, or path.
    - 'trail': track, bridleway, any way with sac_scale, or path with an
      explicitly unpaved surface.
    - unclassified: path without surface and without sac_scale, or any other
      highway kind. Unknown surface is not treated as unpaved.
    """
    kind = tags.get('highway', '')
    surface = tags.get('surface', '')
    has_surface = surface != ''
    is_paved = surface in PAVED_SURFACES
    is_explicitly_unpaved = has_surface and not is_paved
    has_sac_scale = 'sac_scale' in tags

    if kind == 'footway':
        if is_explicitly_unpaved:
            return None
        return 'main'

    if kind in {'pedestrian', 'cycleway'}:
        if is_paved:
            return 'main'
        return None

    if kind == 'path':
        if is_paved:
            return 'main'
        if has_sac_scale or is_explicitly_unpaved:
            return 'trail'
        return None

    if kind in {'track', 'bridleway'} or has_sac_scale:
        return 'trail'

    return None


def road_level(tags):
    """Compute the vertical level of a road segment end.

    Uses the OSM 'layer' tag (integer, default 0).
    Bridges without an explicit layer get +1; tunnels get -1.
    """
    layer_text = tags.get('layer', '')
    if layer_text:
        try:
            return int(layer_text)
        except ValueError:
            pass
    if tags.get('bridge', '') not in ('', 'no'):
        return 1
    if tags.get('tunnel', '') not in ('', 'no'):
        return -1
    return 0


def collect_road_attributes(tags):
    """Copy OSM road attributes to feature properties, omitting blanks."""
    properties = {}
    for key in ROAD_ATTRIBUTES:
        value = tags.get(key, '')
        if value:
            properties[key] = value
    return properties


@dataclass(frozen=True)
class RoadWay:
    """One OSM way that is published, kept until every way is known."""

    nodes: tuple
    coordinates: tuple
    level: int
    is_local: bool
    identity: dict
    properties: dict

    @property
    def is_major(self):
        return self.properties['kind'] in MAJOR_KINDS

    @property
    def is_closed(self):
        return self.nodes[0] == self.nodes[-1]

    def passes_through(self):
        """Nodes this way does not end at. A closed way ends nowhere."""
        return self.nodes if self.is_closed else self.nodes[1:-1]


def rounded_point(point):
    """Round a coordinate pair to the six decimals that are published."""
    return tuple(round(value, 6) for value in point)


def nearest_to_ground(levels):
    """Pick the level closest to the ground, the upper one of two as close."""
    return min(levels, key=lambda level: (abs(level), -level))


class RoadGraph:
    """The nodes that published ways share, and the level of each.

    A bridge has its own level along its length, but its ends are where the
    road goes on: a node takes the level of a way that passes through it, and
    otherwise the level nearest to the ground of the ways that end there.
    """

    def __init__(self, ways):
        ways_at_node = defaultdict(set)
        ending_levels = defaultdict(list)
        passing_levels = defaultdict(list)
        self.positions = {}
        for index, way in enumerate(ways):
            for node, coordinate in zip(way.nodes, way.coordinates):
                ways_at_node[node].add(index)
                self.positions[node] = rounded_point(coordinate)
            for node in (way.nodes[0], way.nodes[-1]):
                ending_levels[node].append(way.level)
            for node in way.passes_through():
                passing_levels[node].append(way.level)
        self.node_ids = frozenset(ways_at_node)
        self.shared_nodes = frozenset(
            node for node, way_indexes in ways_at_node.items()
            if len(way_indexes) > 1
        )
        self._levels = {
            node: nearest_to_ground(passing_levels[node] or levels)
            for node, levels in ending_levels.items()
        }
        self.split_level_nodes = sorted(
            node for node, levels in passing_levels.items()
            if len(set(levels)) > 1
        )

    def level_at(self, node):
        return self._levels[node]


class RoadsLayer(Layer):
    """Write road lines with attributes, path class, and the road graph."""

    filename = SOURCE_FILE

    def __init__(self):
        super().__init__()
        self._ways = []
        self._furniture_node_ids = set()

    def node(self, node, options, state):
        """Remember where a road carries a light, a crossing or a sign."""
        if node_has_road_tag(node):
            self._furniture_node_ids.add(node.id)

    def way(self, way, options, state):
        kind = way.tags.get('highway', '')
        if not kind or kind in SKIPPED_KINDS:
            return
        coordinates = way_coordinates(way)
        has_every_position = len(coordinates) == len(way.nodes)
        if len(coordinates) < 2 or not has_every_position:
            return
        is_local = options.all_details or any(
            options.contains(*coordinate) for coordinate in coordinates
        )
        if not (is_local or kind in MAJOR_KINDS):
            return
        self._ways.append(RoadWay(
            nodes=tuple(node.ref for node in way.nodes),
            coordinates=tuple(coordinates),
            level=road_level(way.tags),
            is_local=is_local,
            identity=osm_identity('way', way.id, way.version),
            properties=road_properties(way.tags),
        ))
        state.road_way_ids.add(way.id)

    def finish(self, options, state):
        """Publish every way with the points it shares with another."""
        graph = RoadGraph(self._ways)
        state.road_node_ids |= graph.node_ids
        if graph.split_level_nodes:
            print(
                'roads: ways cross on different levels at shared nodes '
                f'{graph.split_level_nodes}'
            )
        furniture_nodes = graph.node_ids & self._furniture_node_ids
        kept_nodes = graph.shared_nodes | furniture_nodes
        kept_points = frozenset(graph.positions[node] for node in kept_nodes)
        for way in self._ways:
            self.features.extend(
                road_features(way, graph, kept_points, options)
            )
        state.road_end_node_ids.update(end_nodes_by_way(self.features))
        state.identified_road_node_ids |= furniture_nodes.union(
            *state.road_end_node_ids.values()
        )
        return self.features


def end_nodes_by_way(features):
    """Return the nodes where the parts of each published way end."""
    nodes = {}
    for feature in features:
        properties = feature['properties']
        way_id = int(properties['entityId'].removeprefix('way/'))
        ends = {properties.get('startNode'), properties.get('endNode')}
        nodes.setdefault(way_id, set()).update(ends - {None})
    return nodes


def road_properties(tags):
    """Return the published attributes of a road."""
    properties = {
        'kind': tags.get('highway', ''),
        'name': tags.get('name', ''),
    }
    properties.update(collect_road_attributes(tags))
    path_class = classify_path(tags)
    if path_class:
        properties['pathClass'] = path_class
    return properties


def road_features(way, graph, kept_points, options):
    """Return the parts of one way with the node and level at their ends.

    Major roads cross the detail box whole, so that the graph goes on beyond
    it. Other roads end at its edge. Cutting one that is inside anyway would
    part a way where it meets itself.
    """
    geometry = {'type': 'LineString', 'coordinates': way.coordinates}
    tolerance = (
        DETAIL_SIMPLIFY_DEGREES if way.is_local else COUNTRY_SIMPLIFY_DEGREES
    )
    is_whole = way.is_major or not way.is_local or all(
        options.contains(*coordinate) for coordinate in way.coordinates
    )
    if is_whole:
        features = geometry_features(
            geometry, way.identity, way.properties,
            simplify_tolerance=tolerance, kept_points=kept_points
        )
    else:
        features = clipped_features(
            geometry, options.detail_bbox, way.identity, way.properties,
            tolerance, kept_points
        )
    for feature in features:
        add_end_nodes(feature, way, graph)
    return features


def add_end_nodes(feature, way, graph):
    """Record the node and level at each end of a part that is an OSM end.

    A part clipped by the detail box can end where there is no OSM node.
    """
    first_point, last_point = (
        tuple(feature['geometry']['coordinates'][index]) for index in (0, -1)
    )
    start_node, end_node = way.nodes[0], way.nodes[-1]
    properties = feature['properties']
    if first_point == graph.positions[start_node]:
        properties['startNode'] = start_node
        properties['startLevel'] = graph.level_at(start_node)
    if last_point == graph.positions[end_node]:
        properties['endNode'] = end_node
        properties['endLevel'] = graph.level_at(end_node)
