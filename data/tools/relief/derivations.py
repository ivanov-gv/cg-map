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
    CANYON_SEARCH_DISTANCE_METRES,
    CANYON_SEARCH_STEP_METRES,
    CONTOUR_SIMPLIFY_TOLERANCE_DEGREES,
    HEIGHT_MISMATCH_METRES,
    assert_contours_do_not_cross,
    bank_rise,
    classify_height_check,
    contour_levels,
    content_hash,
    coordinate_slug,
    is_canyon_bank,
    is_index_level,
    rounded_coordinates,
    separate_line_paths,
    smooth_heights,
    sunlit_mask,
    versioned_properties,
)

# Feature #326 adds these kinds to land.geojson; extending this one constant is enough to
# include them in the slope builder, its provenance and the published feature properties.
GREEN_KINDS = (
    'park',
    'garden',
    'wood',
    'forest',
    'meadow',
    'grass',
    'scrub',
    'heath',
    'recreation_ground',
    'cemetery',
    'pitch',
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
                paths.append((level, simplified))
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
            'intervalMetres': interval,
            'index': is_index_level(level, index_interval),
            'segments': len(path) - 1,
            'source': 'Copernicus DEM GLO-30',
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


def _parse_elevation(value):
    if value is None or value == '':
        return None
    try:
        return float(str(value).replace(',', '.'))
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
    return min(levels, default=None)


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
        longitude, latitude = summit['coordinates']
        if not country.covers(Point(longitude, latitude)):
            outside_country += 1
            continue
        dem_elevation = round(model.sample(longitude, latitude), 2)
        surrounding_elevation = round(
            model.surrounding_height(longitude, latitude), 2
        )
        osm_elevation = _parse_elevation(summit['tags'].get('ele'))
        enclosing_contour = (
            _enclosing_contour(rings, longitude, latitude)
            if osm_elevation is not None else None
        )
        height_check = classify_height_check(
            osm_elevation, dem_elevation, enclosing_contour
        )
        reasons = _summit_reasons(
            height_check, osm_elevation, dem_elevation, enclosing_contour
        )
        counts[height_check] += 1
        properties = {
            'entityId': summit['entityId'],
            'entityVersion': summit['entityVersion'],
            'kind': 'summit',
            'natural': summit['kind'],
            'name': summit['tags'].get('name', ''),
            'name:en': summit['tags'].get('name:en', ''),
            'ele': osm_elevation,
            'demElevation': dem_elevation,
            'surroundingDemElevation': surrounding_elevation,
            'enclosingContourElevation': enclosing_contour,
            'heightCheck': height_check,
            'mismatch': height_check == 'mismatch',
            'mismatchReasons': reasons,
            'source': 'OpenStreetMap and Copernicus DEM GLO-30',
        }
        geometry = {'type': 'Point', 'coordinates': rounded_coordinates(summit['coordinates'])}
        features.append({
            'type': 'Feature',
            'id': summit['entityId'],
            'geometry': geometry,
            'properties': properties,
        })
        if height_check == 'mismatch':
            mismatches.append({
                'entityId': summit['entityId'],
                'name': properties['name'],
                'coordinates': geometry['coordinates'],
                'osmElevation': osm_elevation,
                'demElevation': dem_elevation,
                'enclosingContourElevation': enclosing_contour,
                'reasons': reasons,
            })
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
    """Collect DEM cells clipped to the reviewed green areas of the configured kinds."""
    west, south, east, north = detail_bounds
    green_parts = []
    present_kinds = set()
    for feature in land['features']:
        kind = feature['properties'].get('kind')
        if kind not in green_kinds:
            continue
        polygon = shape(feature['geometry'])
        if polygon.is_valid and not polygon.is_empty:
            green_parts.append(polygon.intersection(box(west, south, east, north)))
            present_kinds.add(kind)
    if not green_parts:
        return {'sunlit': [], 'shaded': []}, sorted(present_kinds)

    green = unary_union(green_parts).buffer(0)
    heights = smooth_heights(smooth_heights(grid['heights']))
    classes = sunlit_mask(
        heights, grid['metres_per_column'], grid['metres_per_row']
    )
    longitudes = grid['longitudes']
    latitudes = grid['latitudes']
    x_edges = _cell_edges(longitudes)
    y_edges = _cell_edges(latitudes)
    collected = {'sunlit': [], 'shaded': []}
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
            label = 'sunlit' if classes[row, column] else 'shaded'
            collected[label].append(clipped)
    return collected, sorted(present_kinds)


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


def build_slopes(grid, land, green_kinds, detail_bounds, minimum_area_m2=2500):
    """Classify DEM cells inside reviewed green areas as one Polygon feature each."""
    collected, present_kinds = _green_cells(grid, land, green_kinds, detail_bounds)
    square_metres_per_degree = (
        grid['metres_per_column'] * 3600 * grid['metres_per_row'] * 3600
    )
    minimum_area_degrees = minimum_area_m2 / square_metres_per_degree
    features = []
    used_names = set()
    report = {
        'configuredGreenKinds': list(green_kinds),
        'presentGreenKindsInLand': present_kinds,
        'minimumAreaSquareMetres': minimum_area_m2,
        'features': 0,
        'geometry': 'one Polygon feature per connected slope area',
    }
    for label in ('sunlit', 'shaded'):
        kept = _kept_slope_polygons(collected[label], minimum_area_degrees)
        area_m2 = round(sum(polygon.area for polygon in kept) * square_metres_per_degree)
        for polygon in kept:
            geometry = _geometry(polygon)
            start = geometry['coordinates'][0][0]
            base = f'slope-{label}-{coordinate_slug(start[0])}-{coordinate_slug(start[1])}'
            features.append(derived_feature(_unique_name(base, used_names), {
                'kind': 'slope',
                'aspect': label,
                'greenKinds': list(green_kinds),
                'greenKindsPresentInLand': present_kinds,
                'areaSquareMetres': round(polygon.area * square_metres_per_degree),
                'minimumAreaSquareMetres': minimum_area_m2,
                'source': 'Copernicus DEM GLO-30 and reviewed land.geojson',
            }, geometry))
        report[label] = {'polygons': len(kept), 'areaSquareMetres': area_m2}
    report['features'] = len(features)
    return features, report


def _grid_index(coordinates, value):
    return int(np.argmin(np.abs(np.asarray(coordinates, dtype=float) - value)))


def _ridge_sides(longitudes, latitudes, classes, centre_column, centre_row, radius_columns, radius_rows, radius_metres, summit):
    sunlit_latitudes = []
    shaded_latitudes = []
    longitude_metres = 111_320 * math.cos(math.radians(summit[1]))
    for row in range(max(0, centre_row - radius_rows), min(len(latitudes), centre_row + radius_rows + 1)):
        for column in range(max(0, centre_column - radius_columns), min(len(longitudes), centre_column + radius_columns + 1)):
            east = (longitudes[column] - summit[0]) * longitude_metres
            north = (latitudes[row] - summit[1]) * 111_320
            if math.hypot(east, north) > radius_metres:
                continue
            if classes[row, column]:
                sunlit_latitudes.append(latitudes[row])
            else:
                shaded_latitudes.append(latitudes[row])
    if not sunlit_latitudes or not shaded_latitudes:
        return 'undetermined', 'undetermined'
    if statistics.mean(sunlit_latitudes) < statistics.mean(shaded_latitudes):
        return 'south', 'north'
    return 'north', 'south'


def _aspect_boundary_lines(grid, classes, summit_coordinates, radius_metres):
    longitudes = grid['longitudes']
    latitudes = grid['latitudes']
    x_edges = _cell_edges(longitudes)
    y_edges = _cell_edges(latitudes)
    longitude, latitude = summit_coordinates
    radius_columns = int(math.ceil(radius_metres / grid['metres_per_column'])) + 1
    radius_rows = int(math.ceil(radius_metres / grid['metres_per_row'])) + 1
    longitude_metres = 111_320 * math.cos(math.radians(float(np.mean(latitudes))))
    centre_column = _grid_index(longitudes, longitude)
    centre_row = _grid_index(latitudes, latitude)
    lines = []
    for row in range(max(0, centre_row - radius_rows), min(len(latitudes) - 1, centre_row + radius_rows + 1)):
        for column in range(max(0, centre_column - radius_columns), min(len(longitudes) - 1, centre_column + radius_columns + 1)):
            cell_east = (longitudes[column] - longitude) * longitude_metres
            cell_north = (latitudes[row] - latitude) * 111_320
            if math.hypot(cell_east, cell_north) > radius_metres:
                continue
            if classes[row, column] != classes[row, column + 1]:
                x = x_edges[column + 1]
                lines.append(LineString([(x, y_edges[row + 1]), (x, y_edges[row])]))
            if classes[row, column] != classes[row + 1, column]:
                y = y_edges[row + 1]
                lines.append(LineString([(x_edges[column], y), (x_edges[column + 1], y)]))
    return lines, (centre_column, centre_row, radius_columns, radius_rows)


def build_ridges(grid, summit_features, radius_metres=400):
    """Draw one DEM aspect-class boundary line per feature near each detail-area summit."""
    heights = smooth_heights(smooth_heights(grid['heights']))
    classes = sunlit_mask(heights, grid['metres_per_column'], grid['metres_per_row'])
    features = []
    used_names = set()
    report = {'radiusMetres': radius_metres, 'features': 0, 'items': []}
    for summit in summit_features:
        coordinates = summit['geometry']['coordinates']
        longitude, latitude = coordinates
        if not (grid['longitudes'][0] <= longitude <= grid['longitudes'][-1]
                and grid['latitudes'][-1] <= latitude <= grid['latitudes'][0]):
            continue
        lines, ridge_indices = _aspect_boundary_lines(
            grid, classes, coordinates, radius_metres
        )
        if not lines:
            continue
        merged = unary_union(lines)
        sunlit_side, shaded_side = _ridge_sides(
            grid['longitudes'], grid['latitudes'], classes,
            *ridge_indices, radius_metres, coordinates,
        )
        properties = summit['properties']
        components = list(merged.geoms) if merged.geom_type == 'MultiLineString' else [merged]
        summit_slug = entity_slug(summit['id'])
        summit_features_added = 0
        for line in components:
            path = rounded_coordinates(list(line.coords))
            if len(path) < 2:
                continue
            base = (
                f'ridge-{summit_slug}-{coordinate_slug(path[0][0])}-'
                f'{coordinate_slug(path[0][1])}'
            )
            features.append(derived_feature(_unique_name(base, used_names), {
                'kind': 'ridge',
                'summit': summit['id'],
                'summitName': properties.get('name', ''),
                'sunlitSide': sunlit_side,
                'shadedSide': shaded_side,
                'radiusMetres': radius_metres,
                'source': 'Copernicus DEM GLO-30 and OpenStreetMap summits',
            }, {'type': 'LineString', 'coordinates': path}))
            summit_features_added += 1
        report['items'].append({
            'summit': summit['id'],
            'name': properties.get('name', ''),
            'sunlitSide': sunlit_side,
            'shadedSide': shaded_side,
            'segments': len(lines),
            'features': summit_features_added,
        })
    report['features'] = len(features)
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
        merged = linemerge(unary_union(parts))
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
            parts.append((clipped, cliff['entityId']))
        elif clipped.geom_type in ('MultiLineString', 'GeometryCollection'):
            parts.extend(
                (part, cliff['entityId']) for part in clipped.geoms
                if part.geom_type == 'LineString' and part.length > 0
            )
    return parts


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


def _qualifying_cliffs(cliffs, lines, bank, detail_bounds, latitude_metres,
                       longitude_metres, rim_geometry, near_metres):
    candidates = []
    for line in lines:
        candidates.extend(_cliff_parts(
            cliffs, line, bank, detail_bounds, latitude_metres, longitude_metres
        ))
    kept = [
        (part, identifier) for part, identifier in candidates
        if part.distance(rim_geometry) <= near_metres / latitude_metres
    ]
    return kept, sorted({identifier for _, identifier in kept})


def _metric_length(geometry, latitude_metres, longitude_metres):
    if geometry.is_empty:
        return 0.0

    def to_metres(x, y):
        return x * longitude_metres, y * latitude_metres
    return transform(to_metres, geometry).length


def build_canyon_rims(model, water, cliffs, detail_bounds,
                      river_names=('Morača', 'Ribnica'), sample_spacing_metres=40):
    """Keep canyon rims only where the bank rises at least 8 m within 60 m."""
    latitude_metres = 111_320
    longitude_metres = latitude_metres * math.cos(
        math.radians((detail_bounds[1] + detail_bounds[3]) / 2)
    )
    grouped = {}
    for river_name, line in _river_centrelines(water, detail_bounds, river_names):
        grouped.setdefault(river_name, []).append(_orient_downstream(line, model))

    features = []
    report = {
        'riverBanks': [],
        'sampleSpacingMetres': sample_spacing_metres,
        'minimumBankRiseMetres': CANYON_BANK_RISE_METRES,
        'searchDistanceMetres': CANYON_SEARCH_DISTANCE_METRES,
        'searchStepMetres': CANYON_SEARCH_STEP_METRES,
        'geometry': 'one LineString feature per canyon segment with a shared derived identity and entityPart numbers',
    }
    for river_name in river_names:
        for bank in ('left', 'right'):
            samples = []
            for line in grouped.get(river_name, []):
                samples.extend(_bank_samples(
                    line, bank, model, latitude_metres, longitude_metres,
                    sample_spacing_metres,
                ))
            segments = _segments_from_samples(
                samples, sample_spacing_metres * 1.5 / latitude_metres
            )
            segments.sort(key=lambda segment: tuple(segment[0].coords[0]))
            rim_geometry = unary_union([line for line, _ in segments])
            cliff_parts, cliff_ways = _qualifying_cliffs(
                cliffs, grouped.get(river_name, []), bank, detail_bounds,
                latitude_metres, longitude_metres, rim_geometry,
                CANYON_SEARCH_DISTANCE_METRES / 2,
            ) if segments else ([], [])
            cliff_length = sum(
                _metric_length(part, latitude_metres, longitude_metres)
                for part, _ in cliff_parts
            )
            dem_length = sum(
                _metric_length(line, latitude_metres, longitude_metres)
                for line, _ in segments
            )
            method = (
                'osm-cliff and dem-canyon-bank' if cliff_ways else 'dem-canyon-bank'
            )
            if segments:
                parts = []
                name = f'canyon-rim-{entity_slug(river_name)}-{bank}'
                for index, (segment, rise) in enumerate(segments):
                    geometry = {
                        'type': 'LineString',
                        'coordinates': rounded_coordinates(list(segment.coords)),
                    }
                    length_metres = _metric_length(
                        segment, latitude_metres, longitude_metres
                    )
                    parts.append(({
                        'kind': 'canyon-rim',
                        'river': river_name,
                        'bank': bank,
                        'bankDefinition': 'left and right of the downstream DEM-oriented centreline',
                        'method': method,
                        'cliffWays': cliff_ways,
                        'cliffLengthMetres': round(cliff_length),
                        'demLengthMetres': round(dem_length),
                        'segmentLengthMetres': round(length_metres),
                        'segmentBankRiseMetres': round(rise, 2),
                        'minimumBankRiseMetres': CANYON_BANK_RISE_METRES,
                        'searchDistanceMetres': CANYON_SEARCH_DISTANCE_METRES,
                        'searchStepMetres': CANYON_SEARCH_STEP_METRES,
                        'source': 'Copernicus DEM GLO-30 and OpenStreetMap cliffs',
                    }, geometry))
                features.extend(derived_parts(name, parts))
            report['riverBanks'].append({
                'river': river_name,
                'bank': bank,
                'method': method,
                'cliffWays': cliff_ways,
                'cliffLengthMetres': round(cliff_length),
                'demLengthMetres': round(dem_length),
                'totalLengthMetres': round(dem_length),
                'features': len(segments),
                'segments': [
                    {
                        'entityPart': index,
                        'lengthMetres': round(_metric_length(
                            line, latitude_metres, longitude_metres
                        )),
                        'bankRiseMetres': round(rise, 2),
                    }
                    for index, (line, rise) in enumerate(segments)
                ],
            })
    return features, report


LICENSE_BLOCK = {
    'attribution': CANONICAL_ATTRIBUTION,
    'adaptedProductNotice': ADAPTED_PRODUCT_NOTICE,
    'bucket': 'https://copernicus-dem-30m.s3.amazonaws.com/',
    'eula': 'https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N42_00_E019_00_DEM/INFO/eula_F.pdf',
    'collection': 'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',
}
