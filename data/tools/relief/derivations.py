"""Deterministic relief derivations from a reviewed DEM grid and source geometry.

This module owns all GIS dependencies. It turns the sampled terrain and already checked
OSM/reviewed sources into the five published relief collections and their build report.
"""

import math
import re
import statistics
import unicodedata

import numpy as np
from contourpy import contour_generator
from shapely.geometry import LineString, MultiLineString, Point, Polygon, box, mapping, shape
from shapely.ops import linemerge, transform, unary_union
from shapely.prepared import prep

from .terrain import (
    CANYON_BANK_RISE_METRES,
    CANYON_RIM_JOIN_GAP_METRES,
    CANYON_RIM_MINIMUM_LENGTH_METRES,
    CANYON_SEARCH_DISTANCE_METRES,
    CANYON_SEARCH_STEP_METRES,
    CONTOUR_SIMPLIFY_TOLERANCE_DEGREES,
    HEIGHT_MISMATCH_METRES,
    RIDGE_MINIMUM_LENGTH_METRES,
    RIDGE_SIMPLIFY_TOLERANCE_DEGREES,
    RIDGE_SUMMIT_LINK_DISTANCE_METRES,
    assert_contours_do_not_cross,
    aspect_boundary_paths,
    bank_rise,
    classify_height_check,
    contour_levels,
    content_hash,
    coordinate_slug,
    drop_short_paths,
    is_canyon_bank,
    is_index_level,
    join_short_gaps,
    path_length_metres,
    rounded_coordinates,
    separate_line_paths,
    smooth_heights,
    sunlit_mask,
    versioned_properties,
)

# Keep this list aligned with the green kinds in source-land-water.schema.json.
# Only these reviewed land kinds feed the slope builder and its provenance.
GREEN_KINDS = (
    'park',
    'garden',
    'woods',
    'meadow',
    'grass',
    'scrub',
    'sports',
    'cemetery',
    'playground',
)

CANONICAL_ATTRIBUTION = (
    '© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided '
    'under COPERNICUS by the European Union and ESA; all rights reserved'
)
ADAPTED_PRODUCT_NOTICE = (
    'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and '
    'Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; '
    'all rights reserved'
)
LAYER_SOURCES = {
    'contour': 'Copernicus DEM GLO-30',
    'summit': 'OpenStreetMap and Copernicus DEM GLO-30',
    'slope': 'Copernicus DEM GLO-30 and reviewed land.geojson',
    'ridge': 'Copernicus DEM GLO-30, reviewed land.geojson and OpenStreetMap summits',
    'canyon-rim': 'Copernicus DEM GLO-30 and OpenStreetMap cliffs',
}


def entity_slug(value):
    """Return a lowercase derived-name segment safe for the entity identity contract."""
    normalized = unicodedata.normalize('NFKD', str(value))
    ascii_text = normalized.encode('ascii', 'ignore').decode('ascii').lower()
    return re.sub(r'[^a-z0-9]+', '-', ascii_text).strip('-') or 'unnamed'


def _geometry(geometry):
    return rounded_coordinates(mapping(geometry))


def _unique_name(base, used):
    """Return a deterministic derived name, numbering only genuine coordinate collisions."""
    name = base
    suffix = 0
    while name in used:
        suffix += 1
        name = f'{base}-{suffix}'
    used.add(name)
    return name


def derived_feature(name, properties, geometry):
    """Build one adopted feature whose content version is bound to its final bytes."""
    complete = {'entityId': f'derived:{name}', **properties}
    return {
        'type': 'Feature',
        'id': complete['entityId'],
        'geometry': geometry,
        'properties': versioned_properties(complete, geometry),
    }


def derived_parts(name, parts):
    """Build split parts of one derived identity that share a single content version."""
    identifier = f'derived:{name}'
    unsigned = [
        {
            'geometry': geometry,
            'properties': {**properties, 'entityPart': index},
        }
        for index, (properties, geometry) in enumerate(parts)
    ]
    version = content_hash(unsigned)
    features = []
    for index, (properties, geometry) in enumerate(parts):
        complete = {
            'entityId': identifier,
            'entityVersion': version,
            'entityPart': index,
            **properties,
        }
        features.append({
            'type': 'Feature',
            'id': identifier,
            'geometry': geometry,
            'properties': complete,
        })
    return features


def _simplify_path(path):
    """Simplify one traced contour while keeping a closed ring closed."""
    coordinates = rounded_coordinates(list(LineString(path).simplify(
        CONTOUR_SIMPLIFY_TOLERANCE_DEGREES, preserve_topology=True
    ).coords))
    if len(coordinates) < 2:
        return []
    if path[0] == path[-1] and coordinates[0] != coordinates[-1]:
        coordinates.append(coordinates[0])
    return coordinates


def _grid_height(heights, longitudes, latitudes, longitude, latitude):
    """Return the height of the grid cell nearest a point, clamped to the grid's edge."""
    column = round((longitude - longitudes[0]) / (longitudes[1] - longitudes[0]))
    row = round((latitude - latitudes[0]) / (latitudes[1] - latitudes[0]))
    column = min(max(column, 0), len(longitudes) - 1)
    row = min(max(row, 0), len(latitudes) - 1)
    return float(heights[row, column])


