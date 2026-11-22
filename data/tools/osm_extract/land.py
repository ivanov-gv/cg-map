"""Green areas, clearings and preserved surrounding countries in land.geojson."""

from shapely.geometry import Point, box, shape

from . import Layer
from .geometry import (
    area_source, geometry_features, usable_area_geometry
)
from .identity import osm_identity
from .names import copy_name_tags
from .rings import orient_feature
from .writing import read_collection

SOURCE_FILE = 'land.geojson'
DETAIL_SIMPLIFY_DEGREES = 0.0001

# The first matching tag wins, so a feature with several green tags gets one
# truthful kind and keeps that tag as osmTag. A protected area or a place name
# is not land cover: only an actual cover tag selects a feature.
KIND_RULES = (
    (('leisure', 'park'), 'park'),
    (('leisure', 'garden'), 'garden'),
    (('natural', 'wood'), 'woods'),
    (('landuse', 'forest'), 'woods'),
    (('landuse', 'meadow'), 'meadow'),
    (('natural', 'grassland'), 'meadow'),
    (('landuse', 'grass'), 'grass'),
    (('leisure', 'common'), 'grass'),
    (('natural', 'scrub'), 'scrub'),
    (('leisure', 'pitch'), 'sports'),
    (('leisure', 'sports_centre'), 'sports'),
    (('leisure', 'stadium'), 'sports'),
    (('landuse', 'recreation_ground'), 'sports'),
    (('leisure', 'track'), 'sports'),
    (('landuse', 'cemetery'), 'cemetery'),
    (('amenity', 'grave_yard'), 'cemetery'),
    (('leisure', 'playground'), 'playground'),
)
CLEARING_TAGS = (('leisure', 'common'),)
DESTINATION_KINDS = frozenset({'meadow', 'grass'})
PLACE_MARKER_TAGS = (
    'place', 'amenity', 'tourism', 'historic', 'shop', 'leisure'
)


def green_area_rule(tags):
    """Return the OSM tag and published kind for one mapped green area."""
    for (tag_key, tag_value), kind in KIND_RULES:
        if tags.get(tag_key) == tag_value:
            return f'{tag_key}={tag_value}', kind
    return None


def is_mapped_clearing(tags):
    """Report whether OSM marks this area as a clearing people go to."""
    return any(tags.get(key) == value for key, value in CLEARING_TAGS)


class LandLayer(Layer):
    """Write local green areas and the public-domain Natural Earth context."""

    filename = SOURCE_FILE

    def __init__(self):
        super().__init__()
        self.destination_markers = []

    def node(self, node, options, state):
        """Keep named places and peaks that may make a meadow a destination."""
        tags = node.tags
        is_peak = tags.get('natural') == 'peak'
        is_named_place = bool(tags.get('name')) and any(
            key in tags for key in PLACE_MARKER_TAGS
        )
        if (is_peak or is_named_place) and options.contains(
            node.lon, node.lat
        ):
            self.destination_markers.append(Point(node.lon, node.lat))

    def area(self, area, options, state):
        tags = area.tags
        rule = green_area_rule(tags)
        if rule is None:
            return
        geometry = usable_area_geometry(area)
        if (
            geometry is None
            or not box(*options.detail_bbox).intersects(shape(geometry))
        ):
            return
        osm_tag, kind = rule
        properties = {'kind': kind, 'osmTag': osm_tag, **copy_name_tags(tags)}
        if self.is_destination(kind, tags, geometry):
            properties['destination'] = True
        area_kind, osm_id = area_source(area)
        identity = osm_identity(area_kind, osm_id, area.version)
        features = geometry_features(
            geometry, identity, properties,
            simplify_tolerance=DETAIL_SIMPLIFY_DEGREES
        )
        self.features.extend(orient_feature(feature) for feature in features)

    def is_destination(self, kind, tags, geometry):
        """Apply the documented destination rule to a mapped green area."""
        if kind not in DESTINATION_KINDS:
            return False
        if is_mapped_clearing(tags):
            return True
        if tags.get('name', '').strip():
            return True
        area = shape(geometry)
        return any(area.contains(marker) for marker in self.destination_markers)

    def finish(self, options, state):
        context = read_collection(
            options.sources_directory / 'context-countries.geojson'
        )
        return [*self.features, *context['features']]
