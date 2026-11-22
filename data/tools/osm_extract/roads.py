"""Display roads: local detail plus countrywide major roads.

Extracts OSM road attributes, computes a path class for walking routes,
and records the road graph (end nodes and levels) for each segment.
"""

from . import Layer
from .geometry import (
    clipped_features, geometry_features, way_coordinates
)
from .identity import osm_identity

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


def collect_end_nodes(way):
    """Return the OSM node IDs at both ends of the way."""
    nodes = list(way.nodes)
    if len(nodes) < 2:
        return None, None
    return nodes[0].ref, nodes[-1].ref


def rounded_point(point):
    """Round a coordinate pair to six decimals for endpoint comparison."""
    return [round(point[0], 6), round(point[1], 6)]


def apply_end_nodes_to_part(part_feature, original_start, original_end, end_nodes):
    """Set start/end node and level only when the part keeps that OSM end.

    A clipped part can start or end at the detail-box boundary instead of an
    OSM node. Those synthetic ends carry no node identity or level.
    """
    part_geometry = part_feature['geometry']
    part_coordinates = part_geometry['coordinates']
    if part_geometry['type'] != 'LineString' or len(part_coordinates) < 2:
        return

    part_start = rounded_point(part_coordinates[0])
    part_end = rounded_point(part_coordinates[-1])
    start_node, end_node, start_level, end_level = end_nodes

    if part_start == original_start:
        part_feature['properties']['startNode'] = start_node
        part_feature['properties']['startLevel'] = start_level
    if part_end == original_end:
        part_feature['properties']['endNode'] = end_node
        part_feature['properties']['endLevel'] = end_level


class RoadsLayer(Layer):
    """Write road lines with attributes, path class, and graph nodes."""

    filename = SOURCE_FILE

    def way(self, way, options, state):
        kind = way.tags.get('highway', '')
        if not kind or kind in SKIPPED_KINDS:
            return
        coordinates = way_coordinates(way)
        if len(coordinates) < 2:
            return
        is_local = options.all_details or any(
            options.contains(*coordinate) for coordinate in coordinates
        )
        if not (is_local or kind in MAJOR_KINDS):
            return

        properties = {
            'kind': kind,
            'name': way.tags.get('name', ''),
        }
        properties.update(collect_road_attributes(way.tags))
        path_class = classify_path(way.tags)
        if path_class:
            properties['pathClass'] = path_class

        identity = osm_identity('way', way.id, way.version)
        geometry = {'type': 'LineString', 'coordinates': coordinates}
        if is_local:
            start_node, end_node = collect_end_nodes(way)
            part_features = clipped_features(
                geometry, options.detail_bbox, identity, properties,
                DETAIL_SIMPLIFY_DEGREES
            )
            if start_node is not None:
                original_start = rounded_point(coordinates[0])
                original_end = rounded_point(coordinates[-1])
                level = road_level(way.tags)
                end_nodes = (start_node, end_node, level, level)
                for part_feature in part_features:
                    apply_end_nodes_to_part(
                        part_feature, original_start, original_end, end_nodes
                    )
            self.features.extend(part_features)
        else:
            self.features.extend(geometry_features(
                geometry, identity, properties,
                simplify_tolerance=COUNTRY_SIMPLIFY_DEGREES
            ))
