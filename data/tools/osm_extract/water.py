"""Water lines, OSM water areas, coastlines and the derived ocean polygon."""

from shapely.geometry import LineString, box, mapping, shape
from shapely.ops import unary_union

from . import Layer
from .geometry import (
    area_source,
    clipped_features,
    geometry_features,
    rounded_geometry,
    usable_area_geometry,
    way_coordinates,
)
from .identity import content_version, make_feature, osm_identity
from .rings import orient_feature, rfc7946_geometry
from .writing import read_collection

SOURCE_FILE = 'water.geojson'
LAND_FILE = 'land.geojson'
WATERWAY_KINDS = frozenset({'river', 'stream', 'canal', 'ditch', 'drain'})
COUNTRYWIDE_WATERWAY_KINDS = frozenset({'river', 'canal'})
DETAIL_WATERWAY_KINDS = frozenset({'stream', 'ditch', 'drain'})
WATER_AREA_RULES = (
    (('waterway', 'riverbank'), 'river'),
    (('water', 'river'), 'river'),
    (('water', 'lake'), 'lake'),
    (('water', 'reservoir'), 'reservoir'),
    (('landuse', 'reservoir'), 'reservoir'),
    (('water', 'pond'), 'pond'),
    (('water', 'basin'), 'basin'),
)
WATER_LINE_TAGS = ('tunnel', 'intermittent')
OCEAN_BOUNDS = (17.5, 41.0, 21.5, 44.2)
OCEAN_SIMPLIFY_DEGREES = 0.0001
WATER_SIMPLIFY_DEGREES = 0.0001


def water_area_rule(tags):
    """Return the OSM tag and published kind for one mapped water area."""
    for (tag_key, tag_value), kind in WATER_AREA_RULES:
        if tags.get(tag_key) == tag_value:
            return f'{tag_key}={tag_value}', kind
    if tags.get('natural') == 'water':
        if tags.get('water'):
            return f"water={tags['water']}", 'water'
        return 'natural=water', 'water'
    return None


class WaterLayer(Layer):
    """Write countrywide water and keep coastlines for the land cut."""

    filename = SOURCE_FILE

    def way(self, way, options, state):
        coordinates = way_coordinates(way)
        if len(coordinates) < 2:
            return
        tags = way.tags
        if tags.get('natural') == 'coastline':
            state.coastlines.append(LineString(coordinates))
            self.add_line(way, coordinates, 'natural=coastline', 'coastline')
        kind = tags.get('waterway', '')
        if kind in COUNTRYWIDE_WATERWAY_KINDS:
            self.add_line(way, coordinates, f'waterway={kind}', kind)
        elif kind in DETAIL_WATERWAY_KINDS:
            self.add_detail_line(way, coordinates, options, f'waterway={kind}', kind)

    def add_line(self, way, coordinates, osm_tag, kind):
        """Publish one OSM way as one line, keeping its downstream order."""
        line = {'type': 'LineString', 'coordinates': coordinates}
        identity = osm_identity('way', way.id, way.version)
        self.features.extend(
            geometry_features(line, identity, self.line_properties(way, osm_tag, kind))
        )

    def add_detail_line(self, way, coordinates, options, osm_tag, kind):
        """Clip a minor waterway to the detail box, numbering each clipped part."""
        line = {'type': 'LineString', 'coordinates': coordinates}
        identity = osm_identity('way', way.id, way.version)
        self.features.extend(clipped_features(
            line, options.detail_bbox, identity,
            self.line_properties(way, osm_tag, kind)
        ))

    def line_properties(self, way, osm_tag, kind):
        """Return the published properties copied from one waterway way."""
        tags = way.tags
        properties = {
            'kind': kind,
            'osmTag': osm_tag,
            'name': tags.get('name', ''),
            'name:en': tags.get('name:en', '')
        }
        for tag_name in WATER_LINE_TAGS:
            if tag_name in tags:
                properties[tag_name] = tags[tag_name]
        return properties

    def area(self, area, options, state):
        tags = area.tags
        rule = water_area_rule(tags)
        if rule is None:
            return
        geometry = usable_area_geometry(area)
        if geometry is None:
            return
        osm_tag, kind = rule
        properties = {
            'kind': kind,
            'osmTag': osm_tag,
            'name': tags.get('name', ''),
            'name:en': tags.get('name:en', '')
        }
        area_kind, osm_id = area_source(area)
        identity = osm_identity(area_kind, osm_id, area.version)
        features = geometry_features(
            geometry, identity, properties,
            simplify_tolerance=WATER_SIMPLIFY_DEGREES
        )
        self.features.extend(orient_feature(feature) for feature in features)

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
        geometry = rounded_geometry(
            rfc7946_geometry(mapping(simplified))
        )
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
