"""Readers for the external DEM tiles, OSM snapshot and reviewed source geometry.

Every reader fails visibly on a missing or changed input. Files are only read here;
the builder writes sources after all inputs have been checked.
"""

import hashlib
import json
import math
from contextlib import ExitStack

import numpy as np
import osmium
import rasterio
from rasterio.windows import Window

TILE_SUFFIX = '.tif'
SHA256_FILENAME = 'SHA256SUMS'
METRES_PER_DEGREE_LATITUDE = 111_320


def sha256_file(path):
    """Return the lowercase SHA-256 of a file, read in bounded blocks."""
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def check_sha256(path, expected, label):
    """Raise when an external input no longer matches the reviewed checksum."""
    actual = sha256_file(path)
    if actual != expected:
        raise ValueError(f'{label}: SHA-256 {actual}, expected {expected}')


class TerrainModel:
    """A small mosaic of Copernicus DEM tiles opened for the lifetime of a build."""

    def __init__(self, directory):
        self.directory = directory
        self.paths = sorted(directory.glob('*' + TILE_SUFFIX))
        if not self.paths:
            raise ValueError(f'No DEM tiles in {directory}')
        checksums = {}
        for line in (directory / SHA256_FILENAME).read_text().splitlines():
            digest, filename = line.split()
            checksums[filename] = digest
        if set(checksums) != {path.name for path in self.paths}:
            raise ValueError('DEM tile list and SHA256SUMS disagree')
        for path in self.paths:
            check_sha256(path, checksums[path.name], path.name)
        self._datasets = []

    def __enter__(self):
        """Open every verified tile; the tiles stay open until ``__exit__``."""
        self._stack = ExitStack()
        for path in self.paths:
            self._datasets.append(self._stack.enter_context(rasterio.open(path)))
        return self

    def __exit__(self, exception_type, exception, traceback):
        self._stack.close()

    def _dataset_at(self, longitude, latitude):
        for dataset in self._datasets:
            bounds = dataset.bounds
            if bounds.left <= longitude < bounds.right and bounds.bottom <= latitude < bounds.top:
                return dataset
        raise ValueError(f'No DEM tile covers {longitude}, {latitude}')

    def sample(self, longitude, latitude):
        """Return the EGM2008 height of the pixel centre nearest a WGS84 point."""
        dataset = self._dataset_at(longitude, latitude)
        row, column = dataset.index(longitude, latitude)
        value = float(dataset.read(1, window=Window(column, row, 1, 1))[0, 0])
        if not math.isfinite(value):
            raise ValueError(f'DEM has no height at {longitude}, {latitude}')
        return value

    def detail_grid(self, bounds):
        """Read a detail bounding box as heights and its pixel-centre coordinate arrays.

        ``bounds`` is west, south, east, north. The box must lie inside one tile, which
        keeps the array aligned to the source raster without a resampling step.
        """
        west, south, east, north = bounds
        covering = [
            dataset for dataset in self._datasets
            if dataset.bounds.left <= west and dataset.bounds.right >= east
            and dataset.bounds.bottom <= south and dataset.bounds.top >= north
        ]
        if len(covering) != 1:
            raise ValueError(f'Detail box {bounds} is not inside exactly one DEM tile')
        dataset = covering[0]
        top_row, left_column = dataset.index(west, north)
        bottom_row, right_column = dataset.index(east, south)
        window = Window(
            left_column, top_row,
            right_column - left_column + 1, bottom_row - top_row + 1,
        )
        heights = dataset.read(1, window=window)
        if not np.isfinite(heights).all():
            raise ValueError('Detail box contains DEM pixels without a height')
        longitude, _ = dataset.xy(top_row, left_column)
        _, latitude = dataset.xy(top_row, left_column)
        resolution = abs(dataset.res[0])
        longitudes = longitude + resolution * np.arange(window.width)
        latitudes = latitude - resolution * np.arange(window.height)
        metres_per_column = resolution * METRES_PER_DEGREE_LATITUDE * math.cos(
            math.radians(latitude)
        )
        metres_per_row = resolution * METRES_PER_DEGREE_LATITUDE
        return {
            'heights': heights,
            'longitudes': longitudes,
            'latitudes': latitudes,
            'metres_per_column': metres_per_column,
            'metres_per_row': metres_per_row,
        }

    def surrounding_height(self, longitude, latitude, radius_metres=100, directions=24):
        """Return the highest sampled DEM height on a ring around a summit."""
        latitude_metres = METRES_PER_DEGREE_LATITUDE
        longitude_metres = latitude_metres * math.cos(math.radians(latitude))
        highest = self.sample(longitude, latitude)
        for step in range(directions):
            angle = 2 * math.pi * step / directions
            offset_east = radius_metres * math.cos(angle)
            offset_north = radius_metres * math.sin(angle)
            highest = max(highest, self.sample(
                longitude + offset_east / longitude_metres,
                latitude + offset_north / latitude_metres,
            ))
        return highest


