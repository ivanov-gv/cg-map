"""Parks and preserved surrounding countries in land.geojson."""

from shapely.geometry import box, shape

from . import Layer
from .geometry import (
    area_source, geometry_features, usable_area_geometry
)
from .identity import osm_identity
from .writing import read_collection

SOURCE_FILE = 'land.geojson'
PARK_LANDUSE = {'forest', 'grass', 'meadow', 'recreation_ground'}
PARK_LEISURE = {'park', 'garden'}
DETAIL_SIMPLIFY_DEGREES = 0.0001


class LandLayer(Layer):
    """Write local parks and the public-domain Natural Earth context."""

    filename = SOURCE_FILE

    def area(self, area, options, state):
        tags = area.tags
        is_park = (
            tags.get('landuse') in PARK_LANDUSE
            or tags.get('leisure') in PARK_LEISURE
        )
        if not is_park:
            return
        geometry = usable_area_geometry(area)
        if (
            geometry is None
            or not box(*options.detail_bbox).intersects(shape(geometry))
        ):
            return
        properties = {'kind': 'park', 'name': tags.get('name', '')}
        kind, osm_id = area_source(area)
        identity = osm_identity(kind, osm_id, area.version)
        self.features.extend(geometry_features(
            geometry, identity, properties,
            simplify_tolerance=DETAIL_SIMPLIFY_DEGREES
        ))

    def finish(self, options, state):
        context = read_collection(
            options.sources_directory / 'context-countries.geojson'
        )
        return [*self.features, *context['features']]
