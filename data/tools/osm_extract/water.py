"""Water lines, OSM water areas and the derived ocean polygon."""

from shapely.geometry import LineString, box, mapping, shape
from shapely.ops import unary_union

from . import Layer
from .geometry import (
    area_source,
    geometry_features,
    rounded_geometry,
    usable_area_geometry,
    way_coordinates,
)
from .identity import content_version, make_feature, osm_identity
from .writing import read_collection

SOURCE_FILE = 'water.geojson'
LAND_FILE = 'land.geojson'
WATERWAY_KINDS = {'river', 'canal'}
OCEAN_BOUNDS = (17.5, 41.0, 21.5, 44.2)
OCEAN_SIMPLIFY_DEGREES = 0.0001
WATER_SIMPLIFY_DEGREES = 0.0001


class WaterLayer(Layer):
    """Write countrywide water and keep coastlines for the land cut."""

    filename = SOURCE_FILE

    def way(self, way, options, state):
        coordinates = way_coordinates(way)
        if len(coordinates) < 2:
            return
        if way.tags.get('natural') == 'coastline':
            state.coastlines.append(LineString(coordinates))
        kind = way.tags.get('waterway', '')
        if kind in WATERWAY_KINDS:
            properties = {'kind': 'river', 'name': way.tags.get('name', '')}
            identity = osm_identity('way', way.id, way.version)
            line = {'type': 'LineString', 'coordinates': coordinates}
            self.features.extend(geometry_features(line, identity, properties))

    def area(self, area, options, state):
        if area.tags.get('natural') != 'water':
            return
        geometry = usable_area_geometry(area)
        if geometry is None:
            return
        properties = {'kind': 'water'}
        kind, osm_id = area_source(area)
        identity = osm_identity(kind, osm_id, area.version)
        self.features.extend(geometry_features(
            geometry, identity, properties,
            simplify_tolerance=WATER_SIMPLIFY_DEGREES
        ))

    def finish(self, options, state):
        self.features.insert(0, self.ocean_feature(options, state))
        return self.features

    def ocean_feature(self, options, state):
        """Compute the ocean from this run's country or the reviewed outline."""
        has_fresh_country = (
            options.uses_fresh_country and state.country_geometry is not None
        )
        country = (
            state.country_geometry if has_fresh_country
            else self.country_from_sources(options)
        )
        context = read_collection(
            options.sources_directory / 'context-countries.geojson'
        )
        land = [
            shape(country),
            *[shape(feature['geometry']) for feature in context['features']]
        ]
        ocean = box(*OCEAN_BOUNDS).difference(unary_union(land))
        simplified = ocean.simplify(
            OCEAN_SIMPLIFY_DEGREES, preserve_topology=True
        )
        geometry = rounded_geometry(mapping(simplified))
        properties = {'kind': 'ocean'}
        return make_feature(geometry, properties, {
            'entityId': 'derived:ocean',
            'entityVersion': content_version({
                'geometry': geometry, 'properties': properties
            }),
        })

    def country_from_sources(self, options):
        """Read the reviewed outline when only water is regenerated."""
        land = read_collection(options.sources_directory / LAND_FILE)
        return next(
            feature['geometry'] for feature in land['features']
            if feature['properties']['kind'] == 'country'
        )