def _with_uphill_on_left(path, heights, longitudes, latitudes):
    """Return the contour path running with higher ground on its left.

    A map label placed along a line has the top of its digits on the line's left, so this direction makes every
    contour height read facing uphill. Every segment votes with the heights one grid cell to each side.
    """
    cell_longitude = abs(float(longitudes[1] - longitudes[0]))
    cell_latitude = abs(float(latitudes[1] - latitudes[0]))
    uphill_on_left = 0.0
    for (start_x, start_y), (end_x, end_y) in zip(path[:-1], path[1:]):
        east = (end_x - start_x) / cell_longitude
        north = (end_y - start_y) / cell_latitude
        length = math.hypot(east, north)
        if length == 0:
            continue
        middle_x = (start_x + end_x) / 2
        middle_y = (start_y + end_y) / 2
        left_x = middle_x - north / length * cell_longitude
        left_y = middle_y + east / length * cell_latitude
        right_x = middle_x + north / length * cell_longitude
        right_y = middle_y - east / length * cell_latitude
        uphill_on_left += (
            _grid_height(heights, longitudes, latitudes, left_x, left_y)
            - _grid_height(heights, longitudes, latitudes, right_x, right_y)
        )
    return path if uphill_on_left >= 0 else path[::-1]


def _contour_paths(grid, interval):
    heights = smooth_heights(smooth_heights(grid['heights']))
    generator = contour_generator(
        x=grid['longitudes'], y=grid['latitudes'], z=heights, name='serial'
    )
    levels = contour_levels(float(heights.min()), float(heights.max()), interval)
    paths = []
    for level in levels:
        for path in separate_line_paths(generator.lines(level)):
            simplified = _simplify_path(path)
            if len(simplified) >= 2:
                oriented = _with_uphill_on_left(
                    simplified, heights, grid['longitudes'], grid['latitudes']
                )
                paths.append((level, oriented))
    return paths, levels


def build_contours(grid, interval=20, index_interval=100):
    """Trace one connected contour line per feature from a lightly smoothed DEM grid."""
    paths, levels = _contour_paths(grid, interval)
    features = []
    segments = []
    used_names = set()
    for level, path in paths:
        for start, end in zip(path[:-1], path[1:]):
            segments.append({'level': level, 'path': [start, end]})
        base = f'contour-{level}-{coordinate_slug(path[0][0])}-{coordinate_slug(path[0][1])}'
        geometry = {'type': 'LineString', 'coordinates': path}
        features.append(derived_feature(_unique_name(base, used_names), {
            'kind': 'contour',
            'elevation': level,
            'index': is_index_level(level, index_interval),
        }, geometry))
    assert_contours_do_not_cross(segments)
    report = {
        'intervalMetres': interval,
        'indexIntervalMetres': index_interval,
        'levels': sorted({level for level, _ in paths}),
        'availableLevels': levels,
        'features': len(features),
        'segments': len(segments),
        'crossingPairs': 0,
        'smoothingPasses': 2,
        'simplificationToleranceDegrees': CONTOUR_SIMPLIFY_TOLERANCE_DEGREES,
        'geometry': 'one LineString feature per connected contour line',
    }
    return features, report


_ELEVATION_UNIT_RE = re.compile(
    r'^\s*([+-]?(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?))\s*'
    r'(m|meter|metre|meters|metres)?\s*$',
    re.IGNORECASE,
)
_THOUSANDS_GROUP_RE = re.compile(r'^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$')


def _parse_elevation(value):
    if value is None or value == '':
        return None
    text = str(value).strip()
    match = _ELEVATION_UNIT_RE.match(text)
    if not match:
        return None
    number = match.group(1)
    if ',' in number and not _THOUSANDS_GROUP_RE.match(number):
        return None
    try:
        return float(number.replace(',', ''))
    except ValueError:
        return None


def _country_boundary(land):
    countries = [
        shape(feature['geometry']) for feature in land['features']
        if feature['properties'].get('kind') == 'country'
    ]
    if len(countries) != 1:
        raise ValueError(f'expected one kind=country boundary, found {len(countries)}')
    return prep(unary_union(countries))


def _contour_rings(contour_features):
    rings = []
    for feature in contour_features:
        path = feature['geometry']['coordinates']
        if len(path) < 4 or path[0] != path[-1]:
            continue
        polygon = Polygon(path)
        if not polygon.is_valid:
            polygon = polygon.buffer(0)
        if polygon.geom_type == 'Polygon' and not polygon.is_empty:
            rings.append((feature['properties']['elevation'], prep(polygon)))
    return rings


def _enclosing_contour(rings, longitude, latitude):
    point = Point(longitude, latitude)
    levels = [level for level, region in rings if region.covers(point)]
    return max(levels, default=None)


