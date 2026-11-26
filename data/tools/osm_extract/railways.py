"""Railway tracks, platforms and stations from the reviewed OSM extract.

Active OSM railway values keep their upstream kind. Disused and abandoned
objects keep their status in the published kind, so a later style can draw
them differently without guessing from a missing tag.
"""

from . import Layer
from .geometry import clipped_features, rounded_geometry, way_coordinates
from .identity import make_feature, osm_identity
from .names import copy_name_tags
from .rings import orient_feature

SOURCE_FILE = 'railways.geojson'
TRACK_KINDS = ('rail', 'narrow_gauge', 'light_rail')
LIFECYCLE_STATES = ('disused', 'abandoned')
BASE_KINDS = (*TRACK_KINDS, 'platform', 'station', 'halt')

# check-data.mjs accepts exactly these kinds and tags; a data test keeps both lists equal.
RAILWAY_KINDS = (
    'abandoned_halt', 'abandoned_light_rail', 'abandoned_narrow_gauge',
    'abandoned_platform', 'abandoned_rail', 'abandoned_station',
    'disused_halt', 'disused_light_rail', 'disused_narrow_gauge',
    'disused_platform', 'disused_rail', 'disused_station',
    'halt', 'light_rail', 'narrow_gauge', 'platform', 'rail', 'station',
)
RAILWAY_TAGS = (
    'railway=rail', 'railway=narrow_gauge', 'railway=light_rail',
    'railway=platform', 'public_transport=platform+train=yes',
    'railway=station', 'railway=halt',
    'abandoned:railway=rail', 'abandoned:railway=narrow_gauge',
    'abandoned:railway=light_rail', 'abandoned:railway=platform',
    'abandoned:railway=station', 'abandoned:railway=halt',
    'disused:railway=rail', 'disused:railway=narrow_gauge',
    'disused:railway=light_rail', 'disused:railway=platform',
    'disused:railway=station', 'disused:railway=halt',
)
COPIED_TAGS = ('ref', 'gauge')
POINT_KINDS = frozenset(
    kind for kind in RAILWAY_KINDS if kind.endswith(('station', 'halt'))
)
PLATFORM_KINDS = frozenset(
    kind for kind in RAILWAY_KINDS if kind.endswith('platform')
)


def lifecycle_state(tags):
    """Return the OSM lifecycle a railway object records, if any."""
    railway = tags.get('railway', '')
    if railway in LIFECYCLE_STATES:
        return railway
    for state in LIFECYCLE_STATES:
        if f'{state}:railway' in tags:
            return state
    return None


def railway_selection(tags):
    """Return the published kind and selecting OSM tag, or None.

    A lifecycle tag wins over a plain railway tag; a closed platform way is
    recognised through the same selection as an open platform line.
    """
    state = lifecycle_state(tags)
    if state:
        value = tags.get(f'{state}:railway', '')
        if value in BASE_KINDS:
            return f'{state}_{value}', f'{state}:railway={value}'
        return None
    railway = tags.get('railway', '')
    if railway in BASE_KINDS:
        return railway, f'railway={railway}'
    if tags.get('public_transport') == 'platform' and tags.get('train') == 'yes':
        return 'platform', 'public_transport=platform+train=yes'
    return None


def railway_properties(tags, kind, osm_tag):
    """Copy the selected source fact, names and optional display attributes."""
    properties = {'kind': kind, 'osmTag': osm_tag, **copy_name_tags(tags)}
    for tag in COPIED_TAGS:
        if tags.get(tag):
            properties[tag] = tags[tag]
    return properties


def platform_geometry(way, coordinates):
    """Keep a closed platform way an area; other platform ways stay lines."""
    if (
        way.is_closed() and len(coordinates) >= 4
        and coordinates[0] == coordinates[-1]
    ):
        return {'type': 'Polygon', 'coordinates': [coordinates]}
    return {'type': 'LineString', 'coordinates': coordinates}


def increment(counts, name):
    """Add one to a provenance count that may not be present yet."""
    counts[name] = counts.get(name, 0) + 1


def record_lifecycle_count(tags, options, state, coordinates, is_way):
    """Count disused and abandoned objects that reach the detail box."""
    status = lifecycle_state(tags)
    if status is None or not any(
        options.contains(*coordinate) for coordinate in coordinates
    ):
        return
    increment(state.railway_counts, f'{status}{"Ways" if is_way else "Nodes"}')


class RailwaysLayer(Layer):
    """Write track lines, platform areas or lines, and station points."""

    filename = SOURCE_FILE

    def node(self, node, options, state):
        if not node.location.valid() or not options.contains(node.lon, node.lat):
            return
        tags = dict(node.tags)
        record_lifecycle_count(
            tags, options, state, [(node.lon, node.lat)], False
        )
        selection = railway_selection(tags)
        if selection is None or selection[0] not in POINT_KINDS:
            return
        kind, osm_tag = selection
        properties = railway_properties(tags, kind, osm_tag)
        geometry = {
            'type': 'Point',
            'coordinates': rounded_geometry([node.lon, node.lat]),
        }
        self.features.append(make_feature(
            geometry, properties, osm_identity('node', node.id, node.version)
        ))

    def way(self, way, options, state):
        coordinates = way_coordinates(way)
        if len(coordinates) < 2:
            return
        tags = dict(way.tags)
        record_lifecycle_count(tags, options, state, coordinates, True)
        selection = railway_selection(tags)
        if selection is None:
            return
        kind, osm_tag = selection
        if kind in POINT_KINDS:
            return
        is_track = kind in TRACK_KINDS or (
            kind.startswith(('disused_', 'abandoned_'))
            and kind.split('_', 1)[1] in TRACK_KINDS
        )
        if not (is_track or kind in PLATFORM_KINDS):
            return
        geometry = (
            {'type': 'LineString', 'coordinates': coordinates}
            if is_track else platform_geometry(way, coordinates)
        )
        properties = railway_properties(tags, kind, osm_tag)
        identity = osm_identity('way', way.id, way.version)
        features = clipped_features(geometry, options.detail_bbox, identity, properties)
        self.features.extend(orient_feature(feature) for feature in features)

    def finish(self, options, state):
        """Record how many lifecycle objects the reviewed source publishes."""
        imported = {'disused': set(), 'abandoned': set()}
        for feature in self.features:
            kind = feature['properties']['kind']
            for status in imported:
                if kind.startswith(f'{status}_'):
                    imported[status].add(feature['properties']['entityId'])
        for name in (
            'disusedWays', 'abandonedWays', 'disusedNodes', 'abandonedNodes'
        ):
            state.railway_counts.setdefault(name, 0)
        state.railway_counts.update({
            'importedDisused': len(imported['disused']),
            'importedAbandoned': len(imported['abandoned']),
        })
        return self.features
