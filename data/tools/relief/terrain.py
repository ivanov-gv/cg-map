"""Terrain arithmetic shared by the relief builder and its dependency-free tests.

Arrays are ordered north to south and west to east. Height units are metres above EGM2008.
This module deliberately imports only NumPy so the unit tests run with the repository's
plain ``python3`` rather than the full GIS environment.
"""

import hashlib
import json
import math

import numpy as np

CONTOUR_INTERVAL_METRES = 20
INDEX_INTERVAL_METRES = 100
FLAT_SLOPE_DEGREES = 3.0
COORDINATE_DECIMALS = 6
HEIGHT_MISMATCH_METRES = 25.0
CONTOUR_SIMPLIFY_TOLERANCE_DEGREES = 0.00001
RIDGE_SIMPLIFY_TOLERANCE_DEGREES = 0.00001

# One DEM pixel is 30 m, so a sub-100 m class boundary is a speckle of one or two pixels.
# An OSM summit point and the DEM cell that represents the crest are independent samples,
# so a summit within 50 m still identifies the hill whose shared slope boundary we publish.
RIDGE_MINIMUM_LENGTH_METRES = 100
RIDGE_SUMMIT_LINK_DISTANCE_METRES = 50

# A gap under 60 m is usually one bad DEM sample or a small bend in the 30 m raster, not a
# second rim; joining first keeps one bank as one line. What remains under 100 m after that
# join is shorter than three pixels and reads as speckle, so it is not published.
CANYON_BANK_RISE_METRES = 8.0
CANYON_SEARCH_DISTANCE_METRES = 60
CANYON_SEARCH_STEP_METRES = 10
CANYON_RIM_JOIN_GAP_METRES = 60
CANYON_RIM_MINIMUM_LENGTH_METRES = 100


def contour_levels(minimum_height, maximum_height, interval=CONTOUR_INTERVAL_METRES):
    """Return the ordered contour heights strictly inside the observed height range."""
    first_level = math.ceil(minimum_height / interval) * interval
    last_level = math.floor(maximum_height / interval) * interval
    if first_level > last_level:
        return []
    return list(range(first_level, last_level + interval, interval))


def is_index_level(level, interval=INDEX_INTERVAL_METRES):
    """Return whether a contour height gets the heavier index-line treatment."""
    return level % interval == 0


def slope_and_aspect(heights, metres_per_column, metres_per_row):
    """Return slope degrees and downslope aspect degrees clockwise from north.

    ``heights`` is a two-dimensional array. Its rows move south and its columns move east,
    so the row gradient is the change towards the south, not towards the north.
    """
    southward_gradient, eastward_gradient = np.gradient(
        np.asarray(heights, dtype=float), metres_per_row, metres_per_column
    )
    slope_degrees = np.degrees(np.arctan(np.hypot(eastward_gradient, southward_gradient)))
    aspect_degrees = np.degrees(
        np.arctan2(-eastward_gradient, southward_gradient)
    ) % 360
    return slope_degrees, aspect_degrees


def sunlit_mask(heights, metres_per_column, metres_per_row, flat_degrees=FLAT_SLOPE_DEGREES):
    """Mark cells facing east through south to west, including flat ground, as sunlit."""
    slope_degrees, aspect_degrees = slope_and_aspect(
        heights, metres_per_column, metres_per_row
    )
    is_flat = slope_degrees <= flat_degrees
    faces_sun = (aspect_degrees >= 90) & (aspect_degrees <= 270)
    return is_flat | faces_sun


def aspect_boundary_paths(cell_classes, x_edges, y_edges):
    """Return cell-edge paths shared by neighbouring sunlit and shaded slope cells.

    ``cell_classes`` is -1 outside the published slopes, 0 for shaded cells and 1 for sunlit
    cells. Only a neighbouring 0/1 pair emits its common edge, so a returned path is exactly
    the boundary of the two light classes rather than a line drawn around one summit.
    """
    classes = np.asarray(cell_classes, dtype=int)
    horizontal_edges = np.asarray(x_edges, dtype=float)
    vertical_edges = np.asarray(y_edges, dtype=float)
    paths = []
    for row in range(classes.shape[0]):
        for column in range(classes.shape[1]):
            current_class = int(classes[row, column])
            if current_class not in (0, 1):
                continue
            if column + 1 < classes.shape[1]:
                east_class = int(classes[row, column + 1])
                if east_class in (0, 1) and east_class != current_class:
                    boundary_longitude = float(horizontal_edges[column + 1])
                    paths.append([
                        [boundary_longitude, float(vertical_edges[row + 1])],
                        [boundary_longitude, float(vertical_edges[row])],
                    ])
            if row + 1 < classes.shape[0]:
                south_class = int(classes[row + 1, column])
                if south_class in (0, 1) and south_class != current_class:
                    boundary_latitude = float(vertical_edges[row + 1])
                    paths.append([
                        [float(horizontal_edges[column]), boundary_latitude],
                        [float(horizontal_edges[column + 1]), boundary_latitude],
                    ])
    return paths