def _summit_reasons(height_check, osm_elevation, dem_elevation, enclosing_contour):
    if height_check != 'mismatch':
        return []
    reasons = []
    if enclosing_contour is not None and enclosing_contour > osm_elevation:
        reasons.append(
            f'Closed {enclosing_contour} m contour encloses summit above OSM elevation'
        )
    difference = round(abs(osm_elevation - dem_elevation), 2)
    if difference > HEIGHT_MISMATCH_METRES:
        reasons.append(f'OSM elevation differs from DEM by {difference} m')
    return reasons


def _summit_properties(summit, osm_elevation, dem_elevation, surrounding_elevation,
                       enclosing_contour, height_check, reasons):
    properties = {
        'entityId': summit['entityId'],
        'entityVersion': summit['entityVersion'],
        'kind': 'summit',
        'natural': summit['kind'],
        'ele': osm_elevation,
        'demElevation': dem_elevation,
        'surroundingDemElevation': surrounding_elevation,
        'enclosingContourElevation': enclosing_contour,
        'heightCheck': height_check,
        'mismatch': height_check == 'mismatch',
        'mismatchReasons': reasons,
    }
    for tag in ('name', 'name:en'):
        value = summit['tags'].get(tag)
        if value:
            properties[tag] = value
    return properties


def _summit_mismatch(summit, properties, geometry, osm_elevation, dem_elevation,
                     enclosing_contour, reasons):
    mismatch = {
        'entityId': summit['entityId'],
        'coordinates': geometry['coordinates'],
        'osmElevation': osm_elevation,
        'demElevation': dem_elevation,
        'enclosingContourElevation': enclosing_contour,
        'reasons': reasons,
    }
    if 'name' in properties:
        mismatch['name'] = properties['name']
    return mismatch


def build_summits(model, osm, land, contour_features):
    """Publish Montenegro OSM summits with explicit, non-destructive DEM checks."""
    country = _country_boundary(land)
    rings = _contour_rings(contour_features)
    features = []
    mismatches = []
    counts = {'missing': 0, 'mismatch': 0, 'ok': 0}
    outside_country = 0
    contour_rule_mismatches = 0
    dem_difference_mismatches = 0
    for summit in osm['summits']:
        source_longitude, source_latitude = summit['coordinates']
        published_longitude, published_latitude = rounded_coordinates(summit['coordinates'])
        # Rounding can move a summit across the boundary in either direction, so both the
        # OSM point and the coordinate we publish must lie within the country.
        if not (
            country.covers(Point(source_longitude, source_latitude))
            and country.covers(Point(published_longitude, published_latitude))
        ):
            outside_country += 1
            continue
        dem_elevation = round(model.sample(source_longitude, source_latitude), 2)
        surrounding_elevation = round(
            model.surrounding_height(source_longitude, source_latitude), 2
        )
        osm_elevation = _parse_elevation(summit['tags'].get('ele'))
        enclosing_contour = (
            _enclosing_contour(rings, source_longitude, source_latitude)
            if osm_elevation is not None else None
        )
        height_check = classify_height_check(
            osm_elevation, dem_elevation, enclosing_contour
        )
        reasons = _summit_reasons(
            height_check, osm_elevation, dem_elevation, enclosing_contour
        )
        counts[height_check] += 1
        properties = _summit_properties(
            summit, osm_elevation, dem_elevation, surrounding_elevation,
            enclosing_contour, height_check, reasons,
        )
        geometry = {
            'type': 'Point',
            'coordinates': [published_longitude, published_latitude],
        }
        features.append({
            'type': 'Feature',
            'id': summit['entityId'],
            'geometry': geometry,
            'properties': properties,
        })
        if height_check == 'mismatch':
            mismatches.append(_summit_mismatch(
                summit, properties, geometry, osm_elevation, dem_elevation,
                enclosing_contour, reasons,
            ))
            contour_rule_mismatches += int(bool(
                enclosing_contour is not None and enclosing_contour > osm_elevation
            ))
            dem_difference_mismatches += int(bool(
                abs(osm_elevation - dem_elevation) > HEIGHT_MISMATCH_METRES
            ))
    report = {
        'features': len(features),
        'country': 'Montenegro',
        'countryBoundaryKind': 'country',
        'summitsOutsideCountry': outside_country,
        'heightCheckCounts': counts,
        'mismatchToleranceMetres': HEIGHT_MISMATCH_METRES,
        'contourRule': 'a closed contour enclosing the summit is higher than OSM ele',
        'contourRuleMismatches': contour_rule_mismatches,
        'demDifferenceMismatches': dem_difference_mismatches,
        'mismatches': len(mismatches),
        'items': mismatches,
    }
    return features, report


def _cell_edges(coordinates):
    """Return pixel boundaries, halfway between adjacent DEM pixel centres."""
    values = np.asarray(coordinates, dtype=float)
    first_step = values[1] - values[0]
    last_step = values[-1] - values[-2]
    return [values[0] - first_step / 2] + [
        (values[index] + values[index + 1]) / 2 for index in range(len(values) - 1)
    ] + [values[-1] + last_step / 2]


def _cell_range(coordinates, low, high):
    inside = np.where((coordinates >= low) & (coordinates <= high))[0]
    if not len(inside):
        return 0, 0
    return max(0, int(inside[0]) - 1), min(len(coordinates), int(inside[-1]) + 2)


