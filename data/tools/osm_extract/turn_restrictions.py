"""Turn restrictions touching the detail area.

Extracts OSM relations with type=restriction whose from/to ways are detail-area
roads. Written as JSON (not GeoJSON) since restrictions are topological
relations, not geometries.
"""

from . import Layer

SOURCE_FILE = 'turn-restrictions.json'
ROAD_NODE_KINDS = {
    'traffic_signals', 'crossing', 'stop', 'give_way',
    'mini_roundabout', 'turning_circle',
}


def way_member_id(member):
    """Return the way ID from a relation member, or None."""
    if member.type == 'w':
        return member.ref
    return None


def node_member_id(member):
    """Return the node ID from a relation member, or None."""
    if member.type == 'n':
        return member.ref
    return None


def restriction_sort_key(restriction):
    """Sort restrictions by numeric OSM relation ID."""
    relation_id = restriction['entityId'].split('/')[1]
    return int(relation_id)


class TurnRestrictionsLayer(Layer):
    """Collect turn restriction relations touching the detail area."""

    filename = SOURCE_FILE

    def __init__(self):
        super().__init__()
        self._detail_way_ids = set()
        self._detail_end_node_ids = set()
        self._detail_road_node_ids = set()
        self._restrictions = []
        self._skipped_multiple_roles = 0

    def node(self, node, options, state):
        """Remember detail-area road nodes that can be restriction via nodes."""
        if not node.location.valid():
            return
        if node.tags.get('highway', '') not in ROAD_NODE_KINDS:
            return
        if options.contains(node.lon, node.lat):
            self._detail_road_node_ids.add(node.id)

    def way(self, way, options, state):
        """Remember detail-area highway ways and their end nodes."""
        highway_kind = way.tags.get('highway', '')
        if not highway_kind:
            return
        coordinates = [
            (node.lon, node.lat) for node in way.nodes
            if node.location.valid()
        ]
        is_local = options.all_details or any(
            options.contains(longitude, latitude)
            for longitude, latitude in coordinates
        )
        if not is_local:
            return
        self._detail_way_ids.add(way.id)
        nodes = list(way.nodes)
        if len(nodes) >= 2:
            self._detail_end_node_ids.add(nodes[0].ref)
            self._detail_end_node_ids.add(nodes[-1].ref)

    def relation(self, relation, options, state):
        """Record a restriction relation when its refs resolve in the detail area."""
        if relation.tags.get('type', '') != 'restriction':
            return
        restriction_value = relation.tags.get('restriction', '')
        if not restriction_value:
            return

        from_ways = []
        to_ways = []
        via_nodes = []
        via_ways = []
        for member in relation.members:
            self._collect_member(member, from_ways, to_ways, via_nodes, via_ways)

        if len(from_ways) != 1 or len(to_ways) != 1:
            self._skipped_multiple_roles += 1
            return
        if not self._references_detail_area(from_ways[0], to_ways[0], via_nodes):
            return
        if not self._via_nodes_resolve(via_nodes):
            return
        if not self._via_ways_resolve(via_ways):
            return

        restriction = {
            'entityId': f'relation/{relation.id}',
            'entityVersion': relation.version,
            'restriction': restriction_value,
            'from': from_ways[0],
            'to': to_ways[0],
        }
        if via_nodes:
            restriction['viaNodes'] = via_nodes
        if via_ways:
            restriction['viaWays'] = via_ways
        self._restrictions.append(restriction)

    def _collect_member(self, member, from_ways, to_ways, via_nodes, via_ways):
        """Append a relation member to the role bucket it belongs to."""
        role = member.role
        if role == 'from':
            way_id = way_member_id(member)
            if way_id is not None:
                from_ways.append(way_id)
            return
        if role == 'to':
            way_id = way_member_id(member)
            if way_id is not None:
                to_ways.append(way_id)
            return
        if role == 'via':
            way_id = way_member_id(member)
            node_id = node_member_id(member)
            if way_id is not None:
                via_ways.append(way_id)
            elif node_id is not None:
                via_nodes.append(node_id)

    def _references_detail_area(self, from_way, to_way, via_nodes):
        """Keep restrictions whose from/to ways are in the detail road set."""
        return from_way in self._detail_way_ids and to_way in self._detail_way_ids

    def _via_nodes_resolve(self, via_nodes):
        """Require via nodes to resolve to detail road nodes or end nodes."""
        allowed_nodes = self._detail_road_node_ids | self._detail_end_node_ids
        return all(node_id in allowed_nodes for node_id in via_nodes)

    def _via_ways_resolve(self, via_ways):
        """Require via ways to resolve to detail roads."""
        return all(way_id in self._detail_way_ids for way_id in via_ways)

    def finish(self, options, state):
        """Return restrictions sorted by OSM relation ID."""
        if self._skipped_multiple_roles:
            print(
                'turn-restrictions: skipped '
                f'{self._skipped_multiple_roles} relation(s) with multiple '
                'from/to members'
            )
        self._restrictions.sort(key=restriction_sort_key)
        return {
            'entitySchemaVersion': 1,
            'restrictions': self._restrictions,
        }