def path_length_metres(path, longitude_metres_per_degree, latitude_metres_per_degree):
    """Return the metre length of one WGS84 coordinate path at the build latitude."""
    if len(path) < 2:
        return 0.0
    eastwards = np.diff([point[0] for point in path]) * longitude_metres_per_degree
    northwards = np.diff([point[1] for point in path]) * latitude_metres_per_degree
    return float(np.hypot(eastwards, northwards).sum())


def join_short_gaps(paths, gap_metres, longitude_metres_per_degree, latitude_metres_per_degree):
    """Join ordered paths when the gap between one end and the next start is under a limit."""
    joined = []
    for path in paths:
        coordinates = [list(point) for point in path]
        if not coordinates:
            continue
        if joined:
            previous_end = joined[-1][-1]
            next_start = coordinates[0]
            east = (next_start[0] - previous_end[0]) * longitude_metres_per_degree
            north = (next_start[1] - previous_end[1]) * latitude_metres_per_degree
            if math.hypot(east, north) < gap_metres:
                joined[-1].extend(coordinates)
                continue
        joined.append(coordinates)
    return joined


def drop_short_paths(paths, minimum_length_metres, longitude_metres_per_degree,
                     latitude_metres_per_degree):
    """Keep only paths at least as long as the published minimum."""
    return [
        path for path in paths
        if path_length_metres(
            path, longitude_metres_per_degree, latitude_metres_per_degree
        ) >= minimum_length_metres
    ]


def smooth_heights(heights):
    """Average each cell with its four neighbours without wrapping across array edges."""
    source = np.asarray(heights, dtype=float)
    padded = np.pad(source, 1, mode='edge')
    return (
        padded[1:-1, 1:-1]
        + padded[:-2, 1:-1]
        + padded[2:, 1:-1]
        + padded[1:-1, :-2]
        + padded[1:-1, 2:]
    ) / 5


def rounded_coordinates(coordinates):
    """Round a nested GeoJSON coordinate structure to the published six decimals."""
    if isinstance(coordinates, (list, tuple, np.ndarray)):
        return [rounded_coordinates(value) for value in coordinates]
    if isinstance(coordinates, (float, int, np.floating, np.integer)) and not isinstance(coordinates, bool):
        return round(float(coordinates), COORDINATE_DECIMALS)
    return coordinates


def content_hash(payload):
    """Return a stable content-version token for a derived GeoJSON feature."""
    canonical = json.dumps(
        payload, ensure_ascii=False, separators=(',', ':'), sort_keys=True
    ).encode('utf8')
    return 'sha256:' + hashlib.sha256(canonical).hexdigest()


def coordinate_slug(value):
    """Encode a rounded coordinate as the lowercase slug used by derived IDs."""
    return f'{value:.{COORDINATE_DECIMALS}f}'.replace('.', '_').replace('-', 'm')


def classify_height_check(osm_elevation, dem_elevation, enclosing_contour):
    """Return the published summit check without treating a missing height as a mismatch."""
    if osm_elevation is None:
        return 'missing'
    has_high_contour = enclosing_contour is not None and enclosing_contour > osm_elevation
    has_large_difference = abs(osm_elevation - dem_elevation) > HEIGHT_MISMATCH_METRES
    return 'mismatch' if has_high_contour or has_large_difference else 'ok'


def bank_rise(river_elevation, bank_elevations):
    """Return the highest sampled bank height above the river surface."""
    finite_heights = [height for height in bank_elevations if math.isfinite(height)]
    return max(finite_heights) - river_elevation if finite_heights else float('-inf')


def is_canyon_bank(river_elevation, bank_elevations):
    """Return whether the sampled bank rises enough to count as a canyon edge."""
    return bank_rise(river_elevation, bank_elevations) >= CANYON_BANK_RISE_METRES


def separate_line_paths(paths):
    """Keep every connected input path as its own line in a stable start-coordinate order."""
    lines = []
    for path in paths:
        coordinates = rounded_coordinates(path)
        if len(coordinates) >= 2:
            lines.append(coordinates)
    return sorted(lines, key=lambda line: (
        line[0][0], line[0][1], line[-1][0], line[-1][1], len(line), line,
    ))


def sort_features(features):
    """Return features ordered by identity and split part for deterministic publication."""
    return sorted(features, key=lambda feature: (
        feature['properties']['entityId'],
        feature['properties'].get('entityPart', -1),
    ))


def versioned_properties(properties, geometry):
    """Bind a computed feature's identity and geometry to its content version."""
    unsigned = {key: value for key, value in properties.items() if key != 'entityVersion'}
    return {**properties, 'entityVersion': content_hash({
        'geometry': geometry, 'properties': unsigned,
    })}


def serialize_collection(features):
    """Serialize an adopted collection with sorted keys and features."""
    collection = {
        'type': 'FeatureCollection',
        'entitySchemaVersion': 1,
        'features': sort_features(features),
    }
    return json.dumps(
        collection, ensure_ascii=False, separators=(',', ':'), sort_keys=True
    ) + '\n'


