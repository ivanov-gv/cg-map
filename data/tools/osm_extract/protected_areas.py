"""Named protected areas in protected-areas.geojson: names for the map, not land cover."""

from shapely.geometry import box, shape

from . import Layer
from .geometry import area_source, geometry_features, usable_area_geometry
from .identity import osm_identity
from .names import copy_name_tags
from .rings import orient_feature

SOURCE_FILE = 'protected-areas.geojson'
DETAIL_SIMPLIFY_DEGREES = 0.0001

# A park forest such as Park šuma Gorica is mapped as a protected area over unnamed woods. Its name belongs on the map,
# but the area is no land cover, so it gets its own source instead of a land kind. The first matching tag wins.
PROTECTED_AREA_TAGS = (
    ('leisure', 'nature_reserve'),
    ('boundary', 'protected_area'),
    ('boundary', 'national_park'),
)


def protected_area_tag(tags):
    """Return the OSM tag that makes a named area a protected area, or None."""
    if not tags.get('name', '').strip():
        return None
    for tag_key, tag_value in PROTECTED_AREA_TAGS:
        if tags.get(tag_key) == tag_value:
            return f'{tag_key}={tag_value}'
    return None


class ProtectedAreasLayer(Layer):
    """Write named protected areas that reach the local detail box."""

    filename = SOURCE_FILE

    def area(self, area, options, state):
        osm_tag = protected_area_tag(area.tags)
        if osm_tag is None:
            return
        geometry = usable_area_geometry(area)
        if geometry is None or not box(*options.detail_bbox).intersects(shape(geometry)):
            return
        properties = {'kind': 'protected-area', 'osmTag': osm_tag, **copy_name_tags(area.tags)}
        area_kind, osm_id = area_source(area)
        identity = osm_identity(area_kind, osm_id, area.version)
        features = geometry_features(
            geometry, identity, properties, simplify_tolerance=DETAIL_SIMPLIFY_DEGREES
        )
        self.features.extend(orient_feature(feature) for feature in features)
