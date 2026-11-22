"""Road network nodes: traffic signals, crossings, and junctions.

Extracts OSM nodes within the detail area that carry highway-related tags
indicating a traffic control point or junction feature.
"""

from . import Layer
from .identity import osm_identity

SOURCE_FILE = 'road-nodes.geojson'

# Highway values that mark a road network feature worth recording.
ROAD_NODE_KINDS = {
    'traffic_signals', 'crossing', 'stop', 'give_way',
    'mini_roundabout', 'turning_circle',
}


def node_has_road_tag(node):
    """Check whether an OSM node carries a road-network tag."""
    highway = node.tags.get('highway', '')
    return highway in ROAD_NODE_KINDS


def road_node_sort_key(feature):
    """Sort road nodes by their OSM entity identity."""
    return feature['properties']['entityId']


class RoadNodesLayer(Layer):
    """Collect road network nodes within the detail area."""

    filename = SOURCE_FILE

    def node(self, node, options, state):
        """Record a node if it carries a road-network tag."""
        if not node.location.valid():
            return
        if not node_has_road_tag(node):
            return
        # Only include nodes within the detail area
        if not options.contains(node.lon, node.lat):
            return

        properties = {
            'kind': node.tags.get('highway', ''),
        }
        name = node.tags.get('name', '')
        if name:
            properties['name'] = name
        # Copy relevant OSM tags
        for key in ('ref', 'name:en', 'crossing', 'traffic_signals'):
            value = node.tags.get(key, '')
            if value:
                properties[key] = value

        identity = osm_identity('node', node.id, node.version)
        geometry = {
            'type': 'Point',
            'coordinates': [round(node.lon, 6), round(node.lat, 6)],
        }
        feature = {
            'type': 'Feature',
            'geometry': geometry,
            'properties': {**properties, **identity},
        }
        self.features.append(feature)

    def finish(self, options, state):
        """Sort nodes by OSM ID and return."""
        self.features.sort(key=road_node_sort_key)
        return self.features
