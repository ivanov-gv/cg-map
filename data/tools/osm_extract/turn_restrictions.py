"""Turn restrictions touching the detail area.

Extracts OSM relations with type=restriction that reference ways within
the detail area. Written as JSON (not GeoJSON) since restrictions are
topological relations, not geometries.
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


class TurnRestrictionsLayer(Layer):
    """Collect turn restriction relations touching the detail area."""

    filename = SOURCE_FILE

    def __init__(self):
        super().__init__()
        self._way_ids = set()
        self._restrictions = []

    def way(self, way, options, state):
        """Remember way IDs that are in the detail area."""
        kind = way.tags.get('highway', '')
        if kind:
            self._way_ids.add(way.id)

    def relation(self, relation, options, state):
        """Record a restriction relation if it touches the detail area."""
        if relation.tags.get('type', '') != 'restriction':
            return

        from_way = None
        to_way = None
        via_nodes = []
        via_ways = []

        for member in relation.members:
            role = member.role
            if role == 'from':
                wid = way_member_id(member)
                if wid and wid in self._way_ids:
                    from_way = wid
            elif role == 'to':
                wid = way_member_id(member)
                if wid and wid in self._way_ids:
                    to_way = wid
            elif role == 'via':
                wid = way_member_id(member)
                nid = node_member_id(member)
                if wid:
                    via_ways.append(wid)
                elif nid:
                    via_nodes.append(nid)

        # Only include if from and to are known
        if from_way is None or to_way is None:
            return

        restriction = {
            'entityId': f'relation/{relation.id}',
            'entityVersion': relation.version,
            'restriction': relation.tags.get('restriction', ''),
            'from': from_way,
            'to': to_way,
        }
        if via_nodes:
            restriction['viaNodes'] = via_nodes
        if via_ways:
            restriction['viaWays'] = via_ways

        self._restrictions.append(restriction)

    def finish(self, options, state):
        """Return the restrictions as a structured JSON object."""
        self._restrictions.sort(
            key=lambda r: int(r['entityId'].split('/')[1])
        )
        return {
            'entitySchemaVersion': 1,
            'restrictions': self._restrictions,
        }
