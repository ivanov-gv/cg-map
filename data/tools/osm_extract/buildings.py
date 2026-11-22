"""Building attributes, addresses, entrances and road-name joins."""

import json
import math
import re
from collections import Counter
from pathlib import Path

from shapely.affinity import scale
from shapely.geometry import shape
from shapely.strtree import STRtree

from . import Layer
from .geometry import clipped_features, rounded_geometry, way_coordinates
from .identity import make_feature, osm_identity
from .roads import MAJOR_KINDS, SKIPPED_KINDS

SOURCE_FILE = 'buildings.geojson'
ENTRANCE_FILE = 'building-entrances.geojson'
NAME_TAGS = (
    'building', 'building:levels', 'building:material', 'start_date',
    'name', 'addr:street', 'addr:housenumber', 'roof:levels'
)
ENTRANCE_TAGS = ('ref', 'level', 'wheelchair', 'door')
EARTH_RADIUS_METRES = 6371008.8
DEGREES_TO_RADIANS = math.pi / 180
MAX_ENTRANCE_DISTANCE_METRES = 1.0


def normalize_street_name(value):
    """Fold case and runs of whitespace; never transliterate or drop punctuation."""
    return ' '.join(value.split()).casefold()


def number_rules(sources_dir):
    """Read the address placeholder rule the editor contract already enforces."""
    contract_path = (
        sources_dir.parents[1] / 'packages/contracts/editor-layers.json'
    )
    rules = json.loads(contract_path.read_text(encoding='utf-8'))
    house_number = rules['layers']['building-labels.geojson'][
        'properties'
    ]['addr:housenumber']
    return (
        set(house_number['forbiddenValues']),
        re.compile(house_number['ignoredCharactersPattern'])
    )


def is_placeholder(number, forbidden_values, ignored_characters):
    """Report whether an OSM house number only says that there is no number."""
    normalized = ignored_characters.sub('', number.casefold())
    return normalized in forbidden_values


def building_parts(way, options):
    """Return the published geometry parts of one closed building way."""
    if not way.tags.get('building') or not way.is_closed():
        return []
    coordinates = way_coordinates(way)
    if len(coordinates) < 4:
        return []
    is_local = options.all_details or any(
        options.contains(*coordinate) for coordinate in coordinates
    )
    if not is_local:
        return []
    identity = osm_identity('way', way.id, way.version)
    geometry = {'type': 'Polygon', 'coordinates': [coordinates]}
    return clipped_features(geometry, options.detail_bbox, identity, {})


def record_building_part(feature, state):
    """Remember one published footprint for joins to entrances and places."""
    properties = feature['properties']
    key = (properties['entityId'], properties.get('entityPart'))
    if key not in state.buildings:
        state.buildings[key] = {
            'entityId': properties['entityId'],
            'entityPart': properties.get('entityPart'),
            'geometry': feature['geometry'],
            'shape': shape(feature['geometry']),
        }


class BuildingGeometryLayer(Layer):
    """Collect footprints when another layer group needs them for joins."""

    def way(self, way, options, state):
        for feature in building_parts(way, options):
            record_building_part(feature, state)


class BuildingsLayer(Layer):
    """Write footprints with their OSM identity and copied address tags."""

    filename = SOURCE_FILE

    def way(self, way, options, state):
        parts = building_parts(way, options)
        if not parts:
            return
        properties = {'kind': 'building', 'osm_id': f'way/{way.id}'}
        for tag in NAME_TAGS:
            if way.tags.get(tag):
                properties[tag] = way.tags[tag]
        for part in parts:
            record_building_part(part, state)
            part['properties'].update(properties)
            self.features.append(part)

    def finish(self, options, state):
        """Replace no-number placeholders and join street names once."""
        forbidden_values, ignored_characters = number_rules(
            options.sources_directory
        )
        counts = Counter()
        for feature in self.features:
            properties = feature['properties']
            number = properties.get('addr:housenumber')
            if number and is_placeholder(
                number, forbidden_values, ignored_characters
            ):
                del properties['addr:housenumber']
                properties['nohousenumber'] = 'yes'
                counts['nohousenumber'] += 1
            counts['addr:housenumberPresent'] += int(
                'addr:housenumber' in properties
            )
            street = properties.get('addr:street')
            if street is None:
                continue
            counts['addr:street'] += 1
            road_ids = state.road_names.get(normalize_street_name(street), set())
            if len(road_ids) == 1:
                properties['addr:streetEntityId'] = next(iter(road_ids))
                counts['addr:streetEntityId'] += 1
            else:
                counts['addr:streetUnjoined'] += 1
        for tag in NAME_TAGS:
            counts[tag] = sum(tag in feature['properties'] for feature in self.features)
        state.building_counts.update(counts)
        return self.features


