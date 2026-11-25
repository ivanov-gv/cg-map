"""Turn restrictions between published roads.

Extracts OSM relations with type=restriction whose from/to ways are published
roads. Written as JSON (not GeoJSON) since restrictions are topological
relations, not geometries.
"""

from . import Layer

SOURCE_FILE = 'turn-restrictions.json'


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
    """Collect turn restriction relations between published roads."""

    filename = SOURCE_FILE

    def __init__(self):
        super().__init__()
        self._restrictions = []
        self._skipped_multiple_roles = 0
        # Rules whose road only passes the junction, so it is no turn.
        self._passing = []

    def relation(self, relation, options, state):
        """Remember a restriction until the published roads are known."""
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

    def _is_resolved(self, restriction, state):
        """Require every road and node of a rule to be published."""
        ways = {
            restriction['from'], restriction['to'],
            *restriction.get('viaWays', ())
        }
        nodes = set(restriction.get('viaNodes', ()))
        is_published = (
            ways <= state.road_way_ids
            and nodes <= state.identified_road_node_ids
        )
        return is_published and self._ends_at_junction(restriction, state)

    def _ends_at_junction(self, restriction, state):
        """A rule through one node is about turning where both roads end."""
        via_nodes = restriction.get('viaNodes', ())
        if 'viaWays' in restriction or len(via_nodes) != 1:
            return True
        ends_there = all(
            via_nodes[0] in state.road_end_node_ids.get(way_id, ())
            for way_id in (restriction['from'], restriction['to'])
        )
        if not ends_there:
            self._passing.append(restriction['entityId'])
        return ends_there

    def finish(self, options, state):
        """Return restrictions sorted by OSM relation ID."""
        if self._skipped_multiple_roles:
            print(
                'turn-restrictions: skipped '
                f'{self._skipped_multiple_roles} relation(s) with multiple '
                'from/to members'
            )
        restrictions = [
            restriction for restriction in self._restrictions
            if self._is_resolved(restriction, state)
        ]
        if self._passing:
            print(
                'turn-restrictions: skipped rules at a junction that their '
                f'road does not end at {self._passing}'
            )
        restrictions.sort(key=restriction_sort_key)
        return {
            'entitySchemaVersion': 1,
            'restrictions': restrictions,
        }