def _green_cells(grid, land, green_kinds, detail_bounds):
    """Collect clipped DEM cells and their light classes inside reviewed green areas."""
    west, south, east, north = detail_bounds
    detail_box = box(west, south, east, north)
    green_parts = []
    present_kinds = set()
    for feature in land['features']:
        kind = feature['properties'].get('kind')
        if kind not in green_kinds:
            continue
        polygon = shape(feature['geometry'])
        if polygon.is_valid and not polygon.is_empty:
            green_parts.append(polygon.intersection(detail_box))
            present_kinds.add(kind)

    longitudes = grid['longitudes']
    latitudes = grid['latitudes']
    x_edges = _cell_edges(longitudes)
    y_edges = _cell_edges(latitudes)
    cell_classes = np.full(grid['heights'].shape, -1, dtype=int)
    collected = {'sunlit': [], 'shaded': []}
    empty_result = {
        'cellParts': collected,
        'presentKinds': sorted(present_kinds),
        'green': None,
        'cellClasses': cell_classes,
        'xEdges': x_edges,
        'yEdges': y_edges,
    }
    if not green_parts:
        return empty_result

    green = unary_union(green_parts).buffer(0)
    if green.is_empty:
        return empty_result
    heights = smooth_heights(smooth_heights(grid['heights']))
    is_sunlit = sunlit_mask(
        heights, grid['metres_per_column'], grid['metres_per_row']
    )
    prepared_green = prep(green)
    column_start, column_end = _cell_range(longitudes, green.bounds[0], green.bounds[2])
    row_start, row_end = _cell_range(latitudes, green.bounds[1], green.bounds[3])
    for row in range(row_start, min(row_end, len(latitudes))):
        for column in range(column_start, min(column_end, len(longitudes))):
            cell = box(
                x_edges[column], y_edges[row + 1],
                x_edges[column + 1], y_edges[row],
            )
            if not prepared_green.intersects(cell):
                continue
            clipped = green.intersection(cell)
            if clipped.is_empty:
                continue
            label = 'sunlit' if is_sunlit[row, column] else 'shaded'
            collected[label].append((row, column, clipped))
            cell_classes[row, column] = 1 if is_sunlit[row, column] else 0
    return {
        'cellParts': collected,
        'presentKinds': sorted(present_kinds),
        'green': green,
        'cellClasses': cell_classes,
        'xEdges': x_edges,
        'yEdges': y_edges,
    }


def _kept_slope_polygons(cell_parts, minimum_area_degrees):
    if not cell_parts:
        return []
    merged = unary_union(cell_parts).buffer(0)
    polygons = list(merged.geoms) if merged.geom_type == 'MultiPolygon' else [merged]
    kept = [
        polygon for polygon in polygons
        if polygon.geom_type == 'Polygon' and polygon.area >= minimum_area_degrees
    ]
    return sorted(kept, key=lambda polygon: tuple(polygon.exterior.coords[0]))


def slope_areas(grid, land, green_kinds, detail_bounds, minimum_area_m2=2500):
    """Return the retained slope polygons and the class grid they share a boundary on."""
    cells = _green_cells(grid, land, green_kinds, detail_bounds)
    square_metres_per_degree = (
        grid['metres_per_column'] * 3600 * grid['metres_per_row'] * 3600
    )
    minimum_area_degrees = minimum_area_m2 / square_metres_per_degree
    polygons = {}
    for label in ('sunlit', 'shaded'):
        parts = [part for _, _, part in cells['cellParts'][label]]
        kept = _kept_slope_polygons(parts, minimum_area_degrees)
        polygons[label] = kept
        kept_area = unary_union(kept) if kept else None
        for row, column, part in cells['cellParts'][label]:
            if kept_area is None or not kept_area.covers(part.representative_point()):
                cells['cellClasses'][row, column] = -1
    return {
        'polygons': polygons,
        'greenKinds': list(green_kinds),
        'presentKinds': cells['presentKinds'],
        'green': cells['green'],
        'cellClasses': cells['cellClasses'],
        'xEdges': cells['xEdges'],
        'yEdges': cells['yEdges'],
        'squareMetresPerDegree': square_metres_per_degree,
        'minimumAreaSquareMetres': minimum_area_m2,
        'metresPerDegreeLongitude': grid['metres_per_column'] / abs(
            float(grid['longitudes'][1] - grid['longitudes'][0])
        ),
        'metresPerDegreeLatitude': grid['metres_per_row'] / abs(
            float(grid['latitudes'][0] - grid['latitudes'][1])
        ),
    }


