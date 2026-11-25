"""Geometry normalisation shared by the OSM layer modules."""

import json

import osmium
import shapely
from shapely.geometry import LineString, MultiLineString, box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import polygonize, unary_union

from .identity import make_feature


def rounded_geometry(geometry):
    """Round every coordinate to six decimals and keep polygon rings closed."""
    if isinstance(geometry, dict):
        return {
            name: rounded_geometry(value)
            for name, value in geometry.items()
        }
    if isinstance(geometry, (list, tuple)):
        return [rounded_geometry(value) for value in geometry]
    if isinstance(geometry, float):
        return round(geometry, 6)
    return geometry


def rounded_valid_geometry(geometry):
    """Snap coordinates to the published grid without breaking topology."""
    area = shape(geometry) if isinstance(geometry, dict) else geometry
    return mapping(shapely.set_precision(area, 1e-6))


def canonical_ring(ring):
    """Rotate a closed ring to its lowest coordinate, keeping it closed."""
    corners = [tuple(coordinate) for coordinate in ring[:-1]]
    first = min(range(len(corners)), key=lambda index: corners[index])
    ordered = [list(corner) for corner in corners[first:] + corners[:first]]
    return [*ordered, list(ordered[0])]


def canonical_polygon(rings):
    """Return an RFC 7946 polygon with a stable start and sorted holes."""
    holes = sorted(
        (canonical_ring(ring) for ring in rings[1:]),
        key=lambda ring: ring[:-1]
    )
    return [canonical_ring(rings[0]), *holes]


def canonical_geometry(geometry):
    """Give a derived polygon one byte representation, whatever its input order."""
    area = shape(geometry) if isinstance(geometry, dict) else geometry
    normalized = json.loads(json.dumps(mapping(orient(area, sign=1.0))))
    if normalized['type'] == 'Polygon':
        normalized['coordinates'] = canonical_polygon(normalized['coordinates'])
    elif normalized['type'] == 'MultiPolygon':
        polygons = [
            canonical_polygon(rings) for rings in normalized['coordinates']
        ]
        normalized['coordinates'] = sorted(
            polygons, key=lambda polygon: polygon[0][:-1]
        )
    return normalized


def way_coordinates(way):
    """Return valid node locations as WGS84 longitude/latitude pairs."""
    try:
        return [
            (node.lon, node.lat) for node in way.nodes
            if node.location.valid()
        ]
    except osmium.InvalidLocationError:
        return []


def area_geometry(area):
    """Return GeoJSON for an OSM area, keeping relation or way identity."""
    factory = osmium.geom.GeoJSONFactory()
    return json.loads(factory.create_multipolygon(area))


def usable_area_geometry(area):
    """Skip malformed assembled areas without dropping the rest of a layer."""
    try:
        return area_geometry(area)
    except RuntimeError as error:
        print(f'Area skipped {area.id}: {error}')
        return None


def area_source(area):
    """Return the original OSM object and ID, not osmium's area ID."""
    kind = 'way' if area.from_way() else 'relation'
    return kind, area.orig_id()


def separated_geometries(geometry):
    """Split a multi-geometry into individually addressable parts."""
    if geometry.is_empty:
        return []
    if geometry.geom_type in (
        'MultiPolygon', 'MultiLineString', 'GeometryCollection'
    ):
        return [part for part in geometry.geoms if not part.is_empty]
    return [geometry]


def sortable_geometry(geometry):
    """Give a geometry a stable order independent of OSM traversal order."""
    return json.dumps(
        mapping(geometry), ensure_ascii=False, sort_keys=True,
        separators=(',', ':')
    )


def is_usable(geometry):
    """Reject collapsed results that cannot be published as a line or area."""
    if geometry.geom_type in ('Polygon', 'MultiPolygon'):
        return geometry.area > 0
    if geometry.geom_type in ('LineString', 'MultiLineString'):
        return geometry.length > 0
    return False


def simplified_line(line, tolerance, kept_points):
    """Simplify a line between the points that must stay on it.

    Simplifying a line on its own drops the points it shares with others, and
    with them the only trace that the lines meet there.
    """
    coordinates = list(line.coords)
    kept_indexes = [
        index for index, point in enumerate(coordinates)
        if index in (0, len(coordinates) - 1)
        or tuple(rounded_geometry(point)) in kept_points
    ]
    simplified = coordinates[:1]
    for start, end in zip(kept_indexes, kept_indexes[1:]):
        stretch = coordinates[start:end + 1]
        if len(stretch) > 2:
            stretch = LineString(stretch).simplify(
                tolerance, preserve_topology=True
            ).coords
        simplified.extend(stretch[1:])
    return LineString(simplified)


def geometry_features(
    geometry_value, identity, properties, part_numbers=None,
    simplify_tolerance=0.0, kept_points=frozenset()
):
    """Return one feature per usable geometry, applying simplification."""
    geometry = shape(geometry_value)
    if simplify_tolerance and kept_points:
        geometry = MultiLineString([
            simplified_line(line, simplify_tolerance, kept_points)
            for line in separated_geometries(geometry)
            if line.geom_type == 'LineString'
        ])
    elif simplify_tolerance:
        geometry = geometry.simplify(
            simplify_tolerance, preserve_topology=True
        )
    parts = sorted(separated_geometries(geometry), key=sortable_geometry)
    usable_parts = [part for part in parts if is_usable(part)]
    if part_numbers is None and len(usable_parts) > 1:
        part_numbers = list(range(len(usable_parts)))
    features = []
    for index, part in enumerate(usable_parts):
        number = (
            part_numbers[index] if part_numbers is not None else None
        )
        feature = make_feature(
            rounded_geometry(mapping(part)), properties, identity, number
        )
        features.append(feature)
    return features


def clipped_features(
    geometry_value, detail_bbox, identity, properties,
    simplify_tolerance=0.0, kept_points=frozenset()
):
    """Clip to the detail box, numbering each part of one source object."""
    boundary = box(*detail_bbox)
    original = shape(geometry_value)
    if not boundary.intersects(original):
        return []
    clipped = boundary.intersection(original)
    is_trimmed = not boundary.covers(original)
    parts = sorted(separated_geometries(clipped), key=sortable_geometry)
    part_numbers = (
        list(range(len(parts))) if is_trimmed or len(parts) > 1 else None
    )
    return geometry_features(
        clipped, identity, properties, part_numbers, simplify_tolerance,
        kept_points
    )


def polygonize_land(country_geometry, coastlines, anchor):
    """Cut territorial sea from a country outline using the OSM coastline."""
    country = shape(country_geometry)
    if not coastlines:
        return country
    rings = unary_union([country.boundary, unary_union(coastlines)])
    polygons = list(polygonize(rings))
    if not polygons:
        return country
    mainland = max(polygons, key=lambda polygon: polygon.area)
    if not mainland.contains(anchor):
        return country
    islands = [
        polygon for polygon in polygons
        if polygon is not mainland and polygon.area < 0.001
        and country.covers(polygon.representative_point())
    ]
    return unary_union([mainland, *islands])