class SummitReader(osmium.SimpleHandler):
    """Collect OSM peaks and hills, keeping their typed identity and version."""

    def __init__(self):
        super().__init__()
        self.summits = []

    def _record(self, tags, identity, version, coordinates):
        if tags.get('natural') not in ('peak', 'hill'):
            return
        self.summits.append({
            'entityId': identity,
            'entityVersion': int(version),
            'kind': tags.get('natural'),
            'coordinates': coordinates,
            'tags': dict(tags),
        })

    def node(self, node):
        if node.location.valid():
            coordinates = [node.location.lon, node.location.lat]
            self._record(node.tags, f'node/{node.id}', node.version, coordinates)

    def way(self, way):
        coordinates = [
            [point.lon, point.lat] for point in way.nodes if point.location.valid()
        ]
        if len(coordinates) < 3:
            return
        centre = [
            sum(point[0] for point in coordinates) / len(coordinates),
            sum(point[1] for point in coordinates) / len(coordinates),
        ]
        self._record(way.tags, f'way/{way.id}', way.version, centre)


class CliffReader(osmium.SimpleHandler):
    """Collect OSM cliff and earth-bank ways that touch the detail box."""

    NATURAL_VALUES = ('cliff', 'earth_bank')

    def __init__(self, bounds):
        super().__init__()
        self.bounds = bounds
        self.cliffs = []

    def way(self, way):
        natural = way.tags.get('natural')
        if natural not in self.NATURAL_VALUES:
            return
        coordinates = [
            [point.lon, point.lat] for point in way.nodes if point.location.valid()
        ]
        if len(coordinates) < 2:
            return
        west, south, east, north = self.bounds
        if not any(
            west <= longitude <= east and south <= latitude <= north
            for longitude, latitude in coordinates
        ):
            return
        self.cliffs.append({
            'entityId': f'way/{way.id}',
            'entityVersion': int(way.version),
            'kind': natural,
            'coordinates': coordinates,
        })


def read_osm(pbf_path, expected_sha256, detail_bounds):
    """Read and verify the OSM snapshot, returning summits and local cliffs."""
    check_sha256(pbf_path, expected_sha256, pbf_path.name)
    summits = SummitReader()
    summits.apply_file(str(pbf_path), locations=True, idx='flex_mem')
    cliffs = CliffReader(detail_bounds)
    cliffs.apply_file(str(pbf_path), locations=True, idx='flex_mem')
    reader = osmium.io.Reader(str(pbf_path))
    timestamp = reader.header().get('osmosis_replication_timestamp')
    if not timestamp:
        raise ValueError('OSM snapshot has no replication timestamp')
    return {
        'summits': sorted(summits.summits, key=lambda summit: summit['entityId']),
        'cliffs': sorted(cliffs.cliffs, key=lambda cliff: cliff['entityId']),
        'timestamp': timestamp,
    }


def read_geojson(path):
    """Read a reviewed GeoJSON collection without changing it."""
    collection = json.loads(path.read_text(encoding='utf8'))
    if collection.get('type') != 'FeatureCollection' or not isinstance(
        collection.get('features'), list
    ):
        raise ValueError(f'{path.name}: expected a FeatureCollection')
    return collection