def build_slopes(areas):
    """Publish each retained light-class polygon as one Polygon feature."""
    features = []
    used_names = set()
    report = {
        'configuredGreenKinds': areas['greenKinds'],
        'presentGreenKindsInLand': areas['presentKinds'],
        'minimumAreaSquareMetres': areas['minimumAreaSquareMetres'],
        'features': 0,
        'geometry': 'one Polygon feature per connected slope area',
    }
    for label in ('sunlit', 'shaded'):
        kept = areas['polygons'][label]
        area_m2 = round(
            sum(polygon.area for polygon in kept) * areas['squareMetresPerDegree']
        )
        for polygon in kept:
            geometry = _geometry(polygon)
            start = geometry['coordinates'][0][0]
            base = f'slope-{label}-{coordinate_slug(start[0])}-{coordinate_slug(start[1])}'
            features.append(derived_feature(_unique_name(base, used_names), {
                'kind': 'slope',
                'aspect': label,
                'areaSquareMetres': round(
                    polygon.area * areas['squareMetresPerDegree']
                ),
            }, geometry))
        report[label] = {'polygons': len(kept), 'areaSquareMetres': area_m2}
    report['features'] = len(features)
    return features, report


def _line_components(geometry):
    """Return every LineString part of a merged or clipped geometry."""
    if geometry.is_empty:
        return []
    if geometry.geom_type == 'LineString':
        return [geometry]
    if hasattr(geometry, 'geoms'):
        return [
            part for item in geometry.geoms for part in _line_components(item)
        ]
    return []


def _light_class_sides(cell_classes, y_edges):
    """Name the mean north/south side of the retained sunlit and shaded slope cells."""
    centre_latitudes = (np.asarray(y_edges[:-1]) + np.asarray(y_edges[1:])) / 2
    classes = np.asarray(cell_classes)
    sunlit_rows = np.where((classes == 1).any(axis=1))[0]
    shaded_rows = np.where((classes == 0).any(axis=1))[0]
    sunlit_latitudes = [float(centre_latitudes[row]) for row in sunlit_rows]
    shaded_latitudes = [float(centre_latitudes[row]) for row in shaded_rows]
    if not sunlit_latitudes or not shaded_latitudes:
        return 'undetermined', 'undetermined'
    if statistics.mean(sunlit_latitudes) < statistics.mean(shaded_latitudes):
        return 'south', 'north'
    return 'north', 'south'


def _metric_distance_to_line(point_coordinates, path, metres_per_column, metres_per_row):
    """Return the metre distance from a summit point to a ridge path."""
    def to_metres(longitude, latitude):
        return longitude * metres_per_column, latitude * metres_per_row

    metric_line = transform(to_metres, LineString(path))
    metric_point = transform(to_metres, Point(point_coordinates))
    return metric_line.distance(metric_point)


def _nearest_summit(path, summit_features, metres_per_column, metres_per_row):
    """Return the closest summit within the link distance, or None when there is none."""
    candidates = []
    for summit in summit_features:
        distance = _metric_distance_to_line(
            summit['geometry']['coordinates'], path, metres_per_column, metres_per_row
        )
        if distance <= RIDGE_SUMMIT_LINK_DISTANCE_METRES:
            candidates.append((distance, summit['id'], summit))
    if not candidates:
        return None
    return min(candidates, key=lambda candidate: (candidate[0], candidate[1]))[2]


def build_ridges(areas, summit_features):
    """Publish each connected sunlit/shaded slope boundary as one simplified ridge."""
    raw_paths = aspect_boundary_paths(
        areas['cellClasses'], areas['xEdges'], areas['yEdges']
    )
    sunlit_side, shaded_side = _light_class_sides(areas['cellClasses'], areas['yEdges'])
    report = {
        'geometry': 'one LineString feature per connected sunlit/shaded slope boundary',
        'boundarySource': 'shared boundary of retained sunlit and shaded slope polygons inside green areas',
        'simplificationToleranceDegrees': RIDGE_SIMPLIFY_TOLERANCE_DEGREES,
        'minimumLengthMetres': RIDGE_MINIMUM_LENGTH_METRES,
        'summitLinkDistanceMetres': RIDGE_SUMMIT_LINK_DISTANCE_METRES,
        'features': 0,
        'summitLinks': 0,
        'items': [],
    }
    if not raw_paths or areas['green'] is None:
        return [], report

    boundary = unary_union([LineString(path) for path in raw_paths])
    clipped = boundary.intersection(areas['green'])
    simplified = unary_union([
        line.simplify(RIDGE_SIMPLIFY_TOLERANCE_DEGREES, preserve_topology=True)
        for line in _line_components(clipped)
    ])
    paths = [
        rounded_coordinates(list(line.coords))
        for line in _line_components(linemerge(simplified))
    ]
    paths = drop_short_paths(
        paths, RIDGE_MINIMUM_LENGTH_METRES,
        areas['metresPerDegreeLongitude'], areas['metresPerDegreeLatitude'],
    )
    paths = separate_line_paths(paths)

    features = []
    used_names = set()
    for path in paths:
        linked_summit = _nearest_summit(
            path, summit_features, areas['metresPerDegreeLongitude'], areas['metresPerDegreeLatitude']
        )
        properties = {
            'kind': 'ridge',
            'sunlitSide': sunlit_side,
            'shadedSide': shaded_side,
        }
        if linked_summit is not None:
            properties['summit'] = linked_summit['id']
            properties['summitName'] = linked_summit['properties'].get('name', '')
        base = f'ridge-{coordinate_slug(path[0][0])}-{coordinate_slug(path[0][1])}'
        geometry = {'type': 'LineString', 'coordinates': path}
        feature = derived_feature(_unique_name(base, used_names), properties, geometry)
        features.append(feature)
        report['items'].append({
            'entityId': feature['properties']['entityId'],
            'lengthMetres': round(path_length_metres(
                path, areas['metresPerDegreeLongitude'], areas['metresPerDegreeLatitude']
            )),
            'summit': linked_summit['id'] if linked_summit else None,
        })
    report['features'] = len(features)
    report['summitLinks'] = sum(item['summit'] is not None for item in report['items'])
    return features, report


