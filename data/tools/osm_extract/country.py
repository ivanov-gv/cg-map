"""Montenegro country outline used by land and by derived ocean geometry."""

from shapely.geometry import Point, mapping, shape

from . import Layer
from .geometry import (
    area_geometry, area_source, polygonize_land, rounded_geometry
)
from .identity import make_feature, osm_identity

SOURCE_FILE = 'land.geojson'
COUNTRY_SIMPLIFY_DEGREES = 0.0001
COAST_SIMPLIFY_DEGREES = 0.00003
CAPITAL_POINT = (19.258, 42.438)


class CountryLayer(Layer):
    """Write the reviewed country shape from its relation or closed way."""

    filename = SOURCE_FILE

    def area(self, area, options, state):
        tags = area.tags
        is_country = (
            tags.get('admin_level') == '2'
            and tags.get('boundary') == 'administrative'
            and tags.get('ISO3166-1') == 'ME'
        )
        if not is_country:
            return
        geometry = area_geometry(area)
        kind, osm_id = area_source(area)
        identity = osm_identity(kind, osm_id, area.version)
        properties = {'kind': 'country', 'name': tags.get('name', '')}
        self.features.append(make_feature(geometry, properties, identity))
        state.country_geometry = geometry

    def finish(self, options, state):
        if not self.features:
            raise RuntimeError(
                'Montenegro boundary missing; inspect the input and extractor '
                'before publishing.'
            )
        country = shape(state.country_geometry).simplify(
            COUNTRY_SIMPLIFY_DEGREES, preserve_topology=True
        )
        if state.coastlines:
            country = polygonize_land(
                country, state.coastlines, Point(*CAPITAL_POINT)
            )
            country = country.simplify(
                COAST_SIMPLIFY_DEGREES, preserve_topology=True
            )
        self.features[0]['geometry'] = rounded_geometry(mapping(country))
        state.country_geometry = self.features[0]['geometry']
        return self.features
