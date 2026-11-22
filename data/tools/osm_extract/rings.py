"""Polygon ring winding required by the extracted source contract."""

from shapely.geometry import mapping, shape
from shapely.geometry.polygon import orient


def rfc7946_geometry(geometry_value):
    """Return GeoJSON with counterclockwise exteriors and clockwise holes."""
    geometry = shape(geometry_value)
    if geometry.geom_type not in ('Polygon', 'MultiPolygon'):
        return mapping(geometry)
    return mapping(orient(geometry, sign=1.0))


def orient_feature(feature):
    """Return a copy of a published feature with RFC 7946 polygon rings."""
    return {
        **feature, 'geometry': rfc7946_geometry(feature['geometry'])
    }