def _river_centrelines(water, detail_bounds, river_names):
    west, south, east, north = detail_bounds
    detail_box = box(west, south, east, north)
    centrelines = []
    for name in river_names:
        parts = []
        for feature in water['features']:
            properties = feature['properties']
            if properties.get('name') != name or properties.get('kind') != 'river':
                continue
            if feature['geometry']['type'] != 'LineString':
                continue
            line = shape(feature['geometry']).intersection(detail_box)
            if line.geom_type == 'LineString' and line.length > 0:
                parts.append(line)
            elif line.geom_type in ('MultiLineString', 'GeometryCollection'):
                parts.extend(
                    part for part in line.geoms
                    if part.geom_type == 'LineString' and part.length > 0
                )
        if not parts:
            continue
        merged = linemerge(parts) if len(parts) == 1 else linemerge(unary_union(parts))
        components = list(merged.geoms) if merged.geom_type == 'MultiLineString' else [merged]
        for component in components:
            if component.geom_type == 'LineString' and component.length > 0:
                centrelines.append((name, component))
    return centrelines


def _orient_downstream(line, model):
    def mean_height(fractions):
        heights = []
        for fraction in fractions:
            point = line.interpolate(fraction, normalized=True)
            heights.append(model.sample(point.x, point.y))
        return statistics.mean(heights)

    if mean_height([0.1, 0.2, 0.3]) < mean_height([0.7, 0.8, 0.9]):
        return LineString(list(line.coords)[::-1])
    return line


def _normal_at(line, point, latitude_metres, longitude_metres):
    distance = line.project(point)
    epsilon = max(line.length * 0.001, 1e-7)
    before = line.interpolate(max(0, distance - epsilon))
    after = line.interpolate(min(line.length, distance + epsilon))
    tangent_east = (after.x - before.x) * longitude_metres
    tangent_north = (after.y - before.y) * latitude_metres
    length = math.hypot(tangent_east, tangent_north) or 1
    return -tangent_north / length, tangent_east / length


def _offset_point(point, normal, bank, offset_metres, latitude_metres, longitude_metres):
    direction = 1 if bank == 'left' else -1
    return Point(
        point.x + direction * normal[0] * offset_metres / longitude_metres,
        point.y + direction * normal[1] * offset_metres / latitude_metres,
    )


def _signed_offset_metres(point, line, latitude_metres, longitude_metres):
    normal = _normal_at(line, point, latitude_metres, longitude_metres)
    centre = line.interpolate(line.project(point))
    east = (point.x - centre.x) * longitude_metres
    north = (point.y - centre.y) * latitude_metres
    return east * normal[0] + north * normal[1]


def _river_samples(line, model, latitude_metres, sample_spacing_metres):
    spacing_degrees = sample_spacing_metres / latitude_metres
    distance = 0.0
    while distance <= line.length + spacing_degrees:
        point = line.interpolate(min(distance, line.length))
        try:
            river_height = model.sample(point.x, point.y)
        except ValueError:
            distance += spacing_degrees
            continue
        yield distance, point, river_height
        distance += spacing_degrees


def _bank_samples(line, bank, model, latitude_metres, longitude_metres, sample_spacing_metres):
    samples = []
    for distance, point, river_height in _river_samples(
        line, model, latitude_metres, sample_spacing_metres
    ):
        normal = _normal_at(line, point, latitude_metres, longitude_metres)
        candidates = []
        for offset in range(
            CANYON_SEARCH_STEP_METRES,
            CANYON_SEARCH_DISTANCE_METRES + CANYON_SEARCH_STEP_METRES,
            CANYON_SEARCH_STEP_METRES,
        ):
            bank_point = _offset_point(
                point, normal, bank, offset, latitude_metres, longitude_metres
            )
            try:
                height = model.sample(bank_point.x, bank_point.y)
            except ValueError:
                continue
            candidates.append((offset, height))
        if not candidates:
            continue
        heights = [height for _, height in candidates]
        if not is_canyon_bank(river_height, heights):
            continue
        best_offset, _ = max(candidates, key=lambda candidate: candidate[1])
        rim_point = _offset_point(
            point, normal, bank, best_offset, latitude_metres, longitude_metres
        )
        samples.append((distance, rim_point, bank_rise(river_height, heights)))
    return samples