class RoadNameCollector(Layer):
    """Collect the named road groups the roads layer publishes."""

    def way(self, way, options, state):
        kind = way.tags.get('highway', '')
        name = way.tags.get('name', '')
        if not kind or kind in SKIPPED_KINDS or not name:
            return
        coordinates = way_coordinates(way)
        if len(coordinates) < 2:
            return
        is_local = options.all_details or any(
            options.contains(*coordinate) for coordinate in coordinates
        )
        if not (is_local or kind in MAJOR_KINDS):
            return
        key = normalize_street_name(name)
        state.road_names.setdefault(key, set()).add(f'way/{way.id}')


def metric_geometry(geometry, origin):
    """Scale WGS84 geometry to approximate metres around the detail box centre."""
    longitude_scale = (
        EARTH_RADIUS_METRES * DEGREES_TO_RADIANS * math.cos(
            origin[1] * DEGREES_TO_RADIANS
        )
    )
    latitude_scale = EARTH_RADIUS_METRES * DEGREES_TO_RADIANS
    return scale(
        geometry, xfact=longitude_scale, yfact=latitude_scale, origin=origin
    )


class EntrancesLayer(Layer):
    """Write OSM entrance nodes joined to the nearest nearby building."""

    filename = ENTRANCE_FILE

    def __init__(self):
        super().__init__()
        self.candidates = []

    def node(self, node, options, state):
        entrance = node.tags.get('entrance')
        if not entrance or not node.location.valid():
            return
        coordinate = (node.location.lon, node.location.lat)
        if not options.contains(*coordinate):
            return
        self.candidates.append({
            'coordinate': coordinate,
            'tags': dict(node.tags),
            'identity': osm_identity('node', node.id, node.version),
        })

    def finish(self, options, state):
        """Keep only doors on a published building outline within one metre."""
        forbidden_values, ignored_characters = number_rules(
            options.sources_directory
        )
        west, south, east, north = options.detail_bbox
        origin = ((west + east) / 2, (south + north) / 2)
        footprints = [
            (record, metric_geometry(record['shape'], origin))
            for record in state.buildings.values()
        ]
        tree = STRtree([footprint for _, footprint in footprints])
        counts = Counter()
        for candidate in self.candidates:
            point = metric_geometry(
                shape({'type': 'Point', 'coordinates': candidate['coordinate']}),
                origin
            )
            nearest_index = tree.nearest(point) if footprints else None
            if (
                nearest_index is None
                or point.distance(footprints[nearest_index][1])
                > MAX_ENTRANCE_DISTANCE_METRES
            ):
                counts['entrancesUnjoined'] += 1
                continue
            record = footprints[nearest_index][0]
            properties = {
                'kind': 'entrance',
                'entrance': candidate['tags']['entrance'],
                'buildingEntityId': record['entityId'],
            }
            for tag in ENTRANCE_TAGS:
                if candidate['tags'].get(tag):
                    properties[tag] = candidate['tags'][tag]
            for tag, value in candidate['tags'].items():
                if not tag.startswith('addr:'):
                    continue
                if (
                    tag == 'addr:housenumber'
                    and is_placeholder(value, forbidden_values, ignored_characters)
                ):
                    properties['nohousenumber'] = 'yes'
                    counts['entrance:nohousenumber'] += 1
                    continue
                properties[tag] = value
            geometry = {
                'type': 'Point',
                'coordinates': rounded_geometry(list(candidate['coordinate'])),
            }
            self.features.append(make_feature(
                geometry, properties, candidate['identity']
            ))
        counts['entrances'] = len(self.features)
        for feature in self.features:
            for tag in feature['properties']:
                if tag in ENTRANCE_TAGS or tag.startswith('addr:'):
                    counts[f'entrance:{tag}'] += 1
            counts[f'entranceKind:{feature["properties"]["entrance"]}'] += 1
        state.building_counts.update(counts)
        return self.features
