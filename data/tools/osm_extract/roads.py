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

# Highway kinds that qualify as main walking routes when paved.
MAIN_PATH_KINDS = {'footway', 'pedestrian', 'cycleway', 'path'}

# Highway kinds that qualify as trails when unpaved.
TRAIL_KINDS = {'path', 'track', 'bridleway'}


def classify_path(tags):
    """Return a path class for walking routes, or None.

    Rules (documented and tested):
    - 'main': paved footway, pedestrian, cycleway, or paved path.
      A way is paved when surface is in PAVED_SURFACES.
    - 'trail': unpaved path, track, bridleway, or any way with sac_scale.

    The function checks 'main' first, then 'trail'.
    """
    kind = tags.get('highway', '')
    surface = tags.get('surface', '')
    has_sac_scale = 'sac_scale' in tags
    is_paved = surface in PAVED_SURFACES

    # Main routes: paved walking infrastructure
    if kind in MAIN_PATH_KINDS and is_paved:
        return 'main'

    # Trails: unpaved paths or marked hiking routes
    if kind in TRAIL_KINDS or has_sac_scale:
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

        # Base properties
        properties = {
            'kind': kind,
            'name': way.tags.get('name', ''),
        }

        # Copy OSM road attributes
        properties.update(collect_road_attributes(way.tags))

        # Compute path class for walking routes
        path_class = classify_path(way.tags)
        if path_class:
            properties['pathClass'] = path_class

        # Road graph: end nodes and levels (detail only)
        if is_local:
            start_node, end_node = collect_end_nodes(way)
            if start_node is not None:
                properties['startNode'] = start_node
                properties['endNode'] = end_node
                properties['startLevel'] = road_level(way.tags)
                properties['endLevel'] = road_level(way.tags)

        identity = osm_identity('way', way.id, way.version)
        geometry = {'type': 'LineString', 'coordinates': coordinates}
        if is_local:
            self.features.extend(clipped_features(
                geometry, options.detail_bbox, identity, properties,
                DETAIL_SIMPLIFY_DEGREES
            ))
        else:
            self.features.extend(geometry_features(
                geometry, identity, properties,
                simplify_tolerance=COUNTRY_SIMPLIFY_DEGREES
            ))