def interpolate_on_edge(first, second, level):
    """Return the point where a terrain height crosses a contour level on one grid edge."""
    offset = (level - first[2]) / (second[2] - first[2])
    return [
        first[0] + offset * (second[0] - first[0]),
        first[1] + offset * (second[1] - first[1]),
    ]


def contour_paths_from_grid(heights, longitudes, latitudes, levels):
    """Trace contour segments through a small height grid using marching squares.

    The builder uses contourpy on the full raster, but this dependency-free implementation
    gives the tests the same invariant: distinct levels are interpolated on the same edges
    and therefore cannot cross.
    """
    grid = np.asarray(heights, dtype=float)
    xs = np.asarray(longitudes, dtype=float)
    ys = np.asarray(latitudes, dtype=float)
    for level in levels:
        for row in range(grid.shape[0] - 1):
            for column in range(grid.shape[1] - 1):
                corners = [
                    (xs[column], ys[row], grid[row, column]),
                    (xs[column + 1], ys[row], grid[row, column + 1]),
                    (xs[column + 1], ys[row + 1], grid[row + 1, column + 1]),
                    (xs[column], ys[row + 1], grid[row + 1, column]),
                ]
                crossings = []
                for edge in range(4):
                    first, second = corners[edge], corners[(edge + 1) % 4]
                    if (first[2] <= level < second[2]) or (second[2] <= level < first[2]):
                        crossings.append(interpolate_on_edge(first, second, level))
                if len(crossings) == 2:
                    paths = [crossings]
                elif len(crossings) == 4:
                    paths = [crossings[:2], crossings[2:]]
                else:
                    continue
                for path in paths:
                    yield {'level': level, 'path': path}


def _orientation(first, second, third):
    return (second[0] - first[0]) * (third[1] - first[1]) - (
        second[1] - first[1]
    ) * (third[0] - first[0])


def _on_segment(first, second, point):
    return (
        min(first[0], second[0]) <= point[0] <= max(first[0], second[0])
        and min(first[1], second[1]) <= point[1] <= max(first[1], second[1])
    )


def _collinear_overlap(first, second, third, fourth):
    points = [first, second, third, fourth]
    if any(_orientation(first, second, point) != 0 for point in points[2:]):
        return False
    return any(_on_segment(first, second, point) for point in points[2:]) or any(
        _on_segment(third, fourth, point) for point in points[:2]
    )


def segments_cross(first, second, third, fourth):
    """Return whether two line segments cross or share a positive-length overlap."""
    turns = [
        _orientation(first, second, third),
        _orientation(first, second, fourth),
        _orientation(third, fourth, first),
        _orientation(third, fourth, second),
    ]
    if turns[0] * turns[1] < 0 and turns[2] * turns[3] < 0:
        return True
    return all(turn == 0 for turn in turns) and _collinear_overlap(
        first, second, third, fourth
    )


def contour_crossing_pairs(segments):
    """Find pairs of different-height contours that cross, using a uniform grid index."""
    if not segments:
        return []
    coordinates = [segment['path'] for segment in segments]
    all_points = [point for path in coordinates for point in path]
    span_x = max(point[0] for point in all_points) - min(point[0] for point in all_points)
    span_y = max(point[1] for point in all_points) - min(point[1] for point in all_points)
    bucket_size = max(span_x, span_y, 1e-9) / 128
    origin_x = min(point[0] for point in all_points)
    origin_y = min(point[1] for point in all_points)

    def bucket_ids(path):
        ranges = []
        for axis in (0, 1):
            origin = origin_x if axis == 0 else origin_y
            low = int((min(point[axis] for point in path) - origin) / bucket_size)
            high = int((max(point[axis] for point in path) - origin) / bucket_size)
            ranges.append(range(low, high + 1))
        return [(x, y) for x in ranges[0] for y in ranges[1]]

    buckets = {}
    for index, segment in enumerate(segments):
        for bucket in bucket_ids(segment['path']):
            buckets.setdefault(bucket, []).append(index)

    crossings = []
    compared = set()
    for indices in buckets.values():
        for position, first_index in enumerate(indices):
            for second_index in indices[position + 1:]:
                pair = (min(first_index, second_index), max(first_index, second_index))
                if pair in compared:
                    continue
                compared.add(pair)
                first, second = segments[first_index], segments[second_index]
                if first['level'] == second['level']:
                    continue
                if segments_cross(*first['path'], *second['path']):
                    crossings.append((first, second))
    return crossings


def assert_contours_do_not_cross(segments):
    """Raise with a short description when contours of different heights cross."""
    crossings = contour_crossing_pairs(segments)
    if crossings:
        first, second = crossings[0]
        raise ValueError(
            f'{len(crossings)} crossing contour pairs; first is '
            f'{first["level"]} m and {second["level"]} m'
        )