def _segments_from_samples(samples, maximum_gap):
    runs = []
    run = []
    previous_distance = None
    for distance, point, rise in samples:
        if previous_distance is not None and distance - previous_distance > maximum_gap:
            runs.append(run)
            run = []
        run.append((point, rise))
        previous_distance = distance
    if run:
        runs.append(run)
    segments = []
    for run in runs:
        if len(run) < 2:
            continue
        segments.append((LineString([point for point, _ in run]), max(
            rise for _, rise in run
        )))
    return segments


def _clean_rim_segments(segments, latitude_metres, longitude_metres):
    """Join gap speckle into bank lines and remove the short lines left behind."""
    if not segments:
        return []
    paths = [list(segment.coords) for segment, _ in segments]
    joined_paths = join_short_gaps(
        paths, CANYON_RIM_JOIN_GAP_METRES, longitude_metres, latitude_metres
    )
    kept_paths = drop_short_paths(
        joined_paths, CANYON_RIM_MINIMUM_LENGTH_METRES,
        longitude_metres, latitude_metres,
    )
    cleaned = []
    for path in kept_paths:
        joined_line = LineString(path)
        rise = max(
            rise for segment, rise in segments if joined_line.intersects(segment)
        )
        cleaned.append((joined_line, rise))
    return cleaned


def _cliff_parts(cliffs, line, bank, detail_bounds, latitude_metres, longitude_metres):
    west, south, east, north = detail_bounds
    detail_box = box(west, south, east, north)
    parts = []
    for cliff in cliffs:
        geometry = LineString(cliff['coordinates'])
        representative = geometry.interpolate(0.5, normalized=True)
        signed = _signed_offset_metres(representative, line, latitude_metres, longitude_metres)
        if (bank == 'left' and signed <= 0) or (bank == 'right' and signed >= 0):
            continue
        if abs(signed) > CANYON_SEARCH_DISTANCE_METRES:
            continue
        clipped = geometry.intersection(detail_box)
        if clipped.geom_type == 'LineString' and clipped.length > 0:
            parts.append((clipped, cliff))
        elif clipped.geom_type in ('MultiLineString', 'GeometryCollection'):
            parts.extend(
                (part, cliff) for part in clipped.geoms
                if part.geom_type == 'LineString' and part.length > 0
            )
    return parts


def _qualifying_cliff_parts(cliffs, lines, bank, detail_bounds, latitude_metres,
                            longitude_metres, rim_geometry, near_metres):
    candidates = []
    for line in lines:
        candidates.extend(_cliff_parts(
            cliffs, line, bank, detail_bounds, latitude_metres, longitude_metres
        ))
    if rim_geometry.is_empty:
        return []
    kept = []
    seen = set()
    for part, cliff in candidates:
        if part.distance(rim_geometry) > near_metres / latitude_metres:
            continue
        rounded = rounded_coordinates(list(part.coords))
        key = (cliff['entityId'], tuple(tuple(point) for point in rounded))
        if key in seen:
            continue
        seen.add(key)
        kept.append((part, cliff))
    return sorted(kept, key=lambda item: (item[1]['entityId'], tuple(item[0].coords[0])))


def _with_water_on_right(segment, river_lines, bank):
    """Return the rim segment running so that the river lies on its right.

    A style offsets a canyon wall from the rim toward the water with one sign for every rim, so all rims share this
    direction. River lines run downstream: a left-bank rim keeps the downstream direction, a right-bank rim runs
    upstream. The nearest river line decides the direction, because OSM cliff ways keep their mappers' direction.
    """
    middle = segment.interpolate(0.5, normalized=True)
    river_line = min(river_lines, key=lambda line: line.distance(middle))
    start = Point(segment.coords[0])
    end = Point(segment.coords[-1])
    runs_downstream = river_line.project(end) >= river_line.project(start)
    should_run_downstream = bank == 'left'
    if runs_downstream == should_run_downstream:
        return segment
    return LineString(list(segment.coords)[::-1])


def _metric_length(geometry, latitude_metres, longitude_metres):
    if geometry.is_empty:
        return 0.0

    def to_metres(x, y):
        return x * longitude_metres, y * latitude_metres
    return transform(to_metres, geometry).length


def _cliff_rim_features(cliff_parts, river_name, bank, latitude_metres, longitude_metres):
    grouped = {}
    for part, cliff in cliff_parts:
        grouped.setdefault(
            (cliff['entityId'], cliff['entityVersion']), []
        ).append(part)
    features = []
    for (entity_id, entity_version), parts in sorted(grouped.items()):
        ordered_parts = sorted(parts, key=lambda part: tuple(part.coords[0]))
        for index, part in enumerate(ordered_parts):
            geometry = {
                'type': 'LineString',
                'coordinates': rounded_coordinates(list(part.coords)),
            }
            properties = {
                'entityId': entity_id,
                'entityVersion': entity_version,
                'kind': 'canyon-rim',
                'river': river_name,
                'bank': bank,
                'method': 'osm-cliff',
                'lengthMetres': round(
                    _metric_length(part, latitude_metres, longitude_metres)
                ),
            }
            if len(ordered_parts) > 1:
                properties['entityPart'] = index
            features.append({
                'type': 'Feature',
                'id': entity_id,
                'geometry': geometry,
                'properties': properties,
            })
    return features


