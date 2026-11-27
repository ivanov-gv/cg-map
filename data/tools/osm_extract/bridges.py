"""Bridge outlines from OSM man_made=bridge areas.

Traced outlines are a reviewed seed step, not an OSM fact. When the bridges group is extracted again, this layer carries
those outlines forward byte for byte instead of deriving them from the current roads.
"""

from shapely.geometry import box, shape

from . import Layer
from .geometry import area_source, geometry_features, usable_area_geometry
from .identity import osm_identity
from .names import copy_name_tags
from .rings import orient_feature
from .writing import read_collection

SOURCE_FILE = 'bridges.geojson'
OSM_TAG = 'man_made=bridge'
SIMPLIFY_DEGREES = 0.00001


def bridge_area_tag(tags):
    """Return the selecting OSM tag for a bridge area, or None."""
    if tags.get('man_made') == 'bridge':
        return OSM_TAG
    return None


def reviewed_traced_features(options):
    """Return traced outlines already reviewed in the staged source file."""
    path = options.sources_directory / SOURCE_FILE
    if not path.exists():
        return []
    collection = read_collection(path)
    return [
        feature for feature in collection['features']
        if feature['properties'].get('method') == 'traced'
    ]


class BridgesLayer(Layer):
    """Write mapped bridge areas and keep any reviewed traced outlines."""

    filename = SOURCE_FILE

    def area(self, area, options, state):
        if bridge_area_tag(area.tags) is None:
            return
        geometry = usable_area_geometry(area)
        if geometry is None:
            return
        if not box(*options.detail_bbox).intersects(shape(geometry)):
            return
        properties = {
            'kind': 'bridge',
            'osmTag': OSM_TAG,
            'method': 'osm',
            **copy_name_tags(area.tags),
        }
        area_kind, osm_id = area_source(area)
        identity = osm_identity(area_kind, osm_id, area.version)
        features = geometry_features(
            geometry, identity, properties,
            simplify_tolerance=SIMPLIFY_DEGREES
        )
        self.features.extend(orient_feature(feature) for feature in features)

    def finish(self, options, state):
        """Count mapped areas, then append the reviewed seed unchanged."""
        osm_area_count = len(self.features)
        self.features.extend(reviewed_traced_features(options))
        state.bridge_counts = {'osmAreas': osm_area_count}
        return self.features
