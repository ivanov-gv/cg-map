"""Display roads: local detail plus countrywide major roads."""

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


class RoadsLayer(Layer):
    """Write road lines without claiming they can be used for routing."""

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
        properties = {'kind': kind, 'name': way.tags.get('name', '')}
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