def _dem_rim_features(segments, river_name, bank, latitude_metres, longitude_metres):
    parts = []
    for segment, _ in segments:
        geometry = {
            'type': 'LineString',
            'coordinates': rounded_coordinates(list(segment.coords)),
        }
        parts.append(({
            'kind': 'canyon-rim',
            'river': river_name,
            'bank': bank,
            'method': 'dem-canyon-bank',
            'lengthMetres': round(
                _metric_length(segment, latitude_metres, longitude_metres)
            ),
        }, geometry))
    if not parts:
        return []
    return derived_parts(f'canyon-rim-{entity_slug(river_name)}-{bank}', parts)


def _bank_report(river_name, bank, dem_features, cliff_features, latitude_metres, longitude_metres):
    dem_length = sum(
        feature['properties']['lengthMetres'] for feature in dem_features
    )
    cliff_length = sum(
        feature['properties']['lengthMetres'] for feature in cliff_features
    )
    return {
        'river': river_name,
        'bank': bank,
        'demFeatureCount': len(dem_features),
        'cliffFeatureCount': len(cliff_features),
        'cliffWays': sorted({f['properties']['entityId'] for f in cliff_features}),
        'demLengthMetres': round(dem_length),
        'cliffLengthMetres': round(cliff_length),
        'totalLengthMetres': round(dem_length + cliff_length),
    }


def _river_lines(water, detail_bounds, river_names):
    grouped = {}
    for river_name, line in _river_centrelines(water, detail_bounds, river_names):
        grouped.setdefault(river_name, []).append(line)
    return grouped


def _dem_segments_for_bank(lines, bank, model, latitude_metres, longitude_metres,
                           sample_spacing_metres):
    samples = []
    for line in lines:
        samples.extend(_bank_samples(
            line, bank, model, latitude_metres, longitude_metres,
            sample_spacing_metres,
        ))
    sampled_segments = _segments_from_samples(
        samples, sample_spacing_metres * 1.5 / latitude_metres
    )
    sampled_segments.sort(key=lambda segment: tuple(segment[0].coords[0]))
    return _clean_rim_segments(sampled_segments, latitude_metres, longitude_metres)


def build_canyon_rims(model, water, cliffs, detail_bounds,
                      river_names=('Morača', 'Ribnica'), sample_spacing_metres=40):
    """Publish canyon rims as OSM cliff features and DEM-derived bank segments."""
    latitude_metres = 111_320
    longitude_metres = latitude_metres * math.cos(
        math.radians((detail_bounds[1] + detail_bounds[3]) / 2)
    )
    grouped = _river_lines(water, detail_bounds, river_names)
    for river_name, lines in grouped.items():
        grouped[river_name] = [_orient_downstream(line, model) for line in lines]

    features = []
    river_banks = []
    for river_name in river_names:
        for bank in ('left', 'right'):
            lines = grouped.get(river_name, [])
            dem_segments = _dem_segments_for_bank(
                lines, bank, model, latitude_metres, longitude_metres, sample_spacing_metres
            )
            rim_geometry = unary_union([line for line, _ in dem_segments]) if dem_segments else LineString()
            cliff_parts = _qualifying_cliff_parts(
                cliffs, lines, bank, detail_bounds, latitude_metres, longitude_metres,
                rim_geometry, CANYON_SEARCH_DISTANCE_METRES / 2,
            )
            cliff_parts = [
                (_with_water_on_right(part, lines, bank), cliff) for part, cliff in cliff_parts
            ]
            dem_segments = [
                (_with_water_on_right(segment, lines, bank), rise)
                for segment, rise in dem_segments
            ]
            cliff_features = _cliff_rim_features(
                cliff_parts, river_name, bank, latitude_metres, longitude_metres
            )
            dem_features = _dem_rim_features(
                dem_segments, river_name, bank, latitude_metres, longitude_metres
            )
            features.extend(cliff_features)
            features.extend(dem_features)
            river_banks.append(_bank_report(
                river_name, bank, dem_features, cliff_features, latitude_metres, longitude_metres
            ))

    report = {
        'riverBanks': river_banks,
        'sampleSpacingMetres': sample_spacing_metres,
        'minimumBankRiseMetres': CANYON_BANK_RISE_METRES,
        'searchDistanceMetres': CANYON_SEARCH_DISTANCE_METRES,
        'searchStepMetres': CANYON_SEARCH_STEP_METRES,
        'joinGapMetres': CANYON_RIM_JOIN_GAP_METRES,
        'minimumSegmentLengthMetres': CANYON_RIM_MINIMUM_LENGTH_METRES,
        'geometry': 'OSM cliff segments keep way identity; DEM canyon banks are derived parts',
    }
    return features, report


LICENSE_BLOCK = {
    'attribution': CANONICAL_ATTRIBUTION,
    'adaptedProductNotice': ADAPTED_PRODUCT_NOTICE,
    'bucket': 'https://copernicus-dem-30m.s3.amazonaws.com/',
    'eula': 'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N42_00_E019_00_DEM/INFO/eula_F.pdf',
    'collection': 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',
}
