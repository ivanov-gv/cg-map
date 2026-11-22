"""Building footprints inside the detail box."""

from . import Layer
from .geometry import clipped_features, way_coordinates
from .identity import osm_identity

SOURCE_FILE = 'buildings.geojson'
NAME_TAGS = ('name', 'addr:housenumber', 'addr:street')


class BuildingsLayer(Layer):
    """Write closed ways with their OSM ID and upstream version."""

    filename = SOURCE_FILE

    def way(self, way, options, state):
        if not way.tags.get('building') or not way.is_closed():
            return
        coordinates = way_coordinates(way)
        if len(coordinates) < 4:
            return
        is_local = options.all_details or any(
            options.contains(*coordinate) for coordinate in coordinates
        )
        if not is_local:
            return
        properties = {'kind': 'building', 'osm_id': f'way/{way.id}'}
        for tag in NAME_TAGS:
            if way.tags.get(tag):
                properties[tag] = way.tags[tag]
        identity = osm_identity('way', way.id, way.version)
        geometry = {'type': 'Polygon', 'coordinates': [coordinates]}
        self.features.extend(clipped_features(
            geometry, options.detail_bbox, identity, properties
        ))
