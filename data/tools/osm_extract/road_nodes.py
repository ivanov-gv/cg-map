"""Road network nodes: traffic signals, crossings, and junctions.

Extracts OSM nodes that carry highway-related tags indicating a traffic control
point or junction feature: every one in the detail area, and beyond it those on
a published road.
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
    """Collect road network nodes in the detail area and on its roads."""

    filename = SOURCE_FILE

    def __init__(self):
        super().__init__()
        self._outside_features = {}

    def node(self, node, options, state):
        """Record a node if it carries a road-network tag."""
        if not node.location.valid():
            return
        if not node_has_road_tag(node):
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
        if options.contains(node.lon, node.lat):
            self.features.append(feature)
        else:
            self._outside_features[node.id] = feature

    def finish(self, options, state):
        """Add the nodes on roads beyond the detail area, sorted by OSM ID."""
        self.features.extend(
            feature for node_id, feature in self._outside_features.items()
            if node_id in state.road_node_ids
        )
        self.features.sort(key=road_node_sort_key)
        return self.features
